package expo.modules.fileengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.RectF
import android.media.ExifInterface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Live, GPU-drawn edit preview with a native crop box. JS only sends settings and receives the crop. */
class ImageEditorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onLoad by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any>>()
  private val onCropChange by EventDispatcher<Map<String, Any>>()
  private val worker = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private val version = AtomicInteger(0)
  private val density = resources.displayMetrics.density
  private val canvasView = EditCanvas(context)
  private var source = ""
  private var bitmap: Bitmap? = null
  private var edits = ImageEdits()
  private var aspect = "none"
  private var crop = RectF(0f, 0f, 1f, 1f)
  @Volatile private var disposed = false

  init {
    addView(canvasView)
    canvasView.contentDescription = "Image being edited"
  }

  fun setSource(value: String) {
    if (value == source) return
    source = value
    load()
  }

  fun setEdits(json: String) {
    val next = try { ImageEdits.from(JSONObject(json)) } catch (_: Exception) { ImageEdits() }
    val geometryChanged = next.rotation != edits.rotation || next.flipH != edits.flipH || next.flipV != edits.flipV
    edits = next
    canvasView.paint.colorFilter = if (next.identityColor) null else ColorMatrixColorFilter(ImageProcessing.colorMatrix(next))
    if (geometryChanged) resetCrop()
    canvasView.invalidate()
  }

  fun setAspect(value: String) {
    if (value == aspect) return
    aspect = value
    resetCrop()
    canvasView.invalidate()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    canvasView.measure(MeasureSpec.makeMeasureSpec(right - left, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(bottom - top, MeasureSpec.EXACTLY))
    canvasView.layout(0, 0, right - left, bottom - top)
    if (changed && bitmap == null) load()
  }

  private fun load() {
    if (disposed || source.isEmpty() || width <= 0 || height <= 0) return
    val ticket = version.incrementAndGet()
    val uri = source
    val target = (max(width, height) * 1.25f).toInt().coerceIn(720, if (ImageProcessing.lowMemory(context)) 1440 else 2048)
    worker.execute {
      if (disposed || ticket != version.get()) return@execute
      try {
        val decoded = ImageProcessing.decode(context, Uri.parse(uri), target)
        val (fullWidth, fullHeight) = originalSize(Uri.parse(uri)) ?: (decoded.width to decoded.height)
        main.post {
          if (disposed || ticket != version.get()) { decoded.recycle(); return@post }
          bitmap = decoded
          resetCrop()
          canvasView.invalidate()
          onLoad(mapOf("width" to fullWidth, "height" to fullHeight))
        }
      } catch (_: OutOfMemoryError) {
        main.post { if (!disposed) onError(mapOf("message" to "This image is too large to edit on this device.")) }
      } catch (_: Exception) {
        main.post { if (!disposed) onError(mapOf("message" to "This image format cannot be edited on your device.")) }
      }
    }
  }

  private fun originalSize(uri: Uri): Pair<Int, Int>? = try {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    val open = { if (uri.scheme == "content") requireNotNull(context.contentResolver.openInputStream(uri)) else File(requireNotNull(uri.path)).inputStream() }
    open().use { BitmapFactory.decodeStream(it, null, options) }
    val orientation = try { open().use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) } } catch (_: Exception) { ExifInterface.ORIENTATION_NORMAL }
    val swap = orientation == ExifInterface.ORIENTATION_ROTATE_90 || orientation == ExifInterface.ORIENTATION_ROTATE_270
    if (options.outWidth > 0 && options.outHeight > 0) (if (swap) options.outHeight to options.outWidth else options.outWidth to options.outHeight) else null
  } catch (_: Exception) { null }

  private fun turned() = edits.rotation == 90 || edits.rotation == 270

  /** Width divided by height of the crop in normalised units for the chosen pixel aspect. */
  private fun normalizedRatio(): Float? {
    val image = bitmap ?: return null
    val pixels = when (aspect) {
      "1:1" -> 1f
      "4:3" -> 4f / 3f
      "3:4" -> 3f / 4f
      "16:9" -> 16f / 9f
      "9:16" -> 9f / 16f
      else -> return null
    }
    val w = if (turned()) image.height else image.width
    val h = if (turned()) image.width else image.height
    return pixels * h / w
  }

  private fun resetCrop() {
    val ratio = normalizedRatio()
    crop = if (ratio == null) RectF(0f, 0f, 1f, 1f) else {
      var w = 1f
      var h = w / ratio
      if (h > 1f) { h = 1f; w = h * ratio }
      RectF((1f - w) / 2f, (1f - h) / 2f, (1f + w) / 2f, (1f + h) / 2f)
    }
    emitCrop()
  }

  private fun emitCrop() {
    if (bitmap == null) return
    onCropChange(if (aspect == "none") emptyMap() else mapOf("x" to crop.left.toDouble(), "y" to crop.top.toDouble(), "width" to crop.width().toDouble(), "height" to crop.height().toDouble()))
  }

  fun dispose() {
    if (disposed) return
    disposed = true
    version.incrementAndGet()
    canvasView.setOnTouchListener(null)
    bitmap = null
    worker.shutdownNow()
  }

  private inner class EditCanvas(context: Context) : View(context) {
    val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val shade = Paint().apply { color = Color.argb(150, 0, 0, 0) }
    private val border = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.STROKE; strokeWidth = 2 * density }
    private val guide = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(120, 255, 255, 255); strokeWidth = density }
    private val handle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.STROKE; strokeWidth = 4 * density; strokeCap = Paint.Cap.ROUND }
    private val imageRect = RectF()
    private var dragging = DRAG_NONE
    private var lastX = 0f
    private var lastY = 0f

    private fun layoutImage(): Boolean {
      val image = bitmap ?: return false
      val pad = 20 * density
      val w = (if (turned()) image.height else image.width).toFloat()
      val h = (if (turned()) image.width else image.height).toFloat()
      val scale = min((width - pad * 2) / w, (height - pad * 2) / h)
      if (scale <= 0f) return false
      val left = (width - w * scale) / 2f
      val top = (height - h * scale) / 2f
      imageRect.set(left, top, left + w * scale, top + h * scale)
      return true
    }

    override fun onDraw(canvas: Canvas) {
      val image = bitmap ?: return
      if (image.isRecycled || !layoutImage()) return
      val scale = imageRect.width() / (if (turned()) image.height else image.width)
      canvas.save()
      canvas.translate(imageRect.centerX(), imageRect.centerY())
      canvas.rotate(edits.rotation.toFloat())
      canvas.scale(if (edits.flipH) -scale else scale, if (edits.flipV) -scale else scale)
      canvas.drawBitmap(image, -image.width / 2f, -image.height / 2f, paint)
      canvas.restore()
      if (aspect == "none") return
      val box = screenCrop()
      canvas.drawRect(imageRect.left, imageRect.top, imageRect.right, box.top, shade)
      canvas.drawRect(imageRect.left, box.bottom, imageRect.right, imageRect.bottom, shade)
      canvas.drawRect(imageRect.left, box.top, box.left, box.bottom, shade)
      canvas.drawRect(box.right, box.top, imageRect.right, box.bottom, shade)
      for (i in 1..2) {
        val x = box.left + box.width() * i / 3f
        val y = box.top + box.height() * i / 3f
        canvas.drawLine(x, box.top, x, box.bottom, guide)
        canvas.drawLine(box.left, y, box.right, y, guide)
      }
      canvas.drawRect(box, border)
      val arm = 18 * density
      for ((x, y) in listOf(box.left to box.top, box.right to box.top, box.left to box.bottom, box.right to box.bottom)) {
        val dx = if (x == box.left) arm else -arm
        val dy = if (y == box.top) arm else -arm
        canvas.drawLine(x, y, x + dx, y, handle)
        canvas.drawLine(x, y, x, y + dy, handle)
      }
    }

    private fun screenCrop() = RectF(
      imageRect.left + crop.left * imageRect.width(), imageRect.top + crop.top * imageRect.height(),
      imageRect.left + crop.right * imageRect.width(), imageRect.top + crop.bottom * imageRect.height(),
    )

    override fun onTouchEvent(event: MotionEvent): Boolean {
      if (aspect == "none" || bitmap == null || !layoutImage()) return false
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          val box = screenCrop()
          val reach = 32 * density
          dragging = when {
            abs(event.x - box.left) < reach && abs(event.y - box.top) < reach -> DRAG_TOP_LEFT
            abs(event.x - box.right) < reach && abs(event.y - box.top) < reach -> DRAG_TOP_RIGHT
            abs(event.x - box.left) < reach && abs(event.y - box.bottom) < reach -> DRAG_BOTTOM_LEFT
            abs(event.x - box.right) < reach && abs(event.y - box.bottom) < reach -> DRAG_BOTTOM_RIGHT
            box.contains(event.x, event.y) -> DRAG_MOVE
            else -> DRAG_NONE
          }
          lastX = event.x; lastY = event.y
          if (dragging != DRAG_NONE) parent?.requestDisallowInterceptTouchEvent(true)
          return dragging != DRAG_NONE
        }
        MotionEvent.ACTION_MOVE -> {
          if (dragging == DRAG_NONE) return false
          val dx = (event.x - lastX) / imageRect.width()
          val dy = (event.y - lastY) / imageRect.height()
          lastX = event.x; lastY = event.y
          if (dragging == DRAG_MOVE) {
            val moveX = dx.coerceIn(-crop.left, 1f - crop.right)
            val moveY = dy.coerceIn(-crop.top, 1f - crop.bottom)
            crop.offset(moveX, moveY)
          } else resize(dx, dy)
          invalidate()
          return true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          if (dragging != DRAG_NONE) emitCrop()
          dragging = DRAG_NONE
          parent?.requestDisallowInterceptTouchEvent(false)
          return true
        }
      }
      return true
    }

    private fun resize(dx: Float, dy: Float) {
      val minimum = 0.08f
      val ratio = normalizedRatio()
      val left = dragging == DRAG_TOP_LEFT || dragging == DRAG_BOTTOM_LEFT
      val top = dragging == DRAG_TOP_LEFT || dragging == DRAG_TOP_RIGHT
      val anchorX = if (left) crop.right else crop.left
      val anchorY = if (top) crop.bottom else crop.top
      var w = (crop.width() + if (left) -dx else dx).coerceIn(minimum, if (left) anchorX else 1f - anchorX)
      var h = (crop.height() + if (top) -dy else dy).coerceIn(minimum, if (top) anchorY else 1f - anchorY)
      if (ratio != null) {
        val maxH = if (top) anchorY else 1f - anchorY
        val maxW = if (left) anchorX else 1f - anchorX
        h = w / ratio
        if (h > maxH) { h = maxH; w = h * ratio }
        if (w > maxW) { w = maxW; h = w / ratio }
        if (w < minimum || h < minimum) return
      }
      crop.set(if (left) anchorX - w else anchorX, if (top) anchorY - h else anchorY, if (left) anchorX else anchorX + w, if (top) anchorY else anchorY + h)
    }
  }

  private companion object {
    const val DRAG_NONE = 0
    const val DRAG_MOVE = 1
    const val DRAG_TOP_LEFT = 2
    const val DRAG_TOP_RIGHT = 3
    const val DRAG_BOTTOM_LEFT = 4
    const val DRAG_BOTTOM_RIGHT = 5
  }
}

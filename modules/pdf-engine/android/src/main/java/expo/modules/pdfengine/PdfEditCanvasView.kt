package expo.modules.pdfengine

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.ImageView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Zoomable PDF page for the text editor with native hit-testing and an on-page text box. */
class PdfEditCanvasView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onSelectObject by EventDispatcher<Map<String, Any>>()
  private val onPlace by EventDispatcher<Map<String, Any>>()
  private val onTextChange by EventDispatcher<Map<String, Any>>()
  private val onSubmitText by EventDispatcher<Map<String, Any>>()

  private class Box(val id: Int, val rect: RectF)
  private class TextBox(val visible: Boolean, val text: String, val font: String, val size: Float, val color: Int, val underline: Boolean)
  private class Mark(val erase: RectF?, val left: Int, val right: Int, val lines: List<String>, val font: String, val size: Float, val color: Int, val x: Float, val y: Float, val underline: Boolean)
  private var marks = emptyList<Mark>()
  private val typefaces = HashMap<String, Typeface>()

  /** Standard PDF font names (Helvetica, Times, Courier with Bold/Oblique/Italic) as system faces. */
  private fun typefaceFor(font: String): Typeface = typefaces.getOrPut(font) {
    val base = when {
      font.startsWith("Times") -> Typeface.SERIF
      font.startsWith("Courier") -> Typeface.MONOSPACE
      else -> Typeface.SANS_SERIF
    }
    val bold = font.contains("Bold")
    val italic = font.contains("Oblique") || font.contains("Italic")
    Typeface.create(base, when { bold && italic -> Typeface.BOLD_ITALIC; bold -> Typeface.BOLD; italic -> Typeface.ITALIC; else -> Typeface.NORMAL })
  }

  private val density = resources.displayMetrics.density
  private val worker = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private val version = AtomicInteger(0)
  private val slop = ViewConfiguration.get(context).scaledTouchSlop

  private var source = ""
  private var pageWidth = 1f
  private var pageHeight = 1f
  private var pointWidth = 0f
  private var boxes = emptyList<Box>()
  private var selectedId = -1
  private var adding = false
  private var disabled = false
  private var placement: Pair<Float, Float>? = null
  private var textBox = TextBox(false, "", "Helvetica", 16f, 0x101020, false)
  private var applyingText = false
  private var disposed = false

  private var zoom = 1f
  private var tx = 0f
  private var ty = 0f
  private var contentWidth = 0
  private var contentHeight = 0
  private var animator: ValueAnimator? = null
  private var lastWidth = 0
  private var lastHeight = 0

  private val layer = PageLayer(context)
  private val image = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_XY; setBackgroundColor(Color.WHITE) }
  private val outlines = Overlay(context)
  private val edit = EditText(context)
  private val handle = Handle(context)

  init {
    setBackgroundColor(Color.rgb(232, 234, 240))
    clipChildren = true
    layer.pivotX = 0f; layer.pivotY = 0f
    layer.addView(image); layer.addView(outlines); layer.addView(edit)
    addView(layer); addView(handle)
    edit.apply {
      background = GradientDrawable().apply { setColor(0x1A1565FF); setStroke(max(1, (1 * density).toInt()), 0xFF1565FF.toInt(), 4 * density, 3 * density) }
      includeFontPadding = false
      // Enter starts a new line; lines never wrap, matching how the PDF engine writes them.
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
      setSingleLine(false)
      maxLines = 50
      setHorizontallyScrolling(true)
      setPadding(0, 0, 0, 0)
      gravity = Gravity.START or Gravity.TOP
      imeOptions = EditorInfo.IME_FLAG_NO_ENTER_ACTION
      hint = "Type here"
      setHintTextColor(0x88606070.toInt())
      visibility = View.GONE
      contentDescription = "Text to add to the PDF"
      addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) {
          if (!applyingText) onTextChange(mapOf("text" to (s?.toString() ?: "")))
          layer.requestLayout()
        }
      })
      setOnFocusChangeListener { _, focused -> if (focused) post { ensureTextVisible() } }
    }
    handle.visibility = View.GONE
    handle.contentDescription = "Drag to move the text box"
  }

  fun setSource(value: String) {
    if (value == source) return
    source = value
    val ticket = version.incrementAndGet()
    // Live previews arrive several times a second; decode into the bitmap shown before the current one.
    val reuse = spare
    spare = null
    worker.execute {
      val path = if (value.startsWith("file:")) Uri.parse(value).path else value
      val bitmap = runCatching {
        BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inMutable = true; inBitmap = reuse })
      }.getOrNull() ?: runCatching { BitmapFactory.decodeFile(path) }.getOrNull()
      main.post {
        if (!disposed && ticket == version.get() && bitmap != null) {
          val previous = shown
          image.setImageBitmap(bitmap)
          shown = bitmap
          spare = previous?.takeIf { it !== bitmap && it.isMutable }
        } else if (!disposed && spare == null) spare = (bitmap ?: reuse)?.takeIf { it.isMutable && it !== shown }
      }
    }
  }
  private var shown: Bitmap? = null
  private var spare: Bitmap? = null
  fun setPageLayout(json: String) {
    val item = runCatching { JSONObject(json) }.getOrNull() ?: return
    val w = max(1f, item.optDouble("width", 1.0).toFloat()); val h = max(1f, item.optDouble("height", 1.0).toFloat())
    val changed = w != pageWidth || h != pageHeight
    pageWidth = w; pageHeight = h; pointWidth = item.optDouble("pointWidth", 0.0).toFloat()
    if (changed) requestLayout() else { styleText(); layer.requestLayout() }
  }
  fun setObjects(json: String) {
    boxes = runCatching {
      val array = JSONArray(json)
      List(array.length()) { index ->
        val item = array.getJSONObject(index)
        val x = item.optDouble("x").toFloat(); val y = item.optDouble("y").toFloat()
        Box(item.getInt("id"), RectF(x, y, x + item.optDouble("width").toFloat(), y + item.optDouble("height").toFloat()))
      }
    }.getOrDefault(emptyList())
    outlines.invalidate()
  }
  fun setSelectedId(value: Int) { selectedId = value; outlines.invalidate() }
  fun setAdding(value: Boolean) { adding = value; outlines.invalidate() }
  fun setDisabled(value: Boolean) { disabled = value; edit.isEnabled = !value }
  fun setPlacement(json: String) {
    placement = runCatching { JSONObject(json).let { Pair(it.getDouble("x").toFloat(), it.getDouble("y").toFloat()) } }.getOrNull()
    styleText(); outlines.invalidate(); layer.requestLayout()
  }
  fun setTextBox(json: String) {
    val value = runCatching {
      val item = JSONObject(json)
      TextBox(item.optBoolean("visible"), item.optString("text"), item.optString("font", "Helvetica"), item.optDouble("size", 16.0).toFloat(), item.optInt("color", 0x101020), item.optBoolean("underline"))
    }.getOrDefault(TextBox(false, "", "Helvetica", 16f, 0x101020, false))
    val previous = textBox
    val opening = value.visible && !previous.visible
    textBox = value
    // Typing echoes the same text back from JS; only restyle when something actually changed.
    if (opening || value.font != previous.font) edit.typeface = typefaceFor(value.font)
    if (opening || value.underline != previous.underline) edit.paintFlags = if (value.underline) edit.paintFlags or Paint.UNDERLINE_TEXT_FLAG else edit.paintFlags and Paint.UNDERLINE_TEXT_FLAG.inv()
    if (opening || value.color != previous.color) edit.setTextColor(Color.rgb(value.color shr 16 and 255, value.color shr 8 and 255, value.color and 255))
    if (edit.text.toString() != value.text) {
      applyingText = true
      edit.setText(value.text); edit.setSelection(edit.text.length)
      applyingText = false
    }
    if (value.visible != previous.visible || opening) {
      edit.visibility = if (value.visible) View.VISIBLE else View.GONE
      outlines.invalidate()
    }
    if (opening) edit.post { edit.requestFocus(); showKeyboard() }
    if (!value.visible && edit.hasFocus()) hideKeyboard()
    if (opening || value.size != previous.size || value.font != previous.font || value.visible != previous.visible) { styleText(); layer.requestLayout() }
    updateHandle()
  }
  fun setAnnotations(json: String) {
    marks = runCatching {
      val array = JSONArray(json)
      List(min(array.length(), 500)) { index ->
        val item = array.getJSONObject(index)
        val erase = item.optJSONObject("erase")?.let {
          val x = it.optDouble("x").toFloat(); val y = it.optDouble("y").toFloat()
          RectF(x, y, x + it.optDouble("width").toFloat(), y + it.optDouble("height").toFloat())
        }
        val eraseJson = item.optJSONObject("erase")
        val background = eraseJson?.optInt("background", 0xFFFFFF) ?: 0xFFFFFF
        Mark(erase, 0xFF000000.toInt() or (eraseJson?.optInt("left", background) ?: background), 0xFF000000.toInt() or (eraseJson?.optInt("right", background) ?: background),
          item.optString("text").let { if (it.isBlank()) emptyList() else it.split('\n').take(50) }, item.optString("font", "Helvetica"),
          item.optDouble("size", 16.0).toFloat(), item.optInt("color", 0x101010), item.optDouble("x").toFloat(), item.optDouble("y").toFloat(), item.optBoolean("underline"))
      }
    }.getOrDefault(emptyList())
    outlines.marksChanged()
  }

  private var focusKey = ""
  private var focusRect: RectF? = null
  /** Normalised rect to keep in view at a readable zoom, e.g. the line being edited. */
  fun setFocus(json: String) {
    if (json == focusKey) return
    focusKey = json
    focusRect = runCatching {
      JSONObject(json).let { RectF(it.getDouble("x").toFloat(), it.getDouble("y").toFloat(), (it.getDouble("x") + it.getDouble("width")).toFloat(), (it.getDouble("y") + it.getDouble("height")).toFloat()) }
    }.getOrNull()
    if (focusRect != null) post { focusOn() }
  }
  private fun focusOn() {
    val rect = focusRect ?: return
    if (disposed || contentWidth <= 0 || width <= 0 || height <= 0) return
    if (tx.isNaN() || ty.isNaN()) clampTransform()
    val rw = max(1f, rect.width() * contentWidth); val rh = max(1f, rect.height() * contentHeight)
    // Readable first: the line fills about 36dp of height; long lines start at the left edge.
    val target = min(36 * density / rh, height * 0.45f / rh).coerceIn(1.5f, 4f)
    val endTx = if (rw * target > width * 0.92f) width * 0.04f - rect.left * contentWidth * target else width / 2f - rect.centerX() * contentWidth * target
    val endTy = height * 0.38f - rect.centerY() * contentHeight * target
    val startZoom = zoom; val startTx = tx; val startTy = ty
    animator?.cancel()
    animator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 260
      interpolator = android.view.animation.DecelerateInterpolator()
      addUpdateListener {
        val f = it.animatedValue as Float
        zoom = startZoom + (target - startZoom) * f
        tx = startTx + (endTx - startTx) * f; ty = startTy + (endTy - startTy) * f
        applyTransform()
      }
      addListener(object : android.animation.AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: android.animation.Animator) { outlines.invalidate() }
      })
      start()
    }
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val width = r - l; val height = b - t
    if (width <= 0 || height <= 0) return
    val fit = min(width / pageWidth, height / pageHeight)
    val nextWidth = max(1, (pageWidth * fit).toInt()); val nextHeight = max(1, (pageHeight * fit).toInt())
    val resized = nextWidth != contentWidth || nextHeight != contentHeight
    contentWidth = nextWidth; contentHeight = nextHeight
    styleText()
    layer.measure(MeasureSpec.makeMeasureSpec(contentWidth, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(contentHeight, MeasureSpec.EXACTLY))
    layer.layout(0, 0, contentWidth, contentHeight)
    val size = (30 * density).toInt()
    handle.measure(MeasureSpec.makeMeasureSpec(size, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(size, MeasureSpec.EXACTLY))
    handle.layout(0, 0, size, size)
    val viewResized = width != lastWidth || height != lastHeight
    lastWidth = width; lastHeight = height
    if (resized) { tx = Float.NaN; ty = Float.NaN; outlines.marksChanged() }
    applyTransform()
    if (viewResized && focusRect != null) post { focusOn() }
  }

  private fun clampTransform() {
    val scaledWidth = contentWidth * zoom; val scaledHeight = contentHeight * zoom
    tx = if (scaledWidth <= width) (width - scaledWidth) / 2 else if (tx.isNaN()) (width - scaledWidth) / 2 else min(0f, max(width - scaledWidth, tx))
    ty = if (scaledHeight <= height) (height - scaledHeight) / 2 else if (ty.isNaN()) (height - scaledHeight) / 2 else min(0f, max(height - scaledHeight, ty))
  }
  private fun applyTransform() {
    clampTransform()
    layer.scaleX = zoom; layer.scaleY = zoom
    layer.translationX = tx; layer.translationY = ty
    updateHandle()
  }
  private fun zoomAround(value: Float, focusX: Float, focusY: Float) {
    val next = min(5f, max(1f, value))
    val ratio = next / zoom
    tx = focusX - (focusX - tx) * ratio
    ty = focusY - (focusY - ty) * ratio
    zoom = next
    applyTransform()
  }
  private fun toPage(x: Float, y: Float) = Pair((x - tx) / (contentWidth * zoom), (y - ty) / (contentHeight * zoom))

  private fun textScale() = if (pointWidth > 0f) contentWidth / pointWidth else contentWidth / 612f
  private val boxRect = RectF()
  private fun textBoxRect(): RectF? {
    if (edit.visibility != View.VISIBLE) return null
    return boxRect.apply { set(edit.left.toFloat(), edit.top.toFloat(), edit.right.toFloat(), edit.bottom.toFloat()) }.also {
      it.left = tx + it.left * zoom; it.right = tx + it.right * zoom
      it.top = ty + it.top * zoom; it.bottom = ty + it.bottom * zoom
    }
  }
  private fun updateHandle() {
    val rect = textBoxRect()
    if (rect == null || disabled) { handle.visibility = View.GONE; return }
    handle.visibility = View.VISIBLE
    handle.translationX = rect.left - handle.width - 4 * density
    handle.translationY = rect.centerY() - handle.height / 2f
  }
  private fun ensureTextVisible() {
    val rect = textBoxRect() ?: return
    val margin = 16 * density
    if (rect.bottom > height - margin) ty -= rect.bottom - (height - margin)
    if (rect.top < margin) ty += margin - rect.top
    if (rect.right > width - margin && rect.width() < width) tx -= rect.right - (width - margin)
    if (rect.left < margin + handle.width) tx += margin + handle.width - rect.left
    applyTransform()
  }
  private fun showKeyboard() {
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.showSoftInput(edit, InputMethodManager.SHOW_IMPLICIT)
  }
  private fun hideKeyboard() {
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(edit.windowToken, 0)
    edit.clearFocus()
  }

  private fun tap(x: Float, y: Float) {
    if (disabled) return
    val (px, py) = toPage(x, y)
    if (px < 0 || px > 1 || py < 0 || py > 1) return
    if (adding) { onPlace(mapOf("x" to px.toDouble(), "y" to py.toDouble())); return }
    val tolX = 10f / (contentWidth * zoom); val tolY = 10f / (contentHeight * zoom)
    val hit = boxes.filter { px >= it.rect.left - tolX && px <= it.rect.right + tolX && py >= it.rect.top - tolY && py <= it.rect.bottom + tolY }
      .minByOrNull {
        val exact = it.rect.contains(px, py)
        (if (exact) 0f else 100f) + abs(py - it.rect.centerY()) + abs(px - it.rect.centerX()) * 0.01f
      }
    if (hit != null) onSelectObject(mapOf("id" to hit.id))
  }

  private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
    private var lastX = 0f
    private var lastY = 0f
    override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
      animator?.cancel(); lastX = detector.focusX; lastY = detector.focusY; return true
    }
    override fun onScale(detector: ScaleGestureDetector): Boolean {
      tx += detector.focusX - lastX; ty += detector.focusY - lastY
      lastX = detector.focusX; lastY = detector.focusY
      zoomAround(zoom * detector.scaleFactor, detector.focusX, detector.focusY)
      return true
    }
    override fun onScaleEnd(detector: ScaleGestureDetector) { outlines.invalidate() }
  })
  private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
    override fun onDown(e: MotionEvent) = true
    override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
      if (!touchOnText) tap(e.x, e.y)
      return true
    }
    override fun onDoubleTap(e: MotionEvent): Boolean {
      if (touchOnText || disabled) return false
      val start = zoom; val target = if (zoom > 1.1f) 1f else 2.5f
      animator?.cancel()
      animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 220
        addUpdateListener { zoomAround(start + (target - start) * (it.animatedValue as Float), e.x, e.y) }
        addListener(object : android.animation.AnimatorListenerAdapter() {
          override fun onAnimationEnd(animation: android.animation.Animator) { outlines.invalidate() }
        })
        start()
      }
      return true
    }
  })

  private var touchOnText = false
  private var draggingHandle = false
  private var panning = false
  private var transforming = false
  private var childCancelled = false
  private var lastX = 0f
  private var lastY = 0f
  private var downX = 0f
  private var downY = 0f

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (disabled) return true
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      animator?.cancel()
      val rect = textBoxRect()
      touchOnText = rect?.contains(event.x, event.y) == true
      draggingHandle = handle.visibility == View.VISIBLE &&
        event.x >= handle.translationX - 8 * density && event.x <= handle.translationX + handle.width + 8 * density &&
        event.y >= handle.translationY - 8 * density && event.y <= handle.translationY + handle.height + 8 * density
      panning = false; transforming = false; childCancelled = false
      downX = event.x; downY = event.y; lastX = event.x; lastY = event.y
    }
    if (draggingHandle) {
      val rect = textBoxRect()
      if (event.actionMasked == MotionEvent.ACTION_MOVE && rect != null) {
        val dx = (event.x - lastX) / zoom; val dy = (event.y - lastY) / zoom
        edit.offsetLeftAndRight(dx.toInt()); edit.offsetTopAndBottom(dy.toInt())
        lastX += dx.toInt() * zoom; lastY += dy.toInt() * zoom
        updateHandle()
      }
      if (event.actionMasked == MotionEvent.ACTION_UP) {
        val x = (edit.left + edit.paddingLeft).toFloat() / contentWidth
        val y = (edit.top + baselineOffset()).toFloat() / contentHeight
        onPlace(mapOf("x" to min(1f, max(0f, x)).toDouble(), "y" to min(1f, max(0f, y)).toDouble()))
      }
      if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) draggingHandle = false
      return true
    }
    scaleDetector.onTouchEvent(event)
    gestures.onTouchEvent(event)
    if (event.pointerCount > 1 || scaleDetector.isInProgress) transforming = true
    if (event.actionMasked == MotionEvent.ACTION_MOVE && !transforming && !touchOnText && !panning && (abs(event.x - downX) > slop || abs(event.y - downY) > slop)) panning = true
    if (event.actionMasked == MotionEvent.ACTION_MOVE && panning && !transforming && event.pointerCount == 1) {
      tx += event.x - lastX; ty += event.y - lastY
      applyTransform()
    }
    if (event.actionMasked == MotionEvent.ACTION_POINTER_UP || event.actionMasked == MotionEvent.ACTION_POINTER_DOWN) {
      val index = if (event.actionMasked == MotionEvent.ACTION_POINTER_UP && event.actionIndex == 0) 1 else 0
      lastX = event.getX(index); lastY = event.getY(index)
    } else { lastX = event.x; lastY = event.y }
    if (touchOnText && !transforming) return super.dispatchTouchEvent(event)
    if (touchOnText && !childCancelled) {
      childCancelled = true
      val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
      super.dispatchTouchEvent(cancel); cancel.recycle()
    }
    return true
  }

  private fun styleText() {
    if (contentWidth <= 0) return
    val scale = textScale()
    val size = max(1f, textBox.size * scale)
    if (edit.textSize != size) {
      edit.setTextSize(TypedValue.COMPLEX_UNIT_PX, size)
      edit.setLineSpacing(max(0f, size * 1.2f - edit.paint.getFontMetrics(null)), 1f)
    }
    val pad = max(1, (2 * scale).toInt())
    if (edit.paddingLeft != pad) edit.setPadding(pad, pad, pad * 3, pad)
    val minimum = max((48 * scale).toInt(), 24)
    val maximum = max(minimum, contentWidth - ((placement?.first ?: 0f) * contentWidth).toInt() + pad)
    if (edit.minWidth != minimum) edit.minWidth = minimum
    if (edit.maxWidth != maximum) edit.maxWidth = maximum
  }

  private fun baselineOffset(): Int = edit.paddingTop - edit.paint.fontMetricsInt.ascent

  fun dispose() {
    disposed = true
    version.incrementAndGet()
    animator?.cancel()
    if (edit.hasFocus()) hideKeyboard()
    image.setImageDrawable(null)
    shown = null; spare = null
    worker.shutdownNow()
  }

  private inner class PageLayer(context: Context) : ViewGroup(context) {
    init { clipChildren = false }
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
      val w = MeasureSpec.getSize(widthMeasureSpec); val h = MeasureSpec.getSize(heightMeasureSpec)
      image.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
      outlines.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
      edit.measure(MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
      setMeasuredDimension(w, h)
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
      image.layout(0, 0, r - l, b - t)
      outlines.layout(0, 0, r - l, b - t)
      val point = placement
      if (point != null) {
        val left = (point.first * (r - l)).toInt() - edit.paddingLeft
        val top = (point.second * (b - t)).toInt() - baselineOffset()
        edit.layout(left, top, left + edit.measuredWidth, top + edit.measuredHeight)
      } else edit.layout(0, 0, 0, 0)
      post { updateHandle() }
    }
  }

  private inner class Overlay(context: Context) : View(context) {
    private val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = 0x661565FF }
    private val selected = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = 0xFF1565FF.toInt() }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x221565FF }
    private val marker = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF1565FF.toInt() }
    private val scratch = RectF()
    private val patch = Paint(Paint.ANTI_ALIAS_FLAG)
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
    private var shaderWidth = 0
    private var shaderHeight = 0
    private var shaders = arrayOfNulls<LinearGradient>(0)
    override fun onDraw(canvas: Canvas) {
      val w = width.toFloat(); val h = height.toFloat()
      if (marks.isNotEmpty()) drawMarks(canvas, w, h)
      outline.strokeWidth = density * 0.8f / zoom; selected.strokeWidth = density * 1.5f / zoom
      if (!adding) {
        val count = min(boxes.size, 600)
        for (index in 0 until count) {
          val box = boxes[index]
          scratch.set(box.rect.left * w, box.rect.top * h, box.rect.right * w, box.rect.bottom * h)
          if (box.id == selectedId) { canvas.drawRect(scratch, fill); canvas.drawRect(scratch, selected) } else canvas.drawRect(scratch, outline)
        }
      }
      val point = placement
      if (adding && point != null && !textBox.visible) canvas.drawCircle(point.first * w, point.second * h, 4 * density / zoom, marker)
    }
    fun marksChanged() { shaderWidth = 0; invalidate() }
    /** Covered lines and applied text, drawn live so edits never round-trip through image files. */
    private fun drawMarks(canvas: Canvas, w: Float, h: Float) {
      if (shaderWidth != width || shaderHeight != height || shaders.size != marks.size) {
        shaderWidth = width; shaderHeight = height
        shaders = Array(marks.size) { index ->
          marks[index].erase?.let { LinearGradient(it.left * w, 0f, it.right * w, 0f, marks[index].left, marks[index].right, Shader.TileMode.CLAMP) }
        }
      }
      val scale = textScale()
      for (index in marks.indices) {
        val mark = marks[index]
        val erase = mark.erase
        if (erase != null) {
          scratch.set(erase.left * w, erase.top * h, erase.right * w, erase.bottom * h)
          val pad = max(1f, scratch.height() * 0.15f)
          scratch.inset(-pad, -pad)
          patch.shader = shaders[index]
          canvas.drawRoundRect(scratch, pad, pad, patch)
        }
        if (mark.lines.isNotEmpty()) {
          ink.typeface = typefaceFor(mark.font)
          ink.textSize = max(1f, mark.size * scale)
          ink.color = 0xFF000000.toInt() or mark.color
          ink.isUnderlineText = mark.underline
          for (line in mark.lines.indices) {
            if (mark.lines[line].isNotEmpty()) canvas.drawText(mark.lines[line], mark.x * w, mark.y * h + line * ink.textSize * 1.2f, ink)
          }
        }
      }
    }
  }

  private inner class Handle(context: Context) : View(context) {
    private val circle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF1565FF.toInt() }
    private val arrows = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; strokeWidth = 2 * density; strokeCap = Paint.Cap.ROUND }
    override fun onDraw(canvas: Canvas) {
      val c = width / 2f; val r = width / 2f
      canvas.drawCircle(c, c, r, circle)
      val a = r * 0.5f
      canvas.drawLine(c - a, c, c + a, c, arrows); canvas.drawLine(c, c - a, c, c + a, arrows)
    }
  }
}

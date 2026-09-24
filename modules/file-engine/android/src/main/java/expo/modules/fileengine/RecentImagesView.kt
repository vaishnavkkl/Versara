package expo.modules.fileengine

import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.LruCache
import android.util.Size
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.AbsListView
import android.widget.BaseAdapter
import android.widget.GridView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.FutureTask
import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min

/** Newest request first; the oldest (usually scrolled away) work is dropped when full. */
private class LatestFirstQueue(private val limit: Int) : LinkedBlockingDeque<Runnable>() {
  override fun offer(element: Runnable): Boolean {
    while (size >= limit) pollLast()
    return offerFirst(element)
  }
}

/** Soft circle with an X, tinted from the app palette. */
private class RemoveGlyph(private val density: Float) : Drawable() {
  var fill = 0x26FFFFFF
  var stroke = Color.WHITE
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND }
  override fun draw(canvas: Canvas) {
    val cx = bounds.exactCenterX()
    val cy = bounds.exactCenterY()
    paint.style = Paint.Style.FILL
    paint.color = fill
    canvas.drawCircle(cx, cy, 12 * density, paint)
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 1.75f * density
    paint.color = stroke
    val arm = 4.25f * density
    canvas.drawLine(cx - arm, cy - arm, cx + arm, cy + arm, paint)
    canvas.drawLine(cx - arm, cy + arm, cx + arm, cy - arm, paint)
  }
  override fun setAlpha(alpha: Int) { paint.alpha = alpha }
  override fun setColorFilter(filter: ColorFilter?) { paint.colorFilter = filter }
  @Deprecated("Deprecated in Android")
  override fun getOpacity() = PixelFormat.TRANSLUCENT
}

private class SquareImageView(context: Context) : ImageView(context) {
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(widthMeasureSpec, widthMeasureSpec)
    setMeasuredDimension(measuredWidth, measuredWidth)
  }
}

/** Recycling, decoding and scrolling stay native; JS receives only user actions. */
class RecentImagesView(context: Context, appContext: AppContext) : ExpoView(context, appContext), ComponentCallbacks2 {
  private val onOpen by EventDispatcher()
  private val onRemove by EventDispatcher()
  private data class Item(val id: String, val uri: String, val name: String, val detail: String, val removable: Boolean, val kind: String)
  private var items = emptyList<Item>()
  private var itemsJson = ""
  private var paletteJson = ""
  private var grid = false
  var disabled = false
  private var label = Color.WHITE
  private var secondary = Color.LTGRAY
  private var surface = Color.DKGRAY
  private var paletteVersion = 0
  private var flinging = false
  private val main = Handler(Looper.getMainLooper())
  private val lowMemory = (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isLowRamDevice
  // Rows show 40dp thumbnails, grid cells about half the screen width; decode no larger than that.
  private val listPixels = min(dp(LIST_THUMB_DP), if (lowMemory) 72 else 112)
  private val gridPixels = if (lowMemory) 144 else 208
  private val cache = object : LruCache<String, Bitmap>(if (lowMemory) 2 * 1024 * 1024 else 4 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
  }
  private val threads = if (lowMemory) 1 else 2
  private val worker = ThreadPoolExecutor(threads, threads, 10, TimeUnit.SECONDS, LatestFirstQueue(24)).apply {
    allowCoreThreadTimeOut(true)
    setThreadFactory { work -> Thread {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
      work.run()
    } }
    rejectedExecutionHandler = ThreadPoolExecutor.DiscardPolicy()
  }
  private var disposed = false
  private var listening = false
  private val list = GridView(context)
  private val adapter = object : BaseAdapter() {
    override fun getCount() = items.size
    override fun getItem(position: Int) = items[position]
    override fun getItemId(position: Int) = position.toLong()
    override fun getViewTypeCount() = 2
    override fun getItemViewType(position: Int) = if (grid) 1 else 0
    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
      val cell = (convertView as? Cell)?.takeIf { it.gridCell == grid } ?: Cell(grid)
      cell.bind(items[position])
      return cell
    }
  }

  init {
    list.apply {
      numColumns = 1
      stretchMode = GridView.STRETCH_COLUMN_WIDTH
      horizontalSpacing = dp(8)
      verticalSpacing = dp(8)
      setPadding(dp(20), dp(4), dp(20), dp(24))
      clipToPadding = false
      isVerticalScrollBarEnabled = true
      setRecyclerListener { (it as? Cell)?.release() }
      setOnScrollListener(object : AbsListView.OnScrollListener {
        override fun onScrollStateChanged(view: AbsListView, state: Int) {
          val wasFlinging = flinging
          flinging = state == AbsListView.OnScrollListener.SCROLL_STATE_FLING
          if (wasFlinging && !flinging) loadVisible()
        }
        override fun onScroll(view: AbsListView, first: Int, visible: Int, total: Int) = Unit
      })
      adapter = this@RecentImagesView.adapter
    }
    addView(list, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    list.measure(MeasureSpec.makeMeasureSpec(right - left, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(bottom - top, MeasureSpec.EXACTLY))
    list.layout(0, 0, right - left, bottom - top)
  }
  private fun refresh() {
    adapter.notifyDataSetChanged()
    // React Native owns the outer layout; explicitly remeasure native adapter children.
    list.post { if (!disposed && width > 0 && height > 0) {
      list.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
      list.layout(0, 0, width, height)
    } }
  }
  private fun loadVisible() {
    for (index in 0 until list.childCount) (list.getChildAt(index) as? Cell)?.load()
  }
  fun setItems(json: String) {
    if (json == itemsJson) return
    itemsJson = json
    val array = JSONArray(json)
    items = (0 until min(array.length(), 160)).map { index ->
      val item = array.getJSONObject(index)
      Item(item.getString("id"), item.getString("uri"), item.getString("name"), item.getString("detail"), item.optBoolean("removable"), item.optString("kind", "image"))
    }
    refresh()
  }
  fun setGrid(value: Boolean) {
    if (grid == value) return
    grid = value
    list.numColumns = if (value) 2 else 1
    refresh()
  }
  fun setPalette(json: String) {
    if (json == paletteJson) return
    paletteJson = json
    val palette = JSONObject(json)
    label = Color.parseColor(palette.getString("label"))
    secondary = Color.parseColor(palette.getString("secondary"))
    surface = Color.parseColor(palette.getString("surface"))
    paletteVersion++
    refresh()
  }
  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

  private fun placeholder(kind: String) = when (kind) {
    "video" -> android.R.drawable.ic_media_play
    "audio" -> android.R.drawable.ic_lock_silent_mode_off
    "pdf" -> android.R.drawable.ic_menu_agenda
    else -> android.R.drawable.ic_menu_gallery
  }

  /** Built once per layout type; binding only swaps text, colours and the bitmap. */
  private inner class Cell(val gridCell: Boolean) : LinearLayout(context) {
    private val image: ImageView = if (gridCell) SquareImageView(context) else ImageView(context)
    private val name = TextView(context)
    private val detail = TextView(context)
    private val remove = View(context)
    private val removeGlyph = RemoveGlyph(resources.displayMetrics.density)
    private val shape = GradientDrawable().apply { cornerRadius = dp(10).toFloat() }
    private var item: Item? = null
    private var wanted: String? = null
    private var loaded: String? = null
    private var paletteSeen = -1
    private var token = 0
    private var task: FutureTask<Unit>? = null

    init {
      background = shape
      val corner = dp(6).toFloat()
      image.outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) { outline.setRoundRect(0, 0, view.width, view.height, corner) }
      }
      image.clipToOutline = true
      image.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
      name.textSize = 13f
      name.maxLines = if (gridCell) 1 else 2
      name.ellipsize = TextUtils.TruncateAt.END
      detail.textSize = 11f
      detail.maxLines = 1
      detail.ellipsize = TextUtils.TruncateAt.END
      remove.background = removeGlyph
      remove.isClickable = true
      remove.isFocusable = true
      remove.setOnClickListener { item?.let { if (!disabled && it.removable) onRemove(mapOf("id" to it.id)) } }
      setOnClickListener { item?.let { if (!disabled) onOpen(mapOf("id" to it.id)) } }
      val text = LinearLayout(context).apply { orientation = VERTICAL; addView(name); addView(detail) }
      if (gridCell) {
        orientation = VERTICAL
        setPadding(dp(8), dp(8), dp(8), dp(8))
        // The remove control sits over the thumbnail's top-right corner.
        val frame = android.widget.FrameLayout(context)
        frame.addView(image, android.widget.FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        frame.addView(remove, android.widget.FrameLayout.LayoutParams(dp(44), dp(44), Gravity.TOP or Gravity.END))
        addView(frame, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        addView(text, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) })
      } else {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(10), dp(8), dp(4), dp(8))
        addView(image, LayoutParams(dp(LIST_THUMB_DP), dp(LIST_THUMB_DP)))
        addView(text, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(12) })
        addView(remove, LayoutParams(dp(44), dp(44)).apply { gravity = Gravity.TOP })
      }
    }

    fun cancel() {
      token++
      task?.let { it.cancel(false); worker.remove(it) }
      task = null
    }

    fun release() {
      cancel()
      loaded = null
      image.setImageDrawable(null)
    }

    fun bind(next: Item) {
      release()
      item = next
      if (paletteSeen != paletteVersion) {
        paletteSeen = paletteVersion
        shape.setColor(surface)
        name.setTextColor(label)
        detail.setTextColor(secondary)
        removeGlyph.fill = if (gridCell) 0x99000000.toInt() else (secondary and 0x00FFFFFF) or 0x24000000
        removeGlyph.stroke = if (gridCell) Color.WHITE else secondary
        removeGlyph.invalidateSelf()
      }
      name.text = next.name
      detail.text = next.detail
      remove.alpha = if (disabled) 0.4f else 1f
      remove.visibility = if (next.removable) VISIBLE else GONE
      remove.contentDescription = "Remove ${next.name} from Recents"
      contentDescription = "Open ${next.name}. ${next.detail}"
      val size = if (gridCell) gridPixels else listPixels
      val key = "${next.uri}|${next.kind}|$size"
      wanted = key
      val cached = cache.get(key)
      if (cached != null) { show(cached, key); return }
      image.scaleType = ImageView.ScaleType.CENTER_INSIDE
      image.setImageResource(placeholder(next.kind))
      if (!flinging) load()
    }

    private fun show(bitmap: Bitmap, key: String) {
      image.scaleType = if (item?.kind == "pdf") ImageView.ScaleType.FIT_CENTER else ImageView.ScaleType.CENTER_CROP
      image.setImageBitmap(bitmap)
      loaded = key
    }

    fun load() {
      val current = item ?: return
      val key = wanted ?: return
      if (loaded == key || disposed || worker.isShutdown) return
      task?.let { it.cancel(false); worker.remove(it) }
      val request = ++token
      val size = if (gridCell) gridPixels else listPixels
      val job = FutureTask<Unit> {
        val bitmap = try { decode(current.uri, current.kind, size) } catch (_: Exception) { null } catch (_: OutOfMemoryError) { cache.evictAll(); null }
        main.post {
          if (!disposed && token == request && bitmap != null) {
            cache.put(key, bitmap)
            if (isAttachedToWindow) show(bitmap, key)
          }
        }
        Unit
      }
      task = job
      try { worker.execute(job) } catch (_: RejectedExecutionException) { task = null }
    }
  }

  private fun decode(value: String, kind: String, size: Int): Bitmap? {
    val uri = Uri.parse(value)
    if (uri.scheme != "file" && uri.scheme != "content") return null
    if (kind == "pdf") return renderPdf(uri, size)
    // MediaStore and document providers keep cached thumbnails; far cheaper than decoding originals.
    if (uri.scheme == "content" && Build.VERSION.SDK_INT >= 29) {
      try { return scaleDown(context.contentResolver.loadThumbnail(uri, Size(size, size), null), size) } catch (_: Exception) { }
    }
    return when (kind) {
      "video" -> videoFrame(uri, size)
      "audio" -> audioArt(uri, size)
      else -> image(uri, size)
    }
  }

  private fun scaleDown(bitmap: Bitmap, size: Int): Bitmap {
    val longest = max(bitmap.width, bitmap.height)
    if (longest <= size) return bitmap
    val scale = size.toFloat() / longest
    val scaled = Bitmap.createScaledBitmap(bitmap, max(1, (bitmap.width * scale).toInt()), max(1, (bitmap.height * scale).toInt()), true)
    if (scaled !== bitmap) bitmap.recycle()
    return scaled
  }

  private fun renderPdf(uri: Uri, size: Int): Bitmap? = context.contentResolver.openFileDescriptor(uri, "r")?.use { descriptor ->
    PdfRenderer(descriptor).use { pdf ->
      if (pdf.pageCount == 0) return@use null
      pdf.openPage(0).use { page ->
        val scale = size.toDouble() / max(page.width, page.height)
        val bitmap = Bitmap.createBitmap(max(1, (page.width * scale).toInt()), max(1, (page.height * scale).toInt()), Bitmap.Config.ARGB_8888)
        try { bitmap.eraseColor(Color.WHITE); page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY); bitmap }
        catch (error: Throwable) { bitmap.recycle(); throw error }
      }
    }
  }

  private fun videoFrame(uri: Uri, size: Int): Bitmap? {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      val frame = if (Build.VERSION.SDK_INT >= 27) retriever.getScaledFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, size, size)
        else retriever.getFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
      return frame?.let { scaleDown(it, size) }
    } finally {
      try { retriever.release() } catch (_: Exception) { }
    }
  }

  private fun audioArt(uri: Uri, size: Int): Bitmap? {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      val bytes = retriever.embeddedPicture ?: return null
      val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
      if (options.outWidth <= 0 || options.outHeight <= 0) return null
      options.inSampleSize = 1
      while (max(options.outWidth, options.outHeight) / (options.inSampleSize * 2) >= size) options.inSampleSize *= 2
      options.inJustDecodeBounds = false
      options.inPreferredConfig = Bitmap.Config.RGB_565
      return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.let { scaleDown(it, size) }
    } finally {
      try { retriever.release() } catch (_: Exception) { }
    }
  }

  private fun image(uri: Uri, size: Int): Bitmap? {
    if (Build.VERSION.SDK_INT >= 28) {
      return ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
        val scale = min(1.0, size.toDouble() / max(info.size.width, info.size.height))
        decoder.setTargetSize(max(1, (info.size.width * scale).toInt()), max(1, (info.size.height * scale).toInt()))
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        decoder.memorySizePolicy = ImageDecoder.MEMORY_POLICY_LOW_RAM
      }
    }
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
    if (options.outWidth <= 0 || options.outHeight <= 0) return null
    options.inSampleSize = 1
    while (max(options.outWidth, options.outHeight) / (options.inSampleSize * 2) >= size) options.inSampleSize *= 2
    options.inJustDecodeBounds = false
    options.inPreferredConfig = Bitmap.Config.RGB_565
    val bitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
    val orientation = try {
      context.contentResolver.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
    } catch (_: Exception) { null }
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(270f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(270f)
    }
    val oriented = if (matrix.isIdentity) bitmap else try { Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true) } finally { bitmap.recycle() }
    return scaleDown(oriented, size)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (!listening && !disposed) { context.applicationContext.registerComponentCallbacks(this); listening = true; adapter.notifyDataSetChanged() }
  }
  private fun clear() {
    for (index in 0 until list.childCount) (list.getChildAt(index) as? Cell)?.release()
    worker.queue.clear()
    cache.evictAll()
  }
  override fun onDetachedFromWindow() {
    // Covered by another screen: stop decoding but keep the small bounded cache, so returning
    // shows thumbnails immediately instead of reloading them. Memory pressure still evicts it.
    for (index in 0 until list.childCount) (list.getChildAt(index) as? Cell)?.cancel()
    worker.queue.clear()
    if (listening) { context.applicationContext.unregisterComponentCallbacks(this); listening = false }
    super.onDetachedFromWindow()
  }
  fun dispose() {
    disposed = true; clear(); worker.shutdownNow(); main.removeCallbacksAndMessages(null)
    if (listening) { context.applicationContext.unregisterComponentCallbacks(this); listening = false }
  }
  override fun onTrimMemory(level: Int) { cache.evictAll() }
  @Deprecated("Deprecated in Android")
  override fun onLowMemory() { cache.evictAll() }
  override fun onConfigurationChanged(config: Configuration) { adapter.notifyDataSetChanged() }

  private companion object { const val LIST_THUMB_DP = 40 }
}

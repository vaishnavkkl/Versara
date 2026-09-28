package expo.modules.pdfengine

import android.content.Context
import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.content.ClipData
import android.content.ClipboardManager
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.widget.Toast
import org.json.JSONObject
import android.animation.ValueAnimator
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.util.LruCache
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.view.ViewGroup
import android.widget.AbsListView
import android.widget.BaseAdapter
import android.widget.ListView
import android.widget.ImageView
import android.widget.TextView
import android.graphics.drawable.ColorDrawable
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class PdfEngineView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onLoad by EventDispatcher<Map<String, Any>>()
  private val onPageChange by EventDispatcher<Map<String, Any>>()
  private val onZoomChange by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any>>()
  var source = ""
  var requestedPage = 0
  var pageRevision = 0
  var vertical = true
  var requestedZoom = 1f
  var zoomRevision = 0
  var dark = true

  private val worker = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private val documentVersion = AtomicInteger(0)
  private val renderVersion = AtomicInteger(0)
  // Renderer and descriptor are confined to worker; only the displayed bitmap lives on main.
  private var renderer: PdfRenderer? = null
  private var descriptor: ParcelFileDescriptor? = null
  private var displayedBitmap: Bitmap? = null
  private var loadedSource = ""
  private var selecting = false
  private var lastPage = -1
  private var lastPageRevision = -1
  private var lastVertical = true
  private var pageCount = 0
  private val ratios = mutableMapOf<Int, Double>()
  // Accessed only on main. Never recycle an evicted bitmap while RenderThread may use it.
  private val lowMemoryDevice = (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isLowRamDevice
  private val cacheBudget = if (lowMemoryDevice) 4 * 1024 * 1024 else (Runtime.getRuntime().maxMemory() / 16).coerceIn(8L * 1024 * 1024, 24L * 1024 * 1024).toInt()
  private val pixelBudget = if (lowMemoryDevice) 1_000_000.0 else (Runtime.getRuntime().maxMemory() / 256.0).coerceIn(2_000_000.0, 4_000_000.0)
  private val bitmapCache = object : LruCache<String, Bitmap>(cacheBudget) {
    override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
  }
  private val memoryCallbacks = object : ComponentCallbacks2 {
    override fun onConfigurationChanged(configuration: Configuration) { }
    override fun onLowMemory() { bitmapCache.evictAll() }
    override fun onTrimMemory(level: Int) { if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) bitmapCache.evictAll() }
  }
  private var lastZoomRevision = -1
  @Volatile private var disposed = false
  private val image = ZoomImageView(context)
  private val list = ListView(context)
  private val scrollThumb = PdfScrollThumb(context)
  private var draggingThumb = false
  private var thumbStartY = 0f
  private var thumbStartProgress = 0f
  private var scrollProgress = 0f
  private val hideScrollThumb = Runnable {
    if (!draggingThumb) scrollThumb.animate().alpha(0f).setDuration(180).withEndAction { scrollThumb.visibility = View.INVISIBLE }.start()
  }
  private fun updateScrollThumb(reveal: Boolean = false) {
    if (!vertical || pageCount < 2 || height <= 0) { scrollThumb.visibility = View.INVISIBLE; return }
    val first = list.getChildAt(0)
    val fraction = if (first != null && first.height > 0) (-first.top.toFloat() / first.height).coerceIn(0f, 1f) else 0f
    val extent = if (first != null && first.height > 0) list.height.toFloat() / first.height else 1f
    scrollProgress = ((list.firstVisiblePosition + fraction) / max(1f, pageCount - extent)).coerceIn(0f, 1f)
    val travel = max(0f, height - scrollThumb.height - 24 * resources.displayMetrics.density)
    scrollThumb.translationY = scrollProgress * travel
    if (reveal) {
      main.removeCallbacks(hideScrollThumb)
      scrollThumb.animate().cancel(); scrollThumb.visibility = View.VISIBLE; scrollThumb.alpha = 1f
      if (!draggingThumb) main.postDelayed(hideScrollThumb, 1000)
    }
  }
  private val badge = TextView(context)
  private val hideBadge = Runnable { badge.animate().alpha(0f).setDuration(250).start() }
  private fun showBadge() {
    if (!vertical || pageCount < 2) return
    badge.text = "${max(0, lastPage) + 1} / $pageCount"
    badge.animate().alpha(1f).setDuration(120).start()
  }
  private val pages = object : BaseAdapter() {
    override fun getCount() = pageCount
    override fun getItem(position: Int): Any = position
    override fun getItemId(position: Int) = position.toLong()
    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
      val row = (convertView as? ZoomImageView) ?: ZoomImageView(context)
      val binding = "${documentVersion.get()}:$position:$width"
      if (row.binding == binding) return row
      row.clearSelection()
      row.onRequestText = { px, py -> selectText(row, position, px, py) }
      row.binding = binding
      row.allowScroll = true
      row.setImageDrawable(null)
      row.setZoom(1f)
      row.layoutParams = AbsListView.LayoutParams(LayoutParams.MATCH_PARENT, max(1, (width * (ratios[position] ?: 1.414)).toInt()).coerceAtMost(100000))
      row.contentDescription = "PDF page ${position + 1} of $pageCount. Pinch to zoom."
      row.detailed = false
      row.onZoomChanged = { zoom ->
        onZoomChange(mapOf("zoom" to zoom.toDouble()))
        if (zoom > 1.4f && !row.detailed && row.binding == binding) renderRow(row, position, min(zoom, 2.5f))
      }
      val cached = bitmapCache.get(binding)
      if (cached != null) row.setImageBitmap(cached) else renderRow(row, position)
      return row
    }
  }

  init {
    context.applicationContext.registerComponentCallbacks(memoryCallbacks)
    clipChildren = true
    image.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    addView(image)
    list.divider = ColorDrawable(Color.TRANSPARENT)
    list.dividerHeight = (8 * resources.displayMetrics.density).toInt()
    list.selector = ColorDrawable(Color.TRANSPARENT)
    list.isVerticalScrollBarEnabled = false
    list.scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
    // Only our visible thumb captures a scrub gesture; the rest of the edge remains page content.
    list.isFastScrollEnabled = false
    list.adapter = pages
    list.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    list.setRecyclerListener { (it as? ZoomImageView)?.let { row -> row.ticket.incrementAndGet(); row.binding = ""; row.clearSelection(); row.onRequestText = null; row.setImageDrawable(null) } }
    list.setOnScrollListener(object : AbsListView.OnScrollListener {
      override fun onScrollStateChanged(view: AbsListView?, state: Int) {
        updateScrollThumb(true)
        main.removeCallbacks(hideBadge)
        if (state == AbsListView.OnScrollListener.SCROLL_STATE_IDLE) main.postDelayed(hideBadge, 900) else showBadge()
      }
      override fun onScroll(view: AbsListView?, first: Int, visible: Int, total: Int) {
        if (!vertical || visible <= 0) return
        updateScrollThumb(true)
        // The page filling the middle of the screen is the one being read.
        val top = view?.getChildAt(0)
        val current = if (top != null && top.bottom < (view.height / 2) && first + 1 < total) first + 1 else first
        if (current != lastPage) {
          lastPage = current
          badge.text = "${current + 1} / $total"
          onPageChange(mapOf("page" to current, "pageCount" to total))
        }
      }
    })
    addView(list)
    badge.apply {
      setTextColor(Color.WHITE)
      textSize = 13f
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      val density = resources.displayMetrics.density
      setPadding((12 * density).toInt(), (6 * density).toInt(), (12 * density).toInt(), (6 * density).toInt())
      background = android.graphics.drawable.GradientDrawable().apply { setColor(0xCC1B1F2A.toInt()); cornerRadius = 16 * density }
      alpha = 0f
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    addView(badge)
    scrollThumb.visibility = View.INVISIBLE
    scrollThumb.contentDescription = "Drag to scroll PDF pages"
    scrollThumb.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          draggingThumb = true; thumbStartY = event.rawY; thumbStartProgress = scrollProgress
          main.removeCallbacks(hideScrollThumb); scrollThumb.animate().cancel(); scrollThumb.alpha = 1f
          parent?.requestDisallowInterceptTouchEvent(true)
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val travel = max(1f, height - scrollThumb.height - 24 * resources.displayMetrics.density)
          val progress = (thumbStartProgress + (event.rawY - thumbStartY) / travel).coerceIn(0f, 1f)
          val target = (progress * max(0, pageCount - 1)).toInt()
          list.setSelectionFromTop(target, 0)
          updateScrollThumb(true)
          true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          draggingThumb = false; parent?.requestDisallowInterceptTouchEvent(false)
          main.postDelayed(hideScrollThumb, 1000); true
        }
        else -> true
      }
    }
    addView(scrollThumb)
    image.onZoomChanged = { zoom ->
      onZoomChange(mapOf("zoom" to zoom.toDouble()))
    }
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    image.layout(0, 0, right - left, bottom - top)
    list.measure(View.MeasureSpec.makeMeasureSpec(right - left, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(bottom - top, View.MeasureSpec.EXACTLY))
    list.layout(0, 0, right - left, bottom - top)
    val margin = (12 * resources.displayMetrics.density).toInt()
    badge.measure(View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
    val badgeLeft = (right - left - badge.measuredWidth) / 2
    badge.layout(badgeLeft, margin, badgeLeft + badge.measuredWidth, margin + badge.measuredHeight)
    val thumbWidth = (32 * resources.displayMetrics.density).toInt()
    val thumbHeight = (48 * resources.displayMetrics.density).toInt()
    scrollThumb.layout(right - left - thumbWidth, margin, right - left, margin + thumbHeight)
    updateScrollThumb()
    if (changed && loadedSource.isNotEmpty()) { if (vertical) pages.notifyDataSetChanged() else renderPage() }
  }

  fun applyProps() {
    if (disposed) return
    setBackgroundColor(if (dark) Color.BLACK else Color.rgb(244, 245, 253))
    updateScrollThumb()
    list.visibility = if (vertical) View.VISIBLE else View.GONE
    image.visibility = if (vertical) View.GONE else View.VISIBLE
    if (vertical != lastVertical) {
      lastVertical = vertical
      if (vertical) list.setSelection(max(0, lastPage)) else { requestedPage = max(0, lastPage); renderPage() }
    }
    if (source != loadedSource) {
      loadedSource = source
      lastPage = requestedPage
      openDocument(source)
    } else if (pageRevision != lastPageRevision) {
      lastPage = requestedPage
      if (vertical) list.setSelection(requestedPage) else renderPage()
    }
    lastPageRevision = pageRevision
    if (zoomRevision != lastZoomRevision) {
      lastZoomRevision = zoomRevision
      image.setZoom(requestedZoom)
      if (vertical) (list.getChildAt(0) as? ZoomImageView)?.setZoom(requestedZoom)
    }
  }

  private fun openDocument(uriString: String) {
    image.clearSelection()
    val version = documentVersion.incrementAndGet()
    renderVersion.incrementAndGet()
    image.setImageDrawable(null)
    displayedBitmap = null
    pageCount = 0
    ratios.clear()
    bitmapCache.evictAll()
    pages.notifyDataSetChanged()
    worker.execute {
      closeDocument()
      if (disposed || version != documentVersion.get()) return@execute
      try {
        val uri = Uri.parse(uriString)
        if (uri.scheme != "file" && uri.scheme != "content") {
          reportError(version, "PDF_INVALID_URI", "Choose a PDF stored on this device.")
          return@execute
        }
        descriptor = if (uri.scheme == "file") {
          ParcelFileDescriptor.open(File(requireNotNull(uri.path)), ParcelFileDescriptor.MODE_READ_ONLY)
        } else context.contentResolver.openFileDescriptor(uri, "r")
        val fd = descriptor ?: throw java.io.FileNotFoundException()
        renderer = PdfRenderer(fd)
        val count = renderer!!.pageCount
        if (count == 0) {
          closeDocument()
          reportError(version, "PDF_EMPTY_DOCUMENT", "This PDF has no readable pages.")
          return@execute
        }
        // Only measure the opening page. renderRow learns other page sizes on
        // demand; a long document must not scan thousands of pages before paint.
        if (disposed || version != documentVersion.get()) return@execute
        val firstPage = requestedPage.coerceIn(0, count - 1)
        val firstRatio = renderer!!.openPage(firstPage).use { it.height.toDouble() / max(1, it.width) }
        main.post {
          if (!disposed && version == documentVersion.get()) {
            ratios[firstPage] = firstRatio
            onLoad(mapOf("pageCount" to count))
            pageCount = count
            pages.notifyDataSetChanged()
            if (vertical) list.setSelection(requestedPage) else renderPage()
          }
        }
      } catch (_: SecurityException) {
        closeDocument()
        reportError(version, "PDF_PASSWORD_REQUIRED", "This PDF is protected or access was denied. Choose an unlocked copy.")
      } catch (_: java.io.FileNotFoundException) {
        closeDocument()
        reportError(version, "PDF_FILE_UNAVAILABLE", "The file is no longer available. Choose it again.")
      } catch (_: OutOfMemoryError) {
        closeDocument()
        reportError(version, "PDF_MEMORY_LIMIT", "This document needs more memory than is available.")
      } catch (_: Exception) {
        closeDocument()
        reportError(version, "PDF_INVALID_DOCUMENT", "This file could not be opened as a PDF.")
      }
    }
  }

  private fun renderPage() {
    image.clearSelection()
    image.onRequestText = { px, py -> selectText(image, requestedPage, px, py) }
    if (disposed || width <= 0 || height <= 0) return
    val version = documentVersion.get()
    val render = renderVersion.incrementAndGet()
    val pageIndex = max(0, requestedPage)
    val targetWidth = width
    val targetHeight = height
    worker.execute {
      if (disposed || version != documentVersion.get() || render != renderVersion.get()) return@execute
      val pdf = renderer ?: return@execute
      var bitmap: Bitmap? = null
      try {
        val index = min(pageIndex, pdf.pageCount - 1)
        val page = pdf.openPage(index)
        page.use {
          // Increase detail only within this device's bounded pixel budget.
          val fit = min(targetWidth.toDouble() / page.width, targetHeight.toDouble() / page.height)
          val budget = sqrt(pixelBudget / (page.width.toDouble() * page.height.toDouble()))
          val scale = min(fit * 2.0, budget)
          val bitmapWidth = max(1, (page.width * scale).toInt())
          val bitmapHeight = max(1, (page.height * scale).toInt())
          bitmap = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888)
          bitmap!!.eraseColor(Color.WHITE)
          page.render(bitmap!!, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        }
        val result = bitmap!!
        val count = pdf.pageCount
        main.post {
          if (disposed || version != documentVersion.get() || render != renderVersion.get()) {
            result.recycle()
          } else {
            image.setImageBitmap(result)
            image.setZoom(requestedZoom)
            image.contentDescription = "PDF page ${index + 1} of $count. Pinch to zoom, drag to pan."
            displayedBitmap = result
            // Let Android release displayed bitmaps after RenderThread drops its references.
            onPageChange(mapOf("page" to index, "pageCount" to count))
          }
        }
      } catch (_: OutOfMemoryError) {
        bitmap?.recycle()
        reportError(version, "PDF_MEMORY_LIMIT", "This page is too large to display on this device.", render)
      } catch (_: Exception) {
        bitmap?.recycle()
        reportError(version, "PDF_RENDER_FAILED", "This page could not be displayed. Try another page or PDF.", render)
      }
    }
  }

  // Recycle page views and render only visible rows. PDF bytes and bitmaps never cross JS.
  private fun renderRow(row: ZoomImageView, index: Int, detail: Float = 1f) {
    val version = documentVersion.get()
    val ticket = row.ticket.incrementAndGet()
    val targetWidth = max(1, width)
    val binding = row.binding
    worker.execute {
      if (disposed || version != documentVersion.get() || ticket != row.ticket.get()) return@execute
      val pdf = renderer ?: return@execute
      var bitmap: Bitmap? = null
      try {
        var ratio = 1.414
        pdf.openPage(index).use { page ->
          ratio = page.height.toDouble() / page.width
          // Rows match the screen; a zoomed row is re-rendered sharper within a larger single-page budget.
          val budget = if (detail > 1f) pixelBudget * 2.5 else pixelBudget
          val scale = min(targetWidth.toDouble() * detail / page.width, sqrt(budget / (page.width.toDouble() * page.height)))
          bitmap = Bitmap.createBitmap(max(1, (page.width * scale).toInt()), max(1, (page.height * scale).toInt()), Bitmap.Config.ARGB_8888)
          bitmap!!.eraseColor(Color.WHITE)
          page.render(bitmap!!, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        }
        val result = bitmap!!
        main.post {
          if (disposed || version != documentVersion.get() || ticket != row.ticket.get()) result.recycle()
          else {
            ratios[index] = ratio
            val rowHeight = max(1, (targetWidth * ratio).toInt()).coerceAtMost(100000)
            if (row.layoutParams.height != rowHeight) { row.layoutParams = AbsListView.LayoutParams(LayoutParams.MATCH_PARENT, rowHeight) }
            if (detail > 1f) {
              row.detailed = true
              row.setImageBitmap(result)
              row.refreshTransform()
            } else {
              bitmapCache.put(binding, result)
              row.setImageBitmap(result)
              row.setZoom(1f)
            }
            if (index == list.firstVisiblePosition) onPageChange(mapOf("page" to index, "pageCount" to pageCount))
          }
        }
      } catch (_: OutOfMemoryError) {
        bitmap?.recycle()
        reportError(version, "PDF_MEMORY_LIMIT", "This page is too large to display on this device.")
      } catch (_: Exception) {
        bitmap?.recycle()
        reportError(version, "PDF_RENDER_FAILED", "This page could not be displayed. Try another PDF.")
      }
    }
  }

  private fun reportError(version: Int, code: String, message: String, render: Int? = null) {
    main.post {
      if (!disposed && version == documentVersion.get() && (render == null || render == renderVersion.get())) {
        onError(mapOf("code" to code, "message" to message))
      }
    }
  }

  private fun closeDocument() {
    try { renderer?.close() } catch (_: Exception) { }
    renderer = null
    try { descriptor?.close() } catch (_: Exception) { }
    descriptor = null
  }

  private fun selectText(row: ZoomImageView, page: Int, x: Float, y: Float) {
    if (disposed || selecting) return
    if (row.selectAt(x, y)) return
    selecting = true
    val version = documentVersion.get(); val binding = row.binding; val uri = Uri.parse(source)
    Toast.makeText(context, "Selecting text...", Toast.LENGTH_SHORT).show()
    worker.execute {
      var copy: File? = null
      try {
        fun stale() = disposed || version != documentVersion.get() || row.binding != binding
        if (stale()) return@execute
        val path = if (uri.scheme == "file" && File(uri.path!!).canonicalPath.startsWith(context.cacheDir.canonicalPath + File.separator)) uri.path!! else {
          val temp = File.createTempFile("pdf-selection-", ".pdf", context.cacheDir); copy = temp
          context.contentResolver.openInputStream(uri)!!.use { input -> temp.outputStream().use { output ->
            val buffer = ByteArray(65536)
            while (true) { if (stale()) return@execute; val read = input.read(buffer); if (read < 0) break; output.write(buffer, 0, read) }
          } }; temp.path
        }
        val result = JSONObject(NativeTextEditor({ stale() }, { _, _ -> }).run(JSONObject().put("action", "selection").put("path", path).put("page", page).toString(), context.cacheDir.canonicalPath, context.filesDir.canonicalPath))
        if (result.has("error")) error(result.getString("error"))
        val items = result.getJSONArray("glyphs")
        val glyphs = List(items.length()) { index -> val g = items.getJSONObject(index); PdfGlyph(g.getString("text"), RectF(g.getDouble("left").toFloat(), g.getDouble("top").toFloat(), g.getDouble("right").toFloat(), g.getDouble("bottom").toFloat())) }
        main.post { if (!stale()) { row.glyphs = glyphs; if (!row.selectAt(x, y)) Toast.makeText(context, "No selectable text here. Use Scan Text for a scanned page.", Toast.LENGTH_SHORT).show() } }
      } catch (error: Exception) { main.post { if (!disposed) Toast.makeText(context, error.message ?: "Text selection unavailable.", Toast.LENGTH_SHORT).show() } }
      finally { copy?.delete(); main.post { selecting = false } }
    }
  }
  fun dispose() {
    if (disposed) return
    disposed = true
    main.removeCallbacks(hideScrollThumb); scrollThumb.animate().cancel(); draggingThumb = false
    context.applicationContext.unregisterComponentCallbacks(memoryCallbacks)
    main.removeCallbacks(hideBadge)
    bitmapCache.evictAll()
    documentVersion.incrementAndGet()
    renderVersion.incrementAndGet()
    image.clearSelection(); image.onRequestText = null
    for (i in 0 until list.childCount) (list.getChildAt(i) as? ZoomImageView)?.let { it.clearSelection(); it.onRequestText = null; it.setImageDrawable(null) }
    image.setImageDrawable(null)
    displayedBitmap = null
    list.adapter = null
    list.setOnScrollListener(null)
    list.setRecyclerListener(null)
    image.onZoomChanged = null
    // Let any in-flight native render finish, discard its bitmap, then close the descriptor.
    worker.execute { closeDocument() }
    worker.shutdown()
  }
}

private data class PdfGlyph(val text: String, val rect: RectF)

// Zoom and pan stay entirely in Android's UI toolkit; no per-frame JS events.
private class ZoomImageView(context: Context) : ImageView(context) {
  var glyphs = emptyList<PdfGlyph>()
  var onRequestText: ((Float, Float) -> Unit)? = null
  private var selectionStart = -1; private var selectionEnd = -1
  private var actionMode: ActionMode? = null
  private var selectingEnd = true
  private var draggingSelection = false
  private val selectionPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x553B82F6 }
  private val handlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF2563EB.toInt() }
  private fun pagePoint(x: Float, y: Float): FloatArray {
    val inverse = Matrix(); transform.invert(inverse); val p = floatArrayOf(x, y); inverse.mapPoints(p)
    p[0] /= max(1, drawable?.intrinsicWidth ?: 1); p[1] /= max(1, drawable?.intrinsicHeight ?: 1); return p
  }
  private fun glyphAt(x: Float, y: Float): Int = glyphs.indices.filter { glyphs[it].text.isNotBlank() }.minByOrNull { i -> val r = glyphs[i].rect; val dx = max(r.left - x, max(0f, x - r.right)); val dy = max(r.top - y, max(0f, y - r.bottom)); dx * dx + dy * dy } ?: -1
  fun selectAt(x: Float, y: Float): Boolean {
    val index = glyphAt(x, y); if (index < 0) return false
    val rect = RectF(glyphs[index].rect); rect.inset(-.02f, -.01f); if (!rect.contains(x, y)) return false
    selectionStart = index; selectionEnd = index
    while (selectionStart > 0 && glyphs[selectionStart - 1].text.isNotBlank()) selectionStart--
    while (selectionEnd + 1 < glyphs.size && glyphs[selectionEnd + 1].text.isNotBlank()) selectionEnd++
    if (actionMode == null) actionMode = startActionMode(object : ActionMode.Callback2() {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean { menu.add(0, 1, 0, "Copy"); menu.add(0, 2, 1, "Select all"); return true }
      override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = false
      override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
        if (item.itemId == 2) { selectionStart = 0; selectionEnd = glyphs.lastIndex; invalidate(); mode.invalidateContentRect(); return true }
        if (item.itemId == 1 && selectionStart >= 0) {
          val text = glyphs.subList(min(selectionStart, selectionEnd), max(selectionStart, selectionEnd) + 1).joinToString("") { it.text }
          (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("PDF text", text)); mode.finish(); return true
        }; return false
      }
      override fun onDestroyActionMode(mode: ActionMode) { actionMode = null; selectionStart = -1; selectionEnd = -1; draggingSelection = false; invalidate() }
      override fun onGetContentRect(mode: ActionMode, view: View, out: Rect) { if (selectionStart >= 0 && selectionStart < glyphs.size) { val r = displayRect(glyphs[selectionStart].rect); out.set(r.left.toInt(), r.top.toInt(), r.right.toInt(), r.bottom.toInt()) } else out.set(0, 0, width, height) }
    }, ActionMode.TYPE_FLOATING)
    invalidate(); actionMode?.invalidateContentRect(); return true
  }
  fun clearSelection() { actionMode?.finish(); glyphs = emptyList(); selectionStart = -1; selectionEnd = -1; draggingSelection = false; invalidate() }
  private fun displayRect(raw: RectF): RectF {
    val r = RectF(raw.left * (drawable?.intrinsicWidth ?: 1), raw.top * (drawable?.intrinsicHeight ?: 1), raw.right * (drawable?.intrinsicWidth ?: 1), raw.bottom * (drawable?.intrinsicHeight ?: 1)); transform.mapRect(r); return r
  }
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (selectionStart < 0 || selectionEnd < 0) return
    for (i in min(selectionStart, selectionEnd)..max(selectionStart, selectionEnd)) canvas.drawRect(displayRect(glyphs[i].rect), selectionPaint)
    val a = displayRect(glyphs[selectionStart].rect); val b = displayRect(glyphs[selectionEnd].rect); val radius = 7 * resources.displayMetrics.density
    canvas.drawCircle(a.left, a.bottom + radius, radius, handlePaint); canvas.drawCircle(b.right, b.bottom + radius, radius, handlePaint)
  }
  var binding = ""
  val ticket = AtomicInteger(0)
  var allowScroll = false
  var onZoomChanged: ((Float) -> Unit)? = null
  private var zoom = 1f
  private var offsetX = 0f
  private var offsetY = 0f
  private var lastX = 0f
  private var lastY = 0f
  private var lastFocusX = 0f
  private var lastFocusY = 0f
  private var activePointer = MotionEvent.INVALID_POINTER_ID
  private var animator: ValueAnimator? = null
  private val transform = Matrix()
  private val scaleGesture = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
    override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
      animator?.cancel()
      lastFocusX = detector.focusX
      lastFocusY = detector.focusY
      return true
    }
    override fun onScaleEnd(detector: ScaleGestureDetector) { onZoomChanged?.invoke(zoom) }
    override fun onScale(detector: ScaleGestureDetector): Boolean {
      // Follow the fingers while zooming around the point between them.
      offsetX += detector.focusX - lastFocusX
      offsetY += detector.focusY - lastFocusY
      lastFocusX = detector.focusX
      lastFocusY = detector.focusY
      zoomAround(zoom * detector.scaleFactor, detector.focusX, detector.focusY)
      return true
    }
  })
  private val taps = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
    override fun onDown(event: MotionEvent) = true
    override fun onLongPress(event: MotionEvent) { val p = pagePoint(event.x, event.y); onRequestText?.invoke(p[0], p[1]) }
    override fun onDoubleTap(event: MotionEvent): Boolean {
      animateZoom(if (zoom > 1.1f) 1f else 2.5f, event.x, event.y)
      return true
    }
    override fun onSingleTapConfirmed(event: MotionEvent): Boolean { performClick(); return true }
  })

  var detailed = false
  init { scaleType = ImageView.ScaleType.MATRIX }
  fun refreshTransform() = updateTransform()
  fun setZoom(value: Float) {
    animator?.cancel()
    zoom = value.coerceIn(1f, 5f)
    offsetX = 0f
    offsetY = 0f
    updateTransform()
  }
  private fun zoomAround(value: Float, focusX: Float, focusY: Float) {
    val next = value.coerceIn(1f, 5f)
    val ratio = next / zoom
    val pointX = focusX - width / 2f
    val pointY = focusY - height / 2f
    offsetX = pointX - (pointX - offsetX) * ratio
    offsetY = pointY - (pointY - offsetY) * ratio
    zoom = next
    updateTransform()
  }
  private fun animateZoom(target: Float, focusX: Float, focusY: Float) {
    animator?.cancel()
    animator = ValueAnimator.ofFloat(zoom, target).apply {
      duration = 220
      interpolator = DecelerateInterpolator()
      addUpdateListener { zoomAround(it.animatedValue as Float, focusX, focusY) }
      addListener(object : android.animation.AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: android.animation.Animator) { onZoomChanged?.invoke(zoom) }
      })
      start()
    }
  }
  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    updateTransform()
  }
  override fun onDetachedFromWindow() {
    animator?.cancel(); actionMode?.finish()
    super.onDetachedFromWindow()
  }
  private fun updateTransform() {
    val image = drawable ?: return
    if (width == 0 || height == 0 || image.intrinsicWidth <= 0 || image.intrinsicHeight <= 0) return
    val fit = min(width.toFloat() / image.intrinsicWidth, height.toFloat() / image.intrinsicHeight)
    val scale = fit * zoom
    val scaledWidth = image.intrinsicWidth * scale
    val scaledHeight = image.intrinsicHeight * scale
    val maxX = max(0f, (scaledWidth - width) / 2)
    val maxY = max(0f, (scaledHeight - height) / 2)
    offsetX = offsetX.coerceIn(-maxX, maxX)
    offsetY = offsetY.coerceIn(-maxY, maxY)
    transform.reset()
    transform.postScale(scale, scale)
    transform.postTranslate((width - scaledWidth) / 2 + offsetX, (height - scaledHeight) / 2 + offsetY)
    imageMatrix = transform
  }
  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (selectionStart >= 0 && selectionEnd >= 0 && event.pointerCount == 1) {
      if (event.actionMasked == MotionEvent.ACTION_DOWN) {
        val a = displayRect(glyphs[selectionStart].rect); val b = displayRect(glyphs[selectionEnd].rect); val radius = 30 * resources.displayMetrics.density
        val da = kotlin.math.hypot(event.x - a.left, event.y - a.bottom); val db = kotlin.math.hypot(event.x - b.right, event.y - b.bottom)
        draggingSelection = min(da, db) < radius; selectingEnd = db <= da
        if (!draggingSelection) actionMode?.finish()
      }
      if (draggingSelection) {
        parent?.requestDisallowInterceptTouchEvent(true)
        if (event.actionMasked == MotionEvent.ACTION_MOVE) { val p = pagePoint(event.x, event.y); val index = glyphAt(p[0], p[1]); if (index >= 0) { if (selectingEnd) selectionEnd = index else selectionStart = index; invalidate(); actionMode?.invalidateContentRect() } }
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) { draggingSelection = false; parent?.requestDisallowInterceptTouchEvent(false) }
        return true
      }
    }
    parent?.requestDisallowInterceptTouchEvent(!allowScroll || zoom > 1.01f || event.pointerCount > 1)
    scaleGesture.onTouchEvent(event)
    taps.onTouchEvent(event)
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> { activePointer = event.getPointerId(0); lastX = event.x; lastY = event.y }
      MotionEvent.ACTION_POINTER_UP -> {
        // Continue panning with a remaining finger instead of jumping to it.
        val lifted = event.actionIndex
        if (event.getPointerId(lifted) == activePointer) {
          val next = if (lifted == 0) 1 else 0
          activePointer = event.getPointerId(next)
          lastX = event.getX(next)
          lastY = event.getY(next)
        }
      }
      MotionEvent.ACTION_MOVE -> {
        val index = event.findPointerIndex(activePointer).takeIf { it >= 0 } ?: 0
        val x = event.getX(index)
        val y = event.getY(index)
        if (!scaleGesture.isInProgress && event.pointerCount == 1 && zoom > 1.01f) {
          offsetX += x - lastX
          offsetY += y - lastY
          updateTransform()
        }
        lastX = x
        lastY = y
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { activePointer = MotionEvent.INVALID_POINTER_ID; parent?.requestDisallowInterceptTouchEvent(false) }
    }
    return true
  }
  override fun performClick(): Boolean { super.performClick(); return true }
}

/** The hit area moves with the capsule; there is no full-height fast-scroll touch strip. */
private class PdfScrollThumb(context: Context) : View(context) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  override fun onDraw(canvas: Canvas) {
    val d = resources.displayMetrics.density
    paint.color = 0xEE5279E8.toInt()
    val rect = RectF(width - 20 * d, 2 * d, width - 6 * d, height - 2 * d)
    canvas.drawRoundRect(rect, 7 * d, 7 * d, paint)
    paint.color = Color.WHITE; paint.strokeWidth = 1.5f * d; paint.strokeCap = Paint.Cap.ROUND
    for (offset in -1..1) {
      val y = height / 2f + offset * 4 * d
      canvas.drawLine(rect.left + 4 * d, y, rect.right - 4 * d, y, paint)
    }
  }
}

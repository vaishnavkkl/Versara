package expo.modules.pdfengine

import android.content.Context
import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
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
    list.isVerticalScrollBarEnabled = true
    list.scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
    // Native draggable thumb for long documents; it appears while flinging and fades when idle.
    list.isFastScrollEnabled = true
    list.adapter = pages
    list.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    list.setRecyclerListener { (it as? ZoomImageView)?.let { row -> row.ticket.incrementAndGet(); row.binding = ""; row.setImageDrawable(null) } }
    list.setOnScrollListener(object : AbsListView.OnScrollListener {
      override fun onScrollStateChanged(view: AbsListView?, state: Int) {
        main.removeCallbacks(hideBadge)
        if (state == AbsListView.OnScrollListener.SCROLL_STATE_IDLE) main.postDelayed(hideBadge, 900) else showBadge()
      }
      override fun onScroll(view: AbsListView?, first: Int, visible: Int, total: Int) {
        if (!vertical || visible <= 0) return
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
    if (changed && loadedSource.isNotEmpty()) { if (vertical) pages.notifyDataSetChanged() else renderPage() }
  }

  fun applyProps() {
    if (disposed) return
    setBackgroundColor(if (dark) Color.BLACK else Color.rgb(244, 245, 253))
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
        // Known page heights keep rows and the fast-scroll thumb stable instead of jumping as pages render.
        val sizes = HashMap<Int, Double>()
        for (index in 0 until min(count, 2000)) {
          if (disposed || version != documentVersion.get()) return@execute
          renderer!!.openPage(index).use { sizes[index] = it.height.toDouble() / max(1, it.width) }
        }
        if (count == 0) {
          closeDocument()
          reportError(version, "PDF_EMPTY_DOCUMENT", "This PDF has no readable pages.")
          return@execute
        }
        main.post {
          if (!disposed && version == documentVersion.get()) {
            ratios.putAll(sizes)
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

  fun dispose() {
    if (disposed) return
    disposed = true
    context.applicationContext.unregisterComponentCallbacks(memoryCallbacks)
    main.removeCallbacks(hideBadge)
    bitmapCache.evictAll()
    documentVersion.incrementAndGet()
    renderVersion.incrementAndGet()
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

// Zoom and pan stay entirely in Android's UI toolkit; no per-frame JS events.
private class ZoomImageView(context: Context) : ImageView(context) {
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
    animator?.cancel()
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

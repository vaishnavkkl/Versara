package expo.modules.fileengine

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.VelocityTracker
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.widget.ImageView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Full-screen image preview: decode, zoom, pan and swipe-to-dismiss stay in native code. */
class ZoomableImageView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onLoad by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any>>()
  private val onDismiss by EventDispatcher<Map<String, Any>>()
  // At most one decoder and one replacement request; relayouts never accumulate work.
  private val worker = ThreadPoolExecutor(1, 1, 10, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(1)).apply {
    allowCoreThreadTimeOut(true)
    setThreadFactory { work -> Thread {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
      work.run()
    } }
    rejectedExecutionHandler = ThreadPoolExecutor.DiscardOldestPolicy()
  }
  private val main = Handler(Looper.getMainLooper())
  private val version = AtomicInteger(0)
  private val image = ImageView(context)
  private val density = resources.displayMetrics.density
  private var source = ""
  private val lowMemory = ImageProcessing.lowMemory(context)
  private var requestedTarget = 0
  private var loadedTarget = 0
  private var attached = false
  @Volatile private var disposed = false

  private var zoom = 1f
  private var offsetX = 0f
  private var offsetY = 0f
  private var dismissY = 0f
  private var dismissing = false
  private var lastX = 0f
  private var lastY = 0f
  private var lastFocusX = 0f
  private var lastFocusY = 0f
  private var activePointer = MotionEvent.INVALID_POINTER_ID
  private var multiTouch = false
  private var velocity: VelocityTracker? = null
  private var animator: ValueAnimator? = null
  private val transform = Matrix()

  private val scaleGesture = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
    override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
      animator?.cancel()
      settleDismiss()
      lastFocusX = detector.focusX
      lastFocusY = detector.focusY
      return true
    }
    override fun onScale(detector: ScaleGestureDetector): Boolean {
      offsetX += detector.focusX - lastFocusX
      offsetY += detector.focusY - lastFocusY
      lastFocusX = detector.focusX
      lastFocusY = detector.focusY
      zoomAround(zoom * detector.scaleFactor, detector.focusX, detector.focusY)
      return true
    }
    override fun onScaleEnd(detector: ScaleGestureDetector) { load(detail = true) }
  })
  private val taps = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
    override fun onDown(event: MotionEvent) = true
    override fun onDoubleTap(event: MotionEvent): Boolean {
      animateZoom(if (zoom > 1.1f) 1f else DOUBLE_TAP_ZOOM, event.x, event.y)
      return true
    }
  })

  init {
    clipChildren = true
    image.scaleType = ImageView.ScaleType.MATRIX
    image.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    addView(image, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    contentDescription = "Image preview. Pinch or double tap to zoom. Swipe down to close."
  }

  fun setSource(value: String) {
    if (value == source) return
    source = value
    version.incrementAndGet()
    worker.queue.clear()
    requestedTarget = 0; loadedTarget = 0
    image.setImageDrawable(null)
    zoom = 1f; offsetX = 0f; offsetY = 0f; dismissY = 0f
    load()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    load()
  }

  override fun onDetachedFromWindow() {
    attached = false
    version.incrementAndGet()
    worker.queue.clear()
    animator?.cancel()
    velocity?.recycle(); velocity = null
    image.setImageDrawable(null)
    requestedTarget = 0; loadedTarget = 0
    super.onDetachedFromWindow()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    image.layout(0, 0, right - left, bottom - top)
    if (changed) {
      updateTransform()
      load()
    }
  }

  private fun load(detail: Boolean = false) {
    if (disposed || !attached || source.isEmpty() || width <= 0 || height <= 0) return
    // Fit-to-screen first. Extra zoom detail is decoded only after the user's zoom settles.
    val cap = if (detail) { if (lowMemory) 2048 else 4096 } else { if (lowMemory) 1536 else 2048 }
    val target = (max(width, height) * if (detail) zoom.coerceIn(1f, 2f) else 1f).toInt().coerceIn(512, cap)
    if (target <= requestedTarget) return
    requestedTarget = target
    val ticket = version.incrementAndGet()
    val uri = source
    worker.queue.clear()
    worker.execute {
      if (disposed || ticket != version.get()) return@execute
      try {
        val bitmap = ImageProcessing.decode(context, Uri.parse(uri), target)
        main.post {
          if (disposed || ticket != version.get() || !attached) {
            bitmap.recycle() // Never submitted to the rendering thread.
            return@post
          }
          loadedTarget = target
          val firstImage = image.drawable == null
          image.setImageBitmap(bitmap)
          updateTransform()
          if (firstImage) onLoad(mapOf("width" to bitmap.width, "height" to bitmap.height))
        }
      } catch (_: OutOfMemoryError) {
        report(ticket, "This image is too large to preview on this device.")
      } catch (_: Exception) {
        report(ticket, "This image format could not be previewed on your device.")
      }
    }
  }

  private fun report(ticket: Int, message: String) {
    main.post {
      if (!disposed && ticket == version.get()) {
        requestedTarget = loadedTarget
        // A failed optional detail upgrade must not replace a working preview with an error.
        if (image.drawable == null) onError(mapOf("message" to message))
      }
    }
  }

  private fun zoomAround(value: Float, focusX: Float, focusY: Float) {
    val next = value.coerceIn(1f, MAX_ZOOM)
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
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) { load(detail = true) }
      })
      start()
    }
  }

  private fun settleDismiss() {
    if (dismissY == 0f) return
    dismissY = 0f
    updateTransform()
  }

  private fun finishDismissDrag(velocityY: Float) {
    val threshold = DISMISS_DISTANCE_DP * density
    if (dismissY > threshold || (dismissY > 16 * density && velocityY > DISMISS_VELOCITY_DP * density)) {
      dismissing = true
      animator?.cancel()
      animator = ValueAnimator.ofFloat(dismissY, height.toFloat()).apply {
        duration = 180
        addUpdateListener { dismissY = it.animatedValue as Float; updateTransform() }
        addListener(object : AnimatorListenerAdapter() {
          override fun onAnimationEnd(animation: Animator) { if (!disposed) onDismiss(emptyMap()) }
        })
        start()
      }
    } else {
      animator?.cancel()
      animator = ValueAnimator.ofFloat(dismissY, 0f).apply {
        duration = 200
        interpolator = DecelerateInterpolator()
        addUpdateListener { dismissY = it.animatedValue as Float; updateTransform() }
        start()
      }
    }
  }

  private fun updateTransform() {
    val drawable = image.drawable ?: return
    if (width == 0 || height == 0 || drawable.intrinsicWidth <= 0 || drawable.intrinsicHeight <= 0) return
    val fit = min(width.toFloat() / drawable.intrinsicWidth, height.toFloat() / drawable.intrinsicHeight)
    val progress = min(1f, dismissY / height)
    val scale = fit * zoom * (1f - progress * 0.25f)
    val scaledWidth = drawable.intrinsicWidth * scale
    val scaledHeight = drawable.intrinsicHeight * scale
    val maxX = max(0f, (drawable.intrinsicWidth * fit * zoom - width) / 2)
    val maxY = max(0f, (drawable.intrinsicHeight * fit * zoom - height) / 2)
    offsetX = offsetX.coerceIn(-maxX, maxX)
    offsetY = offsetY.coerceIn(-maxY, maxY)
    transform.reset()
    transform.postScale(scale, scale)
    transform.postTranslate((width - scaledWidth) / 2 + offsetX, (height - scaledHeight) / 2 + offsetY + dismissY)
    image.imageMatrix = transform
    image.alpha = 1f - min(0.6f, progress * 1.2f)
  }

  override fun onInterceptTouchEvent(event: MotionEvent) = true

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (dismissing) return true
    parent?.requestDisallowInterceptTouchEvent(true)
    if (velocity == null) velocity = VelocityTracker.obtain()
    velocity?.addMovement(event)
    scaleGesture.onTouchEvent(event)
    taps.onTouchEvent(event)
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        animator?.takeIf { dismissY != 0f }?.cancel()
        activePointer = event.getPointerId(0); lastX = event.x; lastY = event.y; multiTouch = false
      }
      MotionEvent.ACTION_POINTER_DOWN -> multiTouch = true
      MotionEvent.ACTION_POINTER_UP -> {
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
        if (!scaleGesture.isInProgress && event.pointerCount == 1) {
          if (zoom > 1.01f) {
            offsetX += x - lastX
            offsetY += y - lastY
            updateTransform()
          } else if (!multiTouch) {
            val next = max(0f, dismissY + y - lastY)
            if (next != dismissY && (dismissY > 0f || abs(y - lastY) > abs(x - lastX))) {
              dismissY = next
              updateTransform()
            }
          }
        }
        lastX = x
        lastY = y
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        velocity?.computeCurrentVelocity(1000)
        val velocityY = velocity?.yVelocity ?: 0f
        velocity?.recycle(); velocity = null
        activePointer = MotionEvent.INVALID_POINTER_ID
        parent?.requestDisallowInterceptTouchEvent(false)
        if (zoom <= 1.01f && dismissY > 0f) finishDismissDrag(if (event.actionMasked == MotionEvent.ACTION_UP) velocityY else 0f)
      }
    }
    return true
  }

  fun dispose() {
    if (disposed) return
    disposed = true
    version.incrementAndGet()
    animator?.cancel()
    velocity?.recycle(); velocity = null
    image.setImageDrawable(null)
    worker.shutdownNow()
  }

  private companion object {
    const val MAX_ZOOM = 5f
    const val DOUBLE_TAP_ZOOM = 2.5f
    const val DISMISS_DISTANCE_DP = 120f
    const val DISMISS_VELOCITY_DP = 900f
  }
}

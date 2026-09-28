package expo.modules.pdfengine

import android.content.Context
import android.graphics.*
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Touch sampling and drawing run entirely on the UI thread; only finished marks reach JS. */
class PdfMarkupView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onMark by EventDispatcher<Map<String, Any>>()
  private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue(1), ThreadPoolExecutor.DiscardOldestPolicy())
  private val main = Handler(Looper.getMainLooper())
  private var bitmap: Bitmap? = null
  private var source = ""
  @Volatile private var ticket = 0
  @Volatile private var closed = false
  private var marks = JSONArray()
  private var points = JSONArray()
  var mode = "draw"
  var inkColor = "#1D4ED8"
  var fillColor = ""
  var shapePath = "[]"
  var brush = "pen"
  var pattern = "solid"
  private val cachedRect = RectF()
  private val paths = mutableListOf<Path>()
  private var selected = -1
  private var selectionStart: JSONObject? = null
  private var selectionPoint = PointF()
  private var handle = -1
  private var zoom = 1f
  private var panX = 0f; private var panY = 0f
  private var lastX = 0f; private var lastY = 0f
  private var navigating = false
  private val pinch = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
    override fun onScale(d: ScaleGestureDetector): Boolean {
      val next = (zoom * d.scaleFactor).coerceIn(1f, 6f); val ratio = next / zoom
      panX = d.focusX - width / 2f - (d.focusX - width / 2f - panX) * ratio
      panY = d.focusY - height / 2f - (d.focusY - height / 2f - panY) * ratio
      zoom = next; invalidate(); return true
    }
  })
  var inkWidth = .005
  var disabled = false
  private val rect = RectF()
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  init { setWillNotDraw(false); setBackgroundColor(Color.rgb(230, 234, 242)); contentDescription = "PDF page. Drag to annotate." }
  fun setSource(value: String) {
    if (source == value || closed) return
    source = value; val version = ++ticket; points = JSONArray(); bitmap = null; invalidate()
    worker.execute {
      if (closed || version != ticket) return@execute
      val next = runCatching { BitmapFactory.decodeFile(Uri.parse(value).path) }.getOrNull()
      main.post { if (closed || version != ticket) next?.recycle() else { bitmap = next; invalidate() } }
    }
  }
  fun setMarks(value: String) { marks = runCatching { JSONArray(value) }.getOrDefault(JSONArray()); cachedRect.setEmpty(); if (selected >= marks.length()) selected = -1; invalidate() }
  fun dispose() { closed = true; ticket++; worker.shutdownNow(); bitmap = null; marks = JSONArray(); points = JSONArray() }
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val image = bitmap ?: return
    val scale = minOf(width.toFloat() / image.width, height.toFloat() / image.height)
    val w = image.width * scale * zoom; val h = image.height * scale * zoom
    panX = panX.coerceIn(-maxOf(0f, (w - width) / 2), maxOf(0f, (w - width) / 2)); panY = panY.coerceIn(-maxOf(0f, (h - height) / 2), maxOf(0f, (h - height) / 2))
    rect.set((width - w) / 2 + panX, (height - h) / 2 + panY, (width + w) / 2 + panX, (height + h) / 2 + panY)
    paint.reset(); paint.isFilterBitmap = true; canvas.drawBitmap(image, null, rect, paint)
    canvas.save(); canvas.clipRect(rect)
    if (cachedRect != rect || paths.size != marks.length()) {
      paths.clear()
      for (i in 0 until marks.length()) paths.add(markPath(marks.getJSONObject(i)))
      cachedRect.set(rect)
    }
    for (i in 0 until marks.length()) drawMark(canvas, marks.optJSONObject(i) ?: continue, paths[i])
    if (points.length() >= 2) drawMark(canvas, currentMark())
    canvas.restore()
    if (mode == "select" && selected in 0 until marks.length()) {
      val bounds = boundsOf(marks.getJSONObject(selected))
      val box = RectF(rect.left + bounds.left * rect.width(), rect.top + bounds.top * rect.height(), rect.left + bounds.right * rect.width(), rect.top + bounds.bottom * rect.height())
      paint.reset(); paint.isAntiAlias = true; paint.color = Color.rgb(57, 104, 225); paint.strokeWidth = 2 * resources.displayMetrics.density; paint.style = Paint.Style.STROKE
      canvas.drawRect(box, paint); paint.style = Paint.Style.FILL
      for (p in arrayOf(PointF(box.left, box.top), PointF(box.right, box.top), PointF(box.right, box.bottom), PointF(box.left, box.bottom))) canvas.drawCircle(p.x, p.y, 6 * resources.displayMetrics.density, paint)
    }
  }
  private fun currentMark(): JSONObject {
    var output = points
    if (points.length() >= 2 && mode in listOf("polygon", "line", "highlight")) {
      val template = if (mode == "highlight") JSONArray("[[0,0],[1,0],[1,1],[0,1]]") else runCatching { JSONArray(shapePath) }.getOrDefault(JSONArray())
      if (template.length() >= 2) {
        val a = points.getJSONArray(0); val b = points.getJSONArray(1); output = JSONArray()
        for (i in 0 until template.length()) { val p = template.getJSONArray(i); output.put(JSONArray().put(a.getDouble(0) + (b.getDouble(0) - a.getDouble(0)) * p.getDouble(0)).put(a.getDouble(1) + (b.getDouble(1) - a.getDouble(1)) * p.getDouble(1))) }
      }
    }
    return JSONObject().put("kind", mode).put("brush", brush).put("pattern", pattern).put("color", inkColor).put("fillColor", if (mode == "highlight") inkColor else fillColor).put("width", inkWidth).put("points", output)
  }
  private fun markPath(mark: JSONObject): Path {
    val path = Path(); val pts = mark.optJSONArray("points") ?: return path
    for (i in 0 until pts.length()) { val p = pts.getJSONArray(i); val x = rect.left + p.getDouble(0).toFloat() * rect.width(); val y = rect.top + p.getDouble(1).toFloat() * rect.height(); if (i == 0) path.moveTo(x, y) else path.lineTo(x, y) }
    if (mark.optString("kind") in listOf("polygon", "highlight")) path.close()
    return path
  }
  private fun drawMark(canvas: Canvas, mark: JSONObject, cachedPath: Path? = null) {
    val pts = mark.optJSONArray("points") ?: return
    if (pts.length() < 2) return
    val kind = mark.optString("kind")
    paint.reset(); paint.isAntiAlias = true; paint.color = runCatching { Color.parseColor(mark.optString("color")) }.getOrDefault(Color.BLUE)
    paint.strokeWidth = (mark.optDouble("width", .005) * rect.width()).toFloat(); paint.strokeCap = Paint.Cap.ROUND; paint.strokeJoin = Paint.Join.ROUND; paint.style = Paint.Style.STROKE
    paint.alpha = when { kind.startsWith("highlight") || mark.optString("brush") == "highlighter" -> 77; mark.optString("brush") == "pencil" -> 170; mark.optString("brush") == "marker" -> 210; else -> 255 }
    val unit = maxOf(1f, paint.strokeWidth)
    paint.pathEffect = when (mark.optString("pattern")) { "dotted" -> DashPathEffect(floatArrayOf(unit * .1f, unit * 2.4f), 0f); "dashed" -> DashPathEffect(floatArrayOf(unit * 4, unit * 2), 0f); else -> null }
    val path = cachedPath ?: markPath(mark)
    val closedShape = kind in listOf("polygon", "highlight")
    if (closedShape) {
      path.close()
      val fill = mark.optString("fillColor")
      if (fill.isNotEmpty()) { val border = paint.color; paint.color = runCatching { Color.parseColor(fill) }.getOrDefault(border); if (kind == "highlight") paint.alpha = 77; paint.style = Paint.Style.FILL; canvas.drawPath(path, paint); paint.style = Paint.Style.STROKE; paint.color = border }
    }
    if (kind != "highlight") canvas.drawPath(path, paint)
  }

  private fun boundsOf(mark: JSONObject): RectF {
    val pts = mark.getJSONArray("points"); val result = RectF(1f, 1f, 0f, 0f)
    for (i in 0 until pts.length()) { val p = pts.getJSONArray(i); val x = p.getDouble(0).toFloat(); val y = p.getDouble(1).toFloat(); result.left = minOf(result.left, x); result.top = minOf(result.top, y); result.right = maxOf(result.right, x); result.bottom = maxOf(result.bottom, y) }
    return result
  }
  private fun selectTouch(event: MotionEvent): Boolean {
    val x = ((event.x - rect.left) / rect.width()).coerceIn(0f, 1f); val y = ((event.y - rect.top) / rect.height()).coerceIn(0f, 1f)
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        val tolerance = 24 * resources.displayMetrics.density
        handle = -1
        if (selected in 0 until marks.length()) {
          val b = boundsOf(marks.getJSONObject(selected)); val corners = arrayOf(PointF(b.left,b.top),PointF(b.right,b.top),PointF(b.right,b.bottom),PointF(b.left,b.bottom))
          handle = corners.indexOfFirst { kotlin.math.abs(it.x-x)*rect.width() < tolerance && kotlin.math.abs(it.y-y)*rect.height() < tolerance }
        }
        if (handle < 0) selected = (marks.length()-1 downTo 0).firstOrNull { val b = boundsOf(marks.getJSONObject(it)); b.inset(-tolerance/rect.width(),-tolerance/rect.height()); b.contains(x,y) } ?: -1
        selectionStart = if (selected >= 0) JSONObject(marks.getJSONObject(selected).toString()) else null
        selectionPoint = PointF(x,y); parent?.requestDisallowInterceptTouchEvent(true)
      }
      MotionEvent.ACTION_MOVE -> selectionStart?.let { original ->
        val b = boundsOf(original); val target = RectF(b)
        if (handle < 0) target.offset((x-selectionPoint.x).coerceIn(-b.left,1-b.right),(y-selectionPoint.y).coerceIn(-b.top,1-b.bottom))
        else { if (handle == 0 || handle == 3) target.left = minOf(x,b.right-.005f) else target.right = maxOf(x,b.left+.005f); if (handle < 2) target.top = minOf(y,b.bottom-.005f) else target.bottom = maxOf(y,b.top+.005f) }
        val output = JSONArray(); val pts = original.getJSONArray("points")
        for (i in 0 until pts.length()) { val p = pts.getJSONArray(i); output.put(JSONArray().put((target.left + (p.getDouble(0)-b.left)/maxOf(.0001f,b.width())*target.width()).coerceIn(0.0,1.0)).put((target.top + (p.getDouble(1)-b.top)/maxOf(.0001f,b.height())*target.height()).coerceIn(0.0,1.0))) }
        marks.put(selected, JSONObject(original.toString()).put("points", output)); cachedRect.setEmpty()
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        selectionStart?.let { original -> if (event.actionMasked == MotionEvent.ACTION_CANCEL) marks.put(selected, original) else onMark(mapOf("mark" to marks.getJSONObject(selected).toString())) }
        selectionStart = null; cachedRect.setEmpty(); parent?.requestDisallowInterceptTouchEvent(false)
      }
    }
    invalidate(); return true
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (disabled || bitmap == null || closed) return false
    pinch.onTouchEvent(event)
    if (event.pointerCount > 1) {
      selectionStart?.let { if (selected >= 0) marks.put(selected, it) }; selectionStart = null; cachedRect.setEmpty()
      points = JSONArray()
      val cx = (event.getX(0) + event.getX(1)) / 2; val cy = (event.getY(0) + event.getY(1)) / 2
      if (navigating && event.actionMasked == MotionEvent.ACTION_MOVE) { panX += cx - lastX; panY += cy - lastY }
      lastX = cx; lastY = cy; navigating = true; parent?.requestDisallowInterceptTouchEvent(true); invalidate(); return true
    }
    if (navigating) { if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) { navigating = false; parent?.requestDisallowInterceptTouchEvent(false) }; return true }
    if (mode == "select") return selectTouch(event)
    val point = JSONArray().put(((event.x - rect.left) / rect.width()).coerceIn(0f, 1f).toDouble()).put(((event.y - rect.top) / rect.height()).coerceIn(0f, 1f).toDouble())
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> { if (!rect.contains(event.x, event.y)) return false; parent?.requestDisallowInterceptTouchEvent(true); points = JSONArray().put(point).put(point) }
      MotionEvent.ACTION_MOVE -> { if (mode in listOf("highlight", "polygon", "line")) points.put(1, point) else if (points.length() < 4096) points.put(point) }
      MotionEvent.ACTION_UP -> {
        if (points.length() < 2) return false
        if (mode in listOf("highlight", "polygon", "line")) points.put(1, point)
        val mark = currentMark().put("id", java.util.UUID.randomUUID().toString()); marks.put(mark); cachedRect.setEmpty(); onMark(mapOf("mark" to mark.toString())); points = JSONArray(); parent?.requestDisallowInterceptTouchEvent(false); performClick()
      }
      MotionEvent.ACTION_CANCEL -> { points = JSONArray(); parent?.requestDisallowInterceptTouchEvent(false) }
    }
    invalidate(); return true
  }
  override fun performClick(): Boolean { super.performClick(); return true }
}

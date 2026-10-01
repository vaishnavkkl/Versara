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
import kotlin.math.roundToInt

/** Touch sampling and drawing run entirely on the UI thread; only finished marks reach JS. */
class PdfMarkupView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onMark by EventDispatcher<Map<String, Any>>()
  private val onSelection by EventDispatcher<Map<String, Any>>()
  private val onZoom by EventDispatcher<Map<String, Any>>()
  private val onPageSwipe by EventDispatcher<Map<String, Any>>()
  private var zoomSerial = ""
  private var lastZoom = 1f
  private var loupeVisible = false
  private val loupeFinger = PointF()
  private var grabX = 0f; private var grabY = 0f
  private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue(1), ThreadPoolExecutor.DiscardOldestPolicy())
  private val main = Handler(Looper.getMainLooper())
  private val stampWorker = ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,ArrayBlockingQueue(1),ThreadPoolExecutor.DiscardOldestPolicy())
  private var stampImages = emptyMap<String, Bitmap>()
  private var stampKey = ""
  @Volatile private var stampTicket = 0
  private fun loadStamps() {
    val uris = (0 until marks.length()).mapNotNull { marks.optJSONObject(it)?.takeIf { mark -> mark.optString("kind") == "image" }?.optString("imageUri") }.distinct().take(16)
    val key = uris.joinToString("|"); if (key == stampKey || closed) return
    stampKey = key; val version = ++stampTicket
    val retained = stampImages.filterKeys { it in uris }; stampImages = retained
    stampWorker.execute {
      val loaded = retained.toMutableMap()
      for (uri in uris) {
        if (closed || version != stampTicket) return@execute
        if (loaded.containsKey(uri)) continue
        runCatching {
          val parsed = Uri.parse(uri); require(parsed.scheme == "file")
          val file = java.io.File(requireNotNull(parsed.path)).canonicalFile
          require(file.path.startsWith(context.cacheDir.canonicalPath + "/") || file.path.startsWith(context.filesDir.canonicalPath + "/"))
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(file.path,bounds)
          require(bounds.outWidth in 1..1024 && bounds.outHeight in 1..1024)
          val options = BitmapFactory.Options().apply { inSampleSize = if (maxOf(bounds.outWidth,bounds.outHeight) > 512) 2 else 1 }
          BitmapFactory.decodeFile(file.path,options)?.let { loaded[uri] = it }
        }
      }
      main.post { if (!closed && version == stampTicket) { stampImages=loaded; invalidate() } }
    }
  }
  private var bitmap: Bitmap? = null
  private var source = ""
  @Volatile private var ticket = 0
  @Volatile private var closed = false
  private var marks = JSONArray()
  private var points = JSONArray()
  var mode = "draw"
    set(value) {
      if (field == value) return
      finishErase(commit = false)
      selectionStart?.let { if (selected in 0 until marks.length()) { marks.put(selected, it); cachedRect.setEmpty() } }
      field = value; points = JSONArray(); selectionStart = null; loupeVisible = false; panning = false
      if (value != "select") { selected = -1; emitSelection() } else emitSelection()
      lastErase = null; erasedInGesture.clear(); invalidate()
    }
  var inkColor = "#1D4ED8"
  var fillColor = ""
  var shapePath = "[]"
  var brush = "pen"
  var pattern = "solid"
  var inkOpacity = -1.0
  private val cachedRect = RectF()
  private val paths = mutableListOf<Path>()
  private var selected = -1
  private var selectionStart: JSONObject? = null
  private var selectionPoint = PointF()
  private var handle = -1
  private var lastSelection = ""
  private var lastErase: PointF? = null
  private var eraseStart: JSONArray? = null
  private val erasedInGesture = mutableSetOf<String>()
  private var zoom = 1f
  private var panX = 0f; private var panY = 0f
  private var lastX = 0f; private var lastY = 0f
  private var navigating = false
  // In select mode a drag that starts away from every mark moves the page instead.
  private var panning = false
  private var panStartX = 0f; private var panStartY = 0f
  private val pinch = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
    override fun onScale(d: ScaleGestureDetector): Boolean {
      val next = (zoom * d.scaleFactor).coerceIn(1f, 6f); val ratio = next / zoom
      panX = d.focusX - width / 2f - (d.focusX - width / 2f - panX) * ratio
      panY = d.focusY - height / 2f - (d.focusY - height / 2f - panY) * ratio
      zoom = next; invalidate(); return true
    }
    override fun onScaleEnd(d: ScaleGestureDetector) { emitZoom() }
  })
  private fun emitZoom() { if (kotlin.math.abs(zoom - lastZoom) > .001f) { lastZoom = zoom; onZoom(mapOf("zoom" to zoom.toDouble())) } }
  fun requestZoom(value: String) {
    val serial = value.substringBefore(':'); val factor = value.substringAfter(':', "").toFloatOrNull()
    if (serial == zoomSerial) return
    val first = zoomSerial.isEmpty(); zoomSerial = serial
    if (first || factor == null || !factor.isFinite() || factor <= 0f || closed || width <= 0 || rect.isEmpty) return
    val next = (zoom * factor).coerceIn(1f, 6f); val ratio = next / zoom
    var fx = width / 2f; var fy = height / 2f
    if (selected in 0 until marks.length()) { val box = screenBox(boundsOf(marks.getJSONObject(selected))); fx = box.centerX(); fy = box.centerY() }
    panX = fx - width / 2f - (fx - width / 2f - panX) * ratio
    panY = fy - height / 2f - (fy - height / 2f - panY) * ratio
    if (selected >= 0) { panX += width / 2f - fx; panY += height / 2f - fy }
    zoom = next; invalidate(); emitZoom()
  }
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
  fun setMarks(value: String) {
    eraseStart = null; lastErase = null; erasedInGesture.clear()
    val previousIds = (0 until marks.length()).map { marks.optJSONObject(it)?.optString("id") }.toSet()
    val id = marks.optJSONObject(selected)?.optString("id")
    marks = runCatching { JSONArray(value) }.getOrDefault(JSONArray()); cachedRect.setEmpty()
    selected = if (id.isNullOrEmpty()) -1 else (0 until marks.length()).firstOrNull { marks.optJSONObject(it)?.optString("id") == id } ?: -1
    val added = (marks.length()-1 downTo 0).firstOrNull { val mark=marks.optJSONObject(it); (mode == "select" || mark?.optString("kind") == "image") && mark?.optString("id") !in previousIds }
    if (added != null) selected = added
    if (selected < 0) selectionStart = null
    if (mode == "select") emitSelection()
    loadStamps()
    invalidate()
  }
  fun dispose() { closed = true; stampTicket++; stampWorker.shutdownNow(); stampImages=emptyMap(); ticket++; worker.shutdownNow(); bitmap = null; marks = JSONArray(); points = JSONArray(); paths.clear(); cachedRect.setEmpty(); eraseStart = null; lastErase = null; erasedInGesture.clear(); lastSelection = "" }
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val image = bitmap ?: return
    if (width <= 0 || height <= 0 || image.width <= 0 || image.height <= 0) return
    val scale = minOf(width.toFloat() / image.width, height.toFloat() / image.height)
    val w = image.width * scale * zoom; val h = image.height * scale * zoom
    panX = panX.coerceIn(-maxOf(0f, (w - width) / 2), maxOf(0f, (w - width) / 2)); panY = panY.coerceIn(-maxOf(0f, (h - height) / 2), maxOf(0f, (h - height) / 2))
    rect.set((width - w) / 2 + panX, (height - h) / 2 + panY, (width + w) / 2 + panX, (height + h) / 2 + panY)
    if (cachedRect != rect || paths.size != marks.length()) {
      paths.clear()
      for (i in 0 until marks.length()) paths.add(markPath(marks.getJSONObject(i)))
      cachedRect.set(rect)
    }
    val draft = if (points.length() >= 2) currentMark() else null
    drawScene(canvas, image, draft, 1f)
    if (loupeVisible) drawLoupe(canvas, image, draft)
  }

  private fun drawScene(canvas: Canvas, image: Bitmap, draft: JSONObject?, magnification: Float) {
    paint.reset(); paint.isFilterBitmap = true; canvas.drawBitmap(image, null, rect, paint)
    canvas.save(); canvas.clipRect(rect)
    for (i in 0 until marks.length()) drawMark(canvas, marks.optJSONObject(i) ?: continue, paths[i])
    if (draft != null) drawMark(canvas, draft)
    canvas.restore()
    if (mode == "select" && selected in 0 until marks.length()) drawSelection(canvas, marks.getJSONObject(selected), magnification)
  }

  private fun screenBox(bounds: RectF) = RectF(rect.left + bounds.left * rect.width(), rect.top + bounds.top * rect.height(), rect.left + bounds.right * rect.width(), rect.top + bounds.bottom * rect.height())
  /** Corners first (0-3), then edge midpoints (4-7). Images resize from corners only to keep their shape. */
  private fun handlePoints(box: RectF, image: Boolean): List<PointF> {
    val corners = listOf(PointF(box.left, box.top), PointF(box.right, box.top), PointF(box.right, box.bottom), PointF(box.left, box.bottom))
    return if (image) corners else corners + listOf(PointF(box.centerX(), box.top), PointF(box.right, box.centerY()), PointF(box.centerX(), box.bottom), PointF(box.left, box.centerY()))
  }
  /** The move handle sits in the middle, or below a box too small to hold it beside the resize handles. */
  private fun moveHandle(box: RectF): PointF {
    val density = resources.displayMetrics.density
    if (box.width() >= 64 * density && box.height() >= 64 * density) return PointF(box.centerX(), box.centerY())
    val below = box.bottom + 30 * density
    return PointF(box.centerX(), if (below + 16 * density <= height) below else box.top - 30 * density)
  }
  private fun drawSelection(canvas: Canvas, mark: JSONObject, magnification: Float) {
    val d = resources.displayMetrics.density / magnification
    val box = screenBox(boundsOf(mark)); val outline = Color.rgb(124, 128, 176)
    paint.reset(); paint.isAntiAlias = true; paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.25f * d; paint.color = outline
    paint.pathEffect = DashPathEffect(floatArrayOf(4 * d, 3 * d), 0f); canvas.drawRect(box, paint); paint.pathEffect = null
    val move = moveHandle(box)
    if (!box.contains(move.x, move.y)) canvas.drawLine(box.centerX(), if (move.y > box.bottom) box.bottom else box.top, move.x, move.y, paint)
    val half = 5 * d
    for (p in handlePoints(box, mark.optString("kind") == "image")) {
      paint.style = Paint.Style.FILL; paint.color = Color.WHITE; canvas.drawRect(p.x - half, p.y - half, p.x + half, p.y + half, paint)
      paint.style = Paint.Style.STROKE; paint.color = outline; canvas.drawRect(p.x - half, p.y - half, p.x + half, p.y + half, paint)
    }
    paint.style = Paint.Style.FILL; paint.color = Color.rgb(57, 104, 225); canvas.drawCircle(move.x, move.y, 13 * d, paint)
    paint.style = Paint.Style.STROKE; paint.color = Color.WHITE; paint.strokeWidth = 1.6f * d; paint.strokeCap = Paint.Cap.ROUND; paint.strokeJoin = Paint.Join.ROUND
    val arm = 7 * d; val tip = 2.6f * d
    canvas.drawLine(move.x - arm, move.y, move.x + arm, move.y, paint); canvas.drawLine(move.x, move.y - arm, move.x, move.y + arm, paint)
    for ((dx, dy) in listOf(1f to 0f, -1f to 0f, 0f to 1f, 0f to -1f)) {
      val ex = move.x + dx * arm; val ey = move.y + dy * arm
      canvas.drawLine(ex, ey, ex - dx * tip + dy * tip, ey - dy * tip + dx * tip, paint)
      canvas.drawLine(ex, ey, ex - dx * tip - dy * tip, ey - dy * tip - dx * tip, paint)
    }
  }
  /** A magnified view of the point being placed, shown only while a finger moves a shape or draws one. */
  private fun drawLoupe(canvas: Canvas, image: Bitmap, draft: JSONObject?) {
    val density = resources.displayMetrics.density; val size = 128 * density; val margin = 12 * density
    var frame = RectF(width - margin - size, margin, width - margin.toFloat(), margin + size)
    if (RectF(frame).apply { inset(-24 * density, -24 * density) }.contains(loupeFinger.x, loupeFinger.y)) frame = RectF(margin, margin, margin + size, margin + size)
    var focus = PointF(loupeFinger.x, loupeFinger.y); var magnification = 2.5f
    if (mode == "select" && selected in 0 until marks.length()) {
      val box = screenBox(boundsOf(marks.getJSONObject(selected)))
      if (handle < 0) { focus = PointF(box.centerX(), box.centerY()); magnification = (size * .6f / maxOf(box.width(), box.height(), 1f)).coerceIn(1.5f, 4f) }
      else handlePoints(box, false).getOrNull(handle)?.let { focus = it }
    } else if (draft != null && points.length() > 0) points.optJSONArray(points.length() - 1)?.let { focus = PointF(rect.left + it.optDouble(0).toFloat() * rect.width(), rect.top + it.optDouble(1).toFloat() * rect.height()) }
    val radius = 16 * density; val clip = Path().apply { addRoundRect(frame, radius, radius, Path.Direction.CW) }
    paint.reset(); paint.isAntiAlias = true; paint.color = Color.argb(60, 0, 0, 0); canvas.drawRoundRect(RectF(frame).apply { offset(0f, 2 * density) }, radius, radius, paint)
    canvas.save(); canvas.clipPath(clip); canvas.drawColor(Color.rgb(230, 234, 242))
    canvas.translate(frame.centerX(), frame.centerY()); canvas.scale(magnification, magnification); canvas.translate(-focus.x, -focus.y)
    drawScene(canvas, image, draft, magnification)
    canvas.restore()
    paint.reset(); paint.isAntiAlias = true; paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.5f * density; paint.color = Color.WHITE
    canvas.drawRoundRect(frame, radius, radius, paint)
    paint.color = Color.argb(150, 57, 104, 225); paint.strokeWidth = density; val c = 6 * density
    canvas.drawLine(frame.centerX() - c, frame.centerY(), frame.centerX() + c, frame.centerY(), paint); canvas.drawLine(frame.centerX(), frame.centerY() - c, frame.centerX(), frame.centerY() + c, paint)
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
    return JSONObject().put("kind", mode).put("brush", brush).put("pattern", pattern).put("color", inkColor).put("fillColor", if (mode == "highlight") inkColor else fillColor).put("width", inkWidth).put("points", output).also {
      if (inkOpacity.isFinite() && inkOpacity >= 0) it.put("opacity", inkOpacity.coerceIn(.01, 1.0))
    }
  }
  private fun markPath(mark: JSONObject): Path {
    val path = Path(); val pts = mark.optJSONArray("points") ?: return path
    if (mark.optString("pattern") == "dotted" && mark.optString("kind") !in listOf("polygon", "highlight", "redact")) {
      val vertices = (0 until pts.length()).map { i -> val p = pts.getJSONArray(i); PointF(rect.left + p.getDouble(0).toFloat() * rect.width(), rect.top + p.getDouble(1).toFloat() * rect.height()) }
      return StrokeDots.path(vertices, (mark.optDouble("width", .005) * rect.width()).toFloat())
    }
    for (i in 0 until pts.length()) { val p = pts.getJSONArray(i); val x = rect.left + p.getDouble(0).toFloat() * rect.width(); val y = rect.top + p.getDouble(1).toFloat() * rect.height(); if (i == 0) path.moveTo(x, y) else path.lineTo(x, y) }
    if (mark.optString("kind") in listOf("polygon", "highlight")) path.close()
    return path
  }
  private fun drawMark(canvas: Canvas, mark: JSONObject, cachedPath: Path? = null) {
    val pts = mark.optJSONArray("points") ?: return
    if (pts.length() < 2) return
    val kind = mark.optString("kind")
    if (kind == "image") {
      val stamp = stampImages[mark.optString("imageUri")] ?: return
      val b = boundsOf(mark)
      paint.reset(); paint.isFilterBitmap=true
      canvas.drawBitmap(stamp,null,RectF(rect.left+b.left*rect.width(),rect.top+b.top*rect.height(),rect.left+b.right*rect.width(),rect.top+b.bottom*rect.height()),paint)
      return
    }
    paint.reset(); paint.isAntiAlias = true; paint.color = runCatching { Color.parseColor(mark.optString("color")) }.getOrDefault(Color.BLUE)
    paint.strokeWidth = (mark.optDouble("width", .005) * rect.width()).toFloat(); paint.strokeCap = Paint.Cap.ROUND; paint.strokeJoin = Paint.Join.ROUND; paint.style = Paint.Style.STROKE
    val requestedOpacity = mark.optDouble("opacity", Double.NaN)
    val alpha = if (kind == "redact") 255 else if (requestedOpacity.isFinite()) (requestedOpacity.coerceIn(.01, 1.0) * 255).roundToInt() else when { kind.startsWith("highlight") || mark.optString("brush") == "highlighter" -> 77; mark.optString("brush") == "pencil" -> 170; mark.optString("brush") == "marker" -> 210; else -> 255 }
    paint.alpha = alpha
    val unit = paint.strokeWidth
    val openStroke = kind !in listOf("polygon", "highlight", "redact")
    if (openStroke && mark.optString("pattern") == "dotted") {
      paint.style = Paint.Style.FILL
      canvas.drawPath(cachedPath ?: markPath(mark), paint)
      return
    }
    paint.pathEffect = if (openStroke && mark.optString("pattern") == "dashed") DashPathEffect(floatArrayOf(unit * 4, unit * 2), 0f) else null
    val path = cachedPath ?: markPath(mark)
    val closedShape = kind in listOf("polygon", "highlight")
    if (closedShape) {
      path.close()
      val fill = mark.optString("fillColor")
      if (fill.isNotEmpty()) { val border = paint.color; paint.color = runCatching { Color.parseColor(fill) }.getOrDefault(border); paint.alpha = if (kind == "highlight" || requestedOpacity.isFinite()) alpha else 255; paint.style = Paint.Style.FILL; canvas.drawPath(path, paint); paint.style = Paint.Style.STROKE; paint.color = border }
    }
    if (kind != "highlight") canvas.drawPath(path, paint)
  }

  private fun boundsOf(mark: JSONObject): RectF {
    val pts = mark.getJSONArray("points"); val result = RectF(1f, 1f, 0f, 0f)
    for (i in 0 until pts.length()) { val p = pts.getJSONArray(i); val x = p.getDouble(0).toFloat(); val y = p.getDouble(1).toFloat(); result.left = minOf(result.left, x); result.top = minOf(result.top, y); result.right = maxOf(result.right, x); result.bottom = maxOf(result.bottom, y) }
    return result
  }
  private fun selectTouch(event: MotionEvent): Boolean {
    val rx = (event.x - rect.left) / rect.width(); val ry = (event.y - rect.top) / rect.height()
    val x = rx.coerceIn(0f, 1f); val y = ry.coerceIn(0f, 1f)
    if (panning) {
      when (event.actionMasked) {
        MotionEvent.ACTION_MOVE -> { panX += event.x - lastX; panY += event.y - lastY; lastX = event.x; lastY = event.y; invalidate() }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          panning = false; parent?.requestDisallowInterceptTouchEvent(false)
          val dx = event.x - panStartX; val dy = event.y - panStartY
          if (event.actionMasked == MotionEvent.ACTION_UP && zoom <= 1.01f && kotlin.math.abs(dx) > 64 * resources.displayMetrics.density && kotlin.math.abs(dx) > 1.5f * kotlin.math.abs(dy))
            onPageSwipe(mapOf("direction" to if (dx < 0) 1 else -1))
        }
      }
      return true
    }
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        val tolerance = 24 * resources.displayMetrics.density
        handle = -1; grabX = 0f; grabY = 0f
        var grabbed = false
        if (selected in 0 until marks.length()) {
          val mark = marks.getJSONObject(selected); val box = screenBox(boundsOf(mark))
          var best = tolerance
          handlePoints(box, mark.optString("kind") == "image").forEachIndexed { index, p ->
            val distance = kotlin.math.hypot(p.x - event.x, p.y - event.y)
            if (distance < best) { best = distance; handle = index; grabbed = true; grabX = (p.x - event.x) / rect.width(); grabY = (p.y - event.y) / rect.height() }
          }
          val move = moveHandle(box)
          if (kotlin.math.hypot(move.x - event.x, move.y - event.y) < minOf(best, 28 * resources.displayMetrics.density)) { handle = -1; grabbed = true; grabX = 0f; grabY = 0f }
        }
        if (!grabbed) selected = (marks.length()-1 downTo 0).firstOrNull { val b = boundsOf(marks.getJSONObject(it)); b.inset(-tolerance/rect.width(),-tolerance/rect.height()); b.contains(x,y) } ?: -1
        selectionStart = if (selected >= 0) JSONObject(marks.getJSONObject(selected).toString()) else null
        emitSelection()
        if (selected < 0) {
          panning = true; panStartX = event.x; panStartY = event.y; lastX = event.x; lastY = event.y
          parent?.requestDisallowInterceptTouchEvent(true); invalidate(); return true
        }
        selectionPoint = PointF(rx,ry); loupeFinger.set(event.x, event.y); parent?.requestDisallowInterceptTouchEvent(true)
      }
      MotionEvent.ACTION_MOVE -> selectionStart?.let { original ->
        loupeVisible = true; loupeFinger.set(event.x, event.y)
        val b = boundsOf(original); val target = RectF(b)
        val hx = (rx + grabX).coerceIn(0f, 1f); val hy = (ry + grabY).coerceIn(0f, 1f)
        if (handle < 0) target.offset((rx-selectionPoint.x).coerceIn(-b.left,1-b.right),(ry-selectionPoint.y).coerceIn(-b.top,1-b.bottom))
        else {
          if (handle == 0 || handle == 3 || handle == 7) target.left = minOf(hx, b.right - .005f)
          if (handle == 1 || handle == 2 || handle == 5) target.right = maxOf(hx, b.left + .005f)
          if (handle == 0 || handle == 1 || handle == 4) target.top = minOf(hy, b.bottom - .005f)
          if (handle == 2 || handle == 3 || handle == 6) target.bottom = maxOf(hy, b.top + .005f)
        }
        if (handle >= 0 && original.optString("kind") == "image") {
          val left = handle == 0 || handle == 3; val top = handle < 2
          val ax = if (left) b.right else b.left; val ay = if (top) b.bottom else b.top
          val maxScale = minOf((if (left) ax else 1-ax)/maxOf(.0001f,b.width()),(if (top) ay else 1-ay)/maxOf(.0001f,b.height()))
          val scale = maxOf(kotlin.math.abs(hx-ax)/maxOf(.0001f,b.width()),kotlin.math.abs(hy-ay)/maxOf(.0001f,b.height())).coerceIn(minOf(.05f,maxScale),maxScale)
          val w=b.width()*scale; val h=b.height()*scale
          target.set(if (left) ax-w else ax,if (top) ay-h else ay,if (left) ax else ax+w,if (top) ay else ay+h)
        }
        val output = JSONArray(); val pts = original.getJSONArray("points")
        for (i in 0 until pts.length()) { val p = pts.getJSONArray(i); output.put(JSONArray().put((target.left + (p.getDouble(0)-b.left)/maxOf(.0001f,b.width())*target.width()).coerceIn(0.0,1.0)).put((target.top + (p.getDouble(1)-b.top)/maxOf(.0001f,b.height())*target.height()).coerceIn(0.0,1.0))) }
        marks.put(selected, JSONObject(original.toString()).put("points", output)); cachedRect.setEmpty()
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        selectionStart?.let { original -> if (event.actionMasked == MotionEvent.ACTION_CANCEL) marks.put(selected, original) else onMark(mapOf("mark" to marks.getJSONObject(selected).toString())) }
        selectionStart = null; loupeVisible = false; cachedRect.setEmpty(); parent?.requestDisallowInterceptTouchEvent(false)
        emitSelection()
      }
    }
    invalidate(); return true
  }

  private fun emitSelection() {
    val value = if (selected in 0 until marks.length()) marks.getJSONObject(selected).toString() else ""
    if (value != lastSelection) { lastSelection = value; onSelection(mapOf("mark" to value)) }
  }

  private fun segmentDistance(x: Float, y: Float, ax: Float, ay: Float, bx: Float, by: Float): Float {
    val dx = bx - ax; val dy = by - ay; val length = dx * dx + dy * dy
    val t = if (length <= .0001f) 0f else (((x - ax) * dx + (y - ay) * dy) / length).coerceIn(0f, 1f)
    val px = x - ax - t * dx; val py = y - ay - t * dy
    return px * px + py * py
  }
  private fun segmentsHit(a: PointF, b: PointF, x1: Float, y1: Float, x2: Float, y2: Float, tolerance: Float): Boolean {
    if (maxOf(a.x, b.x) + tolerance < minOf(x1, x2) || minOf(a.x, b.x) - tolerance > maxOf(x1, x2) || maxOf(a.y, b.y) + tolerance < minOf(y1, y2) || minOf(a.y, b.y) - tolerance > maxOf(y1, y2)) return false
    val c1 = (b.x - a.x) * (y1 - a.y) - (b.y - a.y) * (x1 - a.x)
    val c2 = (b.x - a.x) * (y2 - a.y) - (b.y - a.y) * (x2 - a.x)
    val c3 = (x2 - x1) * (a.y - y1) - (y2 - y1) * (a.x - x1)
    val c4 = (x2 - x1) * (b.y - y1) - (y2 - y1) * (b.x - x1)
    if (c1 * c2 < 0f && c3 * c4 < 0f) return true
    val radius = tolerance * tolerance
    return minOf(segmentDistance(a.x, a.y, x1, y1, x2, y2), segmentDistance(b.x, b.y, x1, y1, x2, y2), segmentDistance(x1, y1, a.x, a.y, b.x, b.y), segmentDistance(x2, y2, a.x, a.y, b.x, b.y)) <= radius
  }
  private fun eraseAt(x: Float, y: Float) {
    val end = PointF(x, y); val start = lastErase ?: end
    for (index in marks.length() - 1 downTo 0) {
      val mark = marks.optJSONObject(index) ?: continue
      if (mark.optString("kind") !in listOf("draw", "sign", "highlight-brush", "line")) continue
      val id = mark.optString("id"); if (id.isEmpty() || id in erasedInGesture) continue
      val samples = mark.optJSONArray("points") ?: continue
      val tolerance = maxOf(12 * resources.displayMetrics.density, (mark.optDouble("width", .005) * rect.width() / 2).toFloat())
      var hit = false
      for (point in 1 until samples.length()) {
        val a = samples.getJSONArray(point - 1); val b = samples.getJSONArray(point)
        if (segmentsHit(start, end, rect.left + a.getDouble(0).toFloat() * rect.width(), rect.top + a.getDouble(1).toFloat() * rect.height(), rect.left + b.getDouble(0).toFloat() * rect.width(), rect.top + b.getDouble(1).toFloat() * rect.height(), tolerance)) { hit = true; break }
      }
      if (hit) {
        erasedInGesture.add(id); marks.remove(index); cachedRect.setEmpty(); selected = -1
      }
    }
    lastErase = end; emitSelection(); invalidate()
  }
  private fun finishErase(commit: Boolean) {
    val original = eraseStart ?: return
    if (commit) {
      for (id in erasedInGesture.toList()) onMark(mapOf("mark" to JSONObject().put("id", id).put("deleted", true).toString()))
    } else marks = original
    eraseStart = null; lastErase = null; erasedInGesture.clear(); cachedRect.setEmpty(); invalidate()
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (disabled || bitmap == null || closed || rect.isEmpty) return false
    pinch.onTouchEvent(event)
    if (event.pointerCount > 1) {
      finishErase(commit = false)
      selectionStart?.let { if (selected >= 0) marks.put(selected, it) }; selectionStart = null; cachedRect.setEmpty()
      points = JSONArray(); loupeVisible = false; panning = false
      lastErase = null; erasedInGesture.clear()
      val cx = (event.getX(0) + event.getX(1)) / 2; val cy = (event.getY(0) + event.getY(1)) / 2
      if (navigating && event.actionMasked == MotionEvent.ACTION_MOVE) { panX += cx - lastX; panY += cy - lastY }
      lastX = cx; lastY = cy; navigating = true; parent?.requestDisallowInterceptTouchEvent(true); invalidate(); return true
    }
    if (navigating) { if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) { navigating = false; parent?.requestDisallowInterceptTouchEvent(false); emitZoom() }; return true }
    if (mode == "select") return selectTouch(event)
    if (mode == "erase") {
      if (event.actionMasked == MotionEvent.ACTION_DOWN) {
        if (!rect.contains(event.x, event.y)) return false
        eraseStart = JSONArray(marks.toString()); lastErase = null; erasedInGesture.clear(); parent?.requestDisallowInterceptTouchEvent(true)
      }
      if (eraseStart != null && event.actionMasked in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP)) eraseAt(event.x, event.y)
      if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) { finishErase(commit = event.actionMasked == MotionEvent.ACTION_UP); parent?.requestDisallowInterceptTouchEvent(false) }
      return true
    }
    val point = JSONArray().put(((event.x - rect.left) / rect.width()).coerceIn(0f, 1f).toDouble()).put(((event.y - rect.top) / rect.height()).coerceIn(0f, 1f).toDouble())
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> { if (!rect.contains(event.x, event.y)) return false; parent?.requestDisallowInterceptTouchEvent(true); points = JSONArray().put(point).put(point) }
      MotionEvent.ACTION_MOVE -> { if (mode in listOf("highlight", "polygon", "line")) { points.put(1, point); loupeVisible = true; loupeFinger.set(event.x, event.y) } else if (points.length() < 4096) points.put(point) }
      MotionEvent.ACTION_UP -> {
        if (points.length() < 2) return false
        // Fast strokes can finish before another MOVE; keep their final sample.
        if (mode in listOf("highlight", "polygon", "line")) points.put(1, point) else if (points.length() < 4096) points.put(point)
        val mark = currentMark().put("id", java.util.UUID.randomUUID().toString()); marks.put(mark); cachedRect.setEmpty(); onMark(mapOf("mark" to mark.toString())); points = JSONArray(); loupeVisible = false; parent?.requestDisallowInterceptTouchEvent(false); performClick()
      }
      MotionEvent.ACTION_CANCEL -> { points = JSONArray(); loupeVisible = false; parent?.requestDisallowInterceptTouchEvent(false) }
    }
    invalidate(); return true
  }
  override fun performClick(): Boolean { super.performClick(); return true }
}

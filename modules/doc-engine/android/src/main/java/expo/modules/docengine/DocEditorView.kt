package expo.modules.docengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.os.Build
import android.os.SystemClock
import android.text.Editable
import android.text.InputFilter
import android.text.Layout
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.text.TextWatcher
import android.text.style.BackgroundColorSpan
import android.text.style.CharacterStyle
import android.text.style.ForegroundColorSpan
import android.text.style.ImageSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.util.LruCache
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.EditText
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URLDecoder
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

internal object DocEditors { var active: DocEditorView? = null }

private const val INK = 0xFF000000.toInt()
private const val PAPER = 0xFFFFFFFF.toInt()
/** Above this many characters, whole-document work (page reflow, drafts) waits until typing is done. */
private const val LIVE_WORK_LIMIT = 60_000

private class ChevronButton(context: Context, private val forward: Boolean) : View(context) {
  var tint = 0xFF3C4043.toInt()
    set(value) { field = value; invalidate() }
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
  init { isClickable = true; isFocusable = true; background = android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x22000000), null, null) }
  override fun setEnabled(enabled: Boolean) { super.setEnabled(enabled); alpha = if (enabled) 1f else 0.3f }
  override fun onDraw(canvas: Canvas) {
    val size = min(width, height) * 0.22f
    paint.color = tint
    paint.strokeWidth = resources.displayMetrics.density * 2.2f
    val cx = width / 2f; val cy = height / 2f
    val dx = if (forward) -size / 2 else size / 2
    val path = android.graphics.Path().apply { moveTo(cx + dx, cy - size); lineTo(cx - dx, cy); lineTo(cx + dx, cy + size) }
    canvas.drawPath(path, paint)
  }
}

/** Ruler handles that can be dragged. */
private enum class Handle { NONE, FIRST, INDENT, LEFT, RIGHT }

/**
 * Native document surface laid out like the printed page: real paper size, margins, fonts and
 * page breaks at the current zoom. Typing stays here; JavaScript only sends style commands.
 */
class DocEditorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onReady by EventDispatcher<Map<String, Any>>()
  private val onDocChange by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any>>()
  private val onFormat by EventDispatcher<Map<String, Any>>()
  private val onBand by EventDispatcher<Map<String, Any>>()
  /** EditText reports selection changes from its own constructor, before the fields below exist. */
  private var built = false
  private val geometry = PageGeometry()
  private val edit = object : EditText(context) {
    override fun onSelectionChanged(selStart: Int, selEnd: Int) {
      super.onSelectionChanged(selStart, selEnd)
      if (built) reportFormat()
    }
    // Page-flow and spacing spans make some lines very tall; scroll only to the glyph box at the caret.
    override fun bringPointIntoView(offset: Int): Boolean {
      val box = (if (built) caretBox(offset) else null) ?: return super.bringPointIntoView(offset)
      box.offset(totalPaddingLeft, totalPaddingTop)
      return requestRectangleOnScreen(box)
    }
    override fun bringPointIntoView(offset: Int, requestRectWithoutFocus: Boolean): Boolean {
      if (!requestRectWithoutFocus && !isFocused) return false
      return bringPointIntoView(offset)
    }
  }
  private val caretPaint = android.text.TextPaint(Paint.ANTI_ALIAS_FLAG)

  /** Glyph box (ascent to descent at the baseline) of the text at [offset], in layout coordinates. */
  private fun caretBox(offset: Int): android.graphics.Rect? {
    val layout = edit.layout ?: return null
    val text = edit.text ?: return null
    val at = offset.coerceIn(0, text.length)
    val line = layout.getLineForOffset(at)
    val baseline = layout.getLineBaseline(line)
    val probe = if (at > 0 && text[at - 1] != '\n') at - 1 else at
    val sizeSpan = text.getSpans(probe, min(probe + 1, text.length), DocSizeSpan::class.java).lastOrNull()
    caretPaint.textSize = sizeSpan?.px ?: edit.textSize
    caretPaint.typeface = edit.typeface
    val metrics = caretPaint.fontMetricsInt
    val x = layout.getPrimaryHorizontal(at).toInt()
    val pad = (resources.displayMetrics.density * 2).toInt()
    return android.graphics.Rect(x - pad, baseline + metrics.ascent, x + pad, baseline + metrics.descent)
  }

  /** Text cursor sized to the glyphs on the line instead of the full (page-flow inflated) line height. */
  private inner class CaretDrawable : android.graphics.drawable.Drawable() {
    private val fill = Paint().apply { color = 0xFF1A73E8.toInt() }
    override fun draw(canvas: Canvas) {
      val layout = edit.layout ?: return
      val b = bounds
      val line = layout.getLineForVertical(b.centerY().coerceAtLeast(0))
      val shift = b.top - layout.getLineTop(line)
      val offset = layout.getOffsetForHorizontal(line, b.exactCenterX())
      val box = caretBox(edit.selectionEnd.takeIf { it >= 0 && layout.getLineForOffset(it) == line } ?: offset)
      if (box == null || box.height() <= 0) { canvas.drawRect(b, fill); return }
      canvas.drawRect(b.left.toFloat(), (box.top + shift).toFloat(), b.right.toFloat(), (box.bottom + shift).toFloat(), fill)
    }
    override fun getIntrinsicWidth() = (resources.displayMetrics.density * 2).toInt().coerceAtLeast(2)
    override fun setAlpha(alpha: Int) { fill.alpha = alpha }
    override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) { fill.colorFilter = colorFilter }
    @Deprecated("Deprecated in Java")
    override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
  }
  override val shouldUseAndroidLayout = true
  private val ruler = RulerView(context)
  private val scroll = android.widget.ScrollView(context)
  private val hscroll = android.widget.HorizontalScrollView(context)
  private val sheet = PagesView(context)
  private val strip = android.widget.LinearLayout(context)
  private val stripScroll = android.widget.HorizontalScrollView(context)
  private val stripRow = android.widget.LinearLayout(context)
  private val prevButton = ChevronButton(context, false)
  private val nextButton = ChevronButton(context, true)
  private val stripLabel = android.widget.TextView(context)
  var rulerProp = false
  var pagesProp = false
  private var pageSetup = JSONObject()
  private var defaults = JSONObject()
  private var currentPage = 0
  private var pageCount = 1
  private var currentIndent = 0
  private var currentFirst = 0
  private val thumbs = HashMap<Int, Bitmap>()
  private val bitmaps = object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 1024 / 12).toInt().coerceAtLeast(4096)) {
    override fun sizeOf(key: String, value: Bitmap) = value.byteCount / 1024
  }
  private var hf = JSONObject()
  private var lastFormat: Map<String, Any>? = null
  private val worker = Executors.newSingleThreadExecutor()
  private val main = android.os.Handler(android.os.Looper.getMainLooper())
  var sourceProp = ""
  var formatProp = "docx"
  var blankProp = false
  var darkProp = false
  private var generation = 0
  private var updating = false
  private var sourcePath = ""
  private var format = "docx"
  private var blank = false
  private var dark = false
  private var sect = ""
  private var sections = JSONArray()
  private var sectionIndex = 0
  private var blocks = JSONArray()
  private var lines = listOf<Line>()
  private var edited = false
  private var restored = false
  private val undo = ArrayDeque<Snap>()
  private val redo = ArrayDeque<Snap>()
  private var lastPush = 0L
  private data class Line(val block: Int, val role: String, val row: Int = -1)
  private data class Snap(val blocks: String, val hf: String)

  // Zoom: 1 fits the page width to the screen; the text is laid out again at each committed zoom.
  private var zoom = 1f
  private var scale = 0f
  private var flow: PageFlowSpan? = null
  private var pinching = false
  private var pinchAllowed = false
  private var pinchFactor = 1f
  private var pinchX = 0f
  private var pinchY = 0f
  private var pinchPivotX = 0f
  private var pinchPivotY = 0f
  private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
    override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
      if (!pinchAllowed || sections.length() == 0) return false
      pinchFactor = 1f
      pinchX = detector.focusX - scroll.left
      pinchY = detector.focusY - scroll.top
      pinchPivotX = hscroll.scrollX + pinchX
      pinchPivotY = scroll.scrollY + pinchY
      sheet.pivotX = pinchPivotX
      sheet.pivotY = pinchPivotY
      return true
    }
    override fun onScale(detector: ScaleGestureDetector): Boolean {
      pinchFactor = (pinchFactor * detector.scaleFactor).coerceIn(1f / zoom, 4f / zoom)
      sheet.scaleX = pinchFactor
      sheet.scaleY = pinchFactor
      return true
    }
    override fun onScaleEnd(detector: ScaleGestureDetector) = finishZoom()
  })

  // Text being replaced, kept so a rejected edit can be put back with its formatting.
  private var changeStart = 0
  private var changeAfter = 0
  private var changeOld: CharSequence = ""

  init {
    DocFonts.init(context)
    scaleDetector.isQuickScaleEnabled = false
    edit.background = null
    edit.gravity = android.view.Gravity.TOP or android.view.Gravity.START
    edit.setPadding(0, 0, 0, 0)
    edit.includeFontPadding = false
    edit.isVerticalScrollBarEnabled = false
    edit.setLineSpacing(0f, 1f)
    edit.setTextColor(INK)
    edit.setHintTextColor(0xFF9AA0A6.toInt())
    edit.hint = "Start typing"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) edit.textCursorDrawable = CaretDrawable()
    edit.filters = arrayOf(filter())
    edit.addTextChangedListener(object : TextWatcher {
      // Only the lines touched by the change are copied, so typing cost doesn't grow with the document.
      private var windowLine = -1
      private var windowOffset = 0
      private var windowOld = emptyList<String>()
      override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {
        if (updating || s == null) return
        changeStart = start
        changeAfter = after
        changeOld = SpannableStringBuilder(s, start, start + count)
        val (line, lineStart) = lineAt(s, start)
        val end = TextUtils.indexOf(s, '\n', start + count).let { if (it < 0) s.length else it }
        if (line < lines.size && end >= lineStart) {
          windowLine = line; windowOffset = lineStart
          windowOld = s.subSequence(lineStart, end).toString().split('\n')
        } else windowLine = -1
        val now = SystemClock.uptimeMillis()
        // Each undo step serialises the section, so long documents take one per longer pause.
        if (now - lastPush > (if (s.length > LIVE_WORK_LIMIT) 2500 else 450)) { pushUndo(); lastPush = now }
      }
      override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
      override fun afterTextChanged(s: Editable?) {
        if (updating || s == null) return
        val end = TextUtils.indexOf(s, '\n', changeStart + changeAfter).let { if (it < 0) s.length else it }
        if (windowLine >= 0 && end >= windowOffset && windowOffset <= s.length) {
          accept(windowLine, windowOld, s.subSequence(windowOffset, end).toString().split('\n'))
        } else {
          val after = s.toString()
          val before = after.substring(0, changeStart) + changeOld + after.substring((changeStart + changeAfter).coerceAtMost(after.length))
          val old = linesOf(before)
          if (old.size != lines.size) revert() else accept(0, old, linesOf(after))
        }
      }
    })
    sheet.addView(edit)
    hscroll.isFillViewport = true
    hscroll.isHorizontalScrollBarEnabled = false
    hscroll.addView(sheet, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
    scroll.isFillViewport = true
    scroll.addView(hscroll, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    orientation = VERTICAL
    ruler.visibility = GONE
    addView(ruler, LayoutParams(LayoutParams.MATCH_PARENT, dp(28)))
    addView(scroll, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
    buildStrip()
    addView(strip, LayoutParams(LayoutParams.MATCH_PARENT, dp(112)))
    scroll.setOnScrollChangeListener { _, _, _, _, _ -> updateCurrentPage() }
    hscroll.setOnScrollChangeListener { _, _, _, _, _ -> if (ruler.visibility == VISIBLE) ruler.invalidate() }
    stripScroll.setOnScrollChangeListener { _, _, _, _, _ -> if (strip.visibility == VISIBLE) renderVisibleThumbs() }
    built = true
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w != oldw) post {
      if (updateScale() && sections.length() > 0) { commit(); render() }
      ruler.invalidate()
    }
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      pinching = false
      pinchAllowed = event.y >= scroll.top && event.y < scroll.bottom
    }
    scaleDetector.onTouchEvent(event)
    if (!pinching && scaleDetector.isInProgress) {
      pinching = true
      val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
      super.dispatchTouchEvent(cancel)
      cancel.recycle()
    }
    if (pinching) {
      if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) pinching = false
      return true
    }
    return super.dispatchTouchEvent(event)
  }

  private fun finishZoom() {
    val target = (zoom * pinchFactor).coerceIn(1f, 4f)
    sheet.scaleX = 1f
    sheet.scaleY = 1f
    if (abs(target - zoom) < 0.02f) return
    val old = scale
    zoom = target
    commit()
    if (!updateScale()) return
    val ratio = scale / old
    val x = (pinchPivotX * ratio - pinchX).roundToInt()
    val y = (pinchPivotY * ratio - pinchY).roundToInt()
    sheet.addOnLayoutChangeListener(object : OnLayoutChangeListener {
      override fun onLayoutChange(v: View, l: Int, t: Int, r: Int, b: Int, ol: Int, ot: Int, or: Int, ob: Int) {
        v.removeOnLayoutChangeListener(this)
        hscroll.scrollTo(max(0, x), 0)
        scroll.scrollTo(0, max(0, y))
      }
    })
    render()
    ruler.invalidate()
  }

  private fun buildStrip() {
    strip.orientation = HORIZONTAL
    strip.gravity = android.view.Gravity.CENTER_VERTICAL
    strip.visibility = GONE
    strip.elevation = dp(4).toFloat()
    prevButton.contentDescription = "Previous page"
    nextButton.contentDescription = "Next page"
    prevButton.setOnClickListener { goToPage(currentPage - 1) }
    nextButton.setOnClickListener { goToPage(currentPage + 1) }
    stripLabel.textSize = 12f
    stripLabel.gravity = android.view.Gravity.CENTER
    val controls = android.widget.LinearLayout(context).apply {
      orientation = VERTICAL
      gravity = android.view.Gravity.CENTER
      addView(stripLabel, LayoutParams(dp(64), LayoutParams.WRAP_CONTENT))
      addView(android.widget.LinearLayout(context).apply {
        orientation = HORIZONTAL
        addView(prevButton, LayoutParams(dp(40), dp(44)))
        addView(nextButton, LayoutParams(dp(40), dp(44)))
      })
    }
    strip.addView(controls, LayoutParams(dp(88), LayoutParams.MATCH_PARENT))
    stripRow.orientation = HORIZONTAL
    stripRow.setPadding(dp(4), dp(8), dp(12), dp(8))
    stripScroll.isHorizontalScrollBarEnabled = false
    stripScroll.addView(stripRow, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.MATCH_PARENT))
    strip.addView(stripScroll, LayoutParams(0, LayoutParams.MATCH_PARENT, 1f))
  }

  private fun theme() {
    setBackgroundColor(if (dark) 0xFF1B1B1D.toInt() else 0xFFE8EAED.toInt())
    strip.setBackgroundColor(if (dark) 0xFF232326.toInt() else 0xFFFFFFFF.toInt())
    stripLabel.setTextColor(if (dark) 0xFFECECEC.toInt() else 0xFF202124.toInt())
    val tint = if (dark) 0xFFECECEC.toInt() else 0xFF3C4043.toInt()
    prevButton.tint = tint; nextButton.tint = tint
    ruler.invalidate()
    sheet.invalidate()
  }

  // ---------- Page geometry ----------
  // Document values are in twips (1/20 pt); [scale] is screen pixels per point.
  private fun pageValue(key: String, fallback: Int) = pageSetup.optInt(key, fallback)
  private val pageWidth get() = pageValue("w", 12240).coerceAtLeast(2880)
  private val pageHeight get() = pageValue("h", 15840).coerceAtLeast(2880)
  private val marginTop get() = pageValue("top", 1440)
  private val marginBottom get() = pageValue("bottom", 1440)
  private val marginLeft get() = pageValue("left", 1440)
  private val marginRight get() = pageValue("right", 1440)
  private fun px(twips: Int) = (twips / 20f * scale).roundToInt()
  private fun halfToPx(half: Int) = half / 2f * scale
  private val pageW get() = px(pageWidth)
  private val pageH get() = px(pageHeight)
  private val mL get() = px(marginLeft)
  private var headerReach = 0
  private var footerReach = 0
  private val mT get() = max(px(marginTop), headerReach)
  private val mR get() = px(marginRight)
  private val mB get() = max(px(marginBottom), footerReach)
  private val contentW get() = max(dp(40), pageW - mL - mR)
  private val contentH get() = max(dp(40), pageH - mT - mB)
  private val gutter get() = dp(10)
  private val gap get() = dp(14)
  private val pitch get() = pageH + gap
  private val defaultFont get() = defaults.optString("font", "Calibri").ifEmpty { "Calibri" }
  private val defaultHalf get() = defaults.optInt("size", 22).coerceIn(2, 3276)

  /** Recomputes the scale from the view width; returns true when it changed. */
  private fun updateScale(): Boolean {
    val room = width - 2 * gutter
    if (room <= 0) return false
    val next = room / (pageWidth / 20f) * zoom
    if (abs(next - scale) < 0.001f) return false
    scale = next
    applyGeometry()
    return true
  }

  private fun applyGeometry() {
    measureBands()
    geometry.pitch = pitch
    geometry.content = contentH
    edit.minHeight = contentH
    edit.typeface = DocFonts.typeface(defaultFont, Typeface.NORMAL)
    edit.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, halfToPx(defaultHalf))
    sheet.requestLayout()
  }

  private fun pagesFor(height: Int) = max(1, (max(1, height) - 1) / max(1, pitch) + 1).coerceAtMost(5000)

  fun setPage(value: String) {
    if (sections.length() == 0) return
    val next = JSONObject(value)
    for (key in listOf("w", "h", "top", "right", "bottom", "left")) if (next.has(key)) pageSetup.put(key, next.getInt(key))
    pageSetup.put("dirty", true)
    edited = true
    commit()
    scale = 0f
    updateScale()
    render(); scheduleDraft(); emit()
  }

  fun setRuler(visible: Boolean) { ruler.visibility = if (visible) VISIBLE else GONE; ruler.invalidate() }
  fun setPages(visible: Boolean) {
    strip.visibility = if (visible) VISIBLE else GONE
    if (visible) { rebuildStrip(); renderVisibleThumbs() } else { thumbs.clear(); for (i in 0 until stripRow.childCount) thumbImage(i)?.setImageDrawable(null) }
  }

  private val pagesRunnable = Runnable { reflowPages(); thumbs.clear(); if (strip.visibility == VISIBLE) renderVisibleThumbs() }
  private var pagesStale = false
  /**
   * A full page reflow lays out every line again. Short documents do it once typing pauses; long
   * ones mark the pages stale and reflow when the keyboard closes, so typing never waits on it.
   */
  private fun schedulePages() {
    removeCallbacks(pagesRunnable)
    if (edit.length() <= LIVE_WORK_LIMIT) postDelayed(pagesRunnable, 900) else pagesStale = true
  }
  private fun reflowIfStale() {
    if (!pagesStale) return
    pagesStale = false
    removeCallbacks(pagesRunnable)
    postDelayed(pagesRunnable, 300)
  }

  /**
   * Lays the whole text out again so every line lands on the right page after an edit. Setting the
   * justification mode drops the layout without an equality check, giving one full pass; moving the
   * page flow span would lay the text out twice, once for its old range and once for its new one.
   */
  private fun reflowPages() {
    val text = edit.text ?: return
    val span = flow ?: return
    if (Build.VERSION.SDK_INT >= 26) {
      edit.justificationMode = edit.justificationMode
      edit.measure(MeasureSpec.makeMeasureSpec(contentW, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
      sheet.requestLayout()
    } else text.setSpan(span, 0, text.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
  }

  private fun pagesChanged() {
    thumbs.clear()
    if (strip.visibility == VISIBLE) { rebuildStrip(); renderVisibleThumbs() }
    updateCurrentPage(true)
  }

  private fun pageAtScroll(): Int {
    val y = scroll.scrollY + scroll.height / 3 - gutter
    return (max(0, y) / max(1, pitch)).coerceIn(0, max(0, pageCount - 1))
  }

  private fun updateCurrentPage(force: Boolean = false) {
    val next = pageAtScroll()
    val changed = next != currentPage
    currentPage = next
    stripLabel.text = "${currentPage + 1} of $pageCount"
    prevButton.isEnabled = currentPage > 0
    nextButton.isEnabled = currentPage < pageCount - 1
    if ((changed || force) && strip.visibility == VISIBLE) {
      highlightThumbs()
      stripRow.getChildAt(currentPage)?.let { child ->
        val left = child.left - stripScroll.width / 2 + child.width / 2
        stripScroll.smoothScrollTo(left.coerceAtLeast(0), 0)
      }
    }
  }

  private fun goToPage(index: Int) {
    if (index !in 0 until pageCount) return
    scroll.smoothScrollTo(0, max(0, gutter + index * pitch - dp(6)))
    currentPage = index
    updateCurrentPage(true)
  }

  // ---------- Page drawing ----------
  private val bandPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)

  private fun bandRows(kind: String, number: Int): List<Pair<String, String>> {
    val rows = mutableListOf<Pair<String, String>>()
    hf.optString(kind).takeIf { it.isNotEmpty() }?.split('\n')?.forEach { rows.add(it to hf.optString("${kind}Align", "left")) }
    if (hf.optString("pagePos") == kind) {
      val label = when (hf.optString("pageFormat")) { "page" -> "Page $number"; "pageOf" -> "Page $number of $pageCount"; else -> "$number" }
      rows.add(label to hf.optString("pageAlign", "center"))
    }
    return rows
  }

  /** Header or footer text wrapped to the text width, each row with its own alignment. */
  private fun bandLayout(kind: String, number: Int): StaticLayout? {
    val rows = bandRows(kind, number)
    if (rows.isEmpty() || scale <= 0f) return null
    val text = SpannableStringBuilder()
    rows.forEachIndexed { i, (row, align) ->
      if (i > 0) text.append('\n')
      val a = text.length
      text.append(row)
      val alignment = when (align) { "center" -> Layout.Alignment.ALIGN_CENTER; "right" -> Layout.Alignment.ALIGN_OPPOSITE; else -> Layout.Alignment.ALIGN_NORMAL }
      text.setSpan(android.text.style.AlignmentSpan.Standard(alignment), a, text.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
    }
    bandPaint.typeface = DocFonts.typeface(defaultFont, Typeface.NORMAL)
    bandPaint.textSize = halfToPx(defaultHalf)
    bandPaint.color = INK
    return StaticLayout.Builder.obtain(text, 0, text.length, bandPaint, max(1, contentW)).setIncludePad(false).build()
  }

  /** Word pushes the body away from a header or footer that reaches past the margin. */
  private fun measureBands() {
    headerReach = bandLayout("header", 1)?.let { px(pageValue("hd", 720).coerceAtLeast(0)) + it.height } ?: 0
    footerReach = bandLayout("footer", 1)?.let { px(pageValue("fd", 720).coerceAtLeast(0)) + it.height } ?: 0
  }

  /** Header and footer of one page, with the page's top-left corner at (left, top). */
  private fun drawBands(canvas: Canvas, index: Int, left: Float, top: Float) {
    bandLayout("header", index + 1)?.let { layout ->
      canvas.save()
      canvas.translate(left + mL, top + px(pageValue("hd", 720).coerceAtLeast(0)))
      layout.draw(canvas)
      canvas.restore()
    }
    bandLayout("footer", index + 1)?.let { layout ->
      canvas.save()
      canvas.translate(left + mL, top + pageH - px(pageValue("fd", 720).coerceAtLeast(0)) - layout.height)
      layout.draw(canvas)
      canvas.restore()
    }
  }

  /** One printed page with its top-left corner at the canvas origin, in layout pixels. */
  private fun drawPage(canvas: Canvas, index: Int) {
    drawBands(canvas, index, 0f, 0f)
    val layout = edit.layout ?: return
    canvas.save()
    canvas.translate(mL.toFloat(), (mT - index * pitch).toFloat())
    val top = index * pitch
    canvas.clipRect(0, top, contentW, top + contentH)
    layout.draw(canvas)
    canvas.restore()
  }

  /** Holds the page sheets and the text; draws paper, margins' header and footer on every page. */
  private inner class PagesView(context: Context) : android.view.ViewGroup(context) {
    private val shade = Paint().apply { color = 0x1F000000 }
    private val paper = Paint().apply { color = PAPER }
    private var downZone: String? = null
    private var downX = 0f
    private var downY = 0f
    private val slop = android.view.ViewConfiguration.get(context).scaledTouchSlop

    init { setWillNotDraw(false); clipChildren = false }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
      if (scale <= 0f) { setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), 0); return }
      edit.measure(MeasureSpec.makeMeasureSpec(contentW, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
      val pages = pagesFor(edit.measuredHeight)
      if (pages != pageCount) { pageCount = pages; post { pagesChanged() } }
      setMeasuredDimension(pageW + 2 * gutter, 2 * gutter + pages * pitch - gap)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
      val x = gutter + mL; val y = gutter + mT
      edit.layout(x, y, x + edit.measuredWidth, y + edit.measuredHeight)
    }

    override fun onDraw(canvas: Canvas) {
      if (scale <= 0f) return
      val clip = canvas.clipBounds
      val first = max(0, (clip.top - gutter) / max(1, pitch))
      val last = min(pageCount - 1, (clip.bottom - gutter) / max(1, pitch))
      val edge = max(1, dp(1))
      for (i in first..last) {
        val top = (gutter + i * pitch).toFloat()
        val left = gutter.toFloat()
        canvas.drawRect(left - edge, top - edge / 2f, left + pageW + edge, top + pageH + edge * 2, shade)
        canvas.drawRect(left, top, left + pageW, top + pageH, paper)
        drawBands(canvas, i, left, top)
      }
    }

    override fun dispatchDraw(canvas: Canvas) {
      if (scale <= 0f) return
      val clip = canvas.clipBounds
      val first = max(0, (clip.top - gutter) / max(1, pitch))
      val last = min(pageCount - 1, (clip.bottom - gutter) / max(1, pitch))
      if (last < first) return
      val body = android.graphics.Path()
      for (i in first..last) {
        val top = (gutter + i * pitch + mT).toFloat()
        body.addRect((gutter + mL).toFloat(), top, (gutter + mL + contentW).toFloat(), top + contentH, android.graphics.Path.Direction.CW)
      }
      canvas.save()
      canvas.clipPath(body)
      super.dispatchDraw(canvas)
      canvas.restore()
    }

    private fun zoneAt(x: Float, y: Float): String? {
      if (scale <= 0f || x < gutter || x > gutter + pageW) return null
      val offset = y - gutter
      if (offset < 0) return null
      val index = (offset / pitch).toInt()
      if (index >= pageCount) return null
      val local = offset - index * pitch
      return when {
        local > pageH -> null
        local < mT -> "header"
        local > pageH - mB -> "footer"
        else -> "body"
      }
    }

    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
      if (event.actionMasked != MotionEvent.ACTION_DOWN) return false
      val zone = zoneAt(event.x, event.y)
      if (zone == "header" || zone == "footer") { downZone = zone; downX = event.x; downY = event.y; return true }
      return false
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> { downZone = zoneAt(event.x, event.y); downX = event.x; downY = event.y; return downZone != null }
        MotionEvent.ACTION_UP -> {
          val zone = downZone
          downZone = null
          if (zone == null || abs(event.x - downX) > slop || abs(event.y - downY) > slop) return true
          if (zone == "body") {
            edit.requestFocus()
            val offset = edit.getOffsetForPosition(event.x - edit.left, event.y - edit.top)
            edit.setSelection(offset.coerceIn(0, edit.length()))
            (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager)?.showSoftInput(edit, 0)
          } else if (sections.length() > 0) onBand(mapOf("kind" to zone))
        }
        MotionEvent.ACTION_CANCEL -> downZone = null
      }
      return true
    }
  }

  // ---------- Thumbnails ----------
  private fun thumbSize(): Pair<Int, Int> {
    val height = dp(72)
    return (height * pageWidth / pageHeight.toFloat()).roundToInt().coerceAtLeast(dp(24)) to height
  }
  private fun thumbImage(index: Int) = (stripRow.getChildAt(index) as? android.widget.LinearLayout)?.getChildAt(0) as? android.widget.ImageView

  private fun rebuildStrip() {
    val (w, h) = thumbSize()
    while (stripRow.childCount > pageCount) stripRow.removeViewAt(stripRow.childCount - 1)
    for (i in 0 until pageCount) {
      var item = stripRow.getChildAt(i) as? android.widget.LinearLayout
      if (item == null) {
        item = android.widget.LinearLayout(context).apply {
          orientation = VERTICAL
          gravity = android.view.Gravity.CENTER_HORIZONTAL
          setPadding(dp(6), 0, dp(6), 0)
          addView(android.widget.ImageView(context).apply { scaleType = android.widget.ImageView.ScaleType.FIT_XY })
          addView(android.widget.TextView(context).apply { textSize = 11f; gravity = android.view.Gravity.CENTER })
        }
        stripRow.addView(item, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.MATCH_PARENT))
      }
      val index = i
      item.setOnClickListener { goToPage(index) }
      item.contentDescription = "Page ${i + 1}"
      (item.getChildAt(0) as android.widget.ImageView).layoutParams = LayoutParams(w, h)
      (item.getChildAt(1) as android.widget.TextView).apply { text = "${i + 1}"; setTextColor(if (dark) 0xFFA0A0A5.toInt() else 0xFF5F6368.toInt()) }
    }
    highlightThumbs()
  }

  private fun highlightThumbs() {
    for (i in 0 until stripRow.childCount) {
      val image = thumbImage(i) ?: continue
      val selected = i == currentPage
      image.background = android.graphics.drawable.GradientDrawable().apply {
        setColor(PAPER)
        setStroke(if (selected) dp(2) else dp(1), if (selected) 0xFF1A73E8.toInt() else if (dark) 0xFF4A4A4F.toInt() else 0xFFDADCE0.toInt())
      }
      image.setPadding(dp(2), dp(2), dp(2), dp(2))
    }
  }

  /** Only pages near the visible part of the strip keep a bitmap. */
  private fun renderVisibleThumbs() {
    if (edit.layout == null || stripRow.childCount == 0 || scale <= 0f) return
    val (w, h) = thumbSize()
    val itemWidth = (w + dp(12)).coerceAtLeast(1)
    val first = (stripScroll.scrollX / itemWidth - 2).coerceAtLeast(0)
    val last = ((stripScroll.scrollX + max(stripScroll.width, itemWidth)) / itemWidth + 2).coerceAtMost(pageCount - 1)
    thumbs.keys.filter { it < first || it > last }.forEach { thumbs.remove(it); thumbImage(it)?.setImageDrawable(null) }
    val factor = w / pageW.toFloat()
    for (i in first..last) {
      val image = thumbImage(i) ?: continue
      val bitmap = thumbs.getOrPut(i) {
        Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565).also { bitmap ->
          val canvas = Canvas(bitmap)
          canvas.drawColor(PAPER)
          canvas.scale(factor, factor)
          drawPage(canvas, i)
        }
      }
      image.setImageBitmap(bitmap)
    }
  }

  /**
   * Ruler over the page. Drag the top triangle for the first-line indent, the bottom one for the
   * left indent, and the edges of the white band for the page margins.
   */
  private inner class RulerView(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val text = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val metric get() = java.util.Locale.getDefault().country !in setOf("US", "LR", "MM")
    private var drag = Handle.NONE
    private var dragTwips = 0

    private val inset get() = (gutter - hscroll.scrollX).toFloat()
    private val factor get() = pageW / pageWidth.toFloat()
    private fun xOf(twips: Int) = inset + twips * factor
    private fun twipsAt(x: Float): Int {
      val snap = if (metric) 142 else 90
      return (((x - inset) / factor) / snap).roundToInt() * snap
    }
    private fun value(handle: Handle) = if (drag == handle) dragTwips else when (handle) {
      Handle.FIRST -> marginLeft + currentIndent + currentFirst
      Handle.INDENT -> marginLeft + currentIndent
      Handle.LEFT -> marginLeft
      Handle.RIGHT -> pageWidth - marginRight
      Handle.NONE -> 0
    }

    override fun onTouchEvent(event: android.view.MotionEvent): Boolean {
      if (scale <= 0f || sections.length() == 0) return false
      when (event.actionMasked) {
        android.view.MotionEvent.ACTION_DOWN -> {
          val reach = dp(16).toFloat()
          fun near(handle: Handle) = abs(event.x - xOf(value(handle))) <= reach
          drag = when {
            event.y < height / 2f && near(Handle.FIRST) -> Handle.FIRST
            event.y >= height / 2f && near(Handle.INDENT) -> Handle.INDENT
            near(Handle.LEFT) -> Handle.LEFT
            near(Handle.RIGHT) -> Handle.RIGHT
            near(Handle.FIRST) -> Handle.FIRST
            near(Handle.INDENT) -> Handle.INDENT
            else -> Handle.NONE
          }
          if (drag == Handle.NONE) return false
          dragTwips = value(drag)
          parent?.requestDisallowInterceptTouchEvent(true)
          invalidate()
          return true
        }
        android.view.MotionEvent.ACTION_MOVE -> {
          if (drag == Handle.NONE) return false
          val right = pageWidth - marginRight
          dragTwips = when (drag) {
            Handle.FIRST -> twipsAt(event.x).coerceIn(marginLeft, right - 720)
            Handle.INDENT -> twipsAt(event.x).coerceIn(marginLeft, right - 720)
            Handle.LEFT -> twipsAt(event.x).coerceIn(0, right - 1440)
            Handle.RIGHT -> twipsAt(event.x).coerceIn(marginLeft + 1440, pageWidth)
            Handle.NONE -> 0
          }
          invalidate()
          return true
        }
        android.view.MotionEvent.ACTION_UP -> {
          val handle = drag
          val at = dragTwips
          drag = Handle.NONE
          invalidate()
          when (handle) {
            Handle.FIRST -> if (at != value(Handle.FIRST)) command("paraIndent", "$currentIndent,${at - marginLeft - currentIndent}")
            Handle.INDENT -> if (at != value(Handle.INDENT)) command("paraIndent", "${at - marginLeft},$currentFirst")
            Handle.LEFT -> if (at != marginLeft) marginsFromRuler(left = at)
            Handle.RIGHT -> if (at != pageWidth - marginRight) marginsFromRuler(right = pageWidth - at)
            Handle.NONE -> return false
          }
          return true
        }
        android.view.MotionEvent.ACTION_CANCEL -> { drag = Handle.NONE; invalidate(); return true }
      }
      return drag != Handle.NONE
    }

    override fun onDraw(canvas: Canvas) {
      canvas.drawColor(if (dark) 0xFF1B1B1D.toInt() else 0xFFF1F3F4.toInt())
      if (scale <= 0f) return
      val inset = inset
      val factor = factor
      val metric = metric
      val unit = if (metric) 567f else 1440f
      val steps = if (metric) 2 else 8
      val top = dp(4).toFloat(); val bottom = height - dp(4).toFloat()
      paint.style = Paint.Style.FILL
      paint.color = if (dark) 0xFF3A3A3E.toInt() else 0xFFDADCE0.toInt()
      canvas.drawRect(inset, top, inset + pageW, bottom, paint)
      paint.color = if (dark) 0xFF2A2A2D.toInt() else PAPER
      val leftTwips = value(Handle.LEFT)
      val contentLeft = xOf(leftTwips)
      val contentRight = xOf(value(Handle.RIGHT))
      canvas.drawRect(contentLeft, top, contentRight, bottom, paint)
      paint.color = if (dark) 0xFF9AA0A6.toInt() else 0xFF5F6368.toInt()
      paint.strokeWidth = dp(1).toFloat() * 0.75f
      text.color = paint.color
      text.textSize = dp(9).toFloat()
      val minor = unit / steps
      var index = kotlin.math.floor(-leftTwips / minor).toInt()
      while (true) {
        val twips = leftTwips + index * minor
        if (twips > pageWidth) break
        if (twips >= 0) {
          val x = inset + twips * factor
          val whole = index % steps == 0
          if (whole && index != 0) canvas.drawText("${abs(index / steps)}", x, (top + bottom) / 2 + dp(3), text)
          else if (!whole) {
            val length = if (steps == 8 && index % 4 == 0) dp(6) else dp(3)
            canvas.drawLine(x, bottom - length, x, bottom, paint)
          }
        }
        index++
      }
      paint.color = 0xFF1A73E8.toInt()
      marker(canvas, xOf(value(Handle.FIRST)), top, down = true)
      marker(canvas, xOf(value(Handle.INDENT)), bottom, down = false)
      marker(canvas, contentRight, bottom, down = false)
      if (drag != Handle.NONE) {
        val x = xOf(dragTwips)
        paint.strokeWidth = dp(1).toFloat()
        canvas.drawLine(x, top, x, bottom, paint)
        val shown = when (drag) {
          Handle.FIRST, Handle.INDENT -> dragTwips - leftTwips
          Handle.RIGHT -> pageWidth - dragTwips
          else -> dragTwips
        }
        val label = if (metric) String.format(java.util.Locale.getDefault(), "%.2f cm", shown / 567f) else String.format(java.util.Locale.getDefault(), "%.2f\"", shown / 1440f)
        text.color = 0xFF1A73E8.toInt()
        canvas.drawText(label, (x + dp(28)).coerceAtMost(width - dp(28).toFloat()), (top + bottom) / 2 + dp(3), text)
      }
    }
    private fun marker(canvas: Canvas, x: Float, edge: Float, down: Boolean) {
      val size = dp(5).toFloat()
      val path = android.graphics.Path()
      if (down) path.apply { moveTo(x - size, edge); lineTo(x + size, edge); lineTo(x, edge + size * 1.4f); close() }
      else path.apply { moveTo(x - size, edge - size * 1.4f); lineTo(x + size, edge - size * 1.4f); lineTo(x, edge); close() }
      canvas.drawPath(path, paint)
    }
  }

  private fun marginsFromRuler(left: Int? = null, right: Int? = null) {
    val next = JSONObject()
    left?.let { next.put("left", it) }
    right?.let { next.put("right", it) }
    setPage(next.toString())
    onDocChange(mapOf("dirty" to edited, "characters" to edit.length(), "canUndo" to undo.isNotEmpty(), "canRedo" to redo.isNotEmpty(), "section" to sectionIndex, "sections" to sections.length(), "page" to pageJson().toString()))
  }

  private fun pageJson() = JSONObject().put("w", pageWidth).put("h", pageHeight).put("top", marginTop).put("right", marginRight).put("bottom", marginBottom).put("left", marginLeft)

  fun setHeaderFooter(value: String) {
    if (sections.length() == 0) return
    pushUndo()
    val next = JSONObject(value)
    for (key in listOf("headerLocked", "footerLocked")) if (hf.optBoolean(key)) next.put(key, true)
    hf = next.put("dirty", true)
    edited = true
    val top = mT; val bottom = mB
    measureBands()
    if (mT != top || mB != bottom) { commit(); render() }
    else { sheet.invalidate(); thumbs.clear(); if (strip.visibility == VISIBLE) renderVisibleThumbs() }
    scheduleDraft(); emit()
  }

  fun dispose() {
    generation++
    worker.shutdownNow()
    removeCallbacks(pagesRunnable)
    edit.removeCallbacks(draftRunnable)
    // Changes are kept only by Save; the draft exists to recover from a crash while editing.
    if (sections.length() > 0) try { draft().delete() } catch (_: Exception) {}
    thumbs.clear()
    bitmaps.evictAll()
  }

  private fun reportFormat() {
    if (updating || lines.isEmpty() || edit.text == null) return
    val start = edit.selectionStart.coerceAtLeast(0)
    val end = edit.selectionEnd.coerceAtLeast(start)
    val text = edit.text
    val probeStart = if (start == end && start > 0) start - 1 else start
    val probeEnd = if (start == end) max(start, probeStart + 1).coerceAtMost(text.length) else end
    fun has(match: (Any) -> Boolean) =
      if (start == end) text.getSpans(start, start, CharacterStyle::class.java).any { match(it) && appliesAt(it, start) }
      else text.getSpans(probeStart, probeEnd, CharacterStyle::class.java).any { match(it) && text.getSpanStart(it) <= probeStart && text.getSpanEnd(it) >= probeEnd }
    val index = lineIndex(start)
    val sizeSpan = if (start == end) text.getSpans(start, start, DocSizeSpan::class.java).lastOrNull { appliesAt(it, start) } else text.getSpans(probeStart, probeEnd, DocSizeSpan::class.java).firstOrNull()
    val size = sizeSpan?.half?.let { it / 2 } ?: (defaultHalf / 2)
    val block = lines.getOrNull(index)?.takeIf { it.role == "para" }?.let { blocks.optJSONObject(it.block) }
    val indent = block?.optInt("indent", 0)?.coerceAtLeast(0) ?: 0
    val first = block?.optInt("first", 0) ?: 0
    if (indent != currentIndent || first != currentFirst) { currentIndent = indent; currentFirst = first; ruler.invalidate() }
    val state = mapOf(
      "indent" to indent,
      "first" to first,
      "line" to (block?.optInt("line", 0) ?: 0),
      "before" to (block?.optInt("before", -1) ?: -1),
      "after" to (block?.optInt("after", -1) ?: -1),
      "bold" to has { it is StyleSpan && it.style == Typeface.BOLD },
      "italic" to has { it is StyleSpan && it.style == Typeface.ITALIC },
      "underline" to has { it is UnderlineSpan },
      "strike" to has { it is StrikethroughSpan },
      "align" to (block?.optString("align", "left")?.ifEmpty { "left" } ?: "left"),
      "list" to (block?.optString("list", "none")?.ifEmpty { "none" } ?: "none"),
      "size" to size,
      "image" to (imageLine() >= 0),
    )
    if (state != lastFormat) { lastFormat = state; onFormat(state) }
  }

  fun applyProps() {
    setRuler(rulerProp)
    if ((strip.visibility == VISIBLE) != pagesProp) setPages(pagesProp)
    configure(sourceProp, formatProp, blankProp, darkProp)
  }
  fun configure(source: String, format: String, blank: Boolean, dark: Boolean) {
    val path = filePath(source)
    val changed = path != sourcePath || format != this.format || blank != this.blank
    this.dark = dark
    theme()
    if (!changed && sections.length() > 0) return
    sourcePath = path
    this.format = format
    this.blank = blank
    val token = ++generation
    worker.execute {
      try {
        val model = loadModel()
        main.post { if (token == generation) present(model) }
      } catch (error: Exception) {
        main.post { if (token == generation) onError(mapOf("message" to (error.message ?: "Could not open this document."))) }
      }
    }
  }

  // ---------- Commands ----------
  fun command(name: String, value: String) {
    if (sections.length() == 0) return
    if (name == "undo") { restore(undo.removeLastOrNull(), redo); return }
    if (name == "redo") { restore(redo.removeLastOrNull(), undo); return }
    if (name == "blur") {
      edit.clearFocus()
      (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager)?.hideSoftInputFromWindow(edit.windowToken, 0)
      return
    }
    pushUndo(); lastPush = SystemClock.uptimeMillis()
    val start = edit.selectionStart.coerceAtLeast(0)
    val end = edit.selectionEnd.coerceAtLeast(start)
    when (name) {
      "bold" -> toggleStyle(start, end) { StyleSpan(Typeface.BOLD) }
      "italic" -> toggleStyle(start, end) { StyleSpan(Typeface.ITALIC) }
      "underline" -> toggleStyle(start, end) { UnderlineSpan() }
      "strike" -> toggleStyle(start, end) { StrikethroughSpan() }
      "color" -> paint(start, end, value, foreground = true)
      "highlight" -> paint(start, end, value, foreground = false)
      "size" -> size(start, end, value.toIntOrNull() ?: 11)
      "align" -> paragraphStyle(start, end, align = value)
      "list" -> paragraphStyle(start, end, list = value)
      "style" -> headingStyle(start, end, value)
      "indent", "paraIndent", "line", "spaceBefore", "spaceAfter" -> spacing(start, end, name, value)
      "clear" -> clearFormatting(start, end)
      "table" -> { insertTable(value); return }
      "deleteImage" -> {
        val index = imageLine()
        if (index < 0) return
        commit(); removeBlocks(listOf(lines[index].block)); edited = true
        render(); scheduleDraft(); emit(); lastFormat = null; reportFormat()
        return
      }
    }
    markDirty(start, end)
    scheduleDraft()
    emit()
    lastFormat = null
    reportFormat()
  }

  /** Paragraph lines touching [start, end], with their text bounds. */
  private fun paragraphsIn(start: Int, end: Int): List<Triple<Int, Int, Int>> {
    val ranges = lineRanges()
    val out = mutableListOf<Triple<Int, Int, Int>>()
    for (i in ranges.indices) {
      val range = ranges[i]
      if (range.last + 1 < start || range.first > end) continue
      if (lines.getOrNull(i)?.role != "para") continue
      out.add(Triple(i, range.first, if (range.last >= range.first && range.last < edit.length() && edit.text[range.last] != '\n') range.last + 1 else range.first))
    }
    return out
  }

  private fun headingStyle(start: Int, end: Int, value: String) {
    val size = when (value) { "title" -> 26; "subtitle" -> 15; "h1" -> 20; "h2" -> 16; "h3" -> 14; else -> 0 }
    val bold = value == "h1" || value == "h2" || value == "h3"
    val style = when (value) { "title" -> "Title"; "subtitle" -> "Subtitle"; "h1" -> "Heading1"; "h2" -> "Heading2"; "h3" -> "Heading3"; else -> "" }
    for ((index, a, b) in paragraphsIn(start, end)) {
      val block = blocks.optJSONObject(lines[index].block) ?: continue
      if (style.isEmpty()) block.remove("style") else block.put("style", style)
      val flags = Spanned.SPAN_INCLUSIVE_INCLUSIVE
      trim(DocSizeSpan::class.java, a, b)
      edit.text.getSpans(a, b, StyleSpan::class.java).filter { it.style == Typeface.BOLD }.forEach { trimSpan(it, a, b) }
      if (value == "subtitle") {
        trim(ForegroundColorSpan::class.java, a, b)
        edit.text.setSpan(ForegroundColorSpan(0xFF595959.toInt()), a, b, flags)
      }
      val half = if (size > 0) size * 2 else defaultHalf
      edit.text.setSpan(DocSizeSpan(half, halfToPx(half)), a, b, flags)
      if (bold) edit.text.setSpan(StyleSpan(Typeface.BOLD), a, b, flags)
    }
  }

  private fun spacing(start: Int, end: Int, name: String, value: String) {
    for ((index, _, _) in paragraphsIn(start, end)) {
      val block = blocks.optJSONObject(lines[index].block) ?: continue
      when (name) {
        "indent" -> block.put("indent", (block.optInt("indent", 0).coerceAtLeast(0) + if (value == "out") -720 else 720).coerceIn(0, 7200))
        "paraIndent" -> {
          val parts = value.split(',').mapNotNull { it.trim().toIntOrNull() }
          if (parts.size == 2) {
            val indent = parts[0].coerceIn(0, 14400)
            block.put("indent", indent).put("first", parts[1].coerceIn(-indent, 14400))
          }
        }
        "line" -> value.toFloatOrNull()?.let { block.put("line", (it * 240).roundToInt().coerceIn(240, 720)).put("rule", "auto") }
        "spaceBefore" -> value.toIntOrNull()?.let { block.put("before", (it * 20).coerceIn(0, 1440)).remove("cb") }
        "spaceAfter" -> value.toIntOrNull()?.let { block.put("after", (it * 20).coerceIn(0, 1440)).remove("ca") }
      }
      refreshLines(index, index)
    }
    schedulePages()
  }

  private fun paragraphStyle(start: Int, end: Int, align: String? = null, list: String? = null) {
    val touched = mutableListOf<Int>()
    for ((index, _, _) in paragraphsIn(start, end)) {
      val block = blocks.optJSONObject(lines[index].block) ?: continue
      if (align != null) block.put("align", align)
      if (list != null) {
        val was = block.optString("list", "none")
        if (list == "bullet" || list == "decimal") {
          if (block.optString("numKind") != list) for (key in listOf("num", "ilvl", "numKind", "marker", "mf", "ms", "mc", "mb")) block.remove(key)
          if (was == "none" || was.isEmpty()) block.put("indent", max(720, block.optInt("indent", 0))).put("first", -360)
          block.put("list", list)
          if (list == "bullet" && block.optString("num").isEmpty()) block.put("marker", "\u2022")
        } else {
          block.put("list", "none").put("indent", 0).put("first", 0)
          for (key in listOf("num", "ilvl", "numKind", "marker", "mf", "ms", "mc", "mb")) block.remove(key)
        }
      }
      touched.add(index)
    }
    val changed = if (list != null) renumber() else emptySet()
    for (index in touched) refreshLines(index, index)
    refreshBlocks(changed)
    if (align != null) updateJustify()
    schedulePages()
  }

  private fun clearFormatting(start: Int, end: Int) {
    if (start == end) return
    for (span in edit.text.getSpans(start, end, CharacterStyle::class.java)) if (span !is ImageSpan) trimSpan(span, start, end)
  }

  /** Removes [span] from [start, end] while keeping it on the text outside that range. */
  private fun trimSpan(span: Any, start: Int, end: Int) {
    val text = edit.text
    val a = text.getSpanStart(span); val b = text.getSpanEnd(span)
    if (a < 0) return
    text.removeSpan(span)
    if (a < start) cloneSpan(span)?.let { text.setSpan(it, a, start, Spanned.SPAN_EXCLUSIVE_INCLUSIVE) }
    if (b > end) cloneSpan(span)?.let { text.setSpan(it, end, b, Spanned.SPAN_EXCLUSIVE_INCLUSIVE) }
  }
  private fun <T> trim(type: Class<T>, start: Int, end: Int) { for (span in edit.text.getSpans(start, end, type)) trimSpan(span as Any, start, end) }
  private fun cloneSpan(span: Any): Any? = when (span) {
    is StyleSpan -> StyleSpan(span.style)
    is UnderlineSpan -> UnderlineSpan()
    is StrikethroughSpan -> StrikethroughSpan()
    is ForegroundColorSpan -> ForegroundColorSpan(span.foregroundColor)
    is BackgroundColorSpan -> BackgroundColorSpan(span.backgroundColor)
    is DocSizeSpan -> DocSizeSpan(span.half, halfToPx(span.half))
    is DocFontSpan -> DocFontSpan(span.font)
    else -> null
  }

  private fun insertTable(value: String) {
    val parts = value.split('x')
    val rowCount = parts.getOrNull(0)?.toIntOrNull()?.coerceIn(1, 20) ?: 2
    val colCount = parts.getOrNull(1)?.toIntOrNull()?.coerceIn(1, 8) ?: 2
    commit()
    val rows = JSONArray()
    repeat(rowCount) { rows.put(JSONArray().apply { repeat(colCount) { put(JSONObject().put("text", "")) } }) }
    insertBlock(JSONObject().put("kind", "table").put("rows", rows).put("borders", true).put("dirty", true))
  }

  private fun insertBlock(block: JSONObject) {
    val index = lineIndex(edit.selectionStart.coerceAtLeast(0)).let { if (it < 0) blocks.length() else lines[it].block + 1 }
    val next = JSONArray()
    for (i in 0 until index) next.put(blocks.getJSONObject(i))
    next.put(block)
    if (index >= blocks.length()) next.put(paragraph(""))
    for (i in index until blocks.length()) next.put(blocks.getJSONObject(i))
    blocks = next
    sections.getJSONObject(sectionIndex).put("blocks", blocks)
    edited = true
    render()
    val after = lines.indexOfFirst { it.block > index }
    val ranges = lineRanges()
    if (after in ranges.indices) {
      val at = ranges[after].first.coerceIn(0, edit.length())
      edit.requestFocus()
      edit.setSelection(at)
    }
    scheduleDraft(); emit()
  }

  /**
   * Camera photos carry their rotation in EXIF, which Word ignores, and are often far larger than a
   * page needs. Returns an upright copy at most 2400 px on its long side, or the file itself.
   */
  private fun uprightImage(file: File): File {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException("That image could not be read.")
    val jpeg = bounds.outMimeType == "image/jpeg"
    val degrees = if (!jpeg) 0 else try {
      when (android.media.ExifInterface(file.path).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1)) {
        android.media.ExifInterface.ORIENTATION_ROTATE_90 -> 90
        android.media.ExifInterface.ORIENTATION_ROTATE_180 -> 180
        android.media.ExifInterface.ORIENTATION_ROTATE_270 -> 270
        else -> 0
      }
    } catch (_: Exception) { 0 }
    val limit = 2400
    val native = jpeg || bounds.outMimeType == "image/png"
    if (native && degrees == 0 && max(bounds.outWidth, bounds.outHeight) <= limit) return file
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= limit) sample *= 2
    val decoded = try { BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) } catch (_: OutOfMemoryError) { null } ?: return file
    val fit = min(1f, limit / max(decoded.width, decoded.height).toFloat())
    val matrix = android.graphics.Matrix().apply { if (fit < 1f) postScale(fit, fit); if (degrees != 0) postRotate(degrees.toFloat()) }
    val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    if (upright !== decoded) decoded.recycle()
    val dir = File(context.cacheDir, "doc-images").apply { mkdirs() }
    dir.listFiles()?.sortedBy { it.lastModified() }?.dropLast(100)?.forEach { it.delete() }
    val out = File(dir, "image-${System.currentTimeMillis()}.${if (jpeg) "jpg" else "png"}")
    out.outputStream().use { upright.compress(if (jpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG, 90, it) }
    upright.recycle()
    return out
  }

  fun insertImage(path: String) {
    val source = File(filePath(path))
    if (!source.exists()) throw IllegalArgumentException("That image could not be read.")
    val file = uprightImage(source)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    // Inserted at 96 dpi, then limited to the text width like Word does.
    var cx = max(bounds.outWidth, 1).toLong() * 9525L
    var cy = max(bounds.outHeight, 1).toLong() * 9525L
    val maxCx = (pageWidth - marginLeft - marginRight).coerceAtLeast(1440).toLong() * 635L
    if (cx > maxCx) { cy = cy * maxCx / cx; cx = maxCx }
    pushUndo()
    commit()
    insertBlock(JSONObject().put("kind", "image").put("source", file.path).put("cx", cx).put("cy", cy).put("align", "left").put("dirty", true))
  }

  fun resizeImage(percent: Int) {
    val index = imageLine()
    if (index < 0) throw IllegalStateException("Tap an image first.")
    val block = blocks.getJSONObject(lines[index].block)
    val cx = block.optLong("cx").coerceAtLeast(1)
    val cy = block.optLong("cy").coerceAtLeast(1)
    val next = (cx * percent.coerceIn(10, 400) / 100).coerceIn(152400L, 5943600L)
    pushUndo()
    commit()
    block.put("cx", next).put("cy", cy * next / cx).put("resized", true).put("dirty", true).remove("raw")
    edited = true
    render(); scheduleDraft(); emit()
  }

  private fun imageLine(): Int {
    val start = edit.selectionStart.coerceAtLeast(0)
    val ranges = lineRanges()
    for (i in lines.indices) {
      if (lines[i].role != "image" || i >= ranges.size) continue
      if (start >= ranges[i].first && start <= ranges[i].last + 1) return i
    }
    return -1
  }

  fun setSection(index: Int) {
    if (index !in 0 until sections.length() || index == sectionIndex) return
    commit(); sectionIndex = index; blocks = sections.getJSONObject(index).getJSONArray("blocks"); render(); scroll.scrollTo(0, 0); emit()
  }

  fun save(output: String) {
    commit()
    val path = filePath(output)
    if (format == "txt" && !path.endsWith(".docx", true)) File(path).writeText(plain())
    else {
      val request = modelRoot().put("action", "save").put("output", path)
      if (!blank && format == "docx" && sourcePath.isNotEmpty()) request.put("source", sourcePath)
      val result = JSONObject(NativeDoc.call(request.toString()))
      if (result.has("error")) throw IllegalStateException(result.getString("message"))
    }
    draft().delete()
    edited = false
    emit()
  }

  fun exportPdf(output: String) {
    commit()
    for ((drawable, source, size) in pendingPictures.toList()) if (drawable.bitmap == null) drawable.bitmap = bitmapFor(source, size.first, size.second)
    pendingPictures.clear()
    pagesStale = false
    reflowPages()
    val layout = edit.layout ?: throw IllegalStateException("Could not lay out this document.")
    val pages = pagesFor(max(layout.height, contentH))
    val shrink = 1f / scale
    val document = PdfDocument()
    try {
      for (index in 0 until pages) {
        val page = document.startPage(PdfDocument.PageInfo.Builder((pageWidth / 20f).roundToInt(), (pageHeight / 20f).roundToInt(), index + 1).create())
        page.canvas.scale(shrink, shrink)
        drawPage(page.canvas, index)
        document.finishPage(page)
      }
      FileOutputStream(filePath(output)).use { document.writeTo(it) }
    } finally {
      document.close()
    }
  }

  fun exportText(output: String) { commit(); File(filePath(output)).writeText(plain()) }
  fun discard() { draft().delete(); edited = false; emit() }

  private var visibleHeight = 0
  private val keyboardWatch = android.view.ViewTreeObserver.OnGlobalLayoutListener {
    val frame = android.graphics.Rect()
    getWindowVisibleDisplayFrame(frame)
    // The visible frame grows by the keyboard's height when it closes.
    if (visibleHeight > 0 && frame.height() > visibleHeight + dp(120)) reflowIfStale()
    visibleHeight = frame.height()
  }
  override fun onAttachedToWindow() {
    super.onAttachedToWindow(); DocEditors.active = this
    viewTreeObserver.addOnGlobalLayoutListener(keyboardWatch)
  }
  override fun onDetachedFromWindow() {
    if (DocEditors.active === this) DocEditors.active = null
    viewTreeObserver.removeOnGlobalLayoutListener(keyboardWatch)
    super.onDetachedFromWindow()
  }

  // ---------- Loading ----------
  private fun loadModel(): JSONObject {
    val draft = draft()
    if (draft.exists() && draft.length() < 8_000_000) {
      restored = true
      return JSONObject(draft.readText()).also { cacheImages(it) }
    }
    restored = false
    val result = when {
      blank -> JSONObject(NativeDoc.call("{\"action\":\"blank\"}"))
      format == "txt" -> textModel(File(sourcePath).readText())
      else -> JSONObject(NativeDoc.call(JSONObject().put("action", "open").put("path", sourcePath).toString())).also {
        if (it.has("error")) throw IllegalStateException(it.getString("message"))
      }
    }
    cacheImages(result)
    return result
  }

  /** Extracts every picture the document shows, including ones inside tables and text runs. */
  private fun cacheImages(model: JSONObject) {
    if (blank || format == "txt" || sourcePath.isEmpty()) return
    val folder = File(context.cacheDir, "versara-doc-media").apply { mkdirs() }
    val original = File(sourcePath)
    val prefix = "${sourcePath.hashCode().toUInt().toString(16)}_${original.length().toString(16)}_${original.lastModified().toString(16)}"
    val cached = folder.listFiles()?.filter { it.isFile }?.sortedBy { it.lastModified() }.orEmpty()
    var bytes = cached.sumOf { it.length() }
    for (file in cached) {
      if (bytes <= 192L * 1024 * 1024) break
      if (!file.name.startsWith("${prefix}_")) {
        val length = file.length()
        if (file.delete()) bytes -= length
      }
    }
    fun visit(node: Any?) {
      when (node) {
        is JSONArray -> for (i in 0 until node.length()) visit(node.opt(i))
        is JSONObject -> {
          val media = node.optString("media")
          if (media.isNotEmpty()) {
            val name = media.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_")
            val dest = File(folder, "${prefix}_${media.hashCode().toUInt().toString(16)}_$name")
            if (!dest.exists() || dest.length() == 0L) NativeDoc.call(JSONObject().put("action", "media").put("path", sourcePath).put("name", media).put("output", dest.path).toString())
            if (dest.exists() && dest.length() > 0L) node.put("preview", dest.path) else node.remove("preview")
          }
          for (key in listOf("sections", "blocks", "runs", "table", "rows", "cells", "paras")) node.opt(key)?.let { visit(it) }
        }
      }
    }
    visit(model)
  }

  private fun present(model: JSONObject) {
    sect = model.optString("sect")
    hf = model.optJSONObject("hf") ?: JSONObject()
    pageSetup = model.optJSONObject("page") ?: JSONObject()
    defaults = model.optJSONObject("defaults") ?: JSONObject().put("font", "Calibri").put("size", 22).put("before", 0).put("after", if (format == "txt") 0 else 160).put("line", if (format == "txt") 240 else 259).put("rule", "auto")
    sections = model.getJSONArray("sections")
    if (sections.length() == 0) sections.put(JSONObject().put("blocks", JSONArray().put(paragraph(""))))
    sectionIndex = 0
    blocks = sections.getJSONObject(0).getJSONArray("blocks")
    undo.clear(); redo.clear(); edited = restored
    zoom = 1f
    scale = 0f
    updateScale()
    render()
    val locked = (0 until sections.length()).sumOf { section ->
      val list = sections.getJSONObject(section).getJSONArray("blocks")
      (0 until list.length()).count { list.getJSONObject(it).optString("kind") == "locked" }
    }
    val bands = JSONObject(hf.toString()).apply { remove("dirty") }
    val paper = pageJson()
    onReady(mapOf("characters" to edit.length(), "sections" to sections.length(), "section" to 0, "locked" to locked, "restored" to restored, "hf" to bands.toString(), "page" to paper.toString()))
    emit()
    reportFormat()
  }

  // ---------- Rendering ----------
  private fun render() {
    if (sections.length() == 0) return
    if (scale <= 0f) updateScale()
    if (scale <= 0f) return
    applyGeometry()
    val tail = blocks.optJSONObject(blocks.length() - 1)?.optString("kind")
    if (sectionIndex == sections.length() - 1 && tail != null && tail != "paragraph" && !(tail == "locked" && blocks.getJSONObject(blocks.length() - 1).has("runs"))) {
      blocks.put(paragraph(""))
      sections.getJSONObject(sectionIndex).put("blocks", blocks)
    }
    renumber()
    pendingPictures.clear()
    val text = DocText()
    var breakNext = false
    for (i in 0 until blocks.length()) {
      val block = blocks.getJSONObject(i)
      val start = text.length
      val kind = block.optString("kind")
      val table = if (kind == "locked") block.optJSONObject("table") else null
      when {
        table != null && (table.optJSONArray("rows")?.length() ?: 0) > 0 -> appendLockedTable(text, table)
        kind == "image" -> appendImage(text, block)
        kind == "table" -> appendTable(text, block)
        kind == "locked" && !block.has("runs") -> appendLabel(text, block)
        else -> appendParagraph(text, block, contentW)
      }
      if (breakNext || block.optBoolean("pbb") || block.optBoolean("brB")) markBreak(text, start)
      breakNext = block.optBoolean("brA")
      text.append('\n')
    }
    val span = PageFlowSpan(geometry) { offset -> edit.layout?.let { it.getLineTop(it.getLineForOffset(offset)) } ?: 0 }
    flow = span
    text.setSpan(span, 0, text.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
    lines = structure()
    updateJustify()
    val cursor = edit.selectionStart
    updating = true
    val inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or
      (if (text.length > 15_000) android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS else 0)
    if (edit.inputType != inputType) edit.inputType = inputType
    edit.setText(text, android.widget.TextView.BufferType.EDITABLE)
    edit.setSelection(cursor.coerceIn(0, edit.length()))
    updating = false
    thumbs.clear()
    sheet.requestLayout()
    sheet.invalidate()
    if (strip.visibility == VISIBLE) post { renderVisibleThumbs() }
  }

  /** Android justifies a whole text view at once, so the mode follows most of the body text. */
  private fun updateJustify() {
    if (Build.VERSION.SDK_INT < 26) return
    var justified = 0; var ragged = 0
    for (i in 0 until blocks.length()) {
      val block = blocks.optJSONObject(i) ?: continue
      if (block.optString("kind") != "paragraph" && !(block.optString("kind") == "locked" && block.has("runs"))) continue
      val length = paragraphText(block).length
      when (block.optString("align", "left")) { "justify" -> justified += length; "left", "" -> ragged += length }
    }
    val mode = if (justified > ragged) android.text.Layout.JUSTIFICATION_MODE_INTER_WORD else android.text.Layout.JUSTIFICATION_MODE_NONE
    if (edit.justificationMode != mode) edit.justificationMode = mode
  }

  private fun markBreak(text: Spannable, start: Int) {
    text.setSpan(PageBreakMark(), start, start, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
  }

  private fun needsBreak(blockIndex: Int): Boolean {
    val block = blocks.optJSONObject(blockIndex) ?: return false
    return block.optBoolean("pbb") || block.optBoolean("brB") || (blockIndex > 0 && blocks.optJSONObject(blockIndex - 1)?.optBoolean("brA") == true)
  }

  private fun appendParagraph(text: DocText, block: JSONObject, width: Int) {
    val start = text.length
    val runs = block.optJSONArray("runs")
    if (runs != null) for (r in 0 until runs.length()) {
      val run = runs.optJSONObject(r) ?: continue
      val a = text.length
      text.append(run.optString("text").replace('\n', '\u2028'))
      val b = text.length
      if (a < b || (a == start && r == runs.length() - 1)) applyRun(text, run, a, b, block, width)
    }
    applyParagraphSpans(text, block, start, text.length, width)
  }

  private fun applyRun(text: Spannable, run: JSONObject, a: Int, b: Int, block: JSONObject, width: Int) {
    if (run.optString("media").isNotEmpty() && b > a) {
      val (roomW, roomH) = imageRoom(block, width)
      attachImage(text, a, run.optLong("cx"), run.optLong("cy"), run.optString("preview"), roomW, roomH)
      return
    }
    val lineStart = a == 0 || text[a - 1] == '\n'
    val flags = if (a == b || lineStart) Spanned.SPAN_INCLUSIVE_INCLUSIVE else Spanned.SPAN_EXCLUSIVE_INCLUSIVE
    if (run.optBoolean("bold")) text.setSpan(StyleSpan(Typeface.BOLD), a, b, flags)
    if (run.optBoolean("italic")) text.setSpan(StyleSpan(Typeface.ITALIC), a, b, flags)
    // The text view already uses the document's default font and size, so runs in those need no span.
    val font = run.optString("font")
    if (font.isNotEmpty() && !font.equals(defaultFont, ignoreCase = true)) text.setSpan(DocFontSpan(font), a, b, flags)
    val size = run.optInt("size")
    if (size in 2..3276 && size != defaultHalf) text.setSpan(DocSizeSpan(size, halfToPx(size)), a, b, flags)
    if (run.optBoolean("underline")) text.setSpan(UnderlineSpan(), a, b, flags)
    if (run.optBoolean("strike")) text.setSpan(StrikethroughSpan(), a, b, flags)
    val color = hexColor(run.optString("color"))
    if (color != 0) text.setSpan(ForegroundColorSpan(color), a, b, flags)
    val highlight = hexColor(run.optString("highlight"))
    if (highlight != 0) text.setSpan(BackgroundColorSpan(highlight), a, b, flags)
  }

  private fun dominantFont(block: JSONObject): String {
    val runs = block.optJSONArray("runs") ?: return defaultFont
    for (i in 0 until runs.length()) runs.optJSONObject(i)?.optString("font")?.takeIf { it.isNotEmpty() }?.let { return it }
    return defaultFont
  }

  private fun nextTab(x: Int, block: JSONObject): Int {
    val tabs = block.optJSONArray("tabs")
    if (tabs != null) for (i in 0 until tabs.length()) {
      val stop = px(tabs.optJSONArray(i)?.optInt(0) ?: continue)
      if (stop > x + 1) return stop
    }
    val step = max(1, px(720))
    return (x / step + 1) * step
  }

  private fun applyParagraphSpans(text: Spannable, block: JSONObject, start: Int, end: Int, width: Int) {
    val flags = (if (start == end) Spanned.SPAN_INCLUSIVE_INCLUSIVE else Spanned.SPAN_EXCLUSIVE_INCLUSIVE) or FIRST
    val indent = block.optInt("indent", 0).coerceAtLeast(0)
    val first = block.optInt("first", 0)
    val rest = px(indent)
    val markerX = max(0, px(indent + first))
    val marker = block.optString("marker").takeIf { it.isNotEmpty() && block.optString("list", "none") != "none" }
    var firstPx = markerX
    var markerPaint: TextPaint? = null
    if (marker != null) {
      val run = block.optJSONArray("runs")?.optJSONObject(0)
      val half = block.optInt("ms", 0).takeIf { it > 0 } ?: run?.optInt("size", 0)?.takeIf { it > 0 } ?: defaultHalf
      markerPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = DocFonts.typeface(block.optString("mf").ifEmpty { run?.optString("font").orEmpty().ifEmpty { defaultFont } }, if (block.optBoolean("mb")) Typeface.BOLD else Typeface.NORMAL)
        textSize = halfToPx(half)
        color = hexColor(block.optString("mc")).takeIf { it != 0 } ?: INK
      }
      val markerEnd = markerX + markerPaint.measureText(marker).roundToInt()
      firstPx = if (first < 0 && markerEnd < rest) rest else nextTab(markerEnd, block)
    }
    if (firstPx > 0 || rest > 0 || marker != null) text.setSpan(ParagraphMarginSpan(firstPx, rest, marker, markerX, markerPaint), start, end, flags)
    when (block.optString("align")) {
      "center" -> text.setSpan(DocAlignSpan(Layout.Alignment.ALIGN_CENTER), start, end, flags)
      "right" -> text.setSpan(DocAlignSpan(Layout.Alignment.ALIGN_OPPOSITE), start, end, flags)
    }
    val hasLine = block.has("line")
    val line = if (hasLine) block.optInt("line", 240) else defaults.optInt("line", 240)
    val rule = if (hasLine) block.optString("rule", "auto") else defaults.optString("rule", "auto")
    val before = if (block.optBoolean("cb")) 0 else px(block.optInt("before", defaults.optInt("before", 0)).coerceAtLeast(0))
    val after = if (block.optBoolean("ca")) 0 else px(block.optInt("after", defaults.optInt("after", 0)).coerceAtLeast(0))
    text.setSpan(SpacingSpan(before, after, line.coerceIn(1, 31680), rule, px(line), DocFonts.gap(dominantFont(block))), start, end, flags)
    val hasTab = end > start && TextUtils.indexOf(text, '\t', start, end) >= 0
    if (hasTab && !alignedTabs(text, block, start, end, firstPx, width)) {
      val stops = sortedSetOf<Int>()
      block.optJSONArray("tabs")?.let { tabs -> for (i in 0 until tabs.length()) tabs.optJSONArray(i)?.optInt(0)?.let { stops.add(px(it) - rest) } }
      val step = max(1, px(720))
      var x = step
      while (x < width && stops.size < 40) { if (x - rest > (stops.lastOrNull() ?: 0)) stops.add(x - rest); x += step }
      for (stop in stops) if (stop > 0) text.setSpan(DocTabSpan(stop), start, end, flags)
    }
  }

  /**
   * Right, center and decimal tab stops and tab leaders, which Android's left-only tab stops cannot
   * show: each tab gets a measured width so the text after it lands on its stop. Returns false when
   * the paragraph only has plain left stops.
   */
  private fun alignedTabs(text: Spannable, block: JSONObject, start: Int, end: Int, firstPx: Int, width: Int): Boolean {
    val tabs = block.optJSONArray("tabs") ?: return false
    val stops = (0 until tabs.length()).mapNotNull { i -> tabs.optJSONArray(i)?.let { Triple(px(it.optInt(0)), it.optString(1, "left"), it.optString(2, "")) } }
      .filter { it.first > 0 }.sortedBy { it.first }
    if (stops.none { it.second != "left" || it.third.isNotEmpty() }) return false
    val paint = TextPaint(edit.paint)
    fun measure(a: Int, b: Int) = if (b > a) Layout.getDesiredWidth(text, a, b, paint).roundToInt() else 0
    val step = max(1, px(720))
    val least = max(1, paint.measureText(" ").roundToInt())
    var x = firstPx
    var from = start
    var tab = TextUtils.indexOf(text, '\t', start, end)
    while (tab in start until end) {
      x += measure(from, tab)
      val next = TextUtils.indexOf(text, '\t', tab + 1, end).let { if (it < 0) end else it }
      val stop = stops.firstOrNull { it.first > x + 1 } ?: Triple(((x / step) + 1) * step, "left", "")
      val after = when (stop.second) {
        "right" -> measure(tab + 1, next)
        "center" -> measure(tab + 1, next) / 2
        "decimal" -> measure(tab + 1, TextUtils.indexOf(text, '.', tab + 1, next).let { if (it < 0) next else it })
        else -> 0
      }
      val fill = (stop.first - x - after).coerceIn(least, max(least, width - x))
      text.setSpan(DocTabFill(fill, stop.third), tab, tab + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      x += fill
      from = tab + 1
      tab = if (next < end) next else -1
    }
    return true
  }

  private fun appendLabel(text: DocText, block: JSONObject) {
    val start = text.length
    text.append('[').append(block.optString("label", "Locked content")).append(']')
    text.setSpan(StyleSpan(Typeface.ITALIC), start, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    text.setSpan(ForegroundColorSpan(0xFF80868B.toInt()), start, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    text.setSpan(SpacingSpan(0, px(defaults.optInt("after", 0)), 240, "auto", 0, 0f), start, text.length, Spanned.SPAN_EXCLUSIVE_INCLUSIVE or FIRST)
  }

  private fun appendImage(text: DocText, block: JSONObject) {
    val at = text.length
    text.append('\uFFFC')
    val (roomW, roomH) = imageRoom(block, contentW)
    attachImage(text, at, block.optLong("cx"), block.optLong("cy"), block.optString("preview").ifEmpty { block.optString("source") }, roomW, roomH)
    val flags = Spanned.SPAN_EXCLUSIVE_INCLUSIVE or FIRST
    when (block.optString("align")) {
      "center" -> text.setSpan(DocAlignSpan(Layout.Alignment.ALIGN_CENTER), at, at + 1, flags)
      "right" -> text.setSpan(DocAlignSpan(Layout.Alignment.ALIGN_OPPOSITE), at, at + 1, flags)
    }
    text.setSpan(SpacingSpan(px(block.optInt("before", 0).coerceAtLeast(0)), px(block.optInt("after", 0).coerceAtLeast(0)), 240, "auto", 0, 0f), at, at + 1, flags)
  }

  /** The attachment and its paragraph spacing must fit inside one printable body area. */
  private fun imageRoom(block: JSONObject, width: Int): Pair<Int, Int> {
    val left = max(px(block.optInt("indent", 0).coerceAtLeast(0)), px((block.optInt("indent", 0) + block.optInt("first", 0)).coerceAtLeast(0)))
    val right = px(block.optInt("right", 0).coerceAtLeast(0))
    val before = if (block.optBoolean("cb")) 0 else px(block.optInt("before", defaults.optInt("before", 0)).coerceAtLeast(0))
    val after = if (block.optBoolean("ca")) 0 else px(block.optInt("after", defaults.optInt("after", 0)).coerceAtLeast(0))
    val line = block.optInt("line", defaults.optInt("line", 240)).coerceAtLeast(1)
    val factor = if (block.optString("rule", defaults.optString("rule", "auto")) == "auto") line / 240f * (1f + DocFonts.gap(dominantFont(block))) else 1f
    val height = ((contentH - before - after - halfToPx(defaultHalf).roundToInt() - dp(2)) / max(1f, factor)).roundToInt()
    return max(1, width - left - right) to max(1, height)
  }

  private fun attachImage(text: Spannable, at: Int, cx: Long, cy: Long, source: String, maxWidth: Int, maxHeight: Int) {
    var w = cx / 12700f * scale
    var h = cy / 12700f * scale
    if (w <= 0f || h <= 0f) {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      if (source.startsWith("/")) BitmapFactory.decodeFile(source, bounds)
      w = if (bounds.outWidth > 0) bounds.outWidth.toFloat() * scale else dp(120).toFloat()
      h = if (bounds.outHeight > 0) bounds.outHeight.toFloat() * scale else dp(90).toFloat()
    }
    if (w > maxWidth) { h *= maxWidth / w; w = maxWidth.toFloat() }
    val tallest = maxHeight.toFloat()
    if (h > tallest) { w *= tallest / h; h = tallest }
    val width = w.roundToInt().coerceAtLeast(1)
    val height = h.roundToInt().coerceAtLeast(1)
    val drawable = PictureDrawable()
    drawable.setBounds(0, 0, width, height)
    drawable.bitmap = bitmaps.get("$source@$width")
    if (drawable.bitmap == null && source.startsWith("/")) {
      pendingPictures.add(Triple(drawable, source, width to height))
      val token = generation
      if (!worker.isShutdown) worker.execute {
        val bitmap = try { bitmapFor(source, width, height) } catch (_: Exception) { null }
        main.post {
          if (token != generation || bitmap == null) return@post
          drawable.bitmap = bitmap
          pendingPictures.removeAll { it.first === drawable }
          edit.invalidate(); sheet.invalidate()
          thumbs.clear(); if (strip.visibility == VISIBLE) renderVisibleThumbs()
        }
      }
    }
    text.setSpan(ImageSpan(drawable, ImageSpan.ALIGN_BASELINE), at, at + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  }

  /** A picture of fixed size that shows a placeholder until its bitmap is decoded off the main thread. */
  private class PictureDrawable : android.graphics.drawable.Drawable() {
    var bitmap: Bitmap? = null
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    override fun draw(canvas: Canvas) {
      val picture = bitmap
      if (picture != null && !picture.isRecycled) canvas.drawBitmap(picture, null, bounds, paint)
      else { paint.color = 0xFFE8EAED.toInt(); canvas.drawRect(bounds, paint) }
    }
    override fun setAlpha(alpha: Int) { paint.alpha = alpha }
    override fun setColorFilter(filter: android.graphics.ColorFilter?) { paint.colorFilter = filter }
    @Deprecated("Deprecated in Java")
    override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
  }

  /** Pictures still decoding; export waits for them so the PDF has every image. */
  private val pendingPictures = mutableListOf<Triple<PictureDrawable, String, Pair<Int, Int>>>()

  /** Decodes a picture no larger than it's shown, reusing recent decodes. Safe on any thread. */
  private fun bitmapFor(path: String, width: Int, height: Int): Bitmap? {
    if (!path.startsWith("/")) return null
    val key = "$path@$width"
    bitmaps.get(key)?.let { return it }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= width && bounds.outHeight / (sample * 2) >= height) sample *= 2
    val bitmap = try { BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample }) } catch (_: OutOfMemoryError) { null } ?: return null
    bitmaps.put(key, bitmap)
    return bitmap
  }

  /** Column edges of a table in pixels, fitted to the text width when the grid is wider. */
  private fun tableEdges(cols: JSONArray?, count: Int): IntArray {
    val widths = IntArray(max(1, count)) { i -> cols?.optInt(i, 0) ?: 0 }
    if (widths.any { it <= 0 }) widths.fill(max(1, (pageWidth - marginLeft - marginRight) / widths.size))
    var total = widths.sum().toFloat()
    val room = (pageWidth - marginLeft - marginRight).toFloat()
    val fit = if (total > room * 1.05f) room / total else 1f
    val edges = IntArray(widths.size + 1)
    total = 0f
    for (i in widths.indices) { total += widths[i] * fit; edges[i + 1] = px(total.roundToInt()) }
    return edges
  }

  /** An editable table: one line per row with tab stops at the column edges and a drawn grid. */
  private fun appendTable(text: DocText, block: JSONObject) {
    val rows = block.optJSONArray("rows") ?: JSONArray()
    var columns = 1
    for (r in 0 until rows.length()) columns = max(columns, rows.optJSONArray(r)?.length() ?: 0)
    val edges = tableEdges(block.optJSONArray("cols"), columns)
    val pad = px(108)
    val tiny = max(1, dp(2))
    var at = text.length
    text.append('\u2063')
    text.setSpan(TinyLineSpan(tiny), at, at + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE or FIRST)
    val borders = block.optBoolean("borders", true)
    val gap = DocFonts.gap(defaultFont)
    for (r in 0 until rows.length()) {
      text.append('\n')
      val cells = rows.optJSONArray(r) ?: JSONArray()
      val start = text.length
      val fills = IntArray(columns)
      for (c in 0 until cells.length()) {
        val cell = cells.optJSONObject(c) ?: JSONObject()
        if (c > 0) text.append('\t')
        val a = text.length
        text.append(cell.optString("text"))
        if (text.length > a) applyRun(text, cell, a, text.length, cell, edges[min(c + 1, columns)] - edges[min(c, columns)])
        if (c < columns) fills[c] = hexColor(cell.optString("fill"))
      }
      val end = text.length
      val flags = (if (start == end) Spanned.SPAN_INCLUSIVE_INCLUSIVE else Spanned.SPAN_EXCLUSIVE_INCLUSIVE) or FIRST
      text.setSpan(TableGridSpan(edges, fills, borders, geometry, pad), start, end, flags)
      for (c in 1 until columns) text.setSpan(DocTabSpan(edges[c]), start, end, flags)
      text.setSpan(SpacingSpan(px(20), px(20), 240, "auto", 0, gap), start, end, flags)
    }
    text.append('\n')
    at = text.length
    text.append('\u2063')
    text.setSpan(TinyLineSpan(tiny), at, at + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE or FIRST)
  }

  /** A read-only table drawn row by row with its real cell text, shading, merges and borders. */
  private fun appendLockedTable(text: DocText, table: JSONObject) {
    val rows = table.optJSONArray("rows") ?: JSONArray()
    val cols = table.optJSONArray("cols")
    var columns = cols?.length() ?: 0
    for (r in 0 until rows.length()) {
      val cells = rows.optJSONObject(r)?.optJSONArray("cells") ?: continue
      var sum = 0
      for (c in 0 until cells.length()) sum += cells.optJSONObject(c)?.optInt("span", 1)?.coerceAtLeast(1) ?: 1
      columns = max(columns, sum)
    }
    val edges = tableEdges(cols, columns)
    val padX = px(108)
    val padY = max(1, px(10))
    val borders = table.optBoolean("borders", true)
    val built = ArrayList<Pair<List<TableCell>, Int>>()
    for (r in 0 until rows.length()) {
      val row = rows.optJSONObject(r) ?: JSONObject()
      val cells = row.optJSONArray("cells") ?: JSONArray()
      val list = ArrayList<TableCell>()
      var column = 0
      var height = 0
      for (c in 0 until cells.length()) {
        val cell = cells.optJSONObject(c) ?: continue
        val span = cell.optInt("span", 1).coerceAtLeast(1)
        val x = edges[min(column, columns)]
        val right = edges[min(column + span, columns)]
        column += span
        val continued = cell.optInt("vm", 0) == 2
        val layout = if (continued) null else cellLayout(cell.optJSONArray("paras") ?: JSONArray(), max(1, right - x - 2 * padX))
        if (layout != null) height = max(height, layout.height + 2 * padY)
        list.add(TableCell(x, max(1, right - x), layout, hexColor(cell.optString("fill")), cell.optString("va"), continued))
      }
      val given = px(row.optInt("h", 0))
      height = if (row.optBoolean("exact") && given > 0) given else max(max(height, given), max(1, padY * 2))
      built.add(list to height)
    }
    for (r in 0 until built.size - 1) for (cell in built[r].first) cell.openBelow = built[r + 1].first.any { it.continued && it.x == cell.x }
    val width = edges.last()
    for (r in built.indices) {
      if (r > 0) text.append('\n')
      val at = text.length
      text.append('\uFFFC')
      text.setSpan(TableRowSpan(built[r].first, width, built[r].second, padX, padY, borders, r == built.size - 1), at, at + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE or FIRST)
    }
  }

  private fun cellLayout(paras: JSONArray, width: Int): StaticLayout {
    val text = DocText()
    for (p in 0 until paras.length()) {
      if (p > 0) text.append('\n')
      paras.optJSONObject(p)?.let { appendParagraph(text, it, width) }
    }
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      typeface = DocFonts.typeface(defaultFont, Typeface.NORMAL)
      textSize = halfToPx(defaultHalf)
      color = INK
    }
    val spanned = SpannableStringBuilder(text)
    return StaticLayout.Builder.obtain(spanned, 0, spanned.length, paint, width).setIncludePad(false).setLineSpacing(0f, 1f).build()
  }

  /** Numbers list paragraphs again after items are added, removed or changed; returns changed blocks. */
  private fun renumber(): Set<Int> {
    val changed = HashSet<Int>()
    val counters = HashMap<String, Int>()
    var auto = 0
    val digits = Regex("(\\d+)(?!.*\\d)")
    for (i in 0 until blocks.length()) {
      val block = blocks.optJSONObject(i) ?: continue
      val kind = block.optString("kind")
      if (kind != "paragraph" && kind != "locked") { auto = 0; continue }
      val list = block.optString("list", "none")
      val num = block.optString("num")
      val marker = block.optString("marker")
      if (num.isNotEmpty() && list != "none") {
        val level = block.optInt("ilvl", 0)
        counters.keys.filter { it.startsWith("$num/") && (it.substringAfter('/').toIntOrNull() ?: 0) > level }.forEach { counters.remove(it) }
        val key = "$num/$level"
        val match = digits.find(marker) ?: continue
        val value = counters[key]?.plus(1) ?: match.value.toInt()
        counters[key] = value
        if (kind == "paragraph" && match.value.toIntOrNull() != value) {
          block.put("marker", marker.replaceRange(match.range, value.toString()))
          changed.add(i)
        }
        auto = 0
      } else if (list == "decimal" && kind == "paragraph") {
        auto++
        if (marker != "$auto.") { block.put("marker", "$auto."); changed.add(i) }
      } else {
        if (list == "bullet" && kind == "paragraph" && marker.isEmpty()) { block.put("marker", "\u2022"); changed.add(i) }
        auto = 0
      }
    }
    return changed
  }

  // ---------- Editing ----------
  private fun owned(span: Any) = span is ParagraphMarginSpan || span is SpacingSpan || span is DocAlignSpan || span is DocTabSpan || span is DocTabFill || span is PageBreakMark

  /** Rebuilds the paragraph spans of lines [from, to] from their blocks. */
  private fun refreshLines(from: Int, to: Int) {
    val text = edit.text ?: return
    val ranges = lineRanges()
    for (index in max(0, from)..min(to, lines.size - 1)) {
      val line = lines[index]
      if (line.role != "para" || index >= ranges.size) continue
      val block = blocks.optJSONObject(line.block) ?: continue
      val range = ranges[index]
      val a = range.first
      val b = if (range.last >= range.first && range.last < text.length && text[range.last] != '\n') range.last + 1 else a
      for (span in text.getSpans(a, b, Any::class.java)) if (owned(span)) text.removeSpan(span)
      applyParagraphSpans(text, block, a, b, contentW)
      if (needsBreak(line.block)) markBreak(text, a)
    }
  }

  private fun refreshBlocks(indexes: Set<Int>) {
    if (indexes.isEmpty()) return
    for (i in lines.indices) if (lines[i].block in indexes) refreshLines(i, i)
  }

  /**
   * Applies an edit given the old and new text of the lines it touched. `base` is the index of the
   * first of those lines; the full document is the case `base == 0` with every line.
   */
  private fun accept(base: Int, old: List<String>, neuWindow: List<String>) {
    if (base < 0 || base + old.size > lines.size) { revert(); return }
    var s = 0
    while (s < old.size && s < neuWindow.size && old[s] == neuWindow[s]) s++
    var eo = old.lastIndex
    var en = neuWindow.lastIndex
    while (eo >= s && en >= s && old[eo] == neuWindow[en]) { eo--; en-- }
    if (s > eo && s > en) return
    val start = base + s
    val endOld = base + eo
    val endNew = base + en
    val expected = lines.size - old.size + neuWindow.size
    val neu = object : AbstractList<String>() {
      override val size get() = expected
      override fun get(index: Int) = neuWindow[index - base]
    }
    val removed = if (start > endOld) emptyList() else lines.subList(start, endOld + 1)
    if (removed.any { it.role == "locked" || it.role == "tableStart" || it.role == "tableEnd" }) { revert(); return }
    if (removed.any { it.role == "image" } && start <= endNew) { revert(); return }
    if (removed.isNotEmpty() && removed.all { it.role == "image" } && start > endNew) {
      removeBlocks(removed.map { it.block }.distinct())
      edited = true; scheduleDraft(); emit(); return
    }
    if (removed.any { it.role == "tableRow" } && removed.all { it.role == "tableRow" } && removed.map { it.block }.distinct().size == 1 && (endNew - start) == (endOld - start)) {
      val block = blocks.getJSONObject(removed.first().block)
      val rows = block.getJSONArray("rows")
      for (offset in removed.indices) {
        val cells = rows.getJSONArray(removed[offset].row)
        val parts = neu[start + offset].split('\t')
        for (c in 0 until cells.length()) cells.getJSONObject(c).put("text", parts.getOrElse(c) { "" })
      }
      block.put("dirty", true)
      edited = true; scheduleDraft(); emit(); return
    }
    if (removed.any { it.role != "para" }) { revert(); return }
    val added = if (start > endNew) 0 else endNew - start + 1
    if (removed.isEmpty() && start > 0 && start < lines.size && lines[start - 1].block == lines[start].block) { revert(); return }
    if (removed.size == added) {
      removed.forEach { blocks.getJSONObject(it.block).put("dirty", true).remove("raw") }
      if ((start..endNew).any { neu[it].contains('\t') }) refreshLines(start, endOld)
    } else {
      val at = removed.firstOrNull()?.block ?: lines.getOrNull(start)?.block ?: blocks.length()
      val kept = removed.firstOrNull()?.let { blocks.getJSONObject(it.block) }
      val template = kept
        ?: lines.getOrNull(start - 1)?.takeIf { it.role == "para" }?.let { blocks.getJSONObject(it.block) }
        ?: lines.getOrNull(start)?.takeIf { it.role == "para" }?.let { blocks.getJSONObject(it.block) }
      val next = JSONArray()
      val skip = removed.map { it.block }.toSet()
      for (i in 0 until at) if (i !in skip) next.put(blocks.getJSONObject(i))
      val first = if (kept != null && added > 0) { kept.put("dirty", true).remove("raw"); next.put(kept); 1 } else 0
      for (extra in first until added) next.put(continuation(template, neu[start + extra]))
      for (i in (removed.lastOrNull()?.block ?: at - 1) + 1 until blocks.length()) if (i !in skip) next.put(blocks.getJSONObject(i))
      blocks = next
      sections.getJSONObject(sectionIndex).put("blocks", blocks)
      lines = structure().takeIf { it.size == expected } ?: lines
      val changed = renumber()
      refreshLines(start - 1, start + added)
      refreshBlocks(changed)
    }
    edited = true
    scheduleDraft(); emit()
  }

  private fun continuation(template: JSONObject?, text: String): JSONObject {
    val fresh = paragraph(text)
    if (template == null) return fresh
    for (key in listOf("align", "list", "style", "num", "numKind", "marker", "mf", "mc", "rule")) template.optString(key).takeIf { it.isNotEmpty() }?.let { fresh.put(key, it) }
    for (key in listOf("indent", "right", "first", "before", "after", "line", "ilvl", "ms")) if (template.has(key)) fresh.put(key, template.optInt(key))
    for (key in listOf("mb", "cb", "ca")) if (template.optBoolean(key)) fresh.put(key, true)
    template.optJSONArray("tabs")?.let { fresh.put("tabs", JSONArray(it.toString())) }
    template.optString("px").replace(Regex("<[A-Za-z]*:?pageBreakBefore[^>]*/>"), "").takeIf { it.isNotEmpty() }?.let { fresh.put("px", it) }
    return fresh
  }

  private fun commit() {
    val text = edit.text ?: return
    if (sections.length() == 0) return
    var cursor = 0
    for (line in lines) {
      if (cursor > text.length) break
      val end = TextUtils.indexOf(text, '\n', cursor).let { if (it < 0) text.length else it }
      if (line.role == "para") {
        val block = blocks.optJSONObject(line.block)
        if (block != null && block.optBoolean("dirty")) block.put("runs", runsOf(cursor, if (end > cursor) end else cursor + 1))
      }
      cursor = end + 1
    }
    sections.getJSONObject(sectionIndex).put("blocks", blocks)
  }

  private fun runsOf(start: Int, end: Int): JSONArray {
    val text = edit.text
    val stop = min(end, text.length).let { if (it > start && text[it - 1] == '\n') it - 1 else it }
    val points = sortedSetOf(start, stop)
    for (span in text.getSpans(start, stop, CharacterStyle::class.java)) {
      points.add(text.getSpanStart(span).coerceIn(start, stop))
      points.add(text.getSpanEnd(span).coerceIn(start, stop))
    }
    val cuts = points.toList()
    val runs = JSONArray()
    for (i in 0 until cuts.size - 1) {
      val a = cuts[i]; val b = cuts[i + 1]
      if (a >= b) continue
      val slice = text.subSequence(a, b).toString().replace('\u2028', '\n')
      if (slice.isEmpty()) continue
      runs.put(runAt(a, b).put("text", slice))
    }
    if (runs.length() == 0) runs.put(runAt(start, start).put("text", ""))
    return runs
  }

  private fun runAt(a: Int, b: Int): JSONObject {
    val text = edit.text
    val run = JSONObject()
    fun <T> spans(type: Class<T>) = text.getSpans(a, b, type).filter { if (a == b) text.getSpanStart(it) <= a && text.getSpanEnd(it) >= a else true }
    if (spans(StyleSpan::class.java).any { it.style == Typeface.BOLD }) run.put("bold", true)
    if (spans(StyleSpan::class.java).any { it.style == Typeface.ITALIC }) run.put("italic", true)
    if (spans(UnderlineSpan::class.java).isNotEmpty()) run.put("underline", true)
    if (spans(StrikethroughSpan::class.java).isNotEmpty()) run.put("strike", true)
    spans(ForegroundColorSpan::class.java).lastOrNull()?.let { run.put("color", "%06X".format(it.foregroundColor and 0xFFFFFF)) }
    spans(BackgroundColorSpan::class.java).lastOrNull()?.let { run.put("highlight", "%06X".format(it.backgroundColor and 0xFFFFFF)) }
    run.put("size", spans(DocSizeSpan::class.java).lastOrNull()?.half ?: defaultHalf)
    run.put("font", spans(DocFontSpan::class.java).lastOrNull()?.font ?: defaultFont)
    return run
  }

  private fun toggleStyle(start: Int, end: Int, create: () -> CharacterStyle) {
    val sample = create()
    val type = sample.javaClass
    val matches = { span: Any -> span.javaClass == type && (span !is StyleSpan || span.style == (sample as StyleSpan).style) }
    if (start == end) {
      if (!splitAt(type, start, matches)) edit.text.setSpan(sample, start, start, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
      return
    }
    val existing = edit.text.getSpans(start, end, type).filter { matches(it) }
    val covered = existing.any { edit.text.getSpanStart(it) <= start && edit.text.getSpanEnd(it) >= end }
    if (covered) existing.forEach { trimSpan(it, start, end) } else edit.text.setSpan(sample, start, end, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
  }
  private fun paint(start: Int, end: Int, value: String, foreground: Boolean) {
    val type = if (foreground) ForegroundColorSpan::class.java else BackgroundColorSpan::class.java
    if (start == end) splitAt(type, start) { true } else trim(type, start, end)
    if (value.isBlank()) return
    val color = try { android.graphics.Color.parseColor(if (value.startsWith("#")) value else "#$value") } catch (_: IllegalArgumentException) { return }
    edit.text.setSpan(if (foreground) ForegroundColorSpan(color) else BackgroundColorSpan(color), start, end, if (start == end) Spanned.SPAN_INCLUSIVE_INCLUSIVE else Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
  }
  private fun size(start: Int, end: Int, points: Int) {
    if (start == end) splitAt(DocSizeSpan::class.java, start) { true } else trim(DocSizeSpan::class.java, start, end)
    val half = points.coerceIn(1, 400) * 2
    edit.text.setSpan(DocSizeSpan(half, halfToPx(half)), start, end, if (start == end) Spanned.SPAN_INCLUSIVE_INCLUSIVE else Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
  }

  /** A span applies to text typed at [at] when it ends there or around it, or waits there empty. */
  private fun appliesAt(span: Any, at: Int): Boolean {
    val text = edit.text
    val a = text.getSpanStart(span); val b = text.getSpanEnd(span)
    val flags = text.getSpanFlags(span)
    return when {
      a < at && at < b -> true
      a == at && b == at -> true
      a == at -> flags and 0x30 == 0x10
      b == at -> flags and 0x03 == 0x02
      else -> false
    }
  }

  /** Stops matching spans from growing into text typed at [at]; returns whether any applied there. */
  private fun splitAt(type: Class<*>, at: Int, matches: (Any) -> Boolean): Boolean {
    val text = edit.text
    var found = false
    for (span in text.getSpans(at, at, type)) {
      if (span == null || !matches(span) || !appliesAt(span, at)) continue
      found = true
      val a = text.getSpanStart(span); val b = text.getSpanEnd(span)
      val head = if (text.getSpanFlags(span) and 0x30 == 0x10) Spanned.SPAN_INCLUSIVE_EXCLUSIVE else Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
      text.removeSpan(span)
      if (a < at) cloneSpan(span)?.let { text.setSpan(it, a, at, head) }
      if (b > at) cloneSpan(span)?.let { text.setSpan(it, at, b, Spanned.SPAN_EXCLUSIVE_INCLUSIVE) }
    }
    return found
  }
  private fun markDirty(start: Int, end: Int) {
    for ((index, _, _) in paragraphsIn(start, end)) blocks.optJSONObject(lines[index].block)?.put("dirty", true)?.remove("raw")
    edited = true
  }
  private fun paragraphText(block: JSONObject): String {
    val runs = block.optJSONArray("runs") ?: return ""
    return (0 until runs.length()).joinToString("") { runs.getJSONObject(it).optString("text") }.replace('\n', '\u2028')
  }
  private fun paragraph(text: String) = JSONObject().put("kind", "paragraph").put("align", "left").put("list", "none").put("dirty", true)
    .put("runs", JSONArray().put(JSONObject().put("text", text)))
  private fun linesOf(text: String): List<String> {
    val body = if (text.endsWith("\n")) text.dropLast(1) else text
    return body.split('\n')
  }
  private fun linesFor(index: Int, block: JSONObject): List<Line> = when (block.optString("kind")) {
    "locked" -> {
      val rows = block.optJSONObject("table")?.optJSONArray("rows")?.length() ?: 0
      if (rows > 0) (0 until rows).map { Line(index, "locked", it) } else listOf(Line(index, "locked"))
    }
    "image" -> listOf(Line(index, "image"))
    "table" -> {
      val rows = block.optJSONArray("rows")?.length() ?: 0
      listOf(Line(index, "tableStart")) + (0 until rows).map { Line(index, "tableRow", it) } + listOf(Line(index, "tableEnd"))
    }
    else -> listOf(Line(index, "para"))
  }
  private fun structure(): List<Line> {
    val next = mutableListOf<Line>()
    for (i in 0 until blocks.length()) next.addAll(linesFor(i, blocks.getJSONObject(i)))
    return next
  }
  private fun linesFrom(text: String): List<Line> {
    val next = structure()
    return if (next.size == linesOf(text).size) next else lines
  }
  private fun lineRanges(): List<IntRange> {
    val text = edit.text ?: return emptyList()
    val ranges = mutableListOf<IntRange>()
    var cursor = 0
    for (ignored in lines) {
      val end = TextUtils.indexOf(text, '\n', cursor).let { if (it < 0) text.length else it }
      ranges.add(if (end > cursor) cursor until end else cursor..cursor)
      cursor = end + 1
    }
    return ranges
  }
  private fun lineIndex(offset: Int) = lineRanges().indexOfFirst { offset <= it.last + 1 }.let { if (it < 0) lines.lastIndex else it }
  private fun removeBlocks(indexes: List<Int>) {
    val skip = indexes.toSet()
    val next = JSONArray()
    for (i in 0 until blocks.length()) if (i !in skip) next.put(blocks.getJSONObject(i))
    if (next.length() == 0) next.put(paragraph(""))
    blocks = next
    sections.getJSONObject(sectionIndex).put("blocks", blocks)
    lines = linesFrom(edit.text.toString())
  }
  /** Puts back the text a rejected edit replaced, with its formatting. */
  private fun revert() {
    val text = edit.text ?: return
    updating = true
    val end = (changeStart + changeAfter).coerceAtMost(text.length)
    if (changeStart <= end) text.replace(changeStart, end, changeOld)
    updating = false
    val index = lineIndex(changeStart)
    refreshLines(index - 1, index + 1)
  }
  /** Line index and start offset of the line holding `offset`, found without building a line table. */
  private fun lineAt(text: CharSequence, offset: Int): Pair<Int, Int> {
    var line = 0
    var lineStart = 0
    var next = TextUtils.indexOf(text, '\n', 0)
    while (next in 0 until offset) { line++; lineStart = next + 1; next = TextUtils.indexOf(text, '\n', lineStart) }
    return Pair(line, lineStart)
  }
  private fun filter() = InputFilter { source, _, _, dest, dstart, dend ->
    if (updating || lines.isEmpty()) return@InputFilter null
    // A line touches the edit when it spans [dstart, dend] or ends right at dstart.
    var (index, first) = lineAt(dest, max(0, dstart - 1))
    while (index < lines.size && first <= dend) {
      val end = TextUtils.indexOf(dest, '\n', first).let { if (it < 0) dest.length else it }
      val last = if (end > first) end - 1 else first
      if (dstart <= last + 1 && dend >= first) when (lines[index].role) {
        "locked", "tableStart", "tableEnd" -> return@InputFilter ""
        "image" -> if (!(source.isNullOrEmpty() && dstart <= first && dend > last)) return@InputFilter ""
      }
      index++; first = end + 1
    }
    null
  }
  private fun pushUndo() {
    commit()
    undo.addLast(Snap(blocks.toString(), hf.toString()))
    if (undo.size > 30) undo.removeFirst()
    redo.clear()
  }
  private fun restore(snap: Snap?, other: ArrayDeque<Snap>) {
    if (snap == null) return
    commit()
    other.addLast(Snap(blocks.toString(), hf.toString()))
    blocks = JSONArray(snap.blocks)
    hf = JSONObject(snap.hf)
    sections.getJSONObject(sectionIndex).put("blocks", blocks)
    edited = true
    render()
    scheduleDraft(); emit()
    lastFormat = null; reportFormat()
  }
  private fun modelRoot() = JSONObject().put("sect", sect).put("hf", hf).put("page", pageSetup).put("defaults", defaults).put("sections", sections)
  private fun modelPayload(): String = modelRoot().toString()
  private fun plain(): String {
    val out = StringBuilder()
    for (s in 0 until sections.length()) {
      val list = sections.getJSONObject(s).getJSONArray("blocks")
      for (i in 0 until list.length()) {
        val block = list.getJSONObject(i)
        when (block.optString("kind")) {
          "paragraph" -> out.append(paragraphText(block).replace('\u2028', '\n')).append('\n')
          "table" -> {
            val rows = block.optJSONArray("rows") ?: JSONArray()
            for (r in 0 until rows.length()) out.append((0 until rows.getJSONArray(r).length()).joinToString("\t") { rows.getJSONArray(r).getJSONObject(it).optString("text") }).append('\n')
          }
          "locked" -> {
            val table = block.optJSONObject("table")
            when {
              table != null -> {
                val rows = table.optJSONArray("rows") ?: JSONArray()
                for (r in 0 until rows.length()) {
                  val cells = rows.optJSONObject(r)?.optJSONArray("cells") ?: continue
                  out.append((0 until cells.length()).joinToString("\t") { c ->
                    val paras = cells.optJSONObject(c)?.optJSONArray("paras") ?: JSONArray()
                    (0 until paras.length()).joinToString(" ") { paragraphText(paras.getJSONObject(it)).replace('\u2028', ' ') }
                  }).append('\n')
                }
              }
              block.has("runs") -> out.append(paragraphText(block).replace('\u2028', '\n').replace("\uFFFC", "")).append('\n')
              else -> out.append('[').append(block.optString("label", "Locked content")).append("]\n")
            }
          }
          else -> out.append('\n')
        }
      }
    }
    return out.toString()
  }
  private fun textModel(text: String): JSONObject {
    if (text.length > 2_000_000) throw IllegalStateException("This text file is too long to edit here.")
    val sections = JSONArray()
    var blocks = JSONArray()
    var count = 0
    val lines = if (text.isEmpty()) listOf("") else text.replace("\r\n", "\n").removeSuffix("\n").split('\n')
    for (line in lines) {
      if (count > 40_000 && blocks.length() > 0) { sections.put(JSONObject().put("blocks", blocks)); blocks = JSONArray(); count = 0 }
      blocks.put(paragraph(line).put("dirty", false))
      count += line.length + 1
    }
    sections.put(JSONObject().put("blocks", blocks))
    return JSONObject().put("sect", "").put("sections", sections)
  }
  private fun draft(): File {
    val folder = File(context.cacheDir, "versara-doc-drafts").apply { mkdirs() }
    val key = (if (blank) "blank" else sourcePath).hashCode().toUInt().toString(16)
    return File(folder, "$key.json")
  }
  private fun scheduleDraft() {
    edit.removeCallbacks(draftRunnable)
    // Writing a recovery draft serialises the whole model on the main thread; long documents
    // skip it while editing and rely on Save.
    if (edit.length() <= LIVE_WORK_LIMIT) edit.postDelayed(draftRunnable, 1500)
    schedulePages()
  }
  private val draftRunnable = Runnable {
    if (!edited) return@Runnable
    try { commit(); draft().writeText(modelPayload()) } catch (_: Exception) {}
  }
  private fun emit() {
    onDocChange(mapOf("dirty" to edited, "characters" to edit.length(), "canUndo" to undo.isNotEmpty(), "canRedo" to redo.isNotEmpty(), "section" to sectionIndex, "sections" to sections.length()))
  }
  private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()
  private fun filePath(uri: String): String {
    val raw = if (uri.startsWith("file://")) uri.substring(7) else uri
    return URLDecoder.decode(raw, "UTF-8")
  }
}

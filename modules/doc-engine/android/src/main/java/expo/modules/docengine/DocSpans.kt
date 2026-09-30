package expo.modules.docengine

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import android.text.Layout
import android.text.Spanned
import android.text.TextPaint
import android.text.style.LeadingMarginSpan
import android.text.style.LineBackgroundSpan
import android.text.style.LineHeightSpan
import android.text.style.MetricAffectingSpan
import android.text.style.ReplacementSpan
import android.text.style.TabStopSpan
import android.text.style.UpdateLayout
import kotlin.math.max
import kotlin.math.roundToInt

/** Paragraph spans run before the page flow span, which must see each line's final height. */
internal const val FIRST = (1 shl Spanned.SPAN_PRIORITY_SHIFT)

/** Metric-compatible open fonts (SIL OFL) standing in for the common Office fonts. */
internal object DocFonts {
  private var app: Context? = null
  private val families = HashMap<String, Typeface>()
  private val faces = HashMap<String, Typeface>()
  private val gaps = HashMap<String, Float>()

  fun init(context: Context) { if (app == null) app = context.applicationContext }

  fun family(name: String): String {
    val key = name.trim().lowercase()
    return when (key) {
      "calibri", "calibri light", "carlito", "candara", "corbel" -> "Carlito"
      "cambria", "cambria math", "caladea" -> "Caladea"
      "arial", "helvetica", "liberation sans", "arimo", "aptos", "aptos display", "aptos narrow", "segoe ui", "verdana", "tahoma", "arial nova", "century gothic" -> "LiberationSans"
      "times new roman", "times", "liberation serif", "tinos", "georgia", "garamond", "book antiqua", "palatino linotype", "century schoolbook", "baskerville old face" -> "LiberationSerif"
      "courier new", "courier", "consolas", "liberation mono", "lucida console", "cousine" -> "mono"
      else -> if (key.contains("serif") && !key.contains("sans")) "LiberationSerif" else "sans"
    }
  }

  /** A face for the document font name with the requested Typeface style. */
  fun typeface(name: String, style: Int): Typeface {
    val family = family(name)
    val key = "$family/$style"
    faces[key]?.let { return it }
    val face = when (family) {
      "mono" -> Typeface.create(Typeface.MONOSPACE, style)
      "sans" -> Typeface.create(Typeface.SANS_SERIF, style)
      else -> if (Build.VERSION.SDK_INT >= 29) familyFace(family)?.let { Typeface.create(it, style) } else fileFace(family, style)
    } ?: Typeface.create(Typeface.SANS_SERIF, style)
    faces[key] = face
    return face
  }

  /** Word's single spacing adds the font's line gap to its ascent and descent. */
  fun gap(name: String): Float {
    val family = family(name)
    return gaps.getOrPut(family) {
      val paint = Paint().apply { typeface = typeface(name, Typeface.NORMAL); textSize = 100f }
      val metrics = paint.fontMetrics
      val body = metrics.descent - metrics.ascent
      if (body > 0f) (metrics.leading / body).coerceIn(0f, 0.5f) else 0f
    }
  }

  private fun suffix(style: Int) = when (style) { Typeface.BOLD -> "Bold"; Typeface.ITALIC -> "Italic"; Typeface.BOLD_ITALIC -> "BoldItalic"; else -> "Regular" }

  private fun fileFace(family: String, style: Int): Typeface? {
    val assets = app?.assets ?: return null
    return try { Typeface.createFromAsset(assets, "docfonts/$family-${suffix(style)}.ttf") } catch (_: Exception) { null }
  }

  @android.annotation.TargetApi(29)
  private fun familyFace(family: String): Typeface? {
    families[family]?.let { return it }
    val assets = app?.assets ?: return null
    return try {
      val builder = android.graphics.fonts.FontFamily.Builder(android.graphics.fonts.Font.Builder(assets, "docfonts/$family-Regular.ttf").build())
      for (style in listOf(Typeface.BOLD, Typeface.ITALIC, Typeface.BOLD_ITALIC)) builder.addFont(android.graphics.fonts.Font.Builder(assets, "docfonts/$family-${suffix(style)}.ttf").build())
      Typeface.CustomFallbackBuilder(builder.build()).setSystemFallback("sans-serif").build().also { families[family] = it }
    } catch (_: Exception) { null }
  }
}

internal class DocFontSpan(val font: String) : MetricAffectingSpan() {
  override fun updateMeasureState(paint: TextPaint) = apply(paint)
  override fun updateDrawState(paint: TextPaint) = apply(paint)
  private fun apply(paint: TextPaint) {
    val style = paint.typeface?.style ?: Typeface.NORMAL
    val face = DocFonts.typeface(font, style)
    paint.typeface = face
    val fake = style and face.style.inv()
    paint.isFakeBoldText = fake and Typeface.BOLD != 0
    paint.textSkewX = if (fake and Typeface.ITALIC != 0) -0.25f else 0f
  }
}

/** Font size kept in half-points, the document's unit, with its on-screen pixel size. */
internal class DocSizeSpan(val half: Int, val px: Float) : MetricAffectingSpan() {
  override fun updateMeasureState(paint: TextPaint) { paint.textSize = px }
  override fun updateDrawState(paint: TextPaint) { paint.textSize = px }
}

/** Line spacing and space before and after a paragraph, all in pixels. */
internal class SpacingSpan(val before: Int, val after: Int, private val line: Int, private val rule: String, private val linePx: Int, private val gap: Float) : LineHeightSpan, UpdateLayout {
  override fun chooseHeight(text: CharSequence, start: Int, end: Int, spanstartv: Int, lineHeight: Int, fm: Paint.FontMetricsInt) {
    val spanned = text as? Spanned ?: return
    val natural = max(1, fm.descent - fm.ascent)
    val single = (natural * (1f + gap)).roundToInt()
    when (rule) {
      "exact" -> {
        val hasImage = spanned.getSpans(start, end, android.text.style.ImageSpan::class.java).isNotEmpty()
        val target = if (hasImage) max(natural, linePx) else max(1, linePx)
        fm.ascent = (fm.ascent * target / natural.toFloat()).roundToInt()
        fm.descent = target + fm.ascent
      }
      "atLeast" -> fm.descent += max(single, linePx) - natural
      else -> fm.descent += (single * line / 240f).roundToInt() - natural
    }
    if (start <= spanned.getSpanStart(this) && before > 0) fm.ascent -= before
    if (end >= spanned.getSpanEnd(this) && after > 0) fm.descent += after
    fm.top = fm.ascent
    fm.bottom = fm.descent
  }
}

/** Marks a paragraph that must start on a new page. */
internal class PageBreakMark : UpdateLayout

internal class DocAlignSpan(private val value: Layout.Alignment) : android.text.style.AlignmentSpan, UpdateLayout {
  override fun getAlignment() = value
}

internal class DocTabSpan(private val offset: Int) : TabStopSpan, UpdateLayout {
  override fun getTabStop() = offset
}

/** A tab laid out to a measured width, drawing its leader (dots, hyphens or a line) across the gap. */
internal class DocTabFill(private val width: Int, private val leader: String) : ReplacementSpan(), UpdateLayout {
  override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?) = width
  override fun draw(canvas: Canvas, text: CharSequence, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
    if (leader.isEmpty() || width <= 0) return
    val gap = paint.textSize * 0.25f
    val left = x + gap
    val right = x + width - gap
    if (right <= left) return
    if (leader == "line") {
      val stroke = paint.strokeWidth
      paint.strokeWidth = max(1f, paint.textSize / 16f)
      canvas.drawLine(left, y + paint.textSize * 0.1f, right, y + paint.textSize * 0.1f, paint)
      paint.strokeWidth = stroke
      return
    }
    val glyph = if (leader == "hyphen") "-" else "."
    val pitch = max(1f, paint.measureText(glyph) + paint.textSize * 0.18f)
    // Snap to a shared grid so leaders on consecutive lines line up.
    var at = kotlin.math.ceil(left / pitch) * pitch
    while (at + pitch <= right) { canvas.drawText(glyph, at, y.toFloat(), paint); at += pitch }
  }
}

/** Shared page geometry in layout pixels: page i holds lines in [i * pitch, i * pitch + content). */
internal class PageGeometry(var pitch: Int = 1, var content: Int = 1) {
  fun regionTop(y: Int) = (max(0, y) / max(1, pitch)) * pitch
}

/**
 * Moves each line that would cross the bottom margin to the top of the next page. The editor's
 * layout reflows only the edited paragraph, starting its measure at zero, so [origin] gives the
 * real top of that paragraph from the current layout.
 */
internal class PageFlowSpan(private val geometry: PageGeometry, private val origin: (Int) -> Int) : LineHeightSpan, UpdateLayout {
  private var base = 0
  override fun chooseHeight(text: CharSequence, start: Int, end: Int, spanstartv: Int, lineHeight: Int, fm: Paint.FontMetricsInt) {
    if (lineHeight == 0) base = if (start == 0) 0 else origin(start)
    val pitch = max(1, geometry.pitch)
    val top = base + lineHeight
    val page = top / pitch
    val regionTop = page * pitch
    val regionBottom = regionTop + geometry.content
    val spanned = text as? Spanned
    var trailing = 0
    var forced = false
    if (spanned != null) {
      for (span in spanned.getSpans(start, end, SpacingSpan::class.java)) if (spanned.getSpanEnd(span) <= end) trailing = max(trailing, span.after)
      if (top > regionTop) forced = spanned.getSpans(start, start, PageBreakMark::class.java).any { spanned.getSpanStart(it) == start }
    }
    val height = fm.descent - fm.ascent
    val push = top >= regionBottom || forced || (top > regionTop && top + height - trailing > regionBottom)
    if (push) {
      val shift = (page + 1) * pitch - top
      fm.ascent -= shift
      fm.top -= shift
    }
  }
}

/** A near-invisible line, used for the table start and end markers. */
internal class TinyLineSpan(private val height: Int) : LineHeightSpan, UpdateLayout {
  override fun chooseHeight(text: CharSequence, start: Int, end: Int, spanstartv: Int, lineHeight: Int, fm: Paint.FontMetricsInt) {
    fm.ascent = -height; fm.top = -height; fm.descent = 0; fm.bottom = 0
  }
}

/** Left indent with a first-line or hanging indent, and the list marker drawn in the hanging space. */
internal class ParagraphMarginSpan(
  private val firstPx: Int,
  private val restPx: Int,
  val marker: String?,
  private val markerX: Int,
  private val markerPaint: TextPaint?,
) : LeadingMarginSpan, UpdateLayout {
  override fun getLeadingMargin(first: Boolean) = if (first) firstPx else restPx
  override fun drawLeadingMargin(canvas: Canvas, paint: Paint, x: Int, dir: Int, top: Int, baseline: Int, bottom: Int, text: CharSequence, start: Int, end: Int, first: Boolean, layout: Layout) {
    if (!first || marker.isNullOrEmpty()) return
    canvas.drawText(marker, (x + markerX).toFloat(), baseline.toFloat(), markerPaint ?: paint)
  }
}

/**
 * Cell padding, borders and shading for an editable table row laid out with tab stops. It draws in
 * the leading margin, which is recorded with the text; a line background would be drawn again for
 * every line of the document on each frame.
 */
internal class TableGridSpan(
  private val edges: IntArray,
  private val fills: IntArray,
  private val borders: Boolean,
  private val geometry: PageGeometry?,
  private val pad: Int,
) : LeadingMarginSpan, UpdateLayout {
  private val line = Paint().apply { style = Paint.Style.STROKE; color = 0xFF000000.toInt() }
  private val fill = Paint()
  override fun getLeadingMargin(first: Boolean) = pad
  override fun drawLeadingMargin(canvas: Canvas, paint: Paint, x: Int, dir: Int, top: Int, baseline: Int, bottom: Int, text: CharSequence, start: Int, end: Int, first: Boolean, layout: Layout) {
    val spanned = text as? Spanned
    val last = spanned == null || end >= spanned.getSpanEnd(this)
    val y0 = (if (geometry != null) max(top, geometry.regionTop(baseline)) else top).toFloat()
    val y1 = bottom.toFloat()
    val saved = fill.color
    for (i in 0 until edges.size - 1) {
      val color = fills.getOrNull(i) ?: 0
      if (color != 0) { fill.color = color; canvas.drawRect((x + edges[i]).toFloat(), y0, (x + edges[i + 1]).toFloat(), y1, fill) }
    }
    fill.color = saved
    if (!borders) return
    line.strokeWidth = max(1f, paint.textSize / 22f)
    val l = (x + edges.first()).toFloat(); val r = (x + edges.last()).toFloat()
    if (first) canvas.drawLine(l, y0, r, y0, line)
    if (last) canvas.drawLine(l, y1, r, y1, line)
    for (edge in edges) canvas.drawLine((x + edge).toFloat(), y0, (x + edge).toFloat(), y1, line)
  }
}

/** One cell of a read-only table row: its laid-out paragraphs and position. */
internal class TableCell(val x: Int, val width: Int, val layout: android.text.StaticLayout?, val fill: Int, val valign: String, val continued: Boolean) {
  /** The cell below continues this one's vertical merge. */
  var openBelow = false
}

/** Draws one full row of a read-only table as a single line so pages can break between rows. */
internal class TableRowSpan(
  private val cells: List<TableCell>,
  private val rowWidth: Int,
  private val rowHeight: Int,
  private val padX: Int,
  private val padY: Int,
  private val borders: Boolean,
  private val lastRow: Boolean,
) : ReplacementSpan(), LineHeightSpan {
  private val line = Paint().apply { style = Paint.Style.STROKE; color = 0xFF000000.toInt() }
  private val fill = Paint()
  override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
    if (fm != null) { fm.ascent = -rowHeight; fm.top = -rowHeight; fm.descent = 0; fm.bottom = 0 }
    return rowWidth
  }
  override fun chooseHeight(text: CharSequence, start: Int, end: Int, spanstartv: Int, lineHeight: Int, fm: Paint.FontMetricsInt) {
    fm.ascent = -rowHeight; fm.top = -rowHeight; fm.descent = 0; fm.bottom = 0
  }
  override fun draw(canvas: Canvas, text: CharSequence, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
    val y0 = (y - rowHeight).toFloat()
    val y1 = y.toFloat()
    line.strokeWidth = max(1f, paint.textSize / 22f)
    for (cell in cells) {
      val l = x + cell.x; val r = l + cell.width
      if (cell.fill != 0 && !cell.continued) { fill.color = cell.fill; canvas.drawRect(l, y0, r, y1, fill) }
      val layout = cell.layout
      if (layout != null && !cell.continued) {
        val room = rowHeight - 2 * padY - layout.height
        val dy = when (cell.valign) { "center" -> max(0, room / 2); "bottom" -> max(0, room); else -> 0 }
        canvas.save()
        canvas.translate(l + padX, y0 + padY + dy)
        layout.draw(canvas)
        canvas.restore()
      }
      if (borders) {
        canvas.drawLine(l, y0, l, y1, line)
        canvas.drawLine(r, y0, r, y1, line)
        if (!cell.continued) canvas.drawLine(l, y0, r, y0, line)
        if (lastRow || !cell.openBelow) canvas.drawLine(l, y1, r, y1, line)
      }
    }
  }
}

/**
 * Collects text and spans for a whole document. SpannableStringBuilder re-sorts its spans on every
 * setSpan, which is quadratic for tens of thousands of spans; copying this into one sorts them once.
 */
internal class DocText : android.text.Spannable, android.text.GetChars {
  private val chars = StringBuilder()
  private val spans = ArrayList<Any>()
  private val bounds = java.util.IdentityHashMap<Any, IntArray>()

  override val length: Int get() = chars.length
  override fun get(index: Int): Char = chars[index]
  override fun subSequence(startIndex: Int, endIndex: Int): CharSequence = android.text.SpannableStringBuilder(this, startIndex, endIndex)
  override fun toString() = chars.toString()
  override fun getChars(start: Int, end: Int, dest: CharArray, destoff: Int) = chars.getChars(start, end, dest, destoff)

  fun append(value: CharSequence): DocText { chars.append(value); return this }
  fun append(value: Char): DocText { chars.append(value); return this }

  override fun setSpan(what: Any, start: Int, end: Int, flags: Int) {
    val entry = bounds[what]
    if (entry == null) { spans.add(what); bounds[what] = intArrayOf(start, end, flags) }
    else { entry[0] = start; entry[1] = end; entry[2] = flags }
  }
  override fun removeSpan(what: Any) { if (bounds.remove(what) != null) spans.remove(what) }

  override fun <T> getSpans(start: Int, end: Int, type: Class<T>): Array<T> {
    val out = ArrayList<T>()
    for (span in spans) {
      if (!type.isInstance(span)) continue
      val entry = bounds[span] ?: continue
      val a = entry[0]; val b = entry[1]
      if (a > end || b < start) continue
      if (a != b && start != end && (a == end || b == start)) continue
      out.add(type.cast(span) as T)
    }
    @Suppress("UNCHECKED_CAST")
    return out.toArray(java.lang.reflect.Array.newInstance(type, out.size) as Array<T>)
  }
  override fun getSpanStart(tag: Any) = bounds[tag]?.get(0) ?: -1
  override fun getSpanEnd(tag: Any) = bounds[tag]?.get(1) ?: -1
  override fun getSpanFlags(tag: Any) = bounds[tag]?.get(2) ?: 0
  override fun nextSpanTransition(start: Int, limit: Int, type: Class<*>?): Int {
    var next = limit
    for (span in spans) {
      if (type != null && !type.isInstance(span)) continue
      val entry = bounds[span] ?: continue
      if (entry[0] in (start + 1) until next) next = entry[0]
      if (entry[1] in (start + 1) until next) next = entry[1]
    }
    return next
  }
}

internal fun hexColor(hex: String): Int = try { if (hex.length == 6) 0xFF000000.toInt() or hex.toInt(16) else 0 } catch (_: Exception) { 0 }

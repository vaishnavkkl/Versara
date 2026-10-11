p='modules/pdf-engine/android/src/main/java/expo/modules/pdfengine/PdfEditCanvasView.kt'; s=open(p,encoding='utf8').read()
rep=[
("""  private class TextBox(val visible: Boolean, val text: String, val font: String, val size: Float, val color: Int, val underline: Boolean, val submitOnReturn: Boolean = false, val fontFile: String = "")""",
"""  /** `box` (normalised left, top and right) opens the field over an existing paragraph at its width; `lineHeight` is in page points. */
  private class TextBox(val visible: Boolean, val text: String, val font: String, val size: Float, val color: Int, val underline: Boolean, val submitOnReturn: Boolean = false, val fontFile: String = "", val box: RectF? = null, val lineHeight: Float = 0f)"""),
("""      TextBox(item.optBoolean("visible"), item.optString("text"), item.optString("font", "Helvetica"), item.optDouble("size", 16.0).toFloat(), item.optInt("color", 0x101020), item.optBoolean("underline"), item.optBoolean("submitOnReturn"), item.optString("fontFile"))""",
"""      val box = item.optJSONObject("box")?.let {
        val x = it.optDouble("x").toFloat(); val y = it.optDouble("y").toFloat()
        RectF(x, y, x + it.optDouble("width").toFloat(), y)
      }?.takeIf { it.width() > 0f && it.left in 0f..1f && it.top in 0f..1f }
      TextBox(item.optBoolean("visible"), item.optString("text"), item.optString("font", "Helvetica"), item.optDouble("size", 16.0).toFloat(), item.optInt("color", 0x101020), item.optBoolean("underline"), item.optBoolean("submitOnReturn"), item.optString("fontFile"),
        box, item.optDouble("lineHeight", 0.0).toFloat().coerceIn(0f, 1000f))"""),
("""    if (opening || value.size != previous.size || value.font != previous.font || value.visible != previous.visible) { styleText(); layer.requestLayout() }""",
"""    if (opening || value.size != previous.size || value.font != previous.font || value.visible != previous.visible || value.box != previous.box || value.lineHeight != previous.lineHeight) { styleText(); layer.requestLayout() }"""),
("""    val rect = textBoxRect()
    if (rect == null || disabled) { handle.visibility = View.GONE; return }""",
"""    val rect = textBoxRect()
    // A paragraph keeps its place on the page; only new text can be dragged.
    if (rect == null || disabled || textBox.box != null) { handle.visibility = View.GONE; return }"""),
("""    val size = max(1f, textBox.size * scale)
    if (edit.textSize != size) {
      edit.setTextSize(TypedValue.COMPLEX_UNIT_PX, size)
      edit.setLineSpacing(max(0f, size * 1.2f - edit.paint.getFontMetrics(null)), 1f)
    }
    val pad = max(1, (2 * scale).toInt())
    if (edit.paddingLeft != pad) edit.setPadding(pad, pad, pad * 3, pad)
    val minimum = max((48 * scale).toInt(), 24)
    val maximum = max(minimum, contentWidth - ((placement?.first ?: 0f) * contentWidth).toInt() + pad)""",
"""    val size = max(1f, textBox.size * scale)
    val line = if (textBox.box != null && textBox.lineHeight > 0f) textBox.lineHeight * scale else size * 1.2f
    if (edit.textSize != size || lineStep != line) {
      edit.setTextSize(TypedValue.COMPLEX_UNIT_PX, size)
      edit.setLineSpacing(max(0f, line - edit.paint.getFontMetrics(null)), 1f)
      lineStep = line
    }
    val pad = max(1, (2 * scale).toInt())
    if (edit.paddingLeft != pad) edit.setPadding(pad, pad, pad * 3, pad)
    val box = textBox.box
    // A paragraph wraps at its own width, like the saved PDF.
    val minimum = if (box != null) (box.width() * contentWidth).toInt() + pad * 4 else max((48 * scale).toInt(), 24)
    val maximum = if (box != null) minimum else max(minimum, contentWidth - ((placement?.first ?: 0f) * contentWidth).toInt() + pad)"""),
("""  private fun baselineOffset(): Int =""", """  private var lineStep = 0f
  private fun baselineOffset(): Int ="""),
("""      edit.measure(MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))""",
"""      if (textBox.box != null) edit.measure(MeasureSpec.makeMeasureSpec(edit.minWidth, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
      else edit.measure(MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))"""),
("""      val point = placement
      if (point != null) {
        val left = (point.first * (r - l)).toInt() - edit.paddingLeft""",
"""      val point = placement
      val box = textBox.box
      if (box != null && textBox.visible) {
        val left = (box.left * (r - l)).toInt() - edit.paddingLeft
        val top = (box.top * (b - t)).toInt() - edit.paddingTop
        edit.layout(left, top, left + edit.measuredWidth, top + edit.measuredHeight)
      } else if (point != null) {
        val left = (point.first * (r - l)).toInt() - edit.paddingLeft"""),
]
for a,b in rep:
    assert s.count(a)==1,(a[:80], s.count(a)); s=s.replace(a,b)
open(p,'w',encoding='utf8').write(s)
print('ok')

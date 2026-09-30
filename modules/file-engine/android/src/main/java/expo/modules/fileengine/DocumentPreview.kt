package expo.modules.fileengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.InputStream
import java.util.zip.ZipInputStream
import kotlin.math.max
import kotlin.math.min

/**
 * First-page previews for DOCX and TXT files. A DOCX's embedded thumbnail is used when present;
 * otherwise the opening paragraphs are laid out on a Letter-sized page. Only the start of the
 * document is read, so large files stay cheap.
 */
internal object DocumentPreview {
  private const val PAGE_W = 612f
  private const val PAGE_H = 792f
  private const val MARGIN = 64f
  private const val MAX_PARAGRAPHS = 80
  private const val MAX_CHARS = 5000

  private class Paragraph(val text: String, val points: Float, val bold: Boolean, val align: Layout.Alignment, val picture: Pair<Float, Float>? = null)

  fun render(context: Context, uri: Uri, name: String, size: Int): Bitmap? {
    val paragraphs = if (name.endsWith(".txt", true)) open(context, uri)?.use { readText(it) }
    else {
      var thumbnail: Bitmap? = null
      val body = open(context, uri)?.use { stream -> readDocx(stream, size) { thumbnail = it } }
      thumbnail?.let { return it }
      body
    }
    return draw(paragraphs ?: return null, size)
  }

  private fun open(context: Context, uri: Uri): InputStream? =
    if (uri.scheme == "file") java.io.File(requireNotNull(uri.path)).inputStream() else context.contentResolver.openInputStream(uri)

  private fun readText(stream: InputStream): List<Paragraph> {
    val buffer = CharArray(MAX_CHARS)
    val count = stream.bufferedReader().read(buffer).coerceAtLeast(0)
    return String(buffer, 0, count).split('\n').take(MAX_PARAGRAPHS).map { Paragraph(it.trimEnd('\r'), 11f, false, Layout.Alignment.ALIGN_NORMAL) }
  }

  private fun readDocx(stream: InputStream, size: Int, onThumbnail: (Bitmap) -> Unit): List<Paragraph>? {
    var paragraphs: List<Paragraph>? = null
    ZipInputStream(stream.buffered()).use { zip ->
      while (true) {
        val entry = zip.nextEntry ?: break
        val entryName = entry.name.lowercase()
        if (entryName == "word/document.xml") paragraphs = parse(zip)
        else if (entryName.startsWith("docprops/thumbnail.") && (entryName.endsWith(".jpeg") || entryName.endsWith(".jpg") || entryName.endsWith(".png"))) {
          val bytes = zip.readBytes()
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
          if (bounds.outWidth > 0) {
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= size) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.let { onThumbnail(it); return null }
          }
        }
      }
    }
    return paragraphs
  }

  /** Streams `word/document.xml` and stops once the first page is certainly full. */
  private fun parse(stream: InputStream): List<Paragraph> {
    val parser = Xml.newPullParser()
    parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
    parser.setInput(object : java.io.FilterInputStream(stream) { override fun close() = Unit }, "UTF-8")
    val result = ArrayList<Paragraph>()
    val text = StringBuilder()
    var inParagraph = false
    var inText = false
    var points = 0f
    var bold = false
    var style = ""
    var align = Layout.Alignment.ALIGN_NORMAL
    var chars = 0
    var event = parser.eventType
    while (event != XmlPullParser.END_DOCUMENT && result.size < MAX_PARAGRAPHS && chars < MAX_CHARS) {
      when (event) {
        XmlPullParser.START_TAG -> when (parser.name) {
          "w:p" -> { inParagraph = true; text.setLength(0); points = 0f; bold = false; style = ""; align = Layout.Alignment.ALIGN_NORMAL }
          "w:pStyle" -> style = parser.getAttributeValue(null, "w:val") ?: ""
          "w:jc" -> align = when (parser.getAttributeValue(null, "w:val")) {
            "center" -> Layout.Alignment.ALIGN_CENTER
            "right", "end" -> Layout.Alignment.ALIGN_OPPOSITE
            else -> Layout.Alignment.ALIGN_NORMAL
          }
          "w:b" -> if (inParagraph) parser.getAttributeValue(null, "w:val").let { if (it == null || (it != "0" && it != "false")) bold = true }
          "w:sz" -> parser.getAttributeValue(null, "w:val")?.toFloatOrNull()?.let { points = max(points, it / 2f) }
          "w:t" -> inText = true
          "w:tab" -> if (inParagraph) text.append("    ")
          "w:br", "w:cr" -> if (inParagraph) text.append('\n')
          "wp:extent" -> {
            val cx = parser.getAttributeValue(null, "cx")?.toFloatOrNull() ?: 0f
            val cy = parser.getAttributeValue(null, "cy")?.toFloatOrNull() ?: 0f
            if (cx > 0 && cy > 0) result.add(Paragraph("", 0f, false, align, Pair(cx / 12700f, cy / 12700f)))
          }
        }
        XmlPullParser.TEXT -> if (inText) { text.append(parser.text); chars += parser.text.length }
        XmlPullParser.END_TAG -> when (parser.name) {
          "w:t" -> inText = false
          "w:p" -> {
            inParagraph = false
            val heading = style.lowercase()
            val (size, strong) = when {
              heading == "title" -> Pair(26f, true)
              heading.startsWith("heading1") || heading == "heading 1" -> Pair(20f, true)
              heading.startsWith("heading2") -> Pair(16f, true)
              heading.startsWith("heading") -> Pair(14f, true)
              else -> Pair(if (points > 0) points else 11f, bold)
            }
            result.add(Paragraph(text.toString(), size, strong, align))
          }
        }
      }
      event = parser.next()
    }
    return result
  }

  private fun draw(paragraphs: List<Paragraph>, size: Int): Bitmap {
    val scale = size / PAGE_H
    val bitmap = Bitmap.createBitmap(max(1, (PAGE_W * scale).toInt()), max(1, size), Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.WHITE)
    val canvas = Canvas(bitmap)
    canvas.scale(scale, scale)
    val width = (PAGE_W - MARGIN * 2).toInt()
    val regular = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF202124.toInt() }
    val strong = TextPaint(regular).apply { typeface = Typeface.DEFAULT_BOLD }
    val picture = Paint().apply { color = 0xFFE3E6EB.toInt() }
    var y = MARGIN
    for (paragraph in paragraphs) {
      if (y > PAGE_H - MARGIN) break
      val box = paragraph.picture
      if (box != null) {
        val w = min(box.first, width.toFloat())
        val h = box.second * (w / max(1f, box.first))
        val x = when (paragraph.align) { Layout.Alignment.ALIGN_CENTER -> MARGIN + (width - w) / 2; Layout.Alignment.ALIGN_OPPOSITE -> MARGIN + width - w; else -> MARGIN }
        canvas.drawRect(x, y, x + w, min(y + h, PAGE_H - MARGIN), picture)
        y += h + 6f
        continue
      }
      val paint = if (paragraph.bold) strong else regular
      paint.textSize = paragraph.points.coerceIn(6f, 48f)
      if (paragraph.text.isBlank()) { y += paint.textSize * 1.15f; continue }
      val layout = StaticLayout.Builder.obtain(paragraph.text, 0, paragraph.text.length, paint, width).setAlignment(paragraph.align).setLineSpacing(0f, 1.1f).build()
      canvas.save(); canvas.translate(MARGIN, y); layout.draw(canvas); canvas.restore()
      y += layout.height + paint.textSize * 0.6f
    }
    return bitmap
  }
}

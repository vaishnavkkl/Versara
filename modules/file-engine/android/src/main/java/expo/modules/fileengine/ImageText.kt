package expo.modules.fileengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONObject
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** On-device text recognition and redraw for images. Coordinates are normalised to the upright image. */
internal object ImageText {
  private const val ANALYSIS_SIZE = 2048
  private const val MAX_LINES = 400

  private class Sample(val background: Int, val left: Int, val right: Int, val text: Int)

  fun recognize(context: Context, uri: String): Map<String, Any> {
    val bitmap = ImageProcessing.decode(context, Uri.parse(uri), ANALYSIS_SIZE)
    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    try {
      val result = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)))
      val w = bitmap.width.toFloat(); val h = bitmap.height.toFloat()
      val lines = ArrayList<Map<String, Any>>()
      for (block in result.textBlocks) for (line in block.lines) {
        if (lines.size >= MAX_LINES) break
        val box = line.boundingBox ?: continue
        if (box.width() < 2 || box.height() < 2 || line.text.isBlank()) continue
        val sample = sample(bitmap, box.left, box.top, box.right, box.bottom)
        lines += mapOf(
          "id" to lines.size, "text" to line.text,
          "x" to box.left / w.toDouble(), "y" to box.top / h.toDouble(), "width" to box.width() / w.toDouble(), "height" to box.height() / h.toDouble(),
          "angle" to line.angle.toDouble(),
          "color" to (sample.text and 0xFFFFFF), "background" to (sample.background and 0xFFFFFF),
          "backgroundLeft" to (sample.left and 0xFFFFFF), "backgroundRight" to (sample.right and 0xFFFFFF),
        )
      }
      return mapOf("width" to bitmap.width, "height" to bitmap.height, "lines" to lines)
    } finally {
      recognizer.close()
      bitmap.recycle()
    }
  }

  /** Median of the pixels around the box is the background; the pixels farthest from it are the ink. */
  private fun sample(bitmap: Bitmap, left: Int, top: Int, right: Int, bottom: Int): Sample {
    val pad = max(2, ((bottom - top) * 0.18f).roundToInt())
    val l = (left - pad).coerceIn(0, bitmap.width - 1); val r = (right + pad).coerceIn(0, bitmap.width - 1)
    val t = (top - pad).coerceIn(0, bitmap.height - 1); val b = (bottom + pad).coerceIn(0, bitmap.height - 1)
    val border = ArrayList<Int>(); val leftEdge = ArrayList<Int>(); val rightEdge = ArrayList<Int>()
    val stepX = max(1, (r - l) / 80); val stepY = max(1, (b - t) / 30)
    for (x in l..r step stepX) { border += bitmap.getPixel(x, t); border += bitmap.getPixel(x, b) }
    for (y in t..b step stepY) { leftEdge += bitmap.getPixel(l, y); rightEdge += bitmap.getPixel(r, y) }
    border += leftEdge; border += rightEdge
    val background = median(border)
    val inner = ArrayList<Int>()
    val ix = max(1, (right - left) / 60); val iy = max(1, (bottom - top) / 20)
    for (y in top.coerceIn(0, bitmap.height - 1)..bottom.coerceIn(0, bitmap.height - 1) step iy)
      for (x in left.coerceIn(0, bitmap.width - 1)..right.coerceIn(0, bitmap.width - 1) step ix) inner += bitmap.getPixel(x, y)
    val distances = inner.map { distance(it, background) }
    val farthest = distances.maxOrNull() ?: 0f
    val text = if (farthest < 40f) {
      if (luminance(background) > 0.5f) 0xFF101010.toInt() else 0xFFFFFFFF.toInt()
    } else {
      val ink = inner.filterIndexed { index, _ -> distances[index] >= farthest * 0.6f }
      average(ink)
    }
    return Sample(background, median(leftEdge.ifEmpty { border }), median(rightEdge.ifEmpty { border }), text)
  }

  private fun channel(color: Int, shift: Int) = color shr shift and 255
  private fun median(colors: List<Int>): Int {
    if (colors.isEmpty()) return 0xFFFFFFFF.toInt()
    fun m(shift: Int) = colors.map { channel(it, shift) }.sorted()[colors.size / 2]
    return (0xFF shl 24) or (m(16) shl 16) or (m(8) shl 8) or m(0)
  }
  private fun average(colors: List<Int>): Int {
    if (colors.isEmpty()) return 0xFF000000.toInt()
    fun a(shift: Int) = colors.sumOf { channel(it, shift) } / colors.size
    return (0xFF shl 24) or (a(16) shl 16) or (a(8) shl 8) or a(0)
  }
  private fun distance(a: Int, b: Int): Float {
    val dr = channel(a, 16) - channel(b, 16); val dg = channel(a, 8) - channel(b, 8); val db = channel(a, 0) - channel(b, 0)
    return sqrt((dr * dr + dg * dg + db * db).toFloat())
  }
  private fun luminance(color: Int) = (0.299f * channel(color, 16) + 0.587f * channel(color, 8) + 0.114f * channel(color, 0)) / 255f

  /** Maps the standard PDF font names (Helvetica, Times, Courier with Bold/Oblique/Italic) to system faces. */
  fun typeface(font: String): Typeface {
    val base = when {
      font.startsWith("Times") -> Typeface.SERIF
      font.startsWith("Courier") -> Typeface.MONOSPACE
      else -> Typeface.SANS_SERIF
    }
    val bold = font.contains("Bold")
    val italic = font.contains("Oblique") || font.contains("Italic")
    return Typeface.create(base, when { bold && italic -> Typeface.BOLD_ITALIC; bold -> Typeface.BOLD; italic -> Typeface.ITALIC; else -> Typeface.NORMAL })
  }

  /**
   * Covers replaced lines with the sampled background and draws text at its baseline.
   * Sizes are in pixels of an image [refWidth] wide, so previews and full exports match.
   */
  fun render(context: Context, options: JSONObject): Map<String, Any> {
    val destination = Uri.parse(options.getString("outputUri"))
    require(destination.scheme == "file") { "Destination must be an app file URI." }
    val target = File(requireNotNull(destination.path)).canonicalFile
    val allowed = listOf(context.filesDir.canonicalPath, context.cacheDir.canonicalPath)
    require(allowed.any { target.path.startsWith("$it/") }) { "Destination must stay inside the app." }
    require(!target.exists()) { "Destination already exists." }
    val preview = options.optBoolean("preview", false)
    val limit = options.optInt("maxSize", if (ImageProcessing.lowMemory(context)) 3072 else 4096).coerceIn(256, 4096)
    val decoded = ImageProcessing.decode(context, Uri.parse(options.getString("uri")), limit)
    val bitmap = if (decoded.isMutable && decoded.config == Bitmap.Config.ARGB_8888) decoded
    else decoded.copy(Bitmap.Config.ARGB_8888, true).also { decoded.recycle() }
    try {
      val canvas = Canvas(bitmap)
      val w = bitmap.width.toFloat(); val h = bitmap.height.toFloat()
      val ratio = w / options.optDouble("refWidth", w.toDouble()).toFloat().coerceAtLeast(1f)
      val edits = options.optJSONArray("edits")
      require((edits?.length() ?: 0) <= 500) { "Save these changes before adding more." }
      val fill = Paint(Paint.ANTI_ALIAS_FLAG)
      val ink = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
      for (index in 0 until (edits?.length() ?: 0)) {
        val edit = edits!!.getJSONObject(index)
        edit.optJSONObject("erase")?.let { box ->
          val rect = RectF((box.optDouble("x") * w).toFloat(), (box.optDouble("y") * h).toFloat(), ((box.optDouble("x") + box.optDouble("width")) * w).toFloat(), ((box.optDouble("y") + box.optDouble("height")) * h).toFloat())
          val pad = max(2f, rect.height() * 0.15f)
          rect.inset(-pad, -pad)
          val left = 0xFF000000.toInt() or box.optInt("left", box.optInt("background", 0xFFFFFF))
          val right = 0xFF000000.toInt() or box.optInt("right", box.optInt("background", 0xFFFFFF))
          fill.shader = LinearGradient(rect.left, 0f, rect.right, 0f, left, right, Shader.TileMode.CLAMP)
          canvas.drawRoundRect(rect, pad, pad, fill)
        }
        val text = edit.optString("text")
        if (text.isNotBlank()) {
          ink.typeface = typeface(edit.optString("font", "Helvetica"))
          ink.textSize = max(1f, edit.optDouble("size", 16.0).toFloat() * ratio)
          ink.color = 0xFF000000.toInt() or edit.optInt("color", 0x101010)
          ink.isUnderlineText = edit.optBoolean("underline", false)
          val x = (edit.optDouble("x") * w).toFloat()
          val y = (edit.optDouble("y") * h).toFloat()
          text.split('\n').take(50).forEachIndexed { line, value ->
            if (value.isNotEmpty()) canvas.drawText(value, x, y + line * ink.textSize * 1.2f, ink)
          }
        }
      }
      val format = if (preview) "jpeg" else options.optString("format", "jpeg")
      val quality = if (preview) 85 else options.optInt("quality", 92).coerceIn(10, 100)
      val (compress, mime) = when (format) {
        "png" -> Bitmap.CompressFormat.PNG to "image/png"
        "webp" -> (if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP) to "image/webp"
        else -> Bitmap.CompressFormat.JPEG to "image/jpeg"
      }
      target.parentFile?.mkdirs()
      try { target.outputStream().use { require(bitmap.compress(compress, quality, it)) { "Could not encode the image." } } }
      catch (error: Throwable) { target.delete(); throw error }
      return mapOf("uri" to destination.toString(), "width" to bitmap.width, "height" to bitmap.height, "size" to target.length(), "mimeType" to mime)
    } finally {
      bitmap.recycle()
    }
  }
}

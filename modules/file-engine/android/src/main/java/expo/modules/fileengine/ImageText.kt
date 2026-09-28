package expo.modules.fileengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import com.googlecode.tesseract.android.TessBaseAPI
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.atan
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** On-device text recognition and redraw for images. Coordinates are normalised to the upright image. */
internal object ImageText {
  private const val ANALYSIS_SIZE = 2048
  private const val MAX_LINES = 400

  private class Sample(val background: Int, val left: Int, val right: Int, val text: Int)

  private val ocrSetupLock = Any()
  private val recognitionLock = Any()
  private val recognitions = HashMap<String, Recognition>()
  class Recognition internal constructor(val uri: String, internal val key: String) {
    internal val cancelled = AtomicBoolean(false)
    internal var engine: TessBaseAPI? = null
  }

  fun prepareRecognition(uri: String, key: String = uri): Recognition = synchronized(recognitionLock) {
    recognitions[key]?.let { it.cancelled.set(true); it.engine?.stop() }
    require(recognitions.containsKey(key) || recognitions.size < 4) { "Wait for the current text recognition to finish." }
    Recognition(uri, key).also { recognitions[key] = it }
  }

  fun cancelRecognition(request: Recognition) = synchronized(recognitionLock) {
    request.cancelled.set(true); request.engine?.stop()
  }

  fun cancelRecognition(uri: String) = synchronized(recognitionLock) {
    recognitions[uri]?.let { it.cancelled.set(true); it.engine?.stop() }
  }

  fun cancelAllRecognition() = synchronized(recognitionLock) {
    recognitions.values.forEach { it.cancelled.set(true); it.engine?.stop() }
  }

  fun finishRecognition(request: Recognition) = synchronized(recognitionLock) {
    if (recognitions[request.key] === request) recognitions.remove(request.key)
    Unit
  }

  private fun checkRecognition(request: Recognition) {
    if (request.cancelled.get() || Thread.currentThread().isInterrupted) throw InterruptedException("Text recognition was cancelled.")
  }
  private val lineTag = Regex("<span\\b([^>]+)>", RegexOption.IGNORE_CASE)
  private val lineClass = Regex("\\bclass\\s*=\\s*['\"][^'\"]*\\bocr(?:x)?_line\\b[^'\"]*['\"]", RegexOption.IGNORE_CASE)
  private val lineBounds = Regex("\\bbbox\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)")
  private val lineSlope = Regex("\\bbaseline\\s+([-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))")

  /** The asset is bundled once by pdf-engine; never fall back to a download. */
  private fun modelDirectory(context: Context): File = synchronized(ocrSetupLock) {
    val root = File(context.noBackupFilesDir, "versara-image-ocr")
    val data = File(root, "tessdata/eng.traineddata")
    if (!data.isFile || data.length() == 0L) {
      require(data.parentFile!!.isDirectory || data.parentFile!!.mkdirs()) { "Could not prepare offline text recognition." }
      val partial = File.createTempFile("eng-", ".partial", data.parentFile)
      try {
        context.assets.open("tessdata/eng.traineddata").use { source -> partial.outputStream().use { source.copyTo(it) } }
        require(partial.length() > 0 && partial.renameTo(data)) { "Could not prepare offline text recognition." }
      } finally { partial.delete() }
    }
    root
  }

  /** Tesseract's Java iterator exposes line bounds; its hOCR supplies baseline slope. */
  private fun lineAngles(hocr: String): Map<String, Double> {
    val angles = HashMap<String, Double>()
    for (tag in lineTag.findAll(hocr)) {
      val attributes = tag.groupValues[1]
      if (!lineClass.containsMatchIn(attributes)) continue
      val box = lineBounds.find(attributes) ?: continue
      val slope = lineSlope.find(attributes)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
      if (slope.isFinite()) angles[box.groupValues.drop(1).joinToString(",")] = Math.toDegrees(atan(slope))
      if (angles.size >= MAX_LINES) break
    }
    return angles
  }

  fun recognize(context: Context, uri: String, request: Recognition): Map<String, Any> {
    checkRecognition(request)
    val bitmap = ImageProcessing.decode(context, Uri.parse(uri), ANALYSIS_SIZE)
    var recognizer: TessBaseAPI? = null
    try {
      val engine = TessBaseAPI { _ ->
        if (request.cancelled.get() || Thread.currentThread().isInterrupted) synchronized(recognitionLock) { request.engine?.stop() }
      }
      recognizer = engine
      require(engine.init(modelDirectory(context).path, "eng", TessBaseAPI.OEM_LSTM_ONLY)) {
        "Offline text recognition is unavailable. Reinstall the app with its bundled English model."
      }
      synchronized(recognitionLock) { checkRecognition(request); request.engine = engine }
      engine.pageSegMode = TessBaseAPI.PageSegMode.PSM_AUTO
      engine.setImage(bitmap)
      checkRecognition(request)
      val angles = lineAngles(engine.getHOCRText(0) ?: "")
      checkRecognition(request)
      val w = bitmap.width.toFloat(); val h = bitmap.height.toFloat()
      val lines = ArrayList<Map<String, Any>>()
      val iterator = engine.resultIterator
      if (iterator != null) try {
        val level = TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE
        iterator.begin()
        do {
          checkRecognition(request)
          val text = iterator.getUTF8Text(level)?.trim().orEmpty()
          val raw = iterator.getBoundingBox(level) ?: continue
          if (raw.size < 4 || text.isBlank()) continue
          val box = Rect(raw[0].coerceIn(0, bitmap.width), raw[1].coerceIn(0, bitmap.height), raw[2].coerceIn(0, bitmap.width), raw[3].coerceIn(0, bitmap.height))
          if (box.width() < 2 || box.height() < 2) continue
          val sample = sample(bitmap, box.left, box.top, box.right, box.bottom)
          lines += mapOf(
            "id" to lines.size, "text" to text,
            "x" to box.left / w.toDouble(), "y" to box.top / h.toDouble(), "width" to box.width() / w.toDouble(), "height" to box.height() / h.toDouble(),
            "angle" to (angles[raw.take(4).joinToString(",")] ?: 0.0),
            "color" to (sample.text and 0xFFFFFF), "background" to (sample.background and 0xFFFFFF),
            "backgroundLeft" to (sample.left and 0xFFFFFF), "backgroundRight" to (sample.right and 0xFFFFFF),
          )
        } while (lines.size < MAX_LINES && iterator.next(level))
      } finally { iterator.delete() }
      return mapOf("width" to bitmap.width, "height" to bitmap.height, "lines" to lines)
    } finally {
      synchronized(recognitionLock) { request.engine = null }
      recognizer?.recycle()
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
    val source = Uri.parse(options.getString("uri"))
    val decoded = if (preview) ImageProcessing.decode(context, source, limit) else ImageProcessing.decodeExport(context, source)
    val bitmap = if (decoded.isMutable && decoded.config == Bitmap.Config.ARGB_8888) decoded
    else try { requireNotNull(decoded.copy(Bitmap.Config.ARGB_8888, true)) { "Could not prepare the image for editing." } } finally { decoded.recycle() }
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
      val encoded = if (compress == Bitmap.CompressFormat.JPEG && bitmap.hasAlpha()) {
        Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888).also { opaque ->
          Canvas(opaque).apply { drawColor(Color.WHITE); drawBitmap(bitmap, 0f, 0f, null) }
          opaque.setHasAlpha(false)
        }
      } else bitmap
      try { target.outputStream().use { require(encoded.compress(compress, quality, it)) { "Could not encode the image." } } }
      catch (error: Throwable) { target.delete(); throw error }
      finally { if (encoded !== bitmap) encoded.recycle() }
      return mapOf("uri" to destination.toString(), "width" to bitmap.width, "height" to bitmap.height, "size" to target.length(), "mimeType" to mime)
    } finally {
      bitmap.recycle()
    }
  }
}

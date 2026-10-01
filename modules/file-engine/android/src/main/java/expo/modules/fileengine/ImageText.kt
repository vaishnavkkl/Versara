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
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.googlecode.tesseract.android.TessBaseAPI
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
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
          ) + (inkStyle(bitmap, box, text, sample) ?: emptyMap())
        } while (lines.size < MAX_LINES && iterator.next(level))
      } finally { iterator.delete() }
      return mapOf("width" to bitmap.width, "height" to bitmap.height, "lines" to lines)
    } finally {
      synchronized(recognitionLock) { request.engine = null }
      recognizer?.recycle()
      bitmap.recycle()
    }
  }

  /**
   * Edit text uses Google ML Kit's bundled Latin recognizer: its line boxes and angles are what the
   * editor's size and baseline mapping were tuned for. Privacy scans and PDF OCR stay on Tesseract.
   */
  fun recognizeForEditing(context: Context, uri: String, request: Recognition, fonts: Map<String, String> = emptyMap()): Map<String, Any> {
    checkRecognition(request)
    val candidates = candidates(fonts)
    val bitmap = ImageProcessing.decode(context, Uri.parse(uri), ANALYSIS_SIZE)
    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    try {
      val task = recognizer.process(InputImage.fromBitmap(bitmap, 0))
      while (!task.isComplete) {
        checkRecognition(request)
        try { Tasks.await(task, 200, TimeUnit.MILLISECONDS) } catch (_: TimeoutException) { /* Poll for cancellation. */ }
      }
      checkRecognition(request)
      val result = Tasks.await(task)
      val w = bitmap.width.toFloat(); val h = bitmap.height.toFloat()
      val lines = ArrayList<Map<String, Any>>()
      for (block in result.textBlocks) for (line in block.lines) {
        if (lines.size >= MAX_LINES) break
        val box = line.boundingBox ?: continue
        if (box.width() < 2 || box.height() < 2 || line.text.isBlank()) continue
        val sample = sample(bitmap, box.left, box.top, box.right, box.bottom)
        val pad = (box.height() * 0.08f).roundToInt()
        val region = Rect(box.left.coerceAtLeast(0), (box.top - pad).coerceAtLeast(0), box.right.coerceAtMost(bitmap.width), (box.bottom + pad).coerceAtMost(bitmap.height))
        lines += mapOf(
          "id" to lines.size, "text" to line.text,
          "x" to box.left / w.toDouble(), "y" to box.top / h.toDouble(), "width" to box.width() / w.toDouble(), "height" to box.height() / h.toDouble(),
          "angle" to line.angle.toDouble(),
          "color" to (sample.text and 0xFFFFFF), "background" to (sample.background and 0xFFFFFF),
          "backgroundLeft" to (sample.left and 0xFFFFFF), "backgroundRight" to (sample.right and 0xFFFFFF),
        ) + (inkStyle(bitmap, region, line.text, sample, if (lines.size < SHAPE_MATCH_LINES) candidates else emptyList()) ?: emptyMap())
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

  /**
   * Estimates the line's face from its pixels: the tight ink box sets size, baseline and start,
   * measured against the recognized text's own glyph bounds; the typical stem width sets the weight.
   * Sizes are pixels of the analysed image, matching the edit reference width.
   */
  private class Candidate(val font: String, val file: String, val face: Typeface)
  private val STANDARD_FONTS = listOf(
    "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
    "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
    "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
  )
  private const val SHAPE_MATCH_LINES = 120
  private const val SHAPE_GRID = 28
  /** Standard faces plus the bundled fonts the app can also draw and embed. */
  private fun candidates(fonts: Map<String, String>): List<Candidate> =
    STANDARD_FONTS.map { Candidate(it, "", typeface(it)) } +
      fonts.entries.sortedBy { it.key }.take(64).map { (name, file) -> Candidate(name, file, typeface(name, file)) }

  private fun inkStyle(bitmap: Bitmap, box: Rect, text: String, sample: Sample, candidates: List<Candidate> = emptyList()): Map<String, Any>? {
    val contrast = distance(sample.text, sample.background)
    if (contrast < 40f || box.width() < 4 || box.height() < 4) return null
    val threshold = contrast * contrast * 0.25f
    val bw = box.width(); val bh = box.height()
    val pixels = IntArray(bw * bh)
    bitmap.getPixels(pixels, 0, bw, box.left, box.top, bw, bh)
    val bg = sample.background
    fun ink(index: Int): Boolean {
      val c = pixels[index]
      val dr = channel(c, 16) - channel(bg, 16); val dg = channel(c, 8) - channel(bg, 8); val db = channel(c, 0) - channel(bg, 0)
      return dr * dr + dg * dg + db * db >= threshold
    }
    val minimum = if (bw > 20) 2 else 1
    var top = -1; var bottom = -1; var left = bw; var right = -1
    for (y in 0 until bh) {
      var count = 0
      for (x in 0 until bw) if (ink(y * bw + x)) { count++; if (x < left) left = x; if (x > right) right = x }
      if (count >= minimum) { if (top < 0) top = y; bottom = y }
    }
    if (top < 0 || bottom - top < 3 || right <= left) return null
    val inkHeight = bottom - top + 1
    val runs = ArrayList<Int>()
    val from = top + inkHeight * 3 / 10; val to = top + inkHeight * 7 / 10
    for (y in from..to step max(1, (to - from) / 6)) {
      var run = 0
      for (x in 0 until bw) {
        if (ink(y * bw + x)) run++ else if (run > 0) { runs += run; run = 0 }
      }
      if (run > 0) runs += run
    }
    val stroke = if (runs.isEmpty()) 0f else runs.sorted()[runs.size / 2].toFloat()
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 100f }
    val bounds = Rect()
    fun fit(font: String): Float {
      paint.typeface = typeface(font)
      paint.getTextBounds(text, 0, text.length, bounds)
      return if (bounds.height() > 0) 100f * inkHeight / bounds.height() else 0f
    }
    val probe = fit("Helvetica")
    if (probe <= 0f) return null
    // Small text quantises stems to whole pixels, so it needs a clearer margin before reading as bold.
    var bold = stroke / probe > if (probe >= 16f) 0.12f else 0.16f
    val inkWidth = (right - left + 1).toFloat()
    var font = ""; var fontFile = ""; var size = 0f; var ratio = 1f
    val inkHeightPx = bottom - top + 1
    if (candidates.isNotEmpty() && inkHeightPx >= 8 && text.count { !it.isWhitespace() } >= 2) {
      // Shape match: draw the recognized text in every face, stretched onto the same grid as the
      // original ink, and keep the face whose glyphs overlap the ink most (intersection over union).
      // Faces that need a large horizontal stretch to fit lose a little, so proportions still count.
      val gh = min(SHAPE_GRID, inkHeightPx)
      val gw = (gh * inkWidth / inkHeightPx).roundToInt().coerceIn(8, 640)
      val target = BooleanArray(gw * gh)
      val hits = IntArray(gw * gh); val totals = IntArray(gw * gh)
      for (y in top..bottom) {
        val gy = ((y - top) * gh / inkHeightPx).coerceAtMost(gh - 1)
        for (x in left..right) {
          val cell = gy * gw + ((x - left) * gw / inkWidth.toInt()).coerceAtMost(gw - 1)
          totals[cell]++; if (ink(y * bw + x)) hits[cell]++
        }
      }
      for (i in target.indices) target[i] = totals[i] > 0 && hits[i] * 2 >= totals[i]
      val glyphs = Bitmap.createBitmap(gw, gh, Bitmap.Config.ALPHA_8)
      try {
        val canvas = Canvas(glyphs)
        val stride = glyphs.rowBytes
        val buffer = ByteArray(stride * gh)
        var best = -Float.MAX_VALUE
        for (candidate in candidates) {
          paint.typeface = candidate.face
          paint.getTextBounds(text, 0, text.length, bounds)
          if (bounds.width() <= 0 || bounds.height() <= 0) continue
          glyphs.eraseColor(Color.TRANSPARENT)
          canvas.save()
          canvas.scale(gw.toFloat() / bounds.width(), gh.toFloat() / bounds.height())
          canvas.drawText(text, -bounds.left.toFloat(), -bounds.top.toFloat(), paint)
          canvas.restore()
          glyphs.copyPixelsToBuffer(ByteBuffer.wrap(buffer))
          var both = 0; var either = 0
          for (y in 0 until gh) for (x in 0 until gw) {
            val drawn = (buffer[y * stride + x].toInt() and 255) >= 128; val original = target[y * gw + x]
            if (drawn && original) both++
            if (drawn || original) either++
          }
          if (either == 0) continue
          val fitted = 100f * inkHeightPx / bounds.height()
          val stretch = inkWidth / (bounds.width() * fitted / 100f)
          val score = both.toFloat() / either - 0.25f * abs(ln(stretch)) + if (candidate.file.isEmpty()) 0.01f else 0f
          if (score > best) { best = score; font = candidate.font; fontFile = candidate.file; size = fitted; ratio = stretch }
        }
      } finally { glyphs.recycle() }
      if (font.isNotEmpty()) bold = font.contains("Bold") || font.contains("Black")
    }
    if (font.isEmpty()) {
      // The family whose glyphs, at the line's ink height, span the line's ink width most closely.
      // Helvetica wins near-ties because most screenshots and documents use a sans face.
      var error = Float.MAX_VALUE
      for (candidate in if (bold) listOf("Helvetica-Bold", "Times-Bold", "Courier-Bold") else listOf("Helvetica", "Times-Roman", "Courier")) {
        val fitted = fit(candidate)
        if (fitted <= 0f || bounds.width() <= 0) continue
        val width = bounds.width() * fitted / 100f
        val miss = abs(ln(inkWidth / width)) + if (candidate.startsWith("Helvetica")) 0f else 0.04f
        if (miss < error) { error = miss; font = candidate; size = fitted; ratio = inkWidth / width }
      }
    }
    if (font.isEmpty()) return null
    paint.typeface = typeface(font, fontFile)
    paint.getTextBounds(text, 0, text.length, bounds)
    val scaleX = ratio.coerceIn(0.7f, 1.4f)
    val scale = size / 100f
    val baseline = box.top + bottom + 1 - bounds.bottom * scale
    val start = box.left + left - bounds.left * scale * scaleX
    return mapOf("size" to size.toDouble(), "baseline" to baseline / bitmap.height.toDouble(), "left" to max(0f, start) / bitmap.width.toDouble(),
      "bold" to bold, "font" to font, "scaleX" to scaleX.toDouble())
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

  private val fileFaces = HashMap<String, Typeface>()
  /** Bundled fonts load from their file; standard PDF font names (Helvetica, Times, Courier with Bold/Oblique/Italic) map to system faces. */
  fun typeface(font: String, file: String = ""): Typeface {
    if (file.isNotEmpty()) synchronized(fileFaces) {
      fileFaces[file]?.let { return it }
      runCatching { Typeface.createFromFile(Uri.parse(file).path ?: file) }.getOrNull()?.let { face ->
        if (fileFaces.size >= 64) fileFaces.clear()
        fileFaces[file] = face
        return face
      }
    }
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
          ink.typeface = typeface(edit.optString("font", "Helvetica"), edit.optString("fontFile"))
          ink.textSize = max(1f, edit.optDouble("size", 16.0).toFloat() * ratio)
          ink.color = 0xFF000000.toInt() or edit.optInt("color", 0x101010)
          ink.isUnderlineText = edit.optBoolean("underline", false)
          ink.textScaleX = edit.optDouble("scaleX", 1.0).toFloat().coerceIn(0.5f, 2f)
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

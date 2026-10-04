package expo.modules.fileengine

import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import java.io.File
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.sin

/** Colour and geometry settings shared by the live editor preview and the export. */
internal data class ImageEdits(
  val rotation: Int = 0,
  val flipH: Boolean = false,
  val flipV: Boolean = false,
  val brightness: Float = 0f,
  val contrast: Float = 1f,
  val saturation: Float = 1f,
  val warmth: Float = 0f,
  val filter: String = "none",
) {
  val identityColor get() = brightness == 0f && contrast == 1f && saturation == 1f && warmth == 0f && filter == "none"
  fun sameColorAs(other: ImageEdits) = brightness == other.brightness && contrast == other.contrast &&
    saturation == other.saturation && warmth == other.warmth && filter == other.filter

  companion object {
    fun from(json: JSONObject) = ImageEdits(
      rotation = ((json.optInt("rotation", 0) % 360) + 360) % 360,
      flipH = json.optBoolean("flipH", false),
      flipV = json.optBoolean("flipV", false),
      brightness = json.optDouble("brightness", 0.0).toFloat().coerceIn(-0.5f, 0.5f),
      contrast = json.optDouble("contrast", 1.0).toFloat().coerceIn(0.5f, 1.5f),
      saturation = json.optDouble("saturation", 1.0).toFloat().coerceIn(0f, 2f),
      warmth = json.optDouble("warmth", 0.0).toFloat().coerceIn(-1f, 1f),
      filter = json.optString("filter", "none"),
    )
  }
}

internal object ImageProcessing {
  fun lowMemory(context: Context) = (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isLowRamDevice

  /** Header-only source dimensions, in the same oriented coordinates used by the canvas. */
  fun sourceSize(context: Context, uri: Uri): Pair<Int, Int> {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open(context, uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "This image format cannot be read on your device." }
    val orientation = try { open(context, uri).use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) } } catch (_: Exception) { 1 }
    return if (orientation in 5..8) bounds.outHeight to bounds.outWidth else bounds.outWidth to bounds.outHeight
  }

  /** Reserve for the decoded source, destination, filter scratch buffers and encoder work. */
  fun exportPixelBudget(context: Context, bytesPerPixel: Long = 20): Long {
    val runtime = Runtime.getRuntime()
    val heapAvailable = (runtime.maxMemory() - (runtime.totalMemory() - runtime.freeMemory())).coerceAtLeast(0)
    val memory = ActivityManager.MemoryInfo()
    (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memory)
    val workingBytes = minOf(heapAvailable * 7 / 10, memory.availMem / 6, (if (lowMemory(context)) 96L else 256L) * 1024 * 1024)
    return (workingBytes / bytesPerPixel).coerceAtMost(32_000_000L)
  }

  fun requireExportSize(width: Int, height: Int, budget: Long) {
    require(width in 1..32768 && height in 1..32768 && width.toLong() * height <= budget) {
      "This image is too large to process at full resolution with the memory currently available. Use Resize to choose smaller dimensions, or close other editors and try again. The original has not been changed."
    }
  }

  /** No implicit size cap: a smaller decode is allowed only for an explicit resize request. */
  fun decodeExport(context: Context, uri: Uri, target: Int? = null, budget: Long = exportPixelBudget(context)): Bitmap {
    val (width, height) = sourceSize(context, uri)
    val longest = max(width, height)
    val side = target?.coerceIn(1, longest) ?: longest
    val ratio = side.toDouble() / longest
    requireExportSize(max(1, ceil(width * ratio).toInt()), max(1, ceil(height * ratio).toInt()), budget)
    return decode(context, uri, side)
  }

  /** Decodes with EXIF orientation applied, never larger than [target] on the longest side. */
  fun decode(context: Context, uri: Uri, target: Int): Bitmap {
    if (Build.VERSION.SDK_INT >= 28) {
      val source = if (uri.scheme == "content") ImageDecoder.createSource(context.contentResolver, uri)
      else ImageDecoder.createSource(File(requireNotNull(uri.path)))
      return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
        val scale = min(1f, target.toFloat() / max(info.size.width, info.size.height))
        decoder.setTargetSize(max(1, (info.size.width * scale).toInt()), max(1, (info.size.height * scale).toInt()))
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
      }
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open(context, uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= target) sample *= 2
    val decoded = open(context, uri).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
      ?: throw IllegalArgumentException("Unsupported image")
    val orientation = try { open(context, uri).use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) } } catch (_: Exception) { ExifInterface.ORIENTATION_NORMAL }
    val orientationMatrix = Matrix().apply {
      when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(270f); postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(270f)
      }
    }
    val scaled = if (max(decoded.width, decoded.height) > target) {
      val ratio = target.toFloat() / max(decoded.width, decoded.height)
      Bitmap.createScaledBitmap(decoded, max(1, (decoded.width * ratio).toInt()), max(1, (decoded.height * ratio).toInt()), true).also { if (it != decoded) decoded.recycle() }
    } else decoded
    if (orientationMatrix.isIdentity) return scaled
    val rotated = Bitmap.createBitmap(scaled, 0, 0, scaled.width, scaled.height, orientationMatrix, true)
    if (rotated != scaled) scaled.recycle()
    return rotated
  }

  private fun open(context: Context, uri: Uri) = if (uri.scheme == "content") requireNotNull(context.contentResolver.openInputStream(uri))
  else File(requireNotNull(uri.path)).inputStream()

  fun colorMatrix(edits: ImageEdits): ColorMatrix {
    val result = ColorMatrix()
    result.setSaturation(edits.saturation)
    val c = edits.contrast
    val offset = (0.5f - 0.5f * c + edits.brightness) * 255f
    result.postConcat(ColorMatrix(floatArrayOf(
      c, 0f, 0f, 0f, offset,
      0f, c, 0f, 0f, offset,
      0f, 0f, c, 0f, offset,
      0f, 0f, 0f, 1f, 0f,
    )))
    if (edits.warmth != 0f) {
      val w = edits.warmth * 0.15f
      result.postConcat(ColorMatrix(floatArrayOf(
        1f + w, 0f, 0f, 0f, 0f,
        0f, 1f, 0f, 0f, 0f,
        0f, 0f, 1f - w, 0f, 0f,
        0f, 0f, 0f, 1f, 0f,
      )))
    }
    when (edits.filter) {
      "mono" -> result.postConcat(ColorMatrix().apply { setSaturation(0f) })
      "sepia" -> result.postConcat(ColorMatrix(floatArrayOf(
        0.393f, 0.769f, 0.189f, 0f, 0f,
        0.349f, 0.686f, 0.168f, 0f, 0f,
        0.272f, 0.534f, 0.131f, 0f, 0f,
        0f, 0f, 0f, 1f, 0f,
      )))
      "vivid" -> {
        result.postConcat(ColorMatrix().apply { setSaturation(1.35f) })
        result.postConcat(ColorMatrix(floatArrayOf(1.08f, 0f, 0f, 0f, -10f, 0f, 1.08f, 0f, 0f, -10f, 0f, 0f, 1.08f, 0f, -10f, 0f, 0f, 0f, 1f, 0f)))
      }
      "fade" -> result.postConcat(ColorMatrix(floatArrayOf(0.85f, 0f, 0f, 0f, 28f, 0f, 0.85f, 0f, 0f, 28f, 0f, 0f, 0.85f, 0f, 28f, 0f, 0f, 0f, 1f, 0f)))
      "cool" -> result.postConcat(ColorMatrix(floatArrayOf(0.92f, 0f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 0f, 1.12f, 0f, 8f, 0f, 0f, 0f, 1f, 0f)))
    }
    return result
  }

  fun geometry(width: Int, height: Int, edits: ImageEdits) = Matrix().apply {
    postScale(if (edits.flipH) -1f else 1f, if (edits.flipV) -1f else 1f, width / 2f, height / 2f)
    postRotate(edits.rotation.toFloat(), width / 2f, height / 2f)
  }

  /** Full export on a worker thread. Crop is normalised to the rotated and flipped image. */
  fun export(context: Context, options: JSONObject): Map<String, Any> {
    val source = Uri.parse(options.getString("uri"))
    val destination = Uri.parse(options.getString("outputUri"))
    require(destination.scheme == "file") { "Destination must be an app file URI." }
    val target = File(requireNotNull(destination.path)).canonicalFile
    val roots = listOf(context.filesDir.canonicalPath, context.cacheDir.canonicalPath)
    require(roots.any { target.path.startsWith(it + "/") }) { "Destination must stay inside the app." }
    require(!target.exists()) { "Destination already exists." }
    val edits = ImageEdits.from(options.optJSONObject("edits") ?: JSONObject())
    val scale = options.optDouble("scale", 1.0).toFloat().coerceIn(0.05f, 1f)
    val format = options.optString("format", "jpeg")
    val quality = options.optInt("quality", 90).coerceIn(10, 100)
    require(format in listOf("jpeg", "png", "webp")) { "Choose JPG, PNG or WebP on this device." }
    // This pipeline releases each previous bitmap before the next transform.
    // Reserve source + destination (8 bytes/pixel), plus encoder/scratch space.
    // The default 20-byte allowance remains for the heavier advanced tools.
    val budget = exportPixelBudget(context, bytesPerPixel = 12)
    val (sourceWidth, sourceHeight) = sourceSize(context, source)
    val angle = Math.toRadians(edits.rotation.toDouble())
    val rotatedWidth = sourceWidth * abs(cos(angle)) + sourceHeight * abs(sin(angle))
    val rotatedHeight = sourceWidth * abs(sin(angle)) + sourceHeight * abs(cos(angle))
    val crop = options.optJSONObject("crop")
    val cropWidth = (crop?.optDouble("width", 1.0) ?: 1.0).coerceIn(0.000001, 1.0)
    val cropHeight = (crop?.optDouble("height", 1.0) ?: 1.0).coerceIn(0.000001, 1.0)
    val explicitSize = options.has("width") || options.has("height") || scale < 0.999f
    val desiredWidth = options.optInt("width", max(1, (rotatedWidth * cropWidth * scale).roundToInt()))
    val desiredHeight = options.optInt("height", max(1, (rotatedHeight * cropHeight * scale).roundToInt()))
    requireExportSize(desiredWidth, desiredHeight, budget)
    val decodeScale = if (explicitSize) min(1.0, max(desiredWidth / (rotatedWidth * cropWidth), desiredHeight / (rotatedHeight * cropHeight))) else 1.0
    requireExportSize(max(1, ceil(rotatedWidth * decodeScale).toInt()), max(1, ceil(rotatedHeight * decodeScale).toInt()), budget)
    var bitmap = decodeExport(context, source, if (explicitSize) max(1, ceil(max(sourceWidth, sourceHeight) * decodeScale).toInt()) else null, budget)
    try {
      if (edits.rotation != 0 || edits.flipH || edits.flipV) {
        val turned = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, geometry(bitmap.width, bitmap.height, edits), true)
        if (turned != bitmap) { bitmap.recycle(); bitmap = turned }
      }
      options.optJSONObject("crop")?.let { crop ->
        val left = (crop.optDouble("x", 0.0) * bitmap.width).roundToInt().coerceIn(0, bitmap.width - 1)
        val top = (crop.optDouble("y", 0.0) * bitmap.height).roundToInt().coerceIn(0, bitmap.height - 1)
        val width = (crop.optDouble("width", 1.0) * bitmap.width).roundToInt().coerceIn(1, bitmap.width - left)
        val height = (crop.optDouble("height", 1.0) * bitmap.height).roundToInt().coerceIn(1, bitmap.height - top)
        if (left != 0 || top != 0 || width != bitmap.width || height != bitmap.height) {
          val cropped = Bitmap.createBitmap(bitmap, left, top, width, height)
          if (cropped != bitmap) { bitmap.recycle(); bitmap = cropped }
        }
      }
      val outputWidth = if (explicitSize) desiredWidth else bitmap.width
      val outputHeight = if (explicitSize) desiredHeight else bitmap.height
      requireExportSize(outputWidth, outputHeight, budget)
      if (outputWidth != bitmap.width || outputHeight != bitmap.height) {
        val resized = Bitmap.createScaledBitmap(bitmap, outputWidth, outputHeight, true)
        if (resized != bitmap) { bitmap.recycle(); bitmap = resized }
      }
      if (!edits.identityColor) {
        val output = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
        Canvas(output).drawBitmap(bitmap, 0f, 0f, Paint(Paint.FILTER_BITMAP_FLAG).apply { colorFilter = ColorMatrixColorFilter(colorMatrix(edits)) })
        bitmap.recycle(); bitmap = output
      }
      if (format == "jpeg" && bitmap.hasAlpha()) {
        val opaque = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
        Canvas(opaque).apply { drawColor(Color.WHITE); drawBitmap(bitmap, 0f, 0f, null) }
        bitmap.recycle(); bitmap = opaque
      }
      val (compress, mime) = when (format) {
        "png" -> Bitmap.CompressFormat.PNG to "image/png"
        "webp" -> (if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP) to "image/webp"
        else -> Bitmap.CompressFormat.JPEG to "image/jpeg"
      }
      target.parentFile?.mkdirs()
      val temporary = File.createTempFile("versara-image-", ".partial", target.parentFile)
      try {
        temporary.outputStream().use { require(bitmap.compress(compress, quality, it)) { "Could not encode the image." } }
        require(!target.exists() && temporary.renameTo(target)) { "Could not save the image. Choose a new output name." }
      } finally { temporary.delete() }
      return mapOf("uri" to destination.toString(), "width" to bitmap.width, "height" to bitmap.height, "size" to target.length(), "mimeType" to mime)
    } finally {
      bitmap.recycle()
    }
  }
}

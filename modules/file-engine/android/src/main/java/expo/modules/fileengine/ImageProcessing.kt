package expo.modules.fileengine

import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
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
    val degrees = when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90f
      ExifInterface.ORIENTATION_ROTATE_180 -> 180f
      ExifInterface.ORIENTATION_ROTATE_270 -> 270f
      else -> 0f
    }
    val scaled = if (max(decoded.width, decoded.height) > target) {
      val ratio = target.toFloat() / max(decoded.width, decoded.height)
      Bitmap.createScaledBitmap(decoded, max(1, (decoded.width * ratio).toInt()), max(1, (decoded.height * ratio).toInt()), true).also { if (it != decoded) decoded.recycle() }
    } else decoded
    if (degrees == 0f) return scaled
    val rotated = Bitmap.createBitmap(scaled, 0, 0, scaled.width, scaled.height, Matrix().apply { postRotate(degrees) }, true)
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
    require(target.path.startsWith(context.filesDir.canonicalPath + "/")) { "Destination must stay inside app documents." }
    require(!target.exists()) { "Destination already exists." }
    val edits = ImageEdits.from(options.optJSONObject("edits") ?: JSONObject())
    val scale = options.optDouble("scale", 1.0).toFloat().coerceIn(0.05f, 1f)
    val format = options.optString("format", "jpeg")
    val quality = options.optInt("quality", 90).coerceIn(10, 100)
    val limit = if (lowMemory(context)) 3072 else 4096

    var bitmap = decode(context, source, limit)
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
      if (scale < 0.999f) {
        val resized = Bitmap.createScaledBitmap(bitmap, max(1, (bitmap.width * scale).roundToInt()), max(1, (bitmap.height * scale).roundToInt()), true)
        if (resized != bitmap) { bitmap.recycle(); bitmap = resized }
      }
      if (!edits.identityColor) {
        val output = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
        Canvas(output).drawBitmap(bitmap, 0f, 0f, Paint(Paint.FILTER_BITMAP_FLAG).apply { colorFilter = ColorMatrixColorFilter(colorMatrix(edits)) })
        bitmap.recycle(); bitmap = output
      }
      val (compress, mime) = when (format) {
        "png" -> Bitmap.CompressFormat.PNG to "image/png"
        "webp" -> (if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP) to "image/webp"
        else -> Bitmap.CompressFormat.JPEG to "image/jpeg"
      }
      target.parentFile?.mkdirs()
      try {
        target.outputStream().use { require(bitmap.compress(compress, quality, it)) { "Could not encode the image." } }
      } catch (error: Throwable) { target.delete(); throw error }
      return mapOf("uri" to destination.toString(), "width" to bitmap.width, "height" to bitmap.height, "size" to target.length(), "mimeType" to mime)
    } finally {
      bitmap.recycle()
    }
  }
}

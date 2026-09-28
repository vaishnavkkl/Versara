package expo.modules.fileengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** Dedicated raster-only privacy export. No source metadata or reversible overlay is copied. */
internal object ImagePrivacyExport {
  private data class Area(val x: Double, val y: Double, val width: Double, val height: Double) {
    fun pixels(w: Int, h: Int) = Rect(max(0, floor(x * w).toInt() - 1), max(0, floor(y * h).toInt() - 1),
      min(w, ceil((x + width) * w).toInt() + 1), min(h, ceil((y + height) * h).toInt() + 1))
  }
  private fun local(context: Context, value: String): File {
    val uri = Uri.parse(value)
    require(uri.scheme == "file") { "Choose a local image." }
    return File(requireNotNull(uri.path)).canonicalFile.also {
      require(it.path.startsWith(context.cacheDir.canonicalPath + "/") || it.path.startsWith(context.filesDir.canonicalPath + "/")) { "Choose the image again." }
    }
  }
  fun process(context: Context, request: JSONObject, check: () -> Unit): Map<String, Any> {
    check()
    val allowed = setOf("action", "tool", "uri", "outputUri", "rects", "format")
    require(request.keys().asSequence().all { it in allowed } && request.optString("format", "png") == "png") { "Privacy saves only support opaque PNG redactions." }
    val action = request.getString("action")
    require(action == "preview" || action == "export") { "Choose a privacy preview or export." }
    val values = request.getJSONArray("rects")
    require(values.length() <= 300) { "Use at most 300 redaction areas." }
    val areas = (0 until values.length()).map { index ->
      val value = values.getJSONObject(index)
      val area = Area(value.getDouble("x"), value.getDouble("y"), value.getDouble("width"), value.getDouble("height"))
      require(listOf(area.x, area.y, area.width, area.height).all { it.isFinite() } && area.x >= 0 && area.y >= 0 && area.width > 0 && area.height > 0 && area.x + area.width <= 1.00000001 && area.y + area.height <= 1.00000001) { "Keep each redaction area inside the image." }
      area
    }
    val source = local(context, request.getString("uri")); require(source.isFile) { "Choose the image again." }
    val destination = local(context, request.getString("outputUri")); require(!destination.exists()) { "Choose a new output name." }
    require(destination.parentFile!!.isDirectory || destination.parentFile!!.mkdirs()) { "Could not prepare the output folder." }
    val encoded = File.createTempFile("privacy-encode-", ".partial", destination.parentFile)
    val cleaned = File.createTempFile("privacy-clean-", ".partial", destination.parentFile)
    var bitmap: Bitmap? = null
    try {
      val sourceSize = ImageProcessing.sourceSize(context, Uri.fromFile(source))
      val decoded = if (action == "preview") ImageProcessing.decode(context, Uri.fromFile(source), 1440)
        else ImageProcessing.decodeExport(context, Uri.fromFile(source))
      val width = decoded.width; val height = decoded.height
      // A fresh sRGB raster also removes RGB hidden behind fully transparent source pixels.
      try {
        check()
        bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        Canvas(bitmap!!).apply { drawColor(Color.WHITE); drawBitmap(decoded, 0f, 0f, null) }
      } finally { decoded.recycle() }
      val pixelAreas = areas.map { it.pixels(width, height) }
      val paint = Paint().apply { color = Color.BLACK; isAntiAlias = false; alpha = 255 }
      Canvas(bitmap!!).apply { for (area in pixelAreas) { check(); drawRect(area, paint) } }
      check()
      encoded.outputStream().use { require(bitmap!!.compress(Bitmap.CompressFormat.PNG, 100, it)) { "Could not encode the privacy image." } }
      bitmap!!.recycle(); bitmap = null
      cleanPng(encoded, cleaned, check)
      check()
      val reopened = BitmapFactory.decodeFile(cleaned.path, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 })
        ?: throw IllegalStateException("Could not verify the privacy image.")
      bitmap = reopened
      require(reopened.width == width && reopened.height == height) { "The saved image dimensions could not be verified." }
      verifyCoverage(reopened, pixelAreas, check)
      reopened.recycle(); bitmap = null
      check()
      require(!destination.exists() && cleaned.renameTo(destination)) { "Could not save the verified privacy image." }
      try { check() } catch (cancelled: Throwable) { destination.delete(); throw cancelled }
      return mapOf("uri" to Uri.fromFile(destination).toString(), "width" to width, "height" to height, "size" to destination.length(),
        "mimeType" to "image/png", "sourceWidth" to sourceSize.first, "sourceHeight" to sourceSize.second, "metadataRemoved" to true, "redactionCount" to areas.size)
    } finally { bitmap?.recycle(); encoded.delete(); cleaned.delete() }
  }

  /** Stream only the five PNG pixel-encoding chunks. No EXIF/XMP/text/thumbnail/profile/trailing bytes. */
  private fun cleanPng(input: File, output: File, check: () -> Unit) {
    val signature = byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10)
    val allowed = setOf("IHDR", "PLTE", "tRNS", "IDAT", "IEND")
    DataInputStream(input.inputStream().buffered()).use { source ->
      DataOutputStream(output.outputStream().buffered()).use { target ->
        val header = ByteArray(8); source.readFully(header)
        require(header.contentEquals(signature)) { "Privacy export must be PNG." }; target.write(header)
        var consumed = 8L; var chunks = 0; var hasData = false; var done = false
        val buffer = ByteArray(32 * 1024)
        while (!done) {
          check(); require(++chunks <= 100000 && input.length() - consumed >= 12) { "The encoded PNG is incomplete." }
          val length = source.readInt().toLong() and 0xFFFFFFFFL
          val typeBytes = ByteArray(4); source.readFully(typeBytes)
          val type = String(typeBytes, Charsets.US_ASCII)
          require(length <= input.length() - consumed - 12 && (chunks != 1 || type == "IHDR" && length == 13L)) { "The encoded PNG is invalid." }
          require(type != "IHDR" || chunks == 1) { "The encoded PNG has duplicate image headers." }
          val keep = type in allowed
          // Unknown critical chunks indicate an unsupported pixel encoding; never strip those silently.
          require(keep || typeBytes[0].toInt() and 32 != 0) { "The PNG encoding cannot be verified." }
          if (keep) { target.writeInt(length.toInt()); target.write(typeBytes) }
          var remaining = length
          while (remaining > 0) {
            check(); val count = min(buffer.size.toLong(), remaining).toInt()
            source.readFully(buffer, 0, count); if (keep) target.write(buffer, 0, count); remaining -= count
          }
          val crc = source.readInt(); if (keep) target.writeInt(crc)
          consumed += length + 12
          if (type == "IDAT") hasData = true
          if (type == "IEND") { require(length == 0L && hasData && consumed == input.length()) { "The encoded PNG contains unexpected data." }; done = true }
        }
      }
    }
  }

  /** Union intervals per row keeps overlapping boxes bounded by image pixels, not boxes × pixels. */
  private fun verifyCoverage(bitmap: Bitmap, areas: List<Rect>, check: () -> Unit) {
    if (areas.isEmpty()) return
    val row = IntArray(bitmap.width)
    val top = areas.minOf { it.top }; val bottom = areas.maxOf { it.bottom }
    for (y in top until bottom) {
      check()
      val spans = areas.filter { y >= it.top && y < it.bottom }.sortedBy { it.left }
      if (spans.isEmpty()) continue
      bitmap.getPixels(row, 0, bitmap.width, 0, y, bitmap.width, 1)
      var verified = 0
      for (span in spans) {
        for (x in max(verified, span.left) until span.right) require(row[x] == Color.BLACK) { "The saved redaction is not fully opaque. No file was saved." }
        verified = max(verified, span.right)
      }
    }
  }
}


package expo.modules.pdfengine

import android.content.Context
import android.graphics.*
import android.graphics.pdf.PdfDocument
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.*

class ImagePdfOptions : Record {
  @Field var jobId: String = ""
  @Field var uris: List<String> = emptyList()
  @Field var outputUri: String = ""
  @Field var pageSize: String = "a4"
}

private class ConversionFailure(val code: String, message: String) : Exception(message)

class ImagePdfConverter {
  private val worker = Executors.newSingleThreadExecutor()
  private val jobs = PdfJobRegistry()
  fun cancel(id: String) { jobs.cancel(id) }
  fun destroy() { jobs.destroy(worker) }

  fun start(context: Context, options: ImagePdfOptions, promise: Promise, progress: (Int, Int) -> Unit) {
    jobs.submit(worker, options.jobId, promise) { cancelled ->
      var partial: File? = null
      var output: File? = null
      var committed = false
      fun checkCancelled() { if (cancelled.get()) throw ConversionFailure("PDF_CANCELLED", "Conversion cancelled.") }
      try {
        if (options.uris.isEmpty() || options.uris.size > 30 || options.pageSize !in listOf("a4", "letter", "image")) {
          throw ConversionFailure("PDF_INVALID_OPTIONS", "Choose between 1 and 30 images and a valid page size.")
        }
        val uri = Uri.parse(options.outputUri)
        if (uri.scheme != "file") throw ConversionFailure("PDF_INVALID_OUTPUT", "Invalid output location.")
        output = File(requireNotNull(uri.path)).canonicalFile
        val root = File(context.filesDir, "Versara PDFs").canonicalFile
        if (output.parentFile != root || output.exists()) throw ConversionFailure("PDF_INVALID_OUTPUT", "Choose a new PDF output location.")
        root.mkdirs()
        val temporary = File(root, output.name + ".partial")
        if (temporary.exists()) throw ConversionFailure("PDF_INVALID_OUTPUT", "This output is already being created.")
        partial = temporary
        val pixelBudget = min(3_000_000, 24_000_000 / options.uris.size)
        val pdf = PdfDocument()
        try {
          options.uris.forEachIndexed { index, source ->
            checkCancelled()
            val bitmap = decode(context, source, pixelBudget)
            try {
              checkCancelled()
              var w = if (options.pageSize == "letter") 612 else 595
              var h = if (options.pageSize == "letter") 792 else 842
              val margin = if (options.pageSize == "image") 0f else 18f
              if (options.pageSize == "image") {
                val ratio = 842f / max(bitmap.width, bitmap.height)
                w = max(1, (bitmap.width * ratio).roundToInt())
                h = max(1, (bitmap.height * ratio).roundToInt())
              } else if (bitmap.width > bitmap.height) { val swap = w; w = h; h = swap }
              val page = pdf.startPage(PdfDocument.PageInfo.Builder(w, h, index + 1).create())
              try {
                page.canvas.drawColor(Color.WHITE)
                val scale = min((w - margin * 2) / bitmap.width, (h - margin * 2) / bitmap.height)
                val dw = bitmap.width * scale
                val dh = bitmap.height * scale
                val rect = RectF((w - dw) / 2, (h - dh) / 2, (w + dw) / 2, (h + dh) / 2)
                page.canvas.drawBitmap(bitmap, null, rect, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
              } finally { pdf.finishPage(page) }
            } finally { bitmap.recycle() }
            progress(index + 1, options.uris.size)
          }
          checkCancelled()
          partial.outputStream().use { pdf.writeTo(it) }
        } finally { pdf.close() }
        checkCancelled()
        if (partial.length() == 0L || !partial.renameTo(output)) throw ConversionFailure("PDF_WRITE_FAILED", "Could not save the PDF. Check available storage.")
        committed = true
        checkCancelled()
        promise.resolve(mapOf("uri" to Uri.fromFile(output).toString(), "pageCount" to options.uris.size, "size" to output.length().toDouble()))
      } catch (error: ConversionFailure) {
        if (committed) output?.delete()
        promise.reject(error.code, error.message, error)
      } catch (error: OutOfMemoryError) {
        if (committed) output?.delete()
        promise.reject("PDF_MEMORY_LIMIT", "Not enough memory. Try fewer images.", null)
      } catch (error: Exception) {
        if (committed) output?.delete()
        promise.reject("PDF_CONVERSION_FAILED", "Could not convert an image. Use readable JPG, PNG or supported HEIC files and check free storage.", error)
      } finally { partial?.delete() }
    }
  }

  private fun decode(context: Context, value: String, budget: Int): Bitmap {
    val uri = Uri.parse(value)
    if (uri.scheme != "file") throw ConversionFailure("PDF_INVALID_IMAGE", "Select images using the file browser.")
    val file = File(requireNotNull(uri.path)).canonicalFile
    if (!file.path.startsWith(context.cacheDir.canonicalPath + File.separator)) throw ConversionFailure("PDF_INVALID_IMAGE", "Select images using the file browser.")
    if (Build.VERSION.SDK_INT >= 28) {
      return ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, info, _ ->
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        val scale = min(1.0, min(2200.0 / max(info.size.width, info.size.height), sqrt(budget.toDouble() / (info.size.width.toDouble() * info.size.height))))
        decoder.setTargetSize(max(1, (info.size.width * scale).toInt()), max(1, (info.size.height * scale).toInt()))
      }
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw ConversionFailure("PDF_IMAGE_UNSUPPORTED", "This device cannot read this image. Try JPG or PNG.")
    var sample = 1
    while (bounds.outWidth.toDouble() * bounds.outHeight / sample / sample > budget || max(bounds.outWidth, bounds.outHeight) / sample > 2200) sample *= 2
    val bitmap = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 })
      ?: throw ConversionFailure("PDF_IMAGE_UNSUPPORTED", "This image is unreadable. Try another image.")
    val orientation = try { ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) } catch (_: Exception) { 1 }
    val matrix = Matrix()
    when (orientation) {
      2 -> matrix.setScale(-1f, 1f)
      3 -> matrix.setRotate(180f)
      4 -> matrix.setScale(1f, -1f)
      5 -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
      6 -> matrix.setRotate(90f)
      7 -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
      8 -> matrix.setRotate(-90f)
    }
    if (matrix.isIdentity) return bitmap
    return try { Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true) } finally { bitmap.recycle() }
  }
}

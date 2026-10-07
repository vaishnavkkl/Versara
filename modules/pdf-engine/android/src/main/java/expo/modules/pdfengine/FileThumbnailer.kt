package expo.modules.pdfengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.system.Os
import expo.modules.kotlin.Promise
import java.io.File
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlin.math.max

/** Small, on-demand thumbnails. Never load whole PDFs or send pixels over JS. */
internal class FileThumbnailer {
  private val worker = ScheduledThreadPoolExecutor(1).apply { setExecuteExistingDelayedTasksAfterShutdownPolicy(false) }
  private val jobs = PdfJobRegistry()
  fun cancel(id: String) = jobs.cancel(id)
  fun destroy() { runCatching { worker.execute { closePdf() } }; jobs.destroy(worker) }

  // Worker-confined. Parsing a large PDF costs far more than drawing one small page, so page
  // thumbnails reuse one open document and release it after a short idle period.
  private var pdfKey = ""
  private var pdfDescriptor: ParcelFileDescriptor? = null
  private var pdfRenderer: ReaderDocument? = null
  private var idleClose: ScheduledFuture<*>? = null
  private fun openInput(context: Context, input: Uri): ParcelFileDescriptor = when (input.scheme) {
    "file" -> ParcelFileDescriptor.open(File(requireNotNull(input.path)).canonicalFile, ParcelFileDescriptor.MODE_READ_ONLY)
    "content" -> requireNotNull(context.contentResolver.openFileDescriptor(input, "r")) { "File unavailable." }
    else -> throw IllegalArgumentException("Unsupported file.")
  }
  private fun pdfFor(context: Context, input: Uri): ReaderDocument {
    val descriptor = openInput(context, input)
    try {
      val stat = Os.fstat(descriptor.fileDescriptor)
      val key = "$input:${stat.st_mtime}:${stat.st_size}"
      pdfRenderer?.let { if (key == pdfKey) { descriptor.close(); return it } }
      closePdf()
      val path = if (input.scheme == "file") File(requireNotNull(input.path)).canonicalPath else "/proc/self/fd/${descriptor.fd}"
      val renderer = PdfiumDocument.open(path).first ?: PlatformDocument(PdfRenderer(descriptor))
      pdfDescriptor = descriptor; pdfRenderer = renderer; pdfKey = key
      return renderer
    } catch (error: Throwable) { if (pdfDescriptor !== descriptor) descriptor.close(); throw error }
  }
  private fun closePdf() {
    idleClose?.cancel(false); idleClose = null
    runCatching { pdfRenderer?.close() }; pdfRenderer = null
    runCatching { pdfDescriptor?.close() }; pdfDescriptor = null
    pdfKey = ""
  }
  private fun scheduleIdleClose() {
    idleClose?.cancel(false)
    idleClose = runCatching { worker.schedule({ closePdf() }, 15, TimeUnit.SECONDS) }.getOrNull()
  }

  fun render(context: Context, id: String, uri: String, kind: String, pageIndex: Int, outputUri: String, promise: Promise) {
    jobs.submit(worker, id, promise) { cancelled ->
      var bitmap: Bitmap? = null
      var output: File? = null
      var committed = false
      fun check() { check(!cancelled.get()) { "Thumbnail cancelled." } }
      try {
        check()
        val inputUrl = Uri.parse(uri)
        val targetUrl = Uri.parse(outputUri)
        require((inputUrl.scheme == "file" || inputUrl.scheme == "content") && targetUrl.scheme == "file")
        val target = File(requireNotNull(targetUrl.path)).canonicalFile
        require(target.parentFile?.canonicalPath == File(context.cacheDir, "versara-thumbnails").canonicalPath && !target.exists())
        output = target
        target.parentFile?.mkdirs()
        bitmap = when (kind) {
          "pdf" -> try {
            val pdf = pdfFor(context, inputUrl)
            require(pageIndex in 0 until pdf.pageCount)
            val (pageWidth, pageHeight) = pdf.size(pageIndex)
            val scale = 240.0 / max(pageWidth, pageHeight)
            val image = Bitmap.createBitmap(max(1, (pageWidth * scale).toInt()), max(1, (pageHeight * scale).toInt()), Bitmap.Config.ARGB_8888)
            try { image.eraseColor(Color.WHITE); pdf.render(pageIndex, image, android.graphics.Rect(0, 0, image.width, image.height), scale.toFloat(), 0f); image }
            catch (error: Throwable) { image.recycle(); throw error }
          } catch (error: Throwable) { closePdf(); throw error } finally { scheduleIdleClose() }
          "video", "audio" -> {
            val retriever = MediaMetadataRetriever()
            try {
              retriever.setDataSource(context, inputUrl)
              if (kind == "video") {
                if (Build.VERSION.SDK_INT >= 27) retriever.getScaledFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 240, 240)
                else null // Older APIs cannot bound frame decoding; use the video icon.
              } else {
                val bytes = retriever.embeddedPicture
                if (bytes == null || bytes.size > 2 * 1024 * 1024) null else {
                  val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                  BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                  options.inSampleSize = 1
                  while (max(options.outWidth, options.outHeight) / options.inSampleSize > 480) options.inSampleSize *= 2
                  options.inJustDecodeBounds = false
                  BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                }
              }
            } finally { retriever.release() }
          }
          else -> null
        }
        check()
        val image = bitmap ?: error("No thumbnail available.")
        target.outputStream().use { require(image.compress(Bitmap.CompressFormat.JPEG, 80, it)) }
        check()
        committed = true
        promise.resolve(outputUri)
      } catch (error: OutOfMemoryError) { promise.reject("THUMBNAIL_UNAVAILABLE", "Preview unavailable.", null) }
      catch (error: Exception) { promise.reject("THUMBNAIL_UNAVAILABLE", "Preview unavailable.", error) }
      finally { bitmap?.recycle(); if (!committed) output?.delete() }
    }
  }
}

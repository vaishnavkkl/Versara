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
import expo.modules.kotlin.Promise
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.max

/** Small, on-demand thumbnails. Never load whole PDFs or send pixels over JS. */
internal class FileThumbnailer {
  private val worker = Executors.newSingleThreadExecutor()
  private val jobs = PdfJobRegistry()
  fun cancel(id: String) = jobs.cancel(id)
  fun destroy() = jobs.destroy(worker)

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
        require(inputUrl.scheme == "file" && targetUrl.scheme == "file")
        val input = File(requireNotNull(inputUrl.path)).canonicalFile
        val target = File(requireNotNull(targetUrl.path)).canonicalFile
        require(input.path.startsWith(context.cacheDir.canonicalPath + "/") || input.path.startsWith(context.filesDir.canonicalPath + "/"))
        require(target.parentFile?.canonicalPath == File(context.cacheDir, "versara-thumbnails").canonicalPath && !target.exists())
        output = target
        target.parentFile?.mkdirs()
        bitmap = when (kind) {
          "pdf" -> ParcelFileDescriptor.open(input, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
            PdfRenderer(descriptor).use { pdf ->
              require(pageIndex in 0 until pdf.pageCount)
              pdf.openPage(pageIndex).use { page ->
                val scale = 240.0 / max(page.width, page.height)
                val image = Bitmap.createBitmap(max(1, (page.width * scale).toInt()), max(1, (page.height * scale).toInt()), Bitmap.Config.ARGB_8888)
                try { image.eraseColor(Color.WHITE); page.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY); image }
                catch (error: Throwable) { image.recycle(); throw error }
              }
            }
          }
          "video", "audio" -> {
            val retriever = MediaMetadataRetriever()
            try {
              retriever.setDataSource(input.path)
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

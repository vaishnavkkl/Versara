package expo.modules.pdfengine

import android.content.Context
import android.net.Uri
import androidx.annotation.Keep
import expo.modules.kotlin.Promise
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

@Keep
class NativeTextEditor(private val cancelled: () -> Boolean, private val onProgress: (Int, Int) -> Unit) {
  companion object { init { System.loadLibrary("versara_pdf_editor") } }
  external fun run(request: String, cache: String, documents: String): String
  fun isCancelled() = cancelled()
  fun progress(completed: Int, total: Int) = onProgress(completed, total)
}

class PdfTextEditor {
  private val worker = Executors.newSingleThreadExecutor()
  private val jobs = PdfJobRegistry()
  fun cancel(id: String) { jobs.cancel(id) }
  fun destroy() { jobs.destroy(worker) }
  fun run(context: Context, id: String, request: String, promise: Promise, progress: (Int, Int) -> Unit) {
    jobs.submit(worker, id, promise) { cancelled ->
      var searchCopy: File? = null
      var searching = false
      try {
        val options = JSONObject(request)
        searching = options.getString("action") == "search" || options.getString("action") == "find_text"
        fun path(key: String, output: String) {
          val uri = Uri.parse(options.getString(key))
          if (searching && key == "uri" && uri.scheme == "content") {
            val copy = File.createTempFile("pdf-search-", ".pdf", context.cacheDir)
            searchCopy = copy
            context.contentResolver.openInputStream(uri)?.use { source -> copy.outputStream().use { target ->
              val buffer = ByteArray(64 * 1024)
              var bytes = 0L
              while (true) {
                check(!cancelled.get()) { "Search cancelled." }
                val count = source.read(buffer); if (count < 0) break
                bytes += count
                require(bytes <= 512L * 1024 * 1024) { "Search a PDF smaller than 512 MB on this device." }
                target.write(buffer, 0, count)
              }
            } } ?: error("This document is no longer available.")
            options.put(output, copy.canonicalPath)
            return
          }
          require(uri.scheme == "file") { "Choose a local PDF." }
          options.put(output, uri.path ?: error("Invalid file location."))
        }
        path("uri", "path")
        if (!searching) { if (options.getString("action") == "preview") path("imageUri", "imagePath") else path("outputUri", "outputPath") }
        val native = NativeTextEditor({ cancelled.get() }, progress)
        // Expo Paths.document is Context.filesDir on Android.
        val result = JSONObject(native.run(options.toString(), context.cacheDir.canonicalPath, context.filesDir.canonicalPath))
        if (result.has("error")) promise.reject(result.getString("code"), result.getString("error"), null)
        else {
          if (options.getString("action") == "save") result.put("uri", options.getString("outputUri"))
          else if (!searching) result.put("imageUri", options.getString("imageUri"))
          promise.resolve(result.toString())
        }
      } catch (error: OutOfMemoryError) {
        promise.reject("PDF_MEMORY_LIMIT", if (searching) "This PDF is too complex to search on this device." else "This page is too large to edit on this device.", error)
      } catch (error: Throwable) {
        promise.reject(if (cancelled.get()) "PDF_CANCELLED" else "PDF_EDIT_FAILED", if (searching) error.message ?: "This PDF could not be searched." else "Could not open the native editor. Install the latest development build and choose the PDF again.", error)
      } finally { searchCopy?.delete() }
    }
  }
}

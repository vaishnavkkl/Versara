package expo.modules.pdfengine

import android.content.Context
import android.net.Uri
import androidx.annotation.Keep
import expo.modules.kotlin.Promise
import org.json.JSONObject
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
      try {
        val options = JSONObject(request)
        fun path(key: String, output: String) {
          val uri = Uri.parse(options.getString(key))
          require(uri.scheme == "file") { "Choose a local PDF." }
          options.put(output, uri.path ?: error("Invalid file location."))
        }
        path("uri", "path")
        if (options.getString("action") == "preview") path("imageUri", "imagePath") else path("outputUri", "outputPath")
        val native = NativeTextEditor({ cancelled.get() }, progress)
        // Expo Paths.document is Context.filesDir on Android.
        val result = JSONObject(native.run(options.toString(), context.cacheDir.canonicalPath, context.filesDir.canonicalPath))
        if (result.has("error")) promise.reject(result.getString("code"), result.getString("error"), null)
        else {
          if (options.getString("action") == "save") result.put("uri", options.getString("outputUri"))
          else result.put("imageUri", options.getString("imageUri"))
          promise.resolve(result.toString())
        }
      } catch (error: OutOfMemoryError) {
        promise.reject("PDF_MEMORY_LIMIT", "This page is too large to edit on this device.", error)
      } catch (error: Throwable) {
        promise.reject("PDF_EDIT_FAILED", "Could not open the native editor. Install the latest development build and choose the PDF again.", error)
      }
    }
  }
}

package expo.modules.pdfengine

import android.content.Context
import org.json.JSONObject
import java.io.File

/** Shared PDFium preflight for every worker that rewrites document content. */
internal object PdfIntegrity {
  fun requireUnsigned(context: Context, file: File, password: String = "", check: () -> Unit = {}) {
    check()
    val result = JSONObject(NativeTextEditor({ false }, { _, _ -> }).run(
      JSONObject().put("action", "inspect").put("path", file.canonicalPath).put("inputPassword", password).toString(),
      context.cacheDir.canonicalPath, context.filesDir.canonicalPath))
    check()
    require(!result.has("error")) { result.optString("error", "Could not inspect this PDF safely.") }
    require(result.getInt("signatureCount") == 0) { "This PDF is digitally signed. Use an unsigned copy to preserve its signatures." }
  }
}

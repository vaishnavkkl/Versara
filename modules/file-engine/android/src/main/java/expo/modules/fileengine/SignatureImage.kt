package expo.modules.fileengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import org.json.JSONObject
import java.io.File
import java.io.DataOutputStream
import kotlin.math.*

/** Bounded, upright signature assets. Pixels remain native and never cross JS. */
internal object SignatureImage {
  fun process(context: Context, r: JSONObject, check: () -> Unit): Map<String, Any> {
    fun local(value: String): File {
      val uri = Uri.parse(value); require(uri.scheme == "file") { "Choose a local signature image." }
      return File(requireNotNull(uri.path)).canonicalFile.also {
        require(it.path.startsWith(context.cacheDir.canonicalPath + "/") || it.path.startsWith(context.filesDir.canonicalPath + "/")) { "Choose the image again." }
      }
    }
    val input = local(r.getString("uri")); val output = local(r.getString("outputUri"))
    val raw = File(output.path + ".bgra"); val temp = File(output.path + ".partial")
    require(!output.exists() && !raw.exists() && !temp.exists()) { "Choose a new signature asset name." }
    val remove = r.optBoolean("removeBackground", false)
    check()
    val decoded = ImageProcessing.decode(context, Uri.fromFile(input), 1024)
    val bitmap = try { decoded.copy(Bitmap.Config.ARGB_8888, true) ?: error("Could not prepare the signature.") } finally { decoded.recycle() }
    var committed = false
    try {
      // JPEG decodes are opaque. ARGB_8888 alone does not enable alpha writes.
      bitmap.setHasAlpha(true)
      val w = bitmap.width; val h = bitmap.height
      require(w in 1..1024 && h in 1..1024) { "Signature image is too large." }
      DataOutputStream(raw.outputStream().buffered()).use { stream ->
        stream.writeInt(w); stream.writeInt(h)
        val row = IntArray(w)
        for (y in 0 until h) {
          check(); bitmap.getPixels(row, 0, w, 0, y, w, 1)
          for (x in row.indices) {
            val pixel = row[x]; val a = Color.alpha(pixel); var red = Color.red(pixel); var green = Color.green(pixel); var blue = Color.blue(pixel)
            val coverage = if (remove) ((.94 - minOf(red,green,blue)/255.0)/.30).coerceIn(0.0,1.0) else 1.0
            val alpha = (a*coverage).roundToInt()
            if (remove && coverage > 0) {
              fun ink(v: Int) = ((v-255*(1-coverage))/coverage).roundToInt().coerceIn(0,255)
              red=ink(red); green=ink(green); blue=ink(blue)
            }
            if (alpha == 0) { red=0; green=0; blue=0 }
            row[x] = Color.argb(alpha,red,green,blue)
            stream.writeByte(blue); stream.writeByte(green); stream.writeByte(red); stream.writeByte(alpha)
          }
          bitmap.setPixels(row,0,w,0,y,w,1)
        }
      }
      check(); temp.outputStream().use { require(bitmap.compress(Bitmap.CompressFormat.PNG,100,it)) { "Could not save the signature image." } }
      check(); require(temp.renameTo(output)) { "Could not save the signature image." }; check(); committed=true
      return mapOf("uri" to Uri.fromFile(output).toString(), "pixelPath" to raw.path, "width" to w, "height" to h, "size" to output.length(), "mimeType" to "image/png")
    } finally { bitmap.recycle(); temp.delete(); if (!committed) { output.delete(); raw.delete() } }
  }
}

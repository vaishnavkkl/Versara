package expo.modules.pdfengine

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.pdf.PdfRenderer
import androidx.annotation.Keep
import java.io.Closeable
import kotlin.math.max

/** A page source for the reader. Sizes are in PDF points with page rotation applied. */
internal interface ReaderDocument : Closeable {
  val pageCount: Int
  fun size(index: Int): Pair<Double, Double>
  /** Draws page `index` over `bitmap` at `scale` pixels per point, offset by `left`, inside `clip`. */
  fun render(index: Int, bitmap: Bitmap, clip: Rect, scale: Float, left: Float)
}

@Keep
internal object PdfiumReaderNative {
  init { System.loadLibrary("versara_pdf_editor") }
  external fun open(path: String, password: String, error: IntArray): Long
  external fun close(doc: Long)
  external fun pageCount(doc: Long): Int
  external fun pageSize(doc: Long, index: Int, size: DoubleArray): Boolean
  external fun render(doc: Long, index: Int, bitmap: Bitmap, scale: Float, left: Float, top: Float, clip: FloatArray): Boolean
}

/** PDFium also draws annotations (ink signatures, highlights, stamps); Android's PdfRenderer does not. */
internal class PdfiumDocument private constructor(private var handle: Long) : ReaderDocument {
  companion object {
    const val PASSWORD_ERROR = 4
    /** Returns the document, or null with PDFium's error code. */
    fun open(path: String, password: String = ""): Pair<PdfiumDocument?, Int> {
      val error = IntArray(1)
      val handle = try { PdfiumReaderNative.open(path, password, error) } catch (_: UnsatisfiedLinkError) { return null to -1 }
      return if (handle == 0L) null to error[0] else PdfiumDocument(handle) to 0
    }
  }
  override val pageCount = PdfiumReaderNative.pageCount(handle)
  override fun size(index: Int): Pair<Double, Double> {
    val size = DoubleArray(2)
    if (!PdfiumReaderNative.pageSize(handle, index, size)) throw IllegalStateException("Page size unavailable")
    return size[0] to size[1]
  }
  override fun render(index: Int, bitmap: Bitmap, clip: Rect, scale: Float, left: Float) {
    val area = floatArrayOf(clip.left.toFloat(), clip.top.toFloat(), clip.right.toFloat(), clip.bottom.toFloat())
    if (!PdfiumReaderNative.render(handle, index, bitmap, scale, left, 0f, area)) throw IllegalStateException("Page render failed")
  }
  override fun close() {
    val current = handle
    handle = 0L
    if (current != 0L) PdfiumReaderNative.close(current)
  }
}

/** First-page thumbnails with annotations for the file-engine list, which loads this class by name. */
@Keep
object PdfPageThumbnails {
  @JvmStatic
  fun render(path: String, size: Int): Bitmap? {
    val document = PdfiumDocument.open(path).first ?: return null
    return document.use {
      if (it.pageCount == 0) return@use null
      val (pageWidth, pageHeight) = it.size(0)
      val scale = size / max(pageWidth, pageHeight)
      val bitmap = Bitmap.createBitmap(max(1, (pageWidth * scale).toInt()), max(1, (pageHeight * scale).toInt()), Bitmap.Config.ARGB_8888)
      try { bitmap.eraseColor(Color.WHITE); it.render(0, bitmap, Rect(0, 0, bitmap.width, bitmap.height), scale.toFloat(), 0f); bitmap }
      catch (error: Throwable) { bitmap.recycle(); throw error }
    }
  }
}

/** Fallback for files PDFium cannot open by path, such as non-seekable provider streams. */
internal class PlatformDocument(private val renderer: PdfRenderer) : ReaderDocument {
  override val pageCount get() = renderer.pageCount
  override fun size(index: Int) = renderer.openPage(index).use { it.width.toDouble() to it.height.toDouble() }
  override fun render(index: Int, bitmap: Bitmap, clip: Rect, scale: Float, left: Float) {
    renderer.openPage(index).use { page ->
      val transform = Matrix().apply { postScale(scale, scale); postTranslate(left, 0f) }
      page.render(bitmap, clip, transform, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
    }
  }
  override fun close() = renderer.close()
}

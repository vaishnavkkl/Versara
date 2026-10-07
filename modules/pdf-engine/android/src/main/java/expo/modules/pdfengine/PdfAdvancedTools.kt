package expo.modules.pdfengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.net.Uri
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.*
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject
import com.tom_roush.pdfbox.pdmodel.graphics.state.PDExtendedGraphicsState
import com.tom_roush.pdfbox.rendering.PDFRenderer
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import com.tom_roush.pdfbox.util.Matrix
import com.googlecode.tesseract.android.TessBaseAPI
import expo.modules.kotlin.Promise
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.*

/** All parsing, rendering, OCR and writes stay on one bounded native worker. */
class PdfAdvancedTools {
  private val worker = Executors.newSingleThreadExecutor()
  private val jobs = PdfJobRegistry()
  private val recognitionLock = Any()
  private val recognizers = mutableMapOf<String, TessBaseAPI>()
  fun cancel(id: String) { jobs.cancel(id); synchronized(recognitionLock) { recognizers[id]?.stop() } }
  fun destroy() { synchronized(recognitionLock) { recognizers.values.forEach { it.stop() } }; jobs.destroy(worker) }
  private fun local(context: Context, uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file" && parsed.path != null) { "Choose a local PDF." }
    return File(parsed.path!!).canonicalFile.also {
      require(it.path.startsWith(context.cacheDir.canonicalPath + File.separator) && it.isFile) { "Choose the PDF again." }
    }
  }
  private class TextFound : RuntimeException()
  private fun hasSelectableText(pdf: PDDocument, number: Int, check: () -> Unit): Boolean {
    // Stop at the first non-whitespace glyph instead of allocating a page string.
    check()
    var positions = 0
    var examined = 0
    val detector = object : PDFTextStripper() {
      override fun processTextPosition(text: TextPosition) {
        if (positions++ % 64 == 0) check()
        if (!text.unicode.isNullOrBlank()) throw TextFound()
        examined += max(1, text.unicode?.length?.coerceAtMost(100_001) ?: 1)
        // Match iOS's bounded probe: retain an exceptionally large existing
        // layer conservatively instead of walking an unbounded whitespace run.
        if (examined > 100_000) throw TextFound()
      }
    }.apply { startPage = number + 1; endPage = number + 1 }
    val found = try { detector.getText(pdf); false } catch (_: TextFound) { true }
    check()
    return found
  }
  private fun memory(context: Context) = MemoryUsageSetting.setupTempFileOnly().setTempDir(context.cacheDir)
  fun run(context: Context, id: String, request: String, promise: Promise, progress: (Int, Int) -> Unit) {
    jobs.submit(worker, id, promise) { cancelled ->
      val staged = mutableListOf<Pair<File, File>>()
      val committed = mutableListOf<File>()
      try {
        val check = { check(!cancelled.get()) { "PDF_CANCELLED" } }
        check()
        require(request.length <= 2_000_000) { "Too many annotations. Save your changes first." }
        val r = JSONObject(request)
        val op = r.getString("operation")
        require(op in setOf("info", "preview", "estimate", "duplicate", "insert", "compress", "to_image", "highlight", "draw", "shapes", "sign", "watermark", "numbers", "protect", "metadata", "redact", "flatten", "ocr", "extract_text", "repair")) { "Unknown PDF tool." }
        PDFBoxResourceLoader.init(context.applicationContext)
        val input = local(context, r.getString("uri"))
        val password = r.optString("inputPassword")
        PDDocument.load(input, password, memory(context)).use { pdf ->
          val count = pdf.numberOfPages
          require(count in 1..2000) { "Choose a PDF with 1 to 2,000 pages." }
          val p = r.optJSONArray("pages") ?: JSONArray()
          val pages = if (p.length() == 0) (0 until count).toList() else (0 until p.length()).map { p.getInt(it) - 1 }
          require(pages.size <= 2000 && pages.all { it in 0 until count } && pages.distinct().size == pages.size) { "Choose valid, unique page numbers." }
          val permission = pdf.currentAccessPermission
          // Reading text never changes the PDF, so it needs only extraction rights, not edit rights or an unsigned file.
          val readsText = op == "extract_text" || (op == "ocr" && r.optString("ocrFormat", "text") == "text")
          val textPreview = readsText && r.optBoolean("textPreview", false)
          if (readsText) {
            require(permission.canExtractContent()) { "This PDF does not allow copying its text." }
            require(!textPreview || pages.size == 1) { "Preview the text of one page at a time." }
          } else if (op !in setOf("info", "preview")) {
            require(permission.canModify() && permission.canExtractContent() && permission.canAssembleDocument()) { "This PDF restricts editing or extraction. Use an unrestricted copy." }
            require(pdf.signatureDictionaries.isEmpty()) { "This PDF is digitally signed. Use an unsigned copy to preserve its signatures." }
            PdfIntegrity.requireUnsigned(context, input, password, check)
          }
          // A PDFBox full rewrite cannot retain the loaded encryption policy
          // without replacing credentials. Never silently remove protection.
          require(!pdf.isEncrypted || op in setOf("info", "preview", "estimate", "compress", "to_image", "ocr", "extract_text", "protect")) {
            "This tool cannot preserve this PDF's existing encryption. Use an explicitly unlocked copy; the protected original is unchanged."
          }
          if (op == "info") {
            val box = pdf.getPage(0).cropBox
            val info = pdf.documentInformation
            promise.resolve(JSONObject().put("info", JSONObject().put("pageCount", count).put("size", input.length()).put("width", box.width).put("height", box.height).put("version", pdf.version.toString()).put("encrypted", pdf.isEncrypted).put("title", info.title ?: "").put("author", info.author ?: "").put("subject", info.subject ?: "").put("creator", info.creator ?: "").put("producer", info.producer ?: "")).toString())
            return@submit
          }
          fun output(index: Int, preview: Boolean = false): File {
            val uri = Uri.parse(r.getJSONArray("outputUris").getString(index))
            require(uri.scheme == "file" && uri.path != null) { "Invalid output location." }
            val file = File(uri.path!!).canonicalFile
            val root = File(context.filesDir, "Versara PDFs").canonicalFile
            require(if (preview) file.path.startsWith(context.cacheDir.canonicalPath + File.separator) else file.parentFile == root) { "Invalid output location." }
            file.parentFile!!.mkdirs()
            require(!file.exists() && staged.none { it.second == file }) { "Choose a new output name." }
            val partial = File(file.parentFile, file.name + ".partial")
            require(!partial.exists()) { "This output is already being created." }
            staged.add(partial to file)
            return partial
          }
          val quality = r.optString("quality", "balanced")
          require(quality in setOf("max", "balanced", "small")) { "Invalid quality." }
          val dpi = when (quality) { "max" -> 160f; "small" -> 85f; else -> 120f }
          val jpegQuality = when (quality) { "max" -> .92f; "small" -> .48f; else -> .72f }
          val renderer = PDFRenderer(pdf)
          fun render(page: Int, requestedDpi: Float = dpi): Bitmap {
            check()
            val box = pdf.getPage(page).cropBox
            val pixels = if (Runtime.getRuntime().maxMemory() < 256L * 1024 * 1024) 1_500_000f else 3_000_000f
            val scale = min(min(requestedDpi / 72, sqrt(pixels / (box.width * box.height).coerceAtLeast(1f))), 4096f / max(box.width, box.height))
            require(scale.isFinite() && scale > 0 && box.width > 0 && box.height > 0) { "This PDF has invalid page dimensions." }
            val bitmap = renderer.renderImage(page, scale)
            try { check(); return bitmap }
            catch (error: Throwable) { bitmap.recycle(); throw error }
          }
          val outputs = JSONArray()
          var outputCount = count
          var ocrSummary: JSONObject? = null
          when (op) {
            "preview", "to_image" -> {
              val selected = if (op == "preview") listOf(pages.first()) else pages
              require(selected.size <= 100) { "Export up to 100 images at a time." }
              require(r.getJSONArray("outputUris").length() == selected.size) { "Choose one output per page." }
              val format = r.optString("format", "png")
              require(format in setOf("png", "jpg")) { "Choose JPG or PNG." }
              selected.forEachIndexed { index, page ->
                val bitmap = render(page, if (op == "preview") 110f else dpi)
                try { output(index, op == "preview").outputStream().use { require(bitmap.compress(if (format == "jpg") Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG, (jpegQuality * 100).toInt(), it)) { "Could not write image." } } }
                finally { bitmap.recycle() }
                progress(index + 1, selected.size)
              }
            }
            "estimate" -> {
              // Raster-page samples do not estimate embedded-image optimization.
              // The original-byte fallback makes the source size an upper bound.
              check(); promise.resolve(JSONObject().put("estimatedSize", input.length()).put("estimateKind", "upperBound").toString()); return@submit
            }
            "extract_text", "ocr" -> {
              val tess = if (op == "ocr") TessBaseAPI() else null
              // PDFium decodes the JBIG2/JPEG 2000 images common in scans, which PDFBox can render blank.
              // Tesseract reads best near 300 DPI, so OCR gets a larger, memory-bounded budget than previews.
              val ocrDocument = if (tess != null) PdfiumDocument.open(input.canonicalPath, password).first else null
              val ocrPixels = if (Runtime.getRuntime().maxMemory() < 256L * 1024 * 1024) 4_000_000.0 else 8_000_000.0
              fun recognizeImage(page: Int): Bitmap {
                check()
                if (ocrDocument != null) {
                  val (width, height) = ocrDocument.size(page)
                  require(width > 0 && height > 0 && width.isFinite() && height.isFinite()) { "This PDF has invalid page dimensions." }
                  val scale = min(min(300.0 / 72, sqrt(ocrPixels / (width * height))), 6000.0 / max(width, height))
                  val bitmap = Bitmap.createBitmap(max(1, (width * scale).toInt()), max(1, (height * scale).toInt()), Bitmap.Config.ARGB_8888)
                  try {
                    bitmap.eraseColor(Color.WHITE)
                    ocrDocument.render(page, bitmap, Rect(0, 0, bitmap.width, bitmap.height), scale.toFloat(), 0f)
                    tess!!.setVariable("user_defined_dpi", (scale * 72).roundToInt().coerceIn(70, 2400).toString())
                    check(); return bitmap
                  } catch (error: Throwable) { bitmap.recycle(); throw error }
                }
                val bitmap = render(page, 300f)
                val source = pdf.getPage(page)
                val pageWidth = if (source.rotation % 180 != 0) source.cropBox.height else source.cropBox.width
                tess!!.setVariable("user_defined_dpi", (bitmap.width * 72.0 / max(1f, pageWidth)).roundToInt().coerceIn(70, 2400).toString())
                return bitmap
              }
              try {
                if (tess != null) {
                  val root = File(context.filesDir, "versara-ocr")
                  val data = File(root, "tessdata/eng.traineddata")
                  if (!data.isFile) { data.parentFile!!.mkdirs(); val temp = File(data.parentFile, "eng.partial"); try { context.assets.open("tessdata/eng.traineddata").use { from -> temp.outputStream().use { from.copyTo(it) } }; check(temp.renameTo(data)) { "Could not prepare offline OCR." } } finally { temp.delete() } }
                  require(tess.init(root.path, "eng")) { "Offline OCR data could not be loaded." }
                  tess.pageSegMode = TessBaseAPI.PageSegMode.PSM_AUTO
                  tess.setVariable("preserve_interword_spaces", "1")
                  synchronized(recognitionLock) { check(); recognizers[id] = tess }
                }
                val searchable = op == "ocr" && r.optString("ocrFormat", "text") == "pdf"
                require(r.optString("ocrFormat", "text") in setOf("text", "pdf")) { "Choose text or searchable PDF output." }
                if (searchable) {
                  require(pages.size <= 100) { "Recognize up to 100 pages at a time." }
                  val recognized = JSONArray()
                  var totalWords = 0
                  pages.forEachIndexed { index, page ->
                    check()
                    val hasText = r.optBoolean("skipExistingText", true) && hasSelectableText(pdf, page, check)
                    val words = JSONArray()
                    if (!hasText) {
                      val bitmap = recognizeImage(page)
                      try {
                        tess!!.setImage(bitmap); tess.utF8Text; check()
                        val iterator = tess.resultIterator
                        if (iterator != null) try {
                          val level = TessBaseAPI.PageIteratorLevel.RIL_WORD
                          iterator.begin()
                          do {
                            check()
                            val text = iterator.getUTF8Text(level)?.trim().orEmpty()
                            val box = iterator.getBoundingBox(level) ?: continue
                            if (text.isEmpty() || box.size < 4) continue
                            require(text.length <= 256 && !text.any { it == '\n' || it == '\r' || it == '\t' }) { "An OCR word cannot be placed safely. Export text instead." }
                            val l = box[0].coerceIn(0, bitmap.width); val t = box[1].coerceIn(0, bitmap.height)
                            val rr = box[2].coerceIn(0, bitmap.width); val b = box[3].coerceIn(0, bitmap.height)
                            if (rr <= l || b <= t) continue
                            require(words.length() < 2000 && totalWords < 20000) { "Too much OCR text. Choose fewer pages." }
                            words.put(JSONObject().put("text", text).put("x", l.toDouble() / bitmap.width).put("y", t.toDouble() / bitmap.height).put("width", (rr - l).toDouble() / bitmap.width).put("height", (b - t).toDouble() / bitmap.height))
                            totalWords++
                          } while (iterator.next(level))
                        } finally { iterator.delete() }
                      } finally { tess!!.clear(); bitmap.recycle() }
                    }
                    recognized.put(JSONObject().put("page", page).put("words", words).put("skipped", hasText))
                    progress(index + 1, pages.size + 1)
                  }
                  check()
                  val target = output(0)
                  val request = JSONObject().put("action", "ocr_save").put("path", input.canonicalPath).put("outputPath", target.canonicalPath).put("inputPassword", password).put("ocrPages", recognized)
                  val response = JSONObject(NativeTextEditor({ cancelled.get() }, { _, _ -> }).run(request.toString(), context.cacheDir.canonicalPath, context.filesDir.canonicalPath))
                  require(!response.has("error")) { response.optString("error", "Could not create a searchable PDF.") }
                  ocrSummary = response
                  check(); progress(pages.size + 1, pages.size + 1)
                } else output(0, textPreview).bufferedWriter(Charsets.UTF_8).use { writer ->
                  pages.forEachIndexed { index, page ->
                    check(); writer.write("--- Page ${page + 1} ---\n")
                    val text = if (tess == null) PDFTextStripper().apply { startPage = page + 1; endPage = page + 1; sortByPosition = true }.getText(pdf) else {
                      val bitmap = recognizeImage(page)
                      try { tess.setImage(bitmap); tess.utF8Text ?: "" } finally { tess.clear(); bitmap.recycle() }
                    }
                    writer.write(text); writer.write("\n\n"); check(); progress(index + 1, pages.size)
                  }
                }
              } finally { synchronized(recognitionLock) { recognizers.remove(id); tess?.recycle() }; ocrDocument?.close() }
            }
            "compress" -> {
              if (pdf.isEncrypted) input.copyTo(output(0))
              else {
                if (quality != "max") optimizeImages(pdf, quality, check, progress)
                check(); pdf.save(output(0))
              }
            }
            "redact" -> {
              val regions = r.getJSONArray("rects")
              require(regions.length() in 1..3000) { "Choose between 1 and 3,000 covers." }
              val covers = (0 until regions.length()).map { index ->
                val rect = regions.getJSONObject(index)
                val page = rect.getInt("page")
                val x = rect.getDouble("x"); val y = rect.getDouble("y")
                val w = rect.getDouble("width"); val h = rect.getDouble("height")
                require(page in 1..count && listOf(x,y,w,h).all { it.isFinite() } && x >= 0 && y >= 0 && w > 0 && h > 0 && x+w <= 1.000001 && y+h <= 1.000001) { "Invalid redaction region." }
                page to doubleArrayOf(x,y,w,h)
              }.groupBy({ it.first }, { it.second })
              // A new document receives only already-redacted pixels: no source
              // text, cropped content, attachments, annotations or object history.
              PDDocument(memory(context)).use { result ->
                for (page in 0 until count) {
                  val bitmap = render(page, 160f)
                  try {
                    val canvas = android.graphics.Canvas(bitmap)
                    val paint = android.graphics.Paint().apply { color = android.graphics.Color.BLACK; isAntiAlias = false }
                    for (rect in covers[page + 1].orEmpty()) {
                      check()
                      val left = floor(rect[0]*bitmap.width).toInt().coerceIn(0, bitmap.width)
                      val top = floor(rect[1]*bitmap.height).toInt().coerceIn(0, bitmap.height)
                      val right = ceil((rect[0]+rect[2])*bitmap.width).toInt().coerceIn(0, bitmap.width)
                      val bottom = ceil((rect[1]+rect[3])*bitmap.height).toInt().coerceIn(0, bitmap.height)
                      canvas.drawRect(left.toFloat(), top.toFloat(), right.toFloat(), bottom.toFloat(), paint)
                    }
                    val original = pdf.getPage(page); val box = original.cropBox; val rotated = original.rotation % 180 != 0
                    val dest = PDPage(PDRectangle(if (rotated) box.height else box.width, if (rotated) box.width else box.height)); result.addPage(dest)
                    PDPageContentStream(result, dest).use { stream -> stream.drawImage(com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory.createFromImage(result, bitmap), 0f, 0f, dest.mediaBox.width, dest.mediaBox.height) }
                  } finally { bitmap.recycle() }
                  check(); progress(page + 1, count)
                }
                check(); result.save(output(0, true))
              }
            }
            "flatten" -> {
              PDDocument(memory(context)).use { result ->
                for (page in 0 until count) {
                  val bitmap = render(page, 160f)
                  try {
                    val original = pdf.getPage(page); val box = original.cropBox; val rotated = original.rotation % 180 != 0
                    val dest = PDPage(PDRectangle(if (rotated) box.height else box.width, if (rotated) box.width else box.height)); result.addPage(dest)
                    PDPageContentStream(result, dest).use { stream -> stream.drawImage(JPEGFactory.createFromImage(result, bitmap, .95f), 0f, 0f, dest.mediaBox.width, dest.mediaBox.height) }
                  } finally { bitmap.recycle() }
                  check(); progress(page + 1, count)
                }
                result.save(output(0))
              }
            }
            else -> {
              when (op) {
                "duplicate" -> {
                  require(count + pages.size <= 2000) { "Keep the result below 2,001 pages." }
                  // Copy into this document, detach the appended page, then insert next to its original.
                  val originals = pages.sortedDescending().map { pdf.getPage(it) }
                  originals.forEachIndexed { index, page -> val copy = pdf.importPage(page); copy.resources = page.resources; copy.cropBox = page.cropBox; copy.mediaBox = page.mediaBox; copy.rotation = page.rotation; pdf.removePage(copy); pdf.pages.insertAfter(copy, page); check(); progress(index + 1, originals.size) }
                }
                "insert" -> {
                  val position = r.optInt("position", count)
                  require(position in 0..count) { "Choose an insertion position from 0 to $count." }
                  require(count < 2000) { "Keep the result below 2,001 pages." }
                  val source = r.optString("insertUri")
                  if (source.isEmpty()) {
                    val original = pdf.getPage(max(0, position - 1))
                    val box = original.mediaBox
                    val blank = PDPage(box)
                    blank.rotation = original.rotation
                    if (position == count) pdf.addPage(blank) else pdf.pages.insertBefore(blank, pdf.getPage(position))
                  } else PDDocument.load(local(context, source), memory(context)).use { other ->
                    require(!other.isEncrypted && other.currentAccessPermission.canAssembleDocument() && count + other.numberOfPages <= 2000) { "Choose an unrestricted PDF; keep the result below 2,001 pages." }
                    PdfIntegrity.requireUnsigned(context, local(context, source), check = check)
                    val before = if (position < count) pdf.getPage(position) else null
                    for (page in other.pages) { val copy = pdf.importPage(page); copy.resources = page.resources; copy.cropBox = page.cropBox; copy.mediaBox = page.mediaBox; copy.rotation = page.rotation; if (before != null) { pdf.removePage(copy); pdf.pages.insertBefore(copy, before) }; check() }
                    // Save while imported resources are still alive.
                    pdf.save(output(0))
                  }
                }
                "metadata" -> {
                  pdf.documentInformation = PDDocumentInformation()
                  pdf.documentCatalog.metadata = null
                  // Remove XMP streams on pages and nested image/form resources as well.
                  val visited = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<com.tom_roush.pdfbox.cos.COSBase, Boolean>())
                  fun scrub(value: com.tom_roush.pdfbox.cos.COSBase?, depth: Int = 0) {
                    if (value == null || !visited.add(value)) return
                    check(); require(visited.size <= 500_000 && depth <= 128) { "PDF is too complex to sanitize on this device." }
                    when (value) {
                      is com.tom_roush.pdfbox.cos.COSObject -> scrub(value.`object`, depth + 1)
                      is com.tom_roush.pdfbox.cos.COSDictionary -> { value.removeItem(COSName.METADATA); value.values.toList().forEach { scrub(it, depth + 1) } }
                      is com.tom_roush.pdfbox.cos.COSArray -> value.forEach { scrub(it, depth + 1) }
                    }
                  }
                  scrub(pdf.documentCatalog.cosObject)
                }
                "protect" -> {
                  val secret = r.getString("password")
                  require(secret.length in 6..64 && secret.all { it.code in 32..126 }) { "Use 6–64 printable English letters, numbers or symbols." }
                  pdf.isAllSecurityToBeRemoved = false
                  // The known opening password also grants ownership; no hidden permission lock.
                  pdf.protect(StandardProtectionPolicy(secret, secret, AccessPermission()).apply { encryptionKeyLength = 256; isPreferAES = true })
                }
                "repair" -> { /* PDFBox's lenient parser followed by a full rewrite reconstructs readable structure. */ }
                else -> pages.forEachIndexed { index, number ->
                  check(); val page = pdf.getPage(number)
                  PDPageContentStream(pdf, page, PDPageContentStream.AppendMode.APPEND, true, true).use { stream ->
                    val box = page.cropBox; val rotation = ((page.rotation % 360) + 360) % 360
                    val w = if (rotation % 180 == 0) box.width else box.height
                    val h = if (rotation % 180 == 0) box.height else box.width
                    val matrix = when (rotation) { 90 -> Matrix(0f, 1f, -1f, 0f, box.upperRightX, box.lowerLeftY); 180 -> Matrix(-1f, 0f, 0f, -1f, box.upperRightX, box.upperRightY); 270 -> Matrix(0f, -1f, 1f, 0f, box.lowerLeftX, box.upperRightY); else -> Matrix(1f, 0f, 0f, 1f, box.lowerLeftX, box.lowerLeftY) }
                    stream.transform(matrix)
                    if (op == "watermark" || op == "numbers") {
                      val text = if (op == "numbers") (r.optInt("startNumber", 1) + index).toString() else r.optString("text").trim()
                      require(text.isNotEmpty() && text.length <= 100 && text.all { it.code in 32..126 }) { "Use up to 100 English letters, numbers or symbols." }
                      val size = if (op == "numbers") 11f else min(48f, w * .8f / (PDType1Font.HELVETICA_BOLD.getStringWidth(text) / 1000))
                      stream.setGraphicsStateParameters(PDExtendedGraphicsState().apply { nonStrokingAlphaConstant = if (op == "numbers") 1f else .22f })
                      stream.setNonStrokingColor(40, 50, 70); stream.beginText(); stream.setFont(PDType1Font.HELVETICA_BOLD, size)
                      stream.newLineAtOffset((w - PDType1Font.HELVETICA_BOLD.getStringWidth(text) / 1000 * size) / 2, if (op == "numbers") 18f else h / 2)
                      stream.showText(text); stream.endText()
                    } else drawMarks(stream, r.optJSONArray("marks") ?: JSONArray(), number + 1, w, h, check)
                  }
                  progress(index + 1, pages.size)
                }
              }
              outputCount = pdf.numberOfPages
              if (staged.isEmpty()) { check(); pdf.save(output(0)) }
            }
          }
          // Verify every PDF before making any result visible. Encrypted output is reopened with its new password.
          for ((partial, file) in staged) {
            check(); require(partial.length() > 0) { "The output is empty." }
            if (file.extension.lowercase() == "pdf") PDDocument.load(partial, if (op == "protect") r.getString("password") else password, memory(context)).use { verified ->
              require(verified.numberOfPages == outputCount) { "The saved PDF could not be verified." }
              if (op == "repair") for (index in 0 until outputCount) { check(); val preview = PDFRenderer(verified).renderImage(index, .15f); preview.recycle() }
              if (op == "protect") require(verified.isEncrypted) { "Password protection could not be verified." }
              else require(verified.isEncrypted == pdf.isEncrypted) { "The saved PDF did not preserve its encryption. No output was kept." }
            }
          }
          // Rasterising an already compact/vector PDF can make it larger. Keep
          // the validated source bytes instead of exporting a larger degraded copy.
          if (op == "compress") for ((partial, _) in staged) {
            check(); if (partial.length() >= input.length()) input.copyTo(partial, overwrite = true)
          }
          for ((partial, file) in staged) { check(); require(partial.renameTo(file)) { "Could not save output. Check available storage." }; committed.add(file); outputs.put(JSONObject().put("uri", Uri.fromFile(file)).put("size", file.length()).put("pageCount", outputCount)) }
          val response = JSONObject().put("outputs", outputs)
          if (ocrSummary != null) response.put("ocrSummary", ocrSummary)
          if ((op == "ocr" && r.optString("ocrFormat", "text") == "text") || op == "extract_text") {
            val buffer = ByteArray(16_000)
            val length = committed.first().inputStream().use { it.read(buffer) }
            response.put("textPreview", if (length > 0) String(buffer, 0, length, Charsets.UTF_8) else "")
          }
          check(); promise.resolve(response.toString())
        }
      } catch (error: Throwable) {
        committed.forEach { it.delete() }
        promise.reject(if (cancelled.get()) "PDF_CANCELLED" else "PDF_TOOL_FAILED", if (cancelled.get()) "Operation cancelled." else if (error is OutOfMemoryError) "Not enough memory. Try fewer pages." else error.message ?: "Could not process this PDF.", if (error is Exception) error else null)
      } finally { staged.forEach { it.first.delete() } }
    }
  }
  /** Replace only ordinary opaque RGB/gray image resources, never whole pages.
   * Masks, tagged images, optional-content images and large decodes stay intact.
   * Keeping the original resource is always preferable to losing PDF semantics.
   */
  private fun optimizeImages(pdf: PDDocument, quality: String, check: () -> Unit, progress: (Int, Int) -> Unit) {
    val visited = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<com.tom_roush.pdfbox.cos.COSDictionary, Boolean>())
    val replacements = java.util.IdentityHashMap<com.tom_roush.pdfbox.cos.COSStream, PDImageXObject>()
    val examined = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<com.tom_roush.pdfbox.cos.COSStream, Boolean>())
    val edge = if (quality == "small") 1280 else 2200
    val jpeg = if (quality == "small") .58f else .80f
    val decodePixels = if (Runtime.getRuntime().maxMemory() < 256L * 1024 * 1024) 1_500_000L else 3_000_000L
    fun visit(resources: PDResources?, depth: Int = 0) {
      if (resources == null || depth > 32 || visited.size >= 10_000 || !visited.add(resources.cosObject)) return
      for (name in resources.xObjectNames.toList()) {
        check()
        val item = resources.getXObject(name)
        if (item is PDFormXObject) { visit(item.resources, depth + 1); continue }
        if (item !is PDImageXObject) continue
        val cached = replacements[item.cosObject]
        if (cached != null) { resources.put(name, cached); continue }
        if (examined.size >= 2_000 || !examined.add(item.cosObject)) continue
        val dictionary = item.cosObject
        // Do not turn transparency, masks, accessibility structure or layers
        // into a different representation during ordinary compression.
        if (item.isStencil || item.bitsPerComponent != 8 || item.width <= 0 || item.height <= 0 || item.width.toLong() * item.height > decodePixels) continue
        if (listOf("Mask", "SMask", "SMaskInData", "StructParent", "OC", "Alternates").any { dictionary.containsKey(COSName.getPDFName(it)) }) continue
        if (item.colorSpace.name !in setOf("DeviceRGB", "DeviceGray")) continue
        val bitmap = item.image ?: continue
        var scaled: Bitmap? = null
        try {
          check()
          val factor = min(1.0, edge.toDouble() / max(bitmap.width, bitmap.height))
          val working = if (factor < 1) Bitmap.createScaledBitmap(bitmap, max(1, (bitmap.width * factor).toInt()), max(1, (bitmap.height * factor).toInt()), true).also { scaled = it } else bitmap
          val replacement = JPEGFactory.createFromImage(pdf, working, jpeg)
          if (replacement.cosObject.length >= dictionary.length) continue
          // Preserve non-encoding entries (rendering intent and image metadata).
          val encoding = setOf("Length", "Filter", "DecodeParms", "Width", "Height", "BitsPerComponent", "ColorSpace", "Decode")
          for (key in dictionary.keySet()) if (key.name !in encoding) replacement.cosObject.setItem(key, dictionary.getItem(key))
          replacements[dictionary] = replacement
          resources.put(name, replacement)
        } finally { if (scaled !== bitmap) scaled?.recycle(); bitmap.recycle() }
      }
    }
    for ((index, page) in pdf.pages.withIndex()) { check(); visit(page.resources); progress(index + 1, pdf.numberOfPages) }
  }

  private fun drawMarks(stream: PDPageContentStream, marks: JSONArray, page: Int, w: Float, h: Float, check: () -> Unit) {
    require(marks.length() <= 300) { "Save after 300 annotations." }
    for (i in 0 until marks.length()) {
      check(); val mark = marks.getJSONObject(i); if (mark.getInt("page") != page) continue
      val points = mark.getJSONArray("points"); require(points.length() in 2..4096) { "Invalid drawing." }
      val kind = mark.getString("kind"); val color = android.graphics.Color.parseColor(mark.optString("color", "#1D4ED8"))
      fun x(n: Int) = points.getJSONArray(n).getDouble(0).coerceIn(0.0, 1.0).toFloat() * w
      fun y(n: Int) = (1 - points.getJSONArray(n).getDouble(1).coerceIn(0.0, 1.0)).toFloat() * h
      stream.saveGraphicsState()
      stream.setStrokingColor(android.graphics.Color.red(color), android.graphics.Color.green(color), android.graphics.Color.blue(color)); stream.setNonStrokingColor(android.graphics.Color.red(color), android.graphics.Color.green(color), android.graphics.Color.blue(color))
      stream.setLineWidth((mark.optDouble("width", .005).coerceIn(.001, .04) * w).toFloat()); stream.setLineCapStyle(1); stream.setLineJoinStyle(1)
      if (kind == "highlight" || kind == "rectangle" || kind == "ellipse") {
        val left = min(x(0), x(1)); val bottom = min(y(0), y(1)); val width = abs(x(1) - x(0)); val height = abs(y(1) - y(0))
        if (kind == "ellipse") {
          val k = .55228475f; val rx = width / 2; val ry = height / 2; val cx = left + rx; val cy = bottom + ry
          stream.moveTo(cx + rx, cy); stream.curveTo(cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry); stream.curveTo(cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy); stream.curveTo(cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry); stream.curveTo(cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy); stream.closePath()
        } else stream.addRect(left, bottom, width, height)
        if (kind == "highlight") { stream.setGraphicsStateParameters(PDExtendedGraphicsState().apply { nonStrokingAlphaConstant = .3f }); stream.fill() } else stream.stroke()
      } else { stream.moveTo(x(0), y(0)); for (j in 1 until points.length()) stream.lineTo(x(j), y(j)); stream.stroke() }
      stream.restoreGraphicsState()
    }
  }
}

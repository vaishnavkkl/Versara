package expo.modules.pdfengine

import android.content.Context
import android.net.Uri
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.multipdf.PDFMergerUtility
import com.tom_roush.pdfbox.multipdf.Splitter
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import expo.modules.kotlin.Promise
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.concurrent.Executors

class PdfRange : Record {
  @Field var start: Int = 1
  @Field var end: Int = 1
}
class PdfRotation : Record {
  @Field var page: Int = 1
  @Field var degrees: Int = 90
}
class PdfOrganizeOptions : Record {
  @Field var jobId: String = ""
  @Field var operation: String = "merge"
  @Field var uris: List<String> = emptyList()
  @Field var outputUris: List<String> = emptyList()
  @Field var ranges: List<PdfRange> = emptyList()
  @Field var pages: List<Int> = emptyList()
  @Field var rotations: List<PdfRotation> = emptyList()
}
private class PdfJobFailure(val code: String, message: String) : Exception(message)

class PdfOrganizer {
  private val worker = Executors.newSingleThreadExecutor()
  private val jobs = PdfJobRegistry()
  fun cancel(id: String) { jobs.cancel(id) }
  fun destroy() { jobs.destroy(worker) }
  private fun memory(context: Context) = MemoryUsageSetting.setupTempFileOnly().setTempDir(context.cacheDir)
  private fun input(context: Context, value: String): File {
    val uri = Uri.parse(value)
    if (uri.scheme != "file" || uri.path == null) throw PdfJobFailure("PDF_INVALID_URI", "Choose a local PDF using Browse PDFs.")
    val file = File(uri.path!!).canonicalFile
    if (!file.path.startsWith(context.cacheDir.canonicalPath + File.separator) || !file.isFile) throw PdfJobFailure("PDF_FILE_UNAVAILABLE", "The PDF is unavailable. Choose it again.")
    return file
  }
  private fun load(context: Context, value: String): PDDocument {
    val document = PDDocument.load(input(context, value), memory(context))
    if (document.isEncrypted || !document.currentAccessPermission.canAssembleDocument()) {
      document.close()
      throw PdfJobFailure("PDF_PROTECTED", "This PDF is protected. Choose an unrestricted, unlocked copy.")
    }
    if (document.numberOfPages !in 1..2000) {
      document.close()
      throw PdfJobFailure("PDF_PAGE_LIMIT", "Choose a PDF with between 1 and 2,000 pages.")
    }
    return document
  }
  private fun reject(promise: Promise, error: Throwable) {
    when (error) {
      is PdfJobFailure -> promise.reject(error.code, error.message, error)
      is InvalidPasswordException -> promise.reject("PDF_PASSWORD_REQUIRED", "This PDF requires a password. Choose an unlocked copy.", error)
      is OutOfMemoryError -> promise.reject("PDF_MEMORY_LIMIT", "Not enough memory. Try smaller PDFs or fewer pages.", null)
      else -> promise.reject("PDF_PROCESSING_FAILED", "Could not process this PDF. Check that it is readable and that storage is available.", error)
    }
  }
  private fun run(context: Context, id: String, promise: Promise, action: (() -> Unit) -> Any) {
    jobs.submit(worker, id, promise) { flag ->
      try {
        PDFBoxResourceLoader.init(context.applicationContext)
        val check = { if (flag.get()) throw PdfJobFailure("PDF_CANCELLED", "Operation cancelled.") }
        check()
        promise.resolve(action(check))
      } catch (error: Exception) { reject(promise, error) }
      catch (error: OutOfMemoryError) { reject(promise, error) }
    }
  }
  fun inspect(context: Context, id: String, uris: List<String>, promise: Promise) = run(context, id, promise) { check ->
    if (uris.isEmpty() || uris.size > 30) throw PdfJobFailure("PDF_INPUT_LIMIT", "Choose between 1 and 30 PDFs.")
    uris.map { uri -> check(); load(context, uri).use { pdf -> check(); mapOf("uri" to uri, "pageCount" to pdf.numberOfPages) } }
  }
  fun organize(context: Context, options: PdfOrganizeOptions, promise: Promise, progress: (Int, Int) -> Unit) = run(context, options.jobId, promise) { check ->
    val merge = options.operation == "merge"
    if (options.operation !in listOf("merge", "split", "extract", "delete", "reorder", "rotate") || (merge && options.uris.size !in 2..30) || (!merge && options.uris.size != 1)) throw PdfJobFailure("PDF_INVALID_OPTIONS", "Select the PDFs needed for this operation.")
    val expected = if (options.operation == "split") options.ranges.size else 1
    if (expected !in 1..100 || options.outputUris.size != expected) throw PdfJobFailure("PDF_OUTPUT_LIMIT", "Create between 1 and 100 output PDFs per operation.")
    val root = File(context.filesDir, "Versara PDFs").canonicalFile
    root.mkdirs()
    val outputs = options.outputUris.map {
      val uri = Uri.parse(it)
      if (uri.scheme != "file" || uri.path == null) throw PdfJobFailure("PDF_INVALID_OUTPUT", "Invalid output location.")
      val file = File(uri.path!!).canonicalFile
      if (file.parentFile != root || file.exists()) throw PdfJobFailure("PDF_INVALID_OUTPUT", "Choose a new output name.")
      file
    }
    if (outputs.distinct().size != outputs.size) throw PdfJobFailure("PDF_INVALID_OUTPUT", "Each output needs a unique name.")
    val partials = outputs.map { File(it.parentFile, it.name + ".partial") }
    if (partials.any { it.exists() }) throw PdfJobFailure("PDF_INVALID_OUTPUT", "These output files are already being created.")
    val committed = mutableListOf<File>()
    val counts = mutableListOf<Int>()
    try {
      if (merge) {
        PDDocument(memory(context)).use { destination ->
          val merger = PDFMergerUtility()
          options.uris.forEachIndexed { index, uri ->
            check()
            load(context, uri).use { source ->
              if (destination.numberOfPages + source.numberOfPages > 2000) throw PdfJobFailure("PDF_PAGE_LIMIT", "Merge up to 2,000 pages at a time.")
              merger.appendDocument(destination, source)
            }
            check(); progress(index + 1, options.uris.size)
          }
          counts.add(destination.numberOfPages)
          check(); destination.save(partials[0])
        }
      } else if (options.operation == "reorder" || options.operation == "rotate") {
        load(context, options.uris[0]).use { source ->
          val count = source.numberOfPages
          if (options.operation == "reorder") {
            if (options.pages.size != count || options.pages.toSet().size != count || options.pages.any { it !in 1..count }) throw PdfJobFailure("PDF_INVALID_ORDER", "Include every page exactly once in the new order.")
            // Materialize inherited attributes before detaching pages from their original parents.
            val original = source.pages.toList()
            original.forEach { page ->
              check()
              page.resources = page.resources
              page.mediaBox = page.mediaBox
              page.cropBox = page.cropBox
              page.rotation = page.rotation
            }
            original.forEach { page -> check(); source.removePage(page) }
            options.pages.forEachIndexed { index, number ->
              check(); source.addPage(original[number - 1])
              if (index == 0 || index + 1 == count || (index + 1) % 10 == 0) progress(index + 1, count)
            }
          } else {
            if (options.rotations.isEmpty() || options.rotations.size > count || options.rotations.map { it.page }.toSet().size != options.rotations.size || options.rotations.any { it.page !in 1..count || it.degrees !in listOf(90, 180, 270) }) throw PdfJobFailure("PDF_INVALID_ROTATION", "Choose pages and rotate them by 90, 180 or 270 degrees.")
            options.rotations.forEachIndexed { index, rotation ->
              check()
              val page = source.getPage(rotation.page - 1)
              page.rotation = ((page.rotation % 360 + rotation.degrees) % 360 + 360) % 360
              progress(index + 1, options.rotations.size)
            }
          }
          check(); source.save(partials[0])
          counts.add(count)
        }
      } else if (options.operation == "extract" || options.operation == "delete") {
        load(context, options.uris[0]).use { source ->
          if (options.pages.isEmpty() || options.pages.size > 2000 || options.pages.any { it !in 1..source.numberOfPages }) throw PdfJobFailure("PDF_INVALID_PAGES", "Select pages from this document.")
          val selected = options.pages.toSet()
          val kept = (1..source.numberOfPages).filter { if (options.operation == "extract") it in selected else it !in selected }.toSet()
          if (kept.isEmpty()) throw PdfJobFailure("PDF_EMPTY_OUTPUT", "Keep at least one page in the PDF.")
          val created = mutableListOf<PDDocument>()
          var pageNumber = 0
          var completed = 0
          try {
            val splitter = object : Splitter() {
              override fun createNewDocument(): PDDocument = super.createNewDocument().also { created.add(it) }
              override fun processPage(page: PDPage) {
                check()
                pageNumber++
                if (pageNumber in kept) {
                  super.processPage(page)
                  completed++
                  if (completed == 1 || completed == kept.size || completed % 10 == 0) progress(completed, kept.size)
                }
              }
            }
            splitter.memoryUsageSetting = memory(context)
            splitter.setSplitAtPage(Int.MAX_VALUE)
            val destination = splitter.split(source).single()
            check(); destination.save(partials[0])
            counts.add(kept.size)
          } finally { created.forEach { try { it.close() } catch (_: Exception) { } } }
        }
      } else {
        load(context, options.uris[0]).use { source ->
          val total = options.ranges.sumOf { range ->
            if (range.start < 1 || range.end < range.start || range.end > source.numberOfPages) throw PdfJobFailure("PDF_INVALID_RANGE", "A page range is outside this document.")
            range.end - range.start + 1
          }
          if (total > 2000) throw PdfJobFailure("PDF_PAGE_LIMIT", "Split up to 2,000 output pages at a time.")
          var completed = 0
          val created = mutableListOf<PDDocument>()
          try { options.ranges.forEachIndexed { index, range ->
            val splitter = object : Splitter() {
              override fun createNewDocument(): PDDocument = super.createNewDocument().also { created.add(it) }
              override fun processPage(page: PDPage) {
                check()
                super.processPage(page)
                completed++
                if (completed == 1 || completed == total || completed % 10 == 0) progress(completed, total)
              }
            }
            splitter.memoryUsageSetting = memory(context)
            splitter.setStartPage(range.start)
            splitter.setEndPage(range.end)
            splitter.setSplitAtPage(range.end - range.start + 1)
            // The native splitter also detaches page links to excluded pages.
            val destination = splitter.split(source).single()
            check(); destination.save(partials[index])
            counts.add(destination.numberOfPages)
          } } finally {
            // Splitter shares source resources: save ALL outputs before closing ANY document.
            created.forEach { try { it.close() } catch (_: Exception) { } }
          }
        }
      }
      partials.forEachIndexed { index, file ->
        check()
        PDDocument.load(file, memory(context)).use { verified ->
          if (verified.numberOfPages != counts[index]) throw PdfJobFailure("PDF_WRITE_FAILED", "The output PDF could not be verified.")
        }
      }
      outputs.forEachIndexed { index, file ->
        check()
        if (!partials[index].renameTo(file)) throw PdfJobFailure("PDF_WRITE_FAILED", "Could not save the PDF. Check free storage.")
        committed.add(file)
      }
      check()
      outputs.mapIndexed { index, file -> mapOf("uri" to Uri.fromFile(file).toString(), "pageCount" to counts[index], "size" to file.length().toDouble()) }
    } catch (error: Throwable) {
      committed.forEach { it.delete() }
      throw error
    } finally { partials.forEach { it.delete() } }
  }
}

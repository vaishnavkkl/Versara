import ExpoModulesCore
import PDFKit
import Foundation

struct PdfRange: Record {
  @Field var start = 1
  @Field var end = 1
}
struct PdfRotation: Record {
  @Field var page = 1
  @Field var degrees = 90
}
struct PdfOrganizeOptions: Record {
  @Field var jobId = ""
  @Field var operation = "merge"
  @Field var uris: [String] = []
  @Field var outputUris: [String] = []
  @Field var ranges: [PdfRange] = []
  @Field var pages: [Int] = []
  @Field var rotations: [PdfRotation] = []
}
private struct PdfJobFailure: Error {
  let code: String
  let message: String
}
final class PdfOrganizer {
  private let worker = DispatchQueue(label: "com.versara.pdf.organize", qos: .userInitiated)
  private let lock = NSLock()
  private var cancelled = Set<String>()
  private var active = Set<String>()
  private var destroyed = false
  func cancel(_ id: String) {
    lock.lock(); defer { lock.unlock() }
    guard !destroyed else { return }
    if cancelled.count >= 64, let stale = cancelled.first(where: { !active.contains($0) }) { cancelled.remove(stale) }
    cancelled.insert(id)
  }
  func destroy() { lock.lock(); destroyed = true; cancelled.removeAll(); lock.unlock() }
  private func check(_ id: String) throws {
    lock.lock(); let stopped = destroyed || cancelled.contains(id); lock.unlock()
    if stopped { throw PdfJobFailure(code: "PDF_CANCELLED", message: "Operation cancelled.") }
  }
  private func run(_ id: String, promise: Promise, action: @escaping () throws -> Any) {
    lock.lock()
    guard !destroyed, active.count < 4, !active.contains(id) else {
      lock.unlock()
      promise.reject("PDF_BUSY", "Another PDF task is finishing or this tool has closed. Please try again.")
      return
    }
    active.insert(id); lock.unlock()
    worker.async {
      defer { self.lock.lock(); self.cancelled.remove(id); self.active.remove(id); self.lock.unlock() }
      do { try self.check(id); promise.resolve(try autoreleasepool(invoking: action)) }
      catch let error as PdfJobFailure { promise.reject(error.code, error.message) }
      catch { promise.reject("PDF_PROCESSING_FAILED", "Could not process the PDF. Check the file and available storage.") }
    }
  }
  private func load(_ value: String) throws -> PDFDocument {
    let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath().path + "/"
    guard let url = URL(string: value), url.isFileURL, url.resolvingSymlinksInPath().path.hasPrefix(cache),
      let document = PDFDocument(url: url) else {
      throw PdfJobFailure(code: "PDF_INVALID_DOCUMENT", message: "The PDF could not be read. Choose it again.")
    }
    guard !document.isLocked, !document.isEncrypted, document.allowsDocumentAssembly else {
      throw PdfJobFailure(code: "PDF_PROTECTED", message: "This PDF is protected. Choose an unrestricted, unlocked copy.")
    }
    guard (1...2000).contains(document.pageCount) else {
      throw PdfJobFailure(code: "PDF_PAGE_LIMIT", message: "Choose a PDF with between 1 and 2,000 pages.")
    }
    return document
  }
  func inspect(_ id: String, uris: [String], promise: Promise) {
    run(id, promise: promise) {
      guard (1...30).contains(uris.count) else { throw PdfJobFailure(code: "PDF_INPUT_LIMIT", message: "Choose between 1 and 30 PDFs.") }
      return try uris.map { uri in
        try autoreleasepool {
          try self.check(id)
          let document = try self.load(uri)
          try self.check(id)
          return ["uri": uri, "pageCount": document.pageCount] as [String: Any]
        }
      }
    }
  }
  func organize(_ options: PdfOrganizeOptions, promise: Promise, progress: @escaping (Int, Int) -> Void) {
    run(options.jobId, promise: promise) {
      let merge = options.operation == "merge"
      guard ["merge", "split", "extract", "delete", "reorder", "rotate"].contains(options.operation), (merge ? (2...30).contains(options.uris.count) : options.uris.count == 1) else {
        throw PdfJobFailure(code: "PDF_INVALID_OPTIONS", message: "Select the PDFs needed for this operation.")
      }
      let expected = options.operation == "split" ? options.ranges.count : 1
      guard (1...100).contains(expected), options.outputUris.count == expected else {
        throw PdfJobFailure(code: "PDF_OUTPUT_LIMIT", message: "Create between 1 and 100 output PDFs per operation.")
      }
      let manager = FileManager.default
      let root = manager.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Versara PDFs", isDirectory: true).resolvingSymlinksInPath().standardizedFileURL
      let outputs = try options.outputUris.map { value -> URL in
        guard let url = URL(string: value), url.isFileURL,
          url.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL.path == root.path,
          !manager.fileExists(atPath: url.path) else {
          throw PdfJobFailure(code: "PDF_INVALID_OUTPUT", message: "Choose a new PDF output location.")
        }
        return url
      }
      guard Set(outputs.map { $0.path }).count == outputs.count else { throw PdfJobFailure(code: "PDF_INVALID_OUTPUT", message: "Each output needs a unique name.") }
      let partials = outputs.map { $0.appendingPathExtension("partial") }
      guard !partials.contains(where: { manager.fileExists(atPath: $0.path) }) else { throw PdfJobFailure(code: "PDF_INVALID_OUTPUT", message: "These outputs are already being created.") }
      try manager.createDirectory(at: root, withIntermediateDirectories: true)
      var committed: [URL] = []
      var counts: [Int] = []
      defer { for url in partials { try? manager.removeItem(at: url) } }
      do {
        if merge {
          let destination = PDFDocument()
          // Retain source backing documents until PDFKit has serialized all copied pages.
          var sources: [PDFDocument] = []
          for (index, uri) in options.uris.enumerated() {
            try self.check(options.jobId)
            let source = try self.load(uri)
            sources.append(source)
            guard destination.pageCount + source.pageCount <= 2000 else { throw PdfJobFailure(code: "PDF_PAGE_LIMIT", message: "Merge up to 2,000 pages at a time.") }
            for pageIndex in 0..<source.pageCount {
              try self.check(options.jobId)
              guard let page = source.page(at: pageIndex)?.copy() as? PDFPage else { throw PdfJobFailure(code: "PDF_INVALID_PAGE", message: "A PDF page could not be copied.") }
              destination.insert(page, at: destination.pageCount)
            }
            progress(index + 1, options.uris.count)
          }
          try self.check(options.jobId)
          let written = withExtendedLifetime(sources) { destination.write(to: partials[0]) }
          guard written else { throw PdfJobFailure(code: "PDF_WRITE_FAILED", message: "Could not save the PDF. Check free storage.") }
          counts.append(destination.pageCount)
        } else if options.operation == "reorder" || options.operation == "rotate" {
          let source = try self.load(options.uris[0])
          let count = source.pageCount
          if options.operation == "reorder" {
            guard options.pages.count == count, Set(options.pages).count == count, options.pages.allSatisfy({ (1...count).contains($0) }) else { throw PdfJobFailure(code: "PDF_INVALID_ORDER", message: "Include every page exactly once in the new order.") }
            var current = Array(1...count)
            var positions = Array(0..<count)
            for (index, number) in options.pages.enumerated() {
              try self.check(options.jobId)
              let from = positions[number - 1]
              if from != index {
                let displaced = current[index]
                source.exchangePage(at: index, withPageAt: from)
                current.swapAt(index, from)
                positions[number - 1] = index
                positions[displaced - 1] = from
              }
              if index == 0 || index + 1 == count || (index + 1) % 10 == 0 { progress(index + 1, count) }
            }
          } else {
            guard !options.rotations.isEmpty, options.rotations.count <= count, Set(options.rotations.map { $0.page }).count == options.rotations.count,
              options.rotations.allSatisfy({ (1...count).contains($0.page) && [90, 180, 270].contains($0.degrees) }) else { throw PdfJobFailure(code: "PDF_INVALID_ROTATION", message: "Choose pages and rotate them by 90, 180 or 270 degrees.") }
            for (index, rotation) in options.rotations.enumerated() {
              try self.check(options.jobId)
              guard let page = source.page(at: rotation.page - 1) else { throw PdfJobFailure(code: "PDF_INVALID_PAGE", message: "A PDF page could not be read.") }
              page.rotation = ((page.rotation % 360 + rotation.degrees) % 360 + 360) % 360
              progress(index + 1, options.rotations.count)
            }
          }
          try self.check(options.jobId)
          guard source.write(to: partials[0]) else { throw PdfJobFailure(code: "PDF_WRITE_FAILED", message: "Could not save the PDF. Check free storage.") }
          counts.append(count)
        } else if options.operation == "extract" || options.operation == "delete" {
          let source = try self.load(options.uris[0])
          guard !options.pages.isEmpty, options.pages.count <= 2000, options.pages.allSatisfy({ (1...source.pageCount).contains($0) }) else {
            throw PdfJobFailure(code: "PDF_INVALID_PAGES", message: "Select pages from this document.")
          }
          let selected = Set(options.pages)
          let kept = (1...source.pageCount).filter { options.operation == "extract" ? selected.contains($0) : !selected.contains($0) }
          guard !kept.isEmpty else { throw PdfJobFailure(code: "PDF_EMPTY_OUTPUT", message: "Keep at least one page in the PDF.") }
          let destination = PDFDocument()
          for (index, number) in kept.enumerated() {
            try self.check(options.jobId)
            guard let page = source.page(at: number - 1)?.copy() as? PDFPage else { throw PdfJobFailure(code: "PDF_INVALID_PAGE", message: "A PDF page could not be copied.") }
            destination.insert(page, at: destination.pageCount)
            if index == 0 || index + 1 == kept.count || (index + 1) % 10 == 0 { progress(index + 1, kept.count) }
          }
          try self.check(options.jobId)
          guard withExtendedLifetime(source, { destination.write(to: partials[0]) }) else { throw PdfJobFailure(code: "PDF_WRITE_FAILED", message: "Could not save the PDF. Check free storage.") }
          counts.append(kept.count)
        } else {
          let source = try self.load(options.uris[0])
          var total = 0
          for range in options.ranges {
            guard range.start >= 1, range.end >= range.start, range.end <= source.pageCount else { throw PdfJobFailure(code: "PDF_INVALID_RANGE", message: "A page range is outside this document.") }
            total += range.end - range.start + 1
          }
          guard total <= 2000 else { throw PdfJobFailure(code: "PDF_PAGE_LIMIT", message: "Split up to 2,000 output pages at a time.") }
          var completed = 0
          for (index, range) in options.ranges.enumerated() {
            try autoreleasepool {
              let destination = PDFDocument()
              for pageIndex in (range.start - 1)..<range.end {
                try self.check(options.jobId)
                guard let page = source.page(at: pageIndex)?.copy() as? PDFPage else { throw PdfJobFailure(code: "PDF_INVALID_PAGE", message: "A PDF page could not be copied.") }
                destination.insert(page, at: destination.pageCount)
                completed += 1
                if completed == 1 || completed == total || completed % 10 == 0 { progress(completed, total) }
              }
              try self.check(options.jobId)
              guard destination.write(to: partials[index]) else { throw PdfJobFailure(code: "PDF_WRITE_FAILED", message: "Could not save the PDF. Check free storage.") }
              counts.append(destination.pageCount)
            }
          }
        }
        for (index, url) in partials.enumerated() {
          try self.check(options.jobId)
          guard let verified = PDFDocument(url: url), verified.pageCount == counts[index] else { throw PdfJobFailure(code: "PDF_WRITE_FAILED", message: "The output PDF could not be verified.") }
        }
        for (index, url) in outputs.enumerated() {
          try self.check(options.jobId)
          try manager.moveItem(at: partials[index], to: url)
          committed.append(url)
        }
        try self.check(options.jobId)
        return try outputs.enumerated().map { index, url in
          let size = (try manager.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.doubleValue ?? 0
          return ["uri": url.absoluteString, "pageCount": counts[index], "size": size] as [String: Any]
        }
      } catch {
        for url in committed { try? manager.removeItem(at: url) }
        throw error
      }
    }
  }
}

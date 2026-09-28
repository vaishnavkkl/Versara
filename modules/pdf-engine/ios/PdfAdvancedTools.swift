import ExpoModulesCore
import PDFKit
import Vision
import UIKit
import ImageIO
import UniformTypeIdentifiers

private struct AdvancedFailure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

/// Serial, cancellable native jobs. No PDF bytes or bitmap pixels cross the JS bridge.
final class PdfAdvancedTools {
  private let worker = DispatchQueue(label: "com.versara.pdf.advanced", qos: .userInitiated)
  private let lock = NSLock()
  private var active = Set<String>()
  private var cancelled = Set<String>()
  private var destroyed = false
  private var recognizers: [String: VNRecognizeTextRequest] = [:]
  func cancel(_ id: String) {
    lock.lock(); defer { lock.unlock() }
    if cancelled.count >= 64, let stale = cancelled.first(where: { !active.contains($0) }) { cancelled.remove(stale) }
    cancelled.insert(id)
    recognizers[id]?.cancel()
  }
  func destroy() { lock.lock(); destroyed = true; recognizers.values.forEach { $0.cancel() }; lock.unlock() }
  private func isCancelled(_ id: String) -> Bool { lock.lock(); defer { lock.unlock() }; return destroyed || cancelled.contains(id) }
  private func check(_ id: String) throws {
    lock.lock(); let stopped = destroyed || cancelled.contains(id); lock.unlock()
    if stopped { throw AdvancedFailure(message: "PDF_CANCELLED") }
  }
  private func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw AdvancedFailure(message: message) }
  }
  private func input(_ value: String) throws -> URL {
    let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath().standardizedFileURL.path + "/"
    guard let url = URL(string: value), url.isFileURL else { throw AdvancedFailure(message: "Choose a local PDF.") }
    let canonical = url.resolvingSymlinksInPath().standardizedFileURL
    try require(canonical.path.hasPrefix(root) && FileManager.default.fileExists(atPath: canonical.path), "Choose the PDF again.")
    return canonical
  }
  private func hasSelectableText(_ page: PDFPage, id: String) throws -> Bool {
    try check(id)
    let count = page.numberOfCharacters
    guard count > 0 else { return false }
    // Avoid a slow/full-page string allocation for an exceptionally large text
    // layer. Above this cap, conservatively keep that existing layer unchanged.
    if count > 100_000 { try check(id); return true }
    for start in stride(from: 0, to: count, by: 256) {
      try check(id)
      let found = autoreleasepool {
        // PDFPage.selection(for: NSRange) requires a nonempty, in-bounds range.
        let range = NSRange(location: start, length: min(256, count - start))
        let text = page.selection(for: range)?.string ?? ""
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      }
      if found { return true }
    }
    try check(id)
    return false
  }
  private func bitmap(_ page: PDFPage, dpi: CGFloat) throws -> CGImage {
    let box = page.bounds(for: .cropBox)
    let rotated = page.rotation % 180 != 0
    let width = rotated ? box.height : box.width, height = rotated ? box.width : box.height
    try require(width.isFinite && height.isFinite && width > 0 && height > 0, "This PDF has invalid page dimensions.")
    let budget: CGFloat = ProcessInfo.processInfo.physicalMemory < 3_000_000_000 ? 1_500_000 : 3_000_000
    let scale = min(min(dpi / 72, sqrt(budget / (width * height))), 4096 / max(width, height))
    let w = max(1, Int(width * scale)), h = max(1, Int(height * scale))
    guard let context = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw AdvancedFailure(message: "Not enough memory to render this page.") }
    context.setFillColor(UIColor.white.cgColor); context.fill(CGRect(x: 0, y: 0, width: w, height: h))
    guard let reference = page.pageRef else { throw AdvancedFailure(message: "This page is unreadable.") }
    context.concatenate(reference.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: w, height: h), rotate: 0, preserveAspectRatio: true))
    context.drawPDFPage(reference)
    // Annotation drawing uses the same unrotated page-space coordinates as CGPDFPage.
    for annotation in page.annotations where annotation.shouldDisplay { annotation.draw(with: .cropBox, in: context) }
    guard let image = context.makeImage() else { throw AdvancedFailure(message: "Could not render this page.") }
    return image
  }
  private func recognize(_ page: PDFPage, id: String) throws -> [VNRecognizedTextObservation] {
    try check(id)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate; request.usesLanguageCorrection = true; request.recognitionLanguages = ["en-US"]
    let image = try bitmap(page, dpi: 160)
    lock.lock(); recognizers[id] = request; lock.unlock()
    defer { lock.lock(); recognizers.removeValue(forKey: id); lock.unlock() }
    try check(id)
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    try check(id)
    return request.results ?? []
  }
  private func imageData(_ image: CGImage, png: Bool, quality: Double) throws -> Data {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, (png ? UTType.png.identifier : UTType.jpeg.identifier) as CFString, 1, nil) else { throw AdvancedFailure(message: "Could not create image.") }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    try require(CGImageDestinationFinalize(destination), "Could not finish image.")
    return data as Data
  }
  func run(_ id: String, request: String, promise: Promise, progress: @escaping (Int, Int) -> Void) {
    lock.lock()
    guard !destroyed, active.count < 4, !active.contains(id) else { lock.unlock(); promise.reject("PDF_BUSY", "Another PDF task is finishing. Please try again."); return }
    active.insert(id); lock.unlock()
    worker.async {
      var staged: [(URL, URL)] = []
      var committed: [URL] = []
      let manager = FileManager.default
      defer {
        staged.forEach { try? manager.removeItem(at: $0.0) }
        self.lock.lock(); self.active.remove(id); self.cancelled.remove(id); self.lock.unlock()
      }
      do {
        let result: [String: Any] = try autoreleasepool {
          try self.check(id)
          try self.require(request.utf8.count <= 2_000_000, "Too many annotations. Save your changes first.")
          guard let data = request.data(using: .utf8), let r = try JSONSerialization.jsonObject(with: data) as? [String: Any], let op = r["operation"] as? String else { throw AdvancedFailure(message: "Invalid PDF request.") }
          try self.require(["info", "preview", "estimate", "duplicate", "insert", "compress", "to_image", "highlight", "draw", "shapes", "sign", "watermark", "numbers", "protect", "metadata", "redact", "flatten", "ocr", "extract_text", "repair"].contains(op), "Unknown PDF tool.")
          let source = try self.input(r["uri"] as? String ?? "")
          guard let pdf = PDFDocument(url: source) else { throw AdvancedFailure(message: "This PDF cannot be read. Its damage may not be repairable.") }
          if pdf.isLocked { try self.require(pdf.unlock(withPassword: r["inputPassword"] as? String ?? ""), "This PDF requires the correct password.") }
          let count = pdf.pageCount
          try self.require((1...2000).contains(count), "Choose a PDF with 1 to 2,000 pages.")
          let requested = r["pages"] as? [Int] ?? []
          let pages = requested.isEmpty ? Array(0..<count) : requested.map { $0 - 1 }
          try self.require(pages.count <= 2000 && Set(pages).count == pages.count && pages.allSatisfy { (0..<count).contains($0) }, "Choose valid, unique page numbers.")
          if !["info", "preview"].contains(op) {
            try self.require(pdf.allowsDocumentChanges && pdf.allowsCopying && pdf.allowsDocumentAssembly, "This PDF restricts editing or extraction. Use an unrestricted copy.")
            try self.check(id)
            try PdfIntegrity.requireUnsigned(source, password: r["inputPassword"] as? String ?? "")
            try self.check(id)
          }
          // PDFKit does not expose the original owner/user credentials for a
          // rewritten document. Fail before changing protection implicitly.
          try self.require(!pdf.isEncrypted || ["info", "preview", "estimate", "compress", "to_image", "ocr", "extract_text", "protect"].contains(op), "This tool cannot preserve this PDF's existing encryption. Use an explicitly unlocked copy; the protected original is unchanged.")
          let size = (try manager.attributesOfItem(atPath: source.path)[.size] as? NSNumber)?.int64Value ?? 0
          if op == "info" {
            let bounds = pdf.page(at: 0)!.bounds(for: .cropBox), attrs = pdf.documentAttributes ?? [:]
            return ["info": ["pageCount": count, "size": size, "width": bounds.width, "height": bounds.height, "version": "\(pdf.majorVersion).\(pdf.minorVersion)", "encrypted": pdf.isEncrypted, "title": attrs[.titleAttribute] as? String ?? "", "author": attrs[.authorAttribute] as? String ?? "", "subject": attrs[.subjectAttribute] as? String ?? "", "creator": attrs[.creatorAttribute] as? String ?? "", "producer": attrs[.producerAttribute] as? String ?? ""]]
          }
          let root = manager.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Versara PDFs", isDirectory: true).resolvingSymlinksInPath().standardizedFileURL
          let cache = manager.urls(for: .cachesDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath().standardizedFileURL.path + "/"
          func output(_ index: Int, preview: Bool = false) throws -> URL {
            let values = r["outputUris"] as? [String] ?? []
            guard values.indices.contains(index), let value = URL(string: values[index]), value.isFileURL else { throw AdvancedFailure(message: "Invalid output location.") }
            let url = value.resolvingSymlinksInPath().standardizedFileURL
            try self.require(preview ? url.path.hasPrefix(cache) : url.deletingLastPathComponent().path == root.path, "Invalid output location.")
            try self.require(!manager.fileExists(atPath: url.path) && !staged.contains { $0.1 == url }, "Choose a new output name.")
            let partial = url.appendingPathExtension("partial")
            try self.require(!manager.fileExists(atPath: partial.path), "This output is already being created.")
            try manager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            staged.append((partial, url)); return partial
          }
          let quality = r["quality"] as? String ?? "balanced"
          try self.require(["max", "balanced", "small"].contains(quality), "Invalid quality.")
          let dpi: CGFloat = quality == "max" ? 160 : quality == "small" ? 85 : 120
          let jpegQuality = quality == "max" ? 0.92 : quality == "small" ? 0.48 : 0.72
          var outputCount = count
          var ocrSummary: [String: Any]?
          switch op {
          case "preview", "to_image":
            let selected = op == "preview" ? [pages[0]] : pages
            try self.require(selected.count <= 100 && (r["outputUris"] as? [String])?.count == selected.count, "Export up to 100 pages, with one output per page.")
            let format = r["format"] as? String ?? "png"
            try self.require(["png", "jpg"].contains(format), "Choose JPG or PNG.")
            for (index, number) in selected.enumerated() {
              try autoreleasepool { try self.check(id); let image = try self.bitmap(pdf.page(at: number)!, dpi: op == "preview" ? 110 : dpi); try self.imageData(image, png: format == "png", quality: jpegQuality).write(to: output(index, preview: op == "preview")); progress(index + 1, selected.count) }
            }
          case "estimate":
            return ["estimatedSize": size, "estimateKind": "upperBound"]
          case "extract_text", "ocr":
            let ocrFormat = r["ocrFormat"] as? String ?? "text"
            try self.require(["text", "pdf"].contains(ocrFormat), "Choose text or searchable PDF output.")
            if op == "ocr" && ocrFormat == "pdf" {
              try self.require(pages.count <= 100, "Recognize up to 100 selected pages at a time.")
              let tokenPattern = try NSRegularExpression(pattern: "\\S+")
              var recognized: [[String: Any]] = []
              var totalWords = 0
              for (index, number) in pages.enumerated() {
                try autoreleasepool {
                  try self.check(id)
                  let page = pdf.page(at: number)!
                  let skipped = try (r["skipExistingText"] as? Bool ?? true) && self.hasSelectableText(page, id: id)
                  var words: [[String: Any]] = []
                  if !skipped {
                    for observation in try self.recognize(page, id: id) {
                      try self.check(id)
                      guard let candidate = observation.topCandidates(1).first else { continue }
                      let text = candidate.string
                      for match in tokenPattern.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                        try self.check(id)
                        guard let range = Range(match.range, in: text) else { continue }
                        let word = String(text[range])
                        try self.require(word.utf16.count <= 256, "An OCR word cannot be placed safely. Export text instead.")
                        guard let location = try candidate.boundingBox(for: range) else { throw AdvancedFailure(message: "OCR could not locate a word. Export text instead.") }
                        let box = location.boundingBox.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
                        guard !box.isNull && box.width > 0 && box.height > 0 else { continue }
                        try self.require(words.count < 2000 && totalWords < 20000, "Too much OCR text. Choose fewer pages.")
                        words.append(["text": word, "x": box.minX, "y": 1 - box.maxY, "width": box.width, "height": box.height])
                        totalWords += 1
                      }
                    }
                  }
                  recognized.append(["page": number, "words": words, "skipped": skipped])
                  progress(index + 1, pages.count + 1)
                }
              }
              try self.check(id)
              let target = try output(0)
              let request: [String: Any] = ["action": "ocr_save", "path": source.path, "outputPath": target.path, "inputPassword": r["inputPassword"] as? String ?? "", "ocrPages": recognized]
              let requestData = try JSONSerialization.data(withJSONObject: request)
              let encoded = PdfTextEditor.applyOCR(String(decoding: requestData, as: UTF8.self), cancelled: { self.isCancelled(id) })
              guard let data = encoded.data(using: .utf8), let response = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw AdvancedFailure(message: "Could not create the searchable PDF.") }
              if let error = response["error"] as? String { throw AdvancedFailure(message: error) }
              ocrSummary = response
              try self.check(id); progress(pages.count + 1, pages.count + 1)
            } else {
              let target = try output(0)
              try Data().write(to: target)
              let file = try FileHandle(forWritingTo: target); defer { try? file.close() }
              for (index, number) in pages.enumerated() {
                try autoreleasepool {
                  try self.check(id); let page = pdf.page(at: number)!
                  let text = op == "ocr" ? try self.recognize(page, id: id).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n") : page.string ?? ""
                  try file.write(contentsOf: Data("--- Page \(number + 1) ---\n\(text)\n\n".utf8)); try self.check(id); progress(index + 1, pages.count)
                }
              }
            }
          case "compress":
            // PDFKit has no public image-resource recompressor. A native rewrite
            // preserves text, links, annotations and forms; never rasterize here.
            if pdf.isEncrypted { try manager.copyItem(at: source, to: output(0)) }
            else { try self.require(pdf.write(to: output(0)), "Could not save this PDF.") }
          case "metadata":
            // Clear document properties on the original object graph. Drawing
            // pages into a new CGContext would flatten annotations/forms/links.
            pdf.documentAttributes = [:]
            try self.require(pdf.write(to: output(0)), "Could not save this PDF.")
          case "redact":
            do {
              guard let rects = r["rects"] as? [[String: Any]], (1...3000).contains(rects.count) else { throw AdvancedFailure(message: "Choose between 1 and 3,000 covers.") }
              var covers: [Int: [CGRect]] = [:]
              for rect in rects {
                guard let number = rect["page"] as? Int, (1...count).contains(number),
                  let x = rect["x"] as? Double, let y = rect["y"] as? Double, let w = rect["width"] as? Double, let h = rect["height"] as? Double,
                  [x,y,w,h].allSatisfy({ $0.isFinite }), x >= 0, y >= 0, w > 0, h > 0, x+w <= 1.000001, y+h <= 1.000001 else { throw AdvancedFailure(message: "Invalid redaction region.") }
                covers[number, default: []].append(CGRect(x: x, y: y, width: w, height: h))
              }
              let target = try output(0, preview: true)
              let properties: [CFString: Any] = [kCGPDFContextCreator: "", kCGPDFContextAuthor: "", kCGPDFContextTitle: "", kCGPDFContextSubject: "", kCGPDFContextKeywords: []]
              guard let context = CGContext(target as CFURL, mediaBox: nil, properties as CFDictionary) else { throw AdvancedFailure(message: "Could not create PDF.") }
              defer { context.closePDF() }
              for number in 0..<count {
                try autoreleasepool {
                  try self.check(id)
                  let page = pdf.page(at: number)!, box = page.bounds(for: .cropBox), rotated = page.rotation % 180 != 0
                  var bounds = CGRect(x: 0, y: 0, width: rotated ? box.height : box.width, height: rotated ? box.width : box.height)
                  let raw = try self.bitmap(page, dpi: 160)
                  let width = raw.width, height = raw.height
                  guard let pixels = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw AdvancedFailure(message: "Not enough memory to redact this page.") }
                  pixels.draw(raw, in: CGRect(x: 0, y: 0, width: width, height: height))
                  pixels.setShouldAntialias(false); pixels.setBlendMode(.copy); pixels.setFillColor(UIColor.black.cgColor)
                  for rect in covers[number + 1] ?? [] {
                    try self.check(id)
                    let left = floor(rect.minX * CGFloat(width)), right = min(CGFloat(width), ceil(rect.maxX * CGFloat(width)))
                    let top = floor(rect.minY * CGFloat(height)), bottom = min(CGFloat(height), ceil(rect.maxY * CGFloat(height)))
                    pixels.fill(CGRect(x: left, y: CGFloat(height)-bottom, width: right-left, height: bottom-top))
                  }
                  guard let redacted = pixels.makeImage() else { throw AdvancedFailure(message: "Could not redact this page.") }
                  // Only the overwritten raster enters a fresh PDF; original objects never do.
                  let media = Data(bytes: &bounds, count: MemoryLayout<CGRect>.size)
                  context.beginPDFPage([kCGPDFContextMediaBox: media] as CFDictionary)
                  context.draw(redacted, in: bounds); context.endPDFPage()
                  progress(number + 1, count)
                }
              }
            }
          case "flatten":
            do {
              let target = try output(0)
              let properties: [CFString: Any] = [kCGPDFContextCreator: "", kCGPDFContextAuthor: "", kCGPDFContextTitle: "", kCGPDFContextSubject: "", kCGPDFContextKeywords: []]
              guard let context = CGContext(target as CFURL, mediaBox: nil, properties as CFDictionary) else { throw AdvancedFailure(message: "Could not create PDF.") }
              defer { context.closePDF() }
              for number in 0..<count {
                try autoreleasepool {
                  try self.check(id); let page = pdf.page(at: number)!, box = page.bounds(for: .cropBox), rotated = page.rotation % 180 != 0
                  var bounds = CGRect(x: 0, y: 0, width: rotated ? box.height : box.width, height: rotated ? box.width : box.height)
                  let media = Data(bytes: &bounds, count: MemoryLayout<CGRect>.size)
                  context.beginPDFPage([kCGPDFContextMediaBox: media] as CFDictionary)
                  let raw = try self.bitmap(page, dpi: 160)
                  let data = try self.imageData(raw, png: false, quality: 0.95)
                  guard let provider = CGDataProvider(data: data as CFData), let image = CGImage(jpegDataProviderSource: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { throw AdvancedFailure(message: "Could not flatten page.") }
                  context.draw(image, in: bounds)
                  context.endPDFPage(); progress(number + 1, count)
                }
              }
            }
          default:
            var inserted: PDFDocument?
            switch op {
            case "duplicate":
              try self.require(count + pages.count <= 2000, "Keep the result below 2,001 pages.")
              for number in pages.sorted(by: >) { try self.check(id); guard let copy = pdf.page(at: number)?.copy() as? PDFPage else { throw AdvancedFailure(message: "Could not duplicate page.") }; pdf.insert(copy, at: number + 1) }
            case "insert":
              let position = r["position"] as? Int ?? count
              try self.require((0...count).contains(position), "Choose an insertion position from 0 to \(count).")
              try self.require(count < 2000, "Keep the result below 2,001 pages.")
              let uri = r["insertUri"] as? String ?? ""
              if uri.isEmpty() {
                let original = pdf.page(at: max(0, position - 1))!
                let blank = PDFPage(); blank.setBounds(original.bounds(for: .mediaBox), for: .mediaBox); blank.rotation = original.rotation; pdf.insert(blank, at: position)
              } else {
                inserted = PDFDocument(url: try self.input(uri))
                guard let other = inserted else { throw AdvancedFailure(message: "Could not read the inserted PDF.") }
                try self.require(!other.isEncrypted && other.allowsDocumentAssembly && count + other.pageCount <= 2000, "Choose an unrestricted PDF; keep the result below 2,001 pages.")
                try PdfIntegrity.requireUnsigned(try self.input(uri))
                for index in 0..<other.pageCount { try self.check(id); guard let copy = other.page(at: index)?.copy() as? PDFPage else { throw AdvancedFailure(message: "Could not insert page.") }; pdf.insert(copy, at: position + index) }
              }
            case "repair", "protect": break
            default:
              for (index, number) in pages.enumerated() {
                try self.check(id)
                let page = pdf.page(at: number)!
                if op == "watermark" || op == "numbers" {
                  let text = op == "numbers" ? String((r["startNumber"] as? Int ?? 1) + index) : (r["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                  try self.require(!text.isEmpty && text.count <= 100 && text.unicodeScalars.allSatisfy { (32...126).contains(Int($0.value)) }, "Use up to 100 English letters, numbers or symbols.")
                  let box = page.bounds(for: .cropBox)
                  let rotation = (page.rotation % 360 + 360) % 360
                  let width = rotation % 180 == 0 ? box.width : box.height, height = rotation % 180 == 0 ? box.height : box.width
                  let font = UIFont.boldSystemFont(ofSize: op == "numbers" ? 11 : min(48, width * 0.8 / max(1, (text as NSString).size(withAttributes: [.font: UIFont.boldSystemFont(ofSize: 1)]).width)))
                  let transform: CGAffineTransform
                  switch rotation {
                  case 90: transform = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: box.maxX, ty: box.minY)
                  case 180: transform = CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: box.maxX, ty: box.maxY)
                  case 270: transform = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: box.minX, ty: box.maxY)
                  default: transform = CGAffineTransform(translationX: box.minX, y: box.minY)
                  }
                  let bounds = CGRect(x: 0, y: op == "numbers" ? 12 : height / 2 - font.lineHeight / 2, width: width, height: font.lineHeight + 6).applying(transform)
                  let annotation = PDFAnnotation(bounds: bounds, forType: .freeText, withProperties: nil)
                  if rotation != 0 { try self.require(annotation.setValue(rotation, forAnnotationKey: PDFAnnotationKey(rawValue: "Rotate")), "Could not orient the label on this rotated page.") }
                  annotation.contents = text; annotation.font = font; annotation.fontColor = UIColor(red: 0.16, green: 0.2, blue: 0.27, alpha: op == "numbers" ? 1 : 0.22); annotation.color = .clear; annotation.alignment = .center
                  page.addAnnotation(annotation)
                } else { try self.addMarks(r["marks"] as? [[String: Any]] ?? [], page: page, number: number + 1) }
                progress(index + 1, pages.count)
              }
            }
            outputCount = pdf.pageCount
            var options: [PDFDocumentWriteOption: Any] = [:]
            if op == "protect" {
              let password = r["password"] as? String ?? ""
              try self.require((6...64).contains(password.count) && password.unicodeScalars.allSatisfy { (32...126).contains(Int($0.value)) }, "Use 6–64 printable English letters, numbers or symbols.")
              // This tool sets an opening password, not permission restrictions.
              options[.userPasswordOption] = password; options[.ownerPasswordOption] = password
            }
            try self.require(pdf.write(to: output(0), withOptions: options), "Could not save this PDF. Check available storage.")
            withExtendedLifetime(inserted) {}
          }
          for (partial, destination) in staged {
            try self.check(id)
            let bytes = (try manager.attributesOfItem(atPath: partial.path)[.size] as? NSNumber)?.int64Value ?? 0
            try self.require(bytes > 0, "The output is empty.")
            if destination.pathExtension.lowercased() == "pdf" {
              guard let verified = PDFDocument(url: partial) else { throw AdvancedFailure(message: "The saved PDF could not be verified.") }
              if op == "protect" { try self.require(verified.isEncrypted && verified.unlock(withPassword: r["password"] as? String ?? ""), "Password protection could not be verified.") }
              else {
                if verified.isLocked { try self.require(verified.unlock(withPassword: r["inputPassword"] as? String ?? ""), "The saved PDF could not be unlocked with its original password.") }
                try self.require(verified.isEncrypted == pdf.isEncrypted, "The saved PDF did not preserve its encryption. No output was kept.")
              }
              try self.require(!verified.isLocked && verified.pageCount == outputCount, "The saved PDF could not be verified.")
              if op == "repair" { for index in 0..<outputCount { try autoreleasepool { try self.check(id); guard let page = verified.page(at: index) else { throw AdvancedFailure(message: "A repaired page cannot be read.") }; _ = try self.bitmap(page, dpi: 15) } } }
            }
          }
          var outputs: [[String: Any]] = []
          if op == "compress" {
            for (partial, _) in staged {
              try self.check(id)
              let bytes = (try manager.attributesOfItem(atPath: partial.path)[.size] as? NSNumber)?.int64Value ?? 0
              if bytes >= size { try manager.removeItem(at: partial); try manager.copyItem(at: source, to: partial) }
            }
          }
          for (partial, destination) in staged { try self.check(id); try manager.moveItem(at: partial, to: destination); committed.append(destination); let bytes = (try manager.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.int64Value ?? 0; outputs.append(["uri": destination.absoluteString, "size": bytes, "pageCount": outputCount]) }
          var response: [String: Any] = ["outputs": outputs]
          if let ocrSummary { response["ocrSummary"] = ocrSummary }
          if (op == "ocr" && (r["ocrFormat"] as? String ?? "text") == "text") || op == "extract_text", let first = committed.first {
            let file = try FileHandle(forReadingFrom: first); defer { try? file.close() }
            response["textPreview"] = String(decoding: try file.read(upToCount: 16_000) ?? Data(), as: UTF8.self)
          }
          try self.check(id); return response
        }
        let encoded = try JSONSerialization.data(withJSONObject: result)
        promise.resolve(String(data: encoded, encoding: .utf8)!)
      } catch {
        committed.forEach { try? manager.removeItem(at: $0) }
        let cancelled = self.isCancelled(id) || error.localizedDescription == "PDF_CANCELLED"
        promise.reject(cancelled ? "PDF_CANCELLED" : "PDF_TOOL_FAILED", cancelled ? "Operation cancelled." : error.localizedDescription)
      }
    }
  }
  private func addMarks(_ marks: [[String: Any]], page: PDFPage, number: Int) throws {
    try require(marks.count <= 300, "Save after 300 annotations.")
    let box = page.bounds(for: .cropBox), rotation = (page.rotation % 360 + 360) % 360
    func point(_ value: [Double]) throws -> CGPoint {
      try require(value.count == 2 && value.allSatisfy { $0.isFinite && (0...1).contains($0) }, "Invalid drawing point.")
      let x = CGFloat(value[0]), y = CGFloat(value[1])
      switch rotation {
      case 90: return CGPoint(x: box.minX + y * box.width, y: box.minY + x * box.height)
      case 180: return CGPoint(x: box.maxX - x * box.width, y: box.minY + y * box.height)
      case 270: return CGPoint(x: box.maxX - y * box.width, y: box.maxY - x * box.height)
      default: return CGPoint(x: box.minX + x * box.width, y: box.maxY - y * box.height)
      }
    }
    for mark in marks where (mark["page"] as? Int) == number {
      let raw = mark["points"] as? [[Double]] ?? []
      try require((2...4096).contains(raw.count), "Invalid drawing.")
      let points = try raw.map { try point($0) }, kind = mark["kind"] as? String ?? "draw"
      let hex = (mark["color"] as? String ?? "#1D4ED8").replacingOccurrences(of: "#", with: "")
      let rgb = UInt32(hex, radix: 16) ?? 0x1D4ED8
      let color = UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: kind == "highlight" ? 0.3 : 1)
      let width = CGFloat(min(0.04, max(0.001, mark["width"] as? Double ?? 0.005))) * (rotation % 180 == 0 ? box.width : box.height)
      let border = PDFBorder(); border.lineWidth = width
      let annotation: PDFAnnotation
      if ["highlight", "rectangle", "ellipse"].contains(kind) {
        let bounds = CGRect(x: min(points[0].x, points[1].x), y: min(points[0].y, points[1].y), width: abs(points[1].x - points[0].x), height: abs(points[1].y - points[0].y))
        annotation = PDFAnnotation(bounds: bounds, forType: kind == "ellipse" ? .circle : .square, withProperties: nil)
        if kind == "highlight" { annotation.interiorColor = color; border.lineWidth = 0 }
      } else {
        annotation = PDFAnnotation(bounds: box, forType: .ink, withProperties: nil)
        let path = UIBezierPath(); path.move(to: CGPoint(x: points[0].x - box.minX, y: points[0].y - box.minY))
        for p in points.dropFirst() { path.addLine(to: CGPoint(x: p.x - box.minX, y: p.y - box.minY)) }
        annotation.add(path)
      }
      annotation.color = color; annotation.border = border; page.addAnnotation(annotation)
    }
  }
}

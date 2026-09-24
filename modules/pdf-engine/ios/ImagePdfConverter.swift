import ExpoModulesCore
import CoreGraphics
import ImageIO
import Foundation

struct ImagePdfOptions: Record {
  @Field var jobId = ""
  @Field var uris: [String] = []
  @Field var outputUri = ""
  @Field var pageSize = "a4"
}

private struct ConversionFailure: Error {
  let code: String
  let message: String
}

final class ImagePdfConverter {
  private let queue = DispatchQueue(label: "com.versara.pdf.convert", qos: .userInitiated)
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
    lock.lock()
    let shouldCancel = destroyed || cancelled.contains(id)
    lock.unlock()
    if shouldCancel { throw ConversionFailure(code: "PDF_CANCELLED", message: "Conversion cancelled.") }
  }

  func start(_ options: ImagePdfOptions, promise: Promise, progress: @escaping (Int, Int) -> Void) {
    lock.lock()
    guard !destroyed, active.count < 4, !active.contains(options.jobId) else {
      lock.unlock()
      promise.reject("PDF_BUSY", "Another PDF task is finishing or this tool has closed. Please try again.")
      return
    }
    active.insert(options.jobId); lock.unlock()
    queue.async {
      var partial: URL?
      var output: URL?
      var committed = false
      defer {
        if let partial { try? FileManager.default.removeItem(at: partial) }
        self.lock.lock(); self.cancelled.remove(options.jobId); self.active.remove(options.jobId); self.lock.unlock()
      }
      do {
        guard (1...30).contains(options.uris.count), ["a4", "letter", "image"].contains(options.pageSize) else {
          throw ConversionFailure(code: "PDF_INVALID_OPTIONS", message: "Choose between 1 and 30 images and a valid page size.")
        }
        let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Versara PDFs", isDirectory: true)
        guard let destination = URL(string: options.outputUri), destination.isFileURL,
          destination.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL.path == root.resolvingSymlinksInPath().standardizedFileURL.path,
          !FileManager.default.fileExists(atPath: destination.path) else {
          throw ConversionFailure(code: "PDF_INVALID_OUTPUT", message: "Choose a new PDF output location.")
        }
        output = destination
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let temporary = destination.appendingPathExtension("partial")
        guard !FileManager.default.fileExists(atPath: temporary.path) else {
          throw ConversionFailure(code: "PDF_INVALID_OUTPUT", message: "This output is already being created.")
        }
        partial = temporary
        try self.check(options.jobId)
        guard let context = CGContext(temporary as CFURL, mediaBox: nil, nil) else {
          throw ConversionFailure(code: "PDF_WRITE_FAILED", message: "Could not create the PDF. Check free storage.")
        }
        do {
          let budget = min(3_000_000, 24_000_000 / options.uris.count)
          for (index, value) in options.uris.enumerated() {
            try autoreleasepool {
              try self.check(options.jobId)
              let image = try self.decode(value, budget: budget)
              var width: CGFloat = options.pageSize == "letter" ? 612 : 595
              var height: CGFloat = options.pageSize == "letter" ? 792 : 842
              let margin: CGFloat = options.pageSize == "image" ? 0 : 18
              if options.pageSize == "image" {
                let ratio = 842 / CGFloat(max(image.width, image.height))
                width = max(1, (CGFloat(image.width) * ratio).rounded())
                height = max(1, (CGFloat(image.height) * ratio).rounded())
              } else if image.width > image.height { swap(&width, &height) }
              var box = CGRect(x: 0, y: 0, width: width, height: height)
              let data = NSData(bytes: &box, length: MemoryLayout<CGRect>.size)
              context.beginPDFPage([kCGPDFContextMediaBox: data] as CFDictionary)
              context.setFillColor(CGColor(gray: 1, alpha: 1))
              context.fill(box)
              let scale = min((width - margin * 2) / CGFloat(image.width), (height - margin * 2) / CGFloat(image.height))
              let dw = CGFloat(image.width) * scale
              let dh = CGFloat(image.height) * scale
              context.interpolationQuality = .high
              context.draw(image, in: CGRect(x: (width - dw) / 2, y: (height - dh) / 2, width: dw, height: dh))
              context.endPDFPage()
            }
            progress(index + 1, options.uris.count)
          }
          context.closePDF()
        } catch { context.closePDF(); throw error }
        try self.check(options.jobId)
        guard let pdf = CGPDFDocument(temporary as CFURL), pdf.numberOfPages == options.uris.count else {
          throw ConversionFailure(code: "PDF_WRITE_FAILED", message: "Could not finish the PDF. Check free storage.")
        }
        try FileManager.default.moveItem(at: temporary, to: destination)
        committed = true
        try self.check(options.jobId)
        let size = (try FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.doubleValue ?? 0
        promise.resolve(["uri": destination.absoluteString, "pageCount": options.uris.count, "size": size])
      } catch {
        if committed, let output { try? FileManager.default.removeItem(at: output) }
        if let failure = error as? ConversionFailure { promise.reject(failure.code, failure.message) }
        else { promise.reject("PDF_CONVERSION_FAILED", "Could not convert the images. Check the files and available storage.") }
      }
    }
  }

  private func decode(_ value: String, budget: Int) throws -> CGImage {
    let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath().path + "/"
    guard let url = URL(string: value), url.isFileURL, url.resolvingSymlinksInPath().path.hasPrefix(cache),
      let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let w = properties[kCGImagePropertyPixelWidth] as? NSNumber,
      let h = properties[kCGImagePropertyPixelHeight] as? NSNumber, w.doubleValue > 0, h.doubleValue > 0 else {
      throw ConversionFailure(code: "PDF_INVALID_IMAGE", message: "An image is unreadable. Choose JPG, PNG or HEIC files using Browse files.")
    }
    let scale = min(1, sqrt(Double(budget) / (w.doubleValue * h.doubleValue)))
    let edge = max(1, min(2200, Int(max(w.doubleValue, h.doubleValue) * scale)))
    let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: edge,
      kCGImageSourceShouldCacheImmediately: true]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      throw ConversionFailure(code: "PDF_IMAGE_UNSUPPORTED", message: "This image could not be decoded. Try another image.")
    }
    return image
  }
}

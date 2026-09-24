import ExpoModulesCore
import PDFKit
import AVFoundation
import UIKit
import ImageIO

final class FileThumbnailer {
  private let worker = DispatchQueue(label: "com.versara.thumbnails", qos: .utility)
  private let lock = NSLock()
  private var jobs: [String: Bool] = [:]
  private var stopped = false
  func cancel(_ id: String) { lock.lock(); if jobs[id] != nil { jobs[id] = true }; lock.unlock() }
  func destroy() { lock.lock(); stopped = true; lock.unlock() }
  private func cancelled(_ id: String) -> Bool { lock.lock(); defer { lock.unlock() }; return stopped || jobs[id] == true }
  func render(_ id: String, uri: String, kind: String, page: Int, outputUri: String, promise: Promise) {
    lock.lock()
    guard !stopped, jobs.count < 4 else { lock.unlock(); promise.reject("THUMBNAIL_UNAVAILABLE", "Preview unavailable."); return }
    jobs[id] = false; lock.unlock()
    worker.async {
      defer { self.lock.lock(); self.jobs.removeValue(forKey: id); self.lock.unlock() }
      autoreleasepool {
        do {
          let fm = FileManager.default
          let cache = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath()
          let documents = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath()
          guard !self.cancelled(id), let input = URL(string: uri), input.isFileURL,
            let output = URL(string: outputUri), output.isFileURL,
            input.resolvingSymlinksInPath().path.hasPrefix(cache.path + "/") || input.resolvingSymlinksInPath().path.hasPrefix(documents.path + "/"),
            output.deletingLastPathComponent().resolvingSymlinksInPath().path == cache.appendingPathComponent("versara-thumbnails").path,
            !fm.fileExists(atPath: output.path) else { throw NSError(domain: "Thumbnail", code: 1) }
          var image: UIImage?
          if kind == "pdf" {
            guard let document = PDFDocument(url: input), !document.isLocked, let pdfPage = document.page(at: page) else { throw NSError(domain: "Thumbnail", code: 2) }
            image = pdfPage.thumbnail(of: CGSize(width: 240, height: 240), for: .cropBox)
          } else if kind == "video" {
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: input))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 240, height: 240)
            defer { generator.cancelAllCGImageGeneration() }
            image = UIImage(cgImage: try generator.copyCGImage(at: .zero, actualTime: nil))
          }
          guard !self.cancelled(id), let data = image?.jpegData(compressionQuality: 0.8) else { throw NSError(domain: "Thumbnail", code: 3) }
          try fm.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
          try data.write(to: output, options: .atomic)
          if self.cancelled(id) { try? fm.removeItem(at: output); throw NSError(domain: "Thumbnail", code: 4) }
          promise.resolve(outputUri)
        } catch { promise.reject("THUMBNAIL_UNAVAILABLE", "Preview unavailable.") }
      }
    }
  }
}

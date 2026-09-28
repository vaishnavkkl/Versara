import Foundation
import UIKit
import ImageIO
import UniformTypeIdentifiers

/// Separate, raster-only privacy pipeline; no original metadata, alpha-hidden pixels or overlays survive.
enum ImagePrivacyExport {
  private struct Area {
    let x: Double, y: Double, width: Double, height: Double
    func pixels(_ width: Int, _ height: Int) -> PixelArea {
      PixelArea(left: max(0, Int(floor(x * Double(width))) - 1), top: max(0, Int(floor(y * Double(height))) - 1),
        right: min(width, Int(ceil((x + self.width) * Double(width))) + 1),
        bottom: min(height, Int(ceil((y + self.height) * Double(height))) + 1))
    }
  }
  private struct PixelArea { let left: Int, top: Int, right: Int, bottom: Int }
  private static func fail(_ message: String) -> Error { ImageEditing.EditError.invalid(message) }
  private static func local(_ value: String) throws -> URL {
    guard let raw = URL(string: value), raw.isFileURL else { throw fail("Choose a local image.") }
    let url = raw.resolvingSymlinksInPath().standardizedFileURL
    let roots = [FileManager.SearchPathDirectory.documentDirectory, .cachesDirectory].map { FileManager.default.urls(for: $0, in: .userDomainMask)[0].resolvingSymlinksInPath().path + "/" }
    guard roots.contains(where: { url.path.hasPrefix($0) }) else { throw fail("Choose the image again.") }
    return url
  }
  static func process(_ request: [String: Any], check: () throws -> Void) throws -> [String: Any] {
    try check()
    let allowed: Set<String> = ["action", "tool", "uri", "outputUri", "rects", "format"]
    guard Set(request.keys).isSubset(of: allowed), (request["format"] as? String ?? "png") == "png" else { throw fail("Privacy saves only support opaque PNG redactions.") }
    guard let action = request["action"] as? String, ["preview", "export"].contains(action),
          let values = request["rects"] as? [[String: Any]], values.count <= 300 else { throw fail("Choose up to 300 valid redaction areas.") }
    let areas = try values.map { value -> Area in
      let area = Area(x: (value["x"] as? NSNumber)?.doubleValue ?? .nan, y: (value["y"] as? NSNumber)?.doubleValue ?? .nan,
        width: (value["width"] as? NSNumber)?.doubleValue ?? .nan, height: (value["height"] as? NSNumber)?.doubleValue ?? .nan)
      guard [area.x, area.y, area.width, area.height].allSatisfy({ $0.isFinite }), area.x >= 0, area.y >= 0, area.width > 0, area.height > 0,
            area.x + area.width <= 1.00000001, area.y + area.height <= 1.00000001 else { throw fail("Keep each redaction area inside the image.") }
      return area
    }
    let source = try local(request["uri"] as? String ?? ""), destination = try local(request["outputUri"] as? String ?? "")
    guard !FileManager.default.fileExists(atPath: destination.path) else { throw fail("Choose a new output name.") }
    guard let original = ImageEditing.originalSize(uri: source.absoluteString) else { throw fail("Choose a readable image.") }
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    let encoded = destination.deletingLastPathComponent().appendingPathComponent("privacy-encode-\(UUID().uuidString).partial")
    let cleaned = destination.deletingLastPathComponent().appendingPathComponent("privacy-clean-\(UUID().uuidString).partial")
    defer { try? FileManager.default.removeItem(at: encoded); try? FileManager.default.removeItem(at: cleaned) }
    // The autorelease boundary releases the source and rendered frame before reopening the PNG.
    let dimensions = try autoreleasepool { try render(source, to: encoded, preview: action == "preview", areas: areas, check: check) }
    try cleanPng(encoded, to: cleaned, check: check)
    try check()
    try autoreleasepool { try verify(cleaned, width: dimensions.0, height: dimensions.1, areas: areas, check: check) }
    try check()
    try FileManager.default.moveItem(at: cleaned, to: destination)
    do { try check() } catch { try? FileManager.default.removeItem(at: destination); throw error }
    return ["uri": destination.absoluteString, "width": dimensions.0, "height": dimensions.1,
      "size": (try destination.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0, "mimeType": "image/png",
      "sourceWidth": Int(original.width), "sourceHeight": Int(original.height), "metadataRemoved": true, "redactionCount": areas.count]
  }

  private static func canvas(_ width: Int, _ height: Int) throws -> CGContext {
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { throw fail("Could not prepare privacy image memory.") }
    return context
  }
  private static func render(_ source: URL, to destination: URL, preview: Bool, areas: [Area], check: () throws -> Void) throws -> (Int, Int) {
    let image: CGImage
    if preview {
      guard let decoded = ImageEditing.load(uri: source.absoluteString, maxPixels: 1440) else { throw fail("Could not read this image.") }
      image = decoded
    } else { image = try ImageEditing.loadExport(uri: source.absoluteString) }
    try check()
    let context = try canvas(image.width, image.height)
    context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: image.width, height: image.height))
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    guard let pixels = context.data?.assumingMemoryBound(to: UInt8.self) else { throw fail("Could not prepare opaque redactions.") }
    // CGImage bitmap rows use top-left image coordinates. Write full RGBA pixels, without antialiasing.
    let rectangles = areas.map { $0.pixels(image.width, image.height) }
    let top = rectangles.map(\.top).min() ?? 0, bottom = rectangles.map(\.bottom).max() ?? 0
    for y in top..<bottom {
      let spans = rectangles.filter { y >= $0.top && y < $0.bottom }.sorted { $0.left < $1.left }
      var painted = 0
      for area in spans {
        try check()
        if area.right > max(painted, area.left) {
          for x in max(painted, area.left)..<area.right {
            let offset = y * context.bytesPerRow + x * 4
            pixels[offset] = 0; pixels[offset + 1] = 0; pixels[offset + 2] = 0; pixels[offset + 3] = 255
          }
        }
        painted = max(painted, area.right)
      }
    }
    guard let rendered = context.makeImage(), let writer = CGImageDestinationCreateWithURL(destination as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw fail("Could not create the privacy image.") }
    try check()
    CGImageDestinationAddImage(writer, rendered, nil)
    guard CGImageDestinationFinalize(writer) else { throw fail("Could not encode the privacy image.") }
    return (image.width, image.height)
  }

  /// Keep only PNG pixel-encoding chunks; strip EXIF/XMP/text/thumbnail/profile and reject trailing bytes.
  private static func cleanPng(_ input: URL, to output: URL, check: () throws -> Void) throws {
    let source = try FileHandle(forReadingFrom: input)
    defer { try? source.close() }
    guard FileManager.default.createFile(atPath: output.path, contents: nil) else { throw fail("Could not prepare the verified image.") }
    let target = try FileHandle(forWritingTo: output)
    defer { try? target.close() }
    let size = (try input.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0
    func read(_ count: Int) throws -> Data {
      var result = Data()
      while result.count < count {
        try check()
        guard let part = try source.read(upToCount: count - result.count), !part.isEmpty else { throw fail("The encoded PNG is incomplete.") }
        result.append(part)
      }
      return result
    }
    let signature = Data([137, 80, 78, 71, 13, 10, 26, 10])
    guard try read(8) == signature else { throw fail("Privacy export must be PNG.") }
    try target.write(contentsOf: signature)
    let allowed: Set<String> = ["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]
    var consumed = 8, chunks = 0, hasData = false, done = false
    while !done {
      try check(); chunks += 1
      guard chunks <= 100000, size - consumed >= 12 else { throw fail("The encoded PNG is incomplete.") }
      let header = try read(8)
      let length = header.prefix(4).reduce(0) { ($0 << 8) | Int($1) }
      let typeBytes = header.suffix(4)
      let type = String(data: typeBytes, encoding: .ascii) ?? ""
      guard length <= size - consumed - 12, chunks != 1 || type == "IHDR" && length == 13,
            type != "IHDR" || chunks == 1 else { throw fail("The encoded PNG is invalid.") }
      let keep = allowed.contains(type)
      guard keep || ((typeBytes.first ?? 0) & 32) != 0 else { throw fail("The PNG encoding cannot be verified.") }
      if keep { try target.write(contentsOf: header) }
      var remaining = length
      while remaining > 0 {
        let count = min(32768, remaining), part = try read(min(32768, remaining))
        if keep { try target.write(contentsOf: part) }
        remaining -= count
      }
      let crc = try read(4); if keep { try target.write(contentsOf: crc) }
      consumed += length + 12
      if type == "IDAT" { hasData = true }
      if type == "IEND" {
        guard length == 0, hasData, consumed == size else { throw fail("The encoded PNG contains unexpected data.") }
        done = true
      }
    }
  }

  private static func verify(_ file: URL, width: Int, height: Int, areas: [Area], check: () throws -> Void) throws {
    guard let source = CGImageSourceCreateWithURL(file as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
          CGImageSourceGetCount(source) == 1, let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          image.width == width, image.height == height else { throw fail("Could not verify the saved privacy image.") }
    try check()
    if areas.isEmpty { return }
    let context = try canvas(width, height)
    context.setBlendMode(.copy); context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let pixels = context.data?.assumingMemoryBound(to: UInt8.self) else { throw fail("Could not verify opaque redactions.") }
    let rectangles = areas.map { $0.pixels(width, height) }
    let top = rectangles.map(\.top).min() ?? 0, bottom = rectangles.map(\.bottom).max() ?? 0
    for y in top..<bottom {
      try check()
      let spans = rectangles.filter { y >= $0.top && y < $0.bottom }.sorted { $0.left < $1.left }
      var verified = 0
      for span in spans {
        if span.right > max(verified, span.left) {
          for x in max(verified, span.left)..<span.right {
            let offset = y * context.bytesPerRow + x * 4
            guard pixels[offset] == 0, pixels[offset + 1] == 0, pixels[offset + 2] == 0, pixels[offset + 3] == 255 else { throw fail("The saved redaction is not fully opaque. No file was saved.") }
          }
        }
        verified = max(verified, span.right)
      }
    }
  }
}

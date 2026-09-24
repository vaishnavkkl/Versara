import UIKit
import Vision
import ImageIO
import UniformTypeIdentifiers

/// On-device text recognition (Apple Vision) and redraw. Coordinates are normalised to the upright image.
enum ImageText {
  private static let analysisSize: CGFloat = 2048
  private static let maxLines = 400

  private struct Pixels {
    let data: [UInt8]; let width: Int; let height: Int
    init?(_ image: CGImage) {
      width = image.width; height = image.height
      var buffer = [UInt8](repeating: 0, count: width * height * 4)
      guard let context = CGContext(data: &buffer, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      data = buffer
    }
    func at(_ x: Int, _ y: Int) -> Int {
      let i = (min(max(y, 0), height - 1) * width + min(max(x, 0), width - 1)) * 4
      return Int(data[i]) << 16 | Int(data[i + 1]) << 8 | Int(data[i + 2])
    }
  }

  static func recognize(uri: String) throws -> [String: Any] {
    guard let image = ImageEditing.load(uri: uri, maxPixels: analysisSize) else { throw ImageEditing.EditError.invalid("This image format cannot be read on your device.") }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let pixels = Pixels(image)
    var lines: [[String: Any]] = []
    for observation in request.results ?? [] {
      guard lines.count < maxLines, let candidate = observation.topCandidates(1).first, !candidate.string.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
      let box = observation.boundingBox
      let rect = CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height)
      var line: [String: Any] = ["id": lines.count, "text": candidate.string, "x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height, "angle": 0]
      if let pixels {
        let colors = sample(pixels, CGRect(x: rect.minX * CGFloat(pixels.width), y: rect.minY * CGFloat(pixels.height), width: rect.width * CGFloat(pixels.width), height: rect.height * CGFloat(pixels.height)))
        line["color"] = colors.text; line["background"] = colors.background
        line["backgroundLeft"] = colors.left; line["backgroundRight"] = colors.right
      } else {
        line["color"] = 0x101010; line["background"] = 0xFFFFFF; line["backgroundLeft"] = 0xFFFFFF; line["backgroundRight"] = 0xFFFFFF
      }
      lines.append(line)
    }
    return ["width": image.width, "height": image.height, "lines": lines]
  }

  private static func channel(_ color: Int, _ shift: Int) -> Int { color >> shift & 255 }
  private static func median(_ colors: [Int]) -> Int {
    guard !colors.isEmpty else { return 0xFFFFFF }
    func m(_ shift: Int) -> Int { colors.map { channel($0, shift) }.sorted()[colors.count / 2] }
    return m(16) << 16 | m(8) << 8 | m(0)
  }
  private static func average(_ colors: [Int]) -> Int {
    guard !colors.isEmpty else { return 0 }
    func a(_ shift: Int) -> Int { colors.reduce(0) { $0 + channel($1, shift) } / colors.count }
    return a(16) << 16 | a(8) << 8 | a(0)
  }
  private static func distance(_ a: Int, _ b: Int) -> Double {
    let dr = Double(channel(a, 16) - channel(b, 16)), dg = Double(channel(a, 8) - channel(b, 8)), db = Double(channel(a, 0) - channel(b, 0))
    return (dr * dr + dg * dg + db * db).squareRoot()
  }

  /// Median of the pixels around the box is the background; the pixels farthest from it are the ink.
  private static func sample(_ pixels: Pixels, _ rect: CGRect) -> (background: Int, left: Int, right: Int, text: Int) {
    let pad = max(2, Int(rect.height * 0.18))
    let l = Int(rect.minX) - pad, r = Int(rect.maxX) + pad, t = Int(rect.minY) - pad, b = Int(rect.maxY) + pad
    var border: [Int] = [], leftEdge: [Int] = [], rightEdge: [Int] = []
    for x in stride(from: l, through: r, by: max(1, (r - l) / 80)) { border.append(pixels.at(x, t)); border.append(pixels.at(x, b)) }
    for y in stride(from: t, through: b, by: max(1, (b - t) / 30)) { leftEdge.append(pixels.at(l, y)); rightEdge.append(pixels.at(r, y)) }
    border += leftEdge + rightEdge
    let background = median(border)
    var inner: [Int] = []
    for y in stride(from: Int(rect.minY), through: Int(rect.maxY), by: max(1, Int(rect.height) / 20)) {
      for x in stride(from: Int(rect.minX), through: Int(rect.maxX), by: max(1, Int(rect.width) / 60)) { inner.append(pixels.at(x, y)) }
    }
    let distances = inner.map { distance($0, background) }
    let farthest = distances.max() ?? 0
    let text: Int
    if farthest < 40 {
      let luminance = (0.299 * Double(channel(background, 16)) + 0.587 * Double(channel(background, 8)) + 0.114 * Double(channel(background, 0))) / 255
      text = luminance > 0.5 ? 0x101010 : 0xFFFFFF
    } else {
      text = average(zip(inner, distances).filter { $0.1 >= farthest * 0.6 }.map { $0.0 })
    }
    return (background, median(leftEdge.isEmpty ? border : leftEdge), median(rightEdge.isEmpty ? border : rightEdge), text)
  }

  /// Maps the standard PDF font names (Helvetica, Times, Courier with Bold/Oblique/Italic) to iOS faces.
  static func font(_ name: String, size: CGFloat) -> UIFont {
    let bold = name.contains("Bold"), italic = name.contains("Oblique") || name.contains("Italic")
    let face: String
    if name.hasPrefix("Times") {
      face = bold && italic ? "TimesNewRomanPS-BoldItalicMT" : bold ? "TimesNewRomanPS-BoldMT" : italic ? "TimesNewRomanPS-ItalicMT" : "TimesNewRomanPSMT"
    } else {
      let family = name.hasPrefix("Courier") ? "Courier" : "Helvetica"
      face = family + (bold && italic ? "-BoldOblique" : bold ? "-Bold" : italic ? "-Oblique" : "")
    }
    if let font = UIFont(name: face, size: size) { return font }
    var traits: UIFontDescriptor.SymbolicTraits = []
    if bold { traits.insert(.traitBold) }
    if italic { traits.insert(.traitItalic) }
    let system = UIFont.systemFont(ofSize: size)
    return system.fontDescriptor.withSymbolicTraits(traits).map { UIFont(descriptor: $0, size: size) } ?? system
  }
  private static func color(_ value: Int) -> UIColor {
    UIColor(red: CGFloat(value >> 16 & 255) / 255, green: CGFloat(value >> 8 & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
  }

  /// Covers replaced lines with the sampled background and draws text at its baseline.
  /// Sizes are in pixels of an image `refWidth` wide, so previews and full exports match.
  static func render(_ options: [String: Any]) throws -> [String: Any] {
    guard let uri = options["uri"] as? String, let output = options["outputUri"] as? String, let destination = URL(string: output), destination.isFileURL else {
      throw ImageEditing.EditError.invalid("Choose an image to edit.")
    }
    let roots = [FileManager.SearchPathDirectory.documentDirectory, .cachesDirectory].map { FileManager.default.urls(for: $0, in: .userDomainMask)[0].resolvingSymlinksInPath().path }
    let path = destination.resolvingSymlinksInPath().path
    guard roots.contains(where: { path.hasPrefix($0 + "/") }), !FileManager.default.fileExists(atPath: destination.path) else {
      throw ImageEditing.EditError.invalid("Could not save inside Versara.")
    }
    let preview = options["preview"] as? Bool ?? false
    let lowMemory = ProcessInfo.processInfo.physicalMemory <= 2 * 1024 * 1024 * 1024
    let limit = CGFloat(min(max(options["maxSize"] as? Int ?? (lowMemory ? 3072 : 4096), 256), 4096))
    guard let source = ImageEditing.load(uri: uri, maxPixels: limit) else { throw ImageEditing.EditError.invalid("This image format cannot be edited on your device.") }
    let edits = options["edits"] as? [[String: Any]] ?? []
    guard edits.count <= 500 else { throw ImageEditing.EditError.invalid("Save these changes before adding more.") }
    let size = CGSize(width: source.width, height: source.height)
    let ratio = size.width / max(1, CGFloat((options["refWidth"] as? NSNumber)?.doubleValue ?? Double(size.width)))
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
      UIImage(cgImage: source).draw(in: CGRect(origin: .zero, size: size))
      let cg = context.cgContext
      for edit in edits {
        if let box = edit["erase"] as? [String: Any] {
          let x = (box["x"] as? NSNumber)?.doubleValue ?? 0, y = (box["y"] as? NSNumber)?.doubleValue ?? 0
          let w = (box["width"] as? NSNumber)?.doubleValue ?? 0, h = (box["height"] as? NSNumber)?.doubleValue ?? 0
          var rect = CGRect(x: x * size.width, y: y * size.height, width: w * size.width, height: h * size.height)
          let pad = max(2, rect.height * 0.15)
          rect = rect.insetBy(dx: -pad, dy: -pad)
          let fallback = box["background"] as? Int ?? 0xFFFFFF
          let colors = [color(box["left"] as? Int ?? fallback).cgColor, color(box["right"] as? Int ?? fallback).cgColor] as CFArray
          if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
            cg.saveGState()
            cg.addPath(UIBezierPath(roundedRect: rect, cornerRadius: pad).cgPath)
            cg.clip()
            cg.drawLinearGradient(gradient, start: CGPoint(x: rect.minX, y: 0), end: CGPoint(x: rect.maxX, y: 0), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            cg.restoreGState()
          }
        }
        if let text = edit["text"] as? String, !text.trimmingCharacters(in: .whitespaces).isEmpty {
          let points = CGFloat((edit["size"] as? NSNumber)?.doubleValue ?? 16) * ratio
          let face = font(edit["font"] as? String ?? "Helvetica", size: max(1, points))
          let x = CGFloat((edit["x"] as? NSNumber)?.doubleValue ?? 0) * size.width
          let baseline = CGFloat((edit["y"] as? NSNumber)?.doubleValue ?? 0) * size.height
          var attributes: [NSAttributedString.Key: Any] = [.font: face, .foregroundColor: color(edit["color"] as? Int ?? 0x101010)]
          if edit["underline"] as? Bool == true { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
          for (line, value) in text.components(separatedBy: "\n").prefix(50).enumerated() where !value.isEmpty {
            (value as NSString).draw(at: CGPoint(x: x, y: baseline + CGFloat(line) * face.pointSize * 1.2 - face.ascender), withAttributes: attributes)
          }
        }
      }
    }
    guard let image = rendered.cgImage else { throw ImageEditing.EditError.invalid("Could not render the image.") }
    let type: UTType = !preview && (options["format"] as? String) == "png" ? .png : .jpeg
    let quality = preview ? 0.85 : Double(min(max(options["quality"] as? Int ?? 92, 10), 100)) / 100
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let writer = CGImageDestinationCreateWithURL(destination as CFURL, type.identifier as CFString, 1, nil) else { throw ImageEditing.EditError.invalid("Could not create the image file.") }
    CGImageDestinationAddImage(writer, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(writer) else {
      try? FileManager.default.removeItem(at: destination)
      throw ImageEditing.EditError.invalid("Could not encode the image.")
    }
    let bytes = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
    return ["uri": output, "width": image.width, "height": image.height, "size": bytes, "mimeType": type == .png ? "image/png" : "image/jpeg"]
  }
}

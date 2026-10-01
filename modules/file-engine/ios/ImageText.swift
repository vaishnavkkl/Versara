import UIKit
import CoreText
import Vision
import ImageIO
import UniformTypeIdentifiers

/// On-device text recognition (Apple Vision) and redraw. Coordinates are normalised to the upright image.
enum ImageText {
  private static let analysisSize: CGFloat = 2048
  private static let maxLines = 400
  private static let recognitionLock = NSLock()
  private static var recognitions: [String: Recognition] = [:]

  final class Recognition {
    let uri: String
    let key: String
    let request = VNRecognizeTextRequest()
    fileprivate var cancelled = false
    init(uri: String, key: String) { self.uri = uri; self.key = key }
  }

  static func prepareRecognition(uri: String, key: String? = nil) throws -> Recognition {
    recognitionLock.lock(); defer { recognitionLock.unlock() }
    let identity = key ?? uri
    if let previous = recognitions[identity] { previous.cancelled = true; previous.request.cancel() }
    guard recognitions[identity] != nil || recognitions.count < 4 else { throw ImageEditing.EditError.invalid("Wait for the current text recognition to finish.") }
    let operation = Recognition(uri: uri, key: identity)
    recognitions[identity] = operation
    return operation
  }

  static func cancelRecognition(_ operation: Recognition) {
    recognitionLock.lock(); defer { recognitionLock.unlock() }
    operation.cancelled = true; operation.request.cancel()
  }

  static func cancelRecognition(uri: String) {
    recognitionLock.lock(); defer { recognitionLock.unlock() }
    if let operation = recognitions[uri] { operation.cancelled = true; operation.request.cancel() }
  }

  static func cancelAllRecognition() {
    recognitionLock.lock(); defer { recognitionLock.unlock() }
    for operation in recognitions.values { operation.cancelled = true; operation.request.cancel() }
  }

  static func finishRecognition(_ operation: Recognition) {
    recognitionLock.lock(); defer { recognitionLock.unlock() }
    if recognitions[operation.key] === operation { recognitions.removeValue(forKey: operation.key) }
  }

  private static func checkRecognition(_ operation: Recognition) throws {
    recognitionLock.lock(); defer { recognitionLock.unlock() }
    if operation.cancelled { throw CancellationError() }
  }

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

  static func recognize(uri: String, operation: Recognition, fonts: [String: String] = [:]) throws -> [String: Any] {
    try checkRecognition(operation)
    let candidates = standardFonts.map { ($0, "") } + fonts.sorted { $0.key < $1.key }.prefix(64).map { ($0.key, $0.value) }
    guard let image = ImageEditing.load(uri: uri, maxPixels: analysisSize) else { throw ImageEditing.EditError.invalid("This image format cannot be read on your device.") }
    let request = operation.request
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    try checkRecognition(operation)
    do { try VNImageRequestHandler(cgImage: image, options: [:]).perform([request]) }
    catch { try checkRecognition(operation); throw error }
    try checkRecognition(operation)
    let pixels = Pixels(image)
    var lines: [[String: Any]] = []
    for observation in request.results ?? [] {
      try checkRecognition(operation)
      guard lines.count < maxLines, let candidate = observation.topCandidates(1).first, !candidate.string.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
      let box = observation.boundingBox
      let rect = CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height)
      var line: [String: Any] = ["id": lines.count, "text": candidate.string, "x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height, "angle": 0]
      if let pixels {
        let colors = sample(pixels, CGRect(x: rect.minX * CGFloat(pixels.width), y: rect.minY * CGFloat(pixels.height), width: rect.width * CGFloat(pixels.width), height: rect.height * CGFloat(pixels.height)))
        line["color"] = colors.text; line["background"] = colors.background
        line["backgroundLeft"] = colors.left; line["backgroundRight"] = colors.right
        if let style = inkStyle(pixels, rect, candidate.string, colors, candidates: fonts.isEmpty || lines.count >= shapeMatchLines ? [] : candidates) { line.merge(style) { $1 } }
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

  /// Estimates the line's face from its pixels: the tight ink box sets size, baseline and start,
  /// measured against the recognized text's own glyph bounds; the typical stem width sets the weight.
  /// `rect` is normalised; sizes are pixels of the analysed image, matching the edit reference width.
  private static let standardFonts = [
    "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
    "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
    "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
  ]
  private static let shapeMatchLines = 120
  private static let shapeGrid = 28

  private static func inkStyle(_ pixels: Pixels, _ rect: CGRect, _ text: String, _ colors: (background: Int, left: Int, right: Int, text: Int), candidates: [(String, String)] = []) -> [String: Any]? {
    let contrast = distance(colors.text, colors.background)
    guard contrast >= 40 else { return nil }
    let threshold = Int(contrast * contrast * 0.25)
    // Vision boxes can clip descenders, so search slightly beyond them.
    let pad = rect.height * CGFloat(pixels.height) * 0.08
    let x0 = max(0, Int(rect.minX * CGFloat(pixels.width))), x1 = min(pixels.width - 1, Int(rect.maxX * CGFloat(pixels.width)))
    let y0 = max(0, Int(rect.minY * CGFloat(pixels.height) - pad)), y1 = min(pixels.height - 1, Int(rect.maxY * CGFloat(pixels.height) + pad))
    guard x1 - x0 >= 4, y1 - y0 >= 4 else { return nil }
    let br = channel(colors.background, 16), bg = channel(colors.background, 8), bb = channel(colors.background, 0)
    func ink(_ x: Int, _ y: Int) -> Bool {
      let i = (y * pixels.width + x) * 4
      let dr = Int(pixels.data[i]) - br, dg = Int(pixels.data[i + 1]) - bg, db = Int(pixels.data[i + 2]) - bb
      return dr * dr + dg * dg + db * db >= threshold
    }
    let minimum = x1 - x0 > 20 ? 2 : 1
    var top = -1, bottom = -1, left = x1 + 1, right = -1
    for y in y0...y1 {
      var count = 0
      for x in x0...x1 where ink(x, y) { count += 1; left = min(left, x); right = max(right, x) }
      if count >= minimum { if top < 0 { top = y }; bottom = y }
    }
    guard top >= 0, bottom - top >= 3, right > left else { return nil }
    let inkHeight = CGFloat(bottom - top + 1)
    var runs: [Int] = []
    let from = top + (bottom - top + 1) * 3 / 10, to = top + (bottom - top + 1) * 7 / 10
    for y in stride(from: from, through: to, by: max(1, (to - from) / 6)) {
      var run = 0
      for x in x0...x1 { if ink(x, y) { run += 1 } else if run > 0 { runs.append(run); run = 0 } }
      if run > 0 { runs.append(run) }
    }
    let stroke = runs.isEmpty ? 0 : CGFloat(runs.sorted()[runs.count / 2])
    func line(_ name: String, _ file: String = "") -> CTLine {
      CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [.font: font(name, size: 100, file: file), NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String): true]))
    }
    func glyphs(_ name: String, _ file: String = "") -> (bounds: CGRect, width: CGFloat)? {
      let bounds = CTLineGetBoundsWithOptions(line(name, file), .useGlyphPathBounds)
      guard bounds.height > 0 else { return nil }
      return (bounds, bounds.width)
    }
    guard let regular = glyphs("Helvetica") else { return nil }
    let probe = 100 * inkHeight / regular.bounds.height
    // Small text quantises stems to whole pixels, so it needs a clearer margin before reading as bold.
    var bold = stroke / probe > (probe >= 16 ? 0.12 : 0.16)
    let inkWidth = CGFloat(right - left + 1)
    var best: (font: String, bounds: CGRect, size: CGFloat, ratio: CGFloat, miss: CGFloat)?
    let inkRows = bottom - top + 1
    if !candidates.isEmpty, inkRows >= 8, text.filter({ !$0.isWhitespace }).count >= 2 {
      // Shape match: draw the recognized text in every face, stretched onto the same grid as the
      // original ink, and keep the face whose glyphs overlap the ink most (intersection over union).
      // Faces that need a large horizontal stretch to fit lose a little, so proportions still count.
      let gh = min(shapeGrid, inkRows)
      let gw = min(max(Int((CGFloat(gh) * inkWidth / CGFloat(inkRows)).rounded()), 8), 640)
      var hits = [Int](repeating: 0, count: gw * gh), totals = hits
      for y in top...bottom {
        let gy = min((y - top) * gh / inkRows, gh - 1)
        for x in left...right {
          let cell = gy * gw + min((x - left) * gw / Int(inkWidth), gw - 1)
          totals[cell] += 1; if ink(x, y) { hits[cell] += 1 }
        }
      }
      let target = (0..<(gw * gh)).map { totals[$0] > 0 && hits[$0] * 2 >= totals[$0] }
      if let context = CGContext(data: nil, width: gw, height: gh, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue),
         let data = context.data?.assumingMemoryBound(to: UInt8.self) {
        let stride = context.bytesPerRow
        var score = -CGFloat.greatestFiniteMagnitude
        for (name, file) in candidates {
          let drawn = line(name, file)
          let bounds = CTLineGetBoundsWithOptions(drawn, .useGlyphPathBounds)
          guard bounds.width > 0, bounds.height > 0 else { continue }
          context.saveGState()
          context.setFillColor(gray: 0, alpha: 1); context.fill(CGRect(x: 0, y: 0, width: gw, height: gh))
          context.setFillColor(gray: 1, alpha: 1)
          context.scaleBy(x: CGFloat(gw) / bounds.width, y: CGFloat(gh) / bounds.height)
          context.translateBy(x: -bounds.minX, y: -bounds.minY)
          context.textPosition = .zero
          CTLineDraw(drawn, context)
          context.restoreGState()
          var both = 0, either = 0
          for y in 0..<gh { for x in 0..<gw {
            let mark = data[y * stride + x] >= 128, original = target[y * gw + x]
            if mark && original { both += 1 }
            if mark || original { either += 1 }
          } }
          guard either > 0 else { continue }
          let fitted = 100 * inkHeight / bounds.height
          let ratio = inkWidth / (bounds.width * fitted / 100)
          let value = CGFloat(both) / CGFloat(either) - 0.25 * abs(log(ratio)) + (file.isEmpty ? 0.01 : 0)
          if value > score { score = value; best = (name, bounds, fitted, ratio, 0) }
        }
      }
      if let best { bold = best.font.contains("Bold") || best.font.contains("Black") }
    }
    if best == nil {
      // The family whose glyphs, at the line's ink height, span the line's ink width most closely.
      // Helvetica wins near-ties because most screenshots and documents use a sans face.
      for candidate in bold ? ["Helvetica-Bold", "Times-Bold", "Courier-Bold"] : ["Helvetica", "Times-Roman", "Courier"] {
        guard let face = glyphs(candidate), face.bounds.width > 0 else { continue }
        let fitted = 100 * inkHeight / face.bounds.height
        let width = face.bounds.width * fitted / 100
        let miss = abs(log(inkWidth / width)) + (candidate.hasPrefix("Helvetica") ? 0 : 0.04)
        if miss < best?.miss ?? .greatestFiniteMagnitude { best = (candidate, face.bounds, fitted, inkWidth / width, miss) }
      }
    }
    guard let best else { return nil }
    let scaleX = min(max(best.ratio, 0.7), 1.4)
    let scale = best.size / 100
    // Core Text bounds are y-up from the baseline, so minY is the depth of the lowest glyph.
    let baseline = CGFloat(bottom + 1) + best.bounds.minY * scale
    let start = max(0, CGFloat(left) - best.bounds.minX * scale * scaleX)
    return ["size": Double(best.size), "baseline": Double(baseline / CGFloat(pixels.height)), "left": Double(start / CGFloat(pixels.width)),
            "bold": bold, "font": best.font, "scaleX": Double(scaleX)]
  }

  private static let descriptorLock = NSLock()
  private static var descriptors: [String: CTFontDescriptor] = [:]
  /// Bundled fonts load from their file (no app-wide registration needed).
  static func fileFont(_ file: String, size: CGFloat) -> UIFont? {
    guard !file.isEmpty, let url = file.hasPrefix("file:") ? URL(string: file) : URL(fileURLWithPath: file) else { return nil }
    descriptorLock.lock(); defer { descriptorLock.unlock() }
    if descriptors[file] == nil {
      guard let first = (CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor])?.first else { return nil }
      if descriptors.count >= 64 { descriptors.removeAll() }
      descriptors[file] = first
    }
    return descriptors[file].map { CTFontCreateWithFontDescriptor($0, size, nil) as UIFont }
  }

  /// Bundled fonts load from `file`; standard PDF font names (Helvetica, Times, Courier with Bold/Oblique/Italic) map to iOS faces.
  static func font(_ name: String, size: CGFloat, file: String = "") -> UIFont {
    if let bundled = fileFont(file, size: size) { return bundled }
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
    let source: CGImage
    if preview {
      let limit = CGFloat(min(max(options["maxSize"] as? Int ?? 1600, 256), 4096))
      guard let image = ImageEditing.load(uri: uri, maxPixels: limit) else { throw ImageEditing.EditError.invalid("This image format cannot be edited on your device.") }
      source = image
    } else {
      source = try ImageEditing.loadExport(uri: uri)
    }
    let edits = options["edits"] as? [[String: Any]] ?? []
    guard edits.count <= 500 else { throw ImageEditing.EditError.invalid("Save these changes before adding more.") }
    let size = CGSize(width: source.width, height: source.height)
    let ratio = size.width / max(1, CGFloat((options["refWidth"] as? NSNumber)?.doubleValue ?? Double(size.width)))
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let png = !preview && (options["format"] as? String) == "png"
    format.opaque = !png
    let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
      if !png { UIColor.white.setFill(); context.cgContext.fill(CGRect(origin: .zero, size: size)) }
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
          let face = font(edit["font"] as? String ?? "Helvetica", size: max(1, points), file: edit["fontFile"] as? String ?? "")
          let x = CGFloat((edit["x"] as? NSNumber)?.doubleValue ?? 0) * size.width
          let baseline = CGFloat((edit["y"] as? NSNumber)?.doubleValue ?? 0) * size.height
          var attributes: [NSAttributedString.Key: Any] = [.font: face, .foregroundColor: color(edit["color"] as? Int ?? 0x101010)]
          if edit["underline"] as? Bool == true { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
          // `.expansion` takes the log of the horizontal stretch factor.
          let scaleX = min(max((edit["scaleX"] as? NSNumber)?.doubleValue ?? 1, 0.5), 2)
          if scaleX != 1 { attributes[.expansion] = log(scaleX) }
          for (line, value) in text.components(separatedBy: "\n").prefix(50).enumerated() where !value.isEmpty {
            (value as NSString).draw(at: CGPoint(x: x, y: baseline + CGFloat(line) * face.pointSize * 1.2 - face.ascender), withAttributes: attributes)
          }
        }
      }
    }
    guard let image = rendered.cgImage else { throw ImageEditing.EditError.invalid("Could not render the image.") }
    let type: UTType = png ? .png : .jpeg
    let quality = preview ? 0.85 : Double(min(max(options["quality"] as? Int ?? 92, 10), 100)) / 100
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    let temporary = destination.deletingLastPathComponent().appendingPathComponent("versara-text-\(UUID().uuidString).partial")
    defer { try? FileManager.default.removeItem(at: temporary) }
    guard let writer = CGImageDestinationCreateWithURL(temporary as CFURL, type.identifier as CFString, 1, nil) else { throw ImageEditing.EditError.invalid("Could not create the image file.") }
    CGImageDestinationAddImage(writer, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(writer) else {
      throw ImageEditing.EditError.invalid("Could not encode the image.")
    }
    try FileManager.default.moveItem(at: temporary, to: destination)
    let bytes = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
    return ["uri": output, "width": image.width, "height": image.height, "size": bytes, "mimeType": type == .png ? "image/png" : "image/jpeg"]
  }
}

import ExpoModulesCore
import UIKit
import CoreImage
import ImageIO
import UniformTypeIdentifiers

/// Bounded, cancellable image jobs shared by preview and final export.
final class ImageTools {
  private let queue = DispatchQueue(label: "com.versara.image-tools", qos: .userInitiated)
  private let lock = NSLock()
  private var jobs: [String: Bool] = [:]
  private var destroyed = false
  private let context = CIContext(options: [.cacheIntermediates: false])
  private let types: [String: String] = ["jpeg": "public.jpeg", "png": "public.png", "webp": "org.webmproject.webp", "heic": "public.heic", "tiff": "public.tiff"]
  func cancel(_ id: String) { lock.lock(); if jobs[id] != nil { jobs[id] = true }; lock.unlock() }
  func destroy() { lock.lock(); destroyed = true; lock.unlock(); queue.async { self.context.clearCaches() } }
  private func check(_ id: String) throws {
    lock.lock(); let stopped = destroyed || jobs[id] == true; lock.unlock()
    if stopped { throw Failure(message: "Image operation cancelled.") }
  }
  func run(_ id: String, request: String, promise: Promise) {
    lock.lock()
    guard !destroyed, jobs.count < 3, jobs[id] == nil else { lock.unlock(); promise.reject("IMAGE_BUSY", "Wait for the current image operation."); return }
    jobs[id] = false; lock.unlock()
    queue.async { autoreleasepool {
      defer { self.lock.lock(); self.jobs.removeValue(forKey: id); self.lock.unlock(); self.context.clearCaches() }
      do {
        let values = try JSONSerialization.jsonObject(with: Data(request.utf8)) as? [String: Any] ?? [:]
        promise.resolve(try self.process(values, id: id))
      } catch {
        self.lock.lock(); let stopped = self.destroyed || self.jobs[id] == true; self.lock.unlock()
        promise.reject(stopped ? "IMAGE_CANCELLED" : "IMAGE_PROCESSING_FAILED", error.localizedDescription)
      }
    } }
  }
  private func local(_ value: String) throws -> URL {
    guard let url = URL(string: value), url.isFileURL else { throw Failure(message: "Choose a local image.") }
    let target = url.resolvingSymlinksInPath().standardizedFileURL
    let roots = [FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0], FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]]
    guard roots.contains(where: { target.path.hasPrefix($0.resolvingSymlinksInPath().path + "/") }) else { throw Failure(message: "Choose the image again.") }
    return target
  }
  private func supportedFormats() -> [String] {
    let supported = CGImageDestinationCopyTypeIdentifiers() as! [String]
    return ["jpeg", "png", "webp", "heic", "tiff"].filter { supported.contains(types[$0]!) }
  }
  private func info(_ input: URL) throws -> [String: Any] {
    guard let source = CGImageSourceCreateWithURL(input as CFURL, nil), let raw = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any], let size = ImageEditing.originalSize(uri: input.absoluteString) else { throw Failure(message: "This image format cannot be read on your device.") }
    let tiff = raw[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
    let exif = raw[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
    let type = CGImageSourceGetType(source).map { $0 as String } ?? ""
    return ["width": Int(size.width), "height": Int(size.height), "size": (try input.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0, "mimeType": UTType(type)?.preferredMIMEType ?? "image/*", "formats": supportedFormats(), "camera": tiff[kCGImagePropertyTIFFModel] as? String ?? "", "taken": exif[kCGImagePropertyExifDateTimeOriginal] as? String ?? "", "hasLocation": raw[kCGImagePropertyGPSDictionary] != nil]
  }
  private func number(_ r: [String: Any], _ key: String, _ fallback: Double, _ range: ClosedRange<Double>) -> Double {
    let value = (r[key] as? NSNumber)?.doubleValue ?? fallback
    return value.isFinite ? min(max(value, range.lowerBound), range.upperBound) : fallback
  }
  private func zeroOrigin(_ image: CIImage) -> CIImage { image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY)) }
  private func process(_ r: [String: Any], id: String) throws -> [String: Any] {
    if r["tool"] as? String == "signature" { return try SignatureImage.process(r, check: { try self.check(id) }) }
    if r["tool"] as? String == "privacy" { return try ImagePrivacyExport.process(r, check: { try self.check(id) }) }
    try check(id)
    let input = try local(r["uri"] as? String ?? "")
    let original = try info(input)
    if r["action"] as? String == "info" { return original }
    let destination = try local(r["outputUri"] as? String ?? "")
    guard !FileManager.default.fileExists(atPath: destination.path) else { throw Failure(message: "Choose a new output name.") }
    let temporary = destination.appendingPathExtension("partial")
    defer { try? FileManager.default.removeItem(at: temporary) }
    let preview = r["action"] as? String == "preview"
    let budget = ImageEditing.exportPixelBudget()
    let sourceWidth = Double(original["width"] as? Int ?? 1), sourceHeight = Double(original["height"] as? Int ?? 1)
    var requestedWidth = number(r, "width", 0, 0...32768), requestedHeight = number(r, "height", 0, 0...32768)
    if let percent = (r["percent"] as? NSNumber)?.doubleValue {
      guard percent.isFinite, (0.1...400).contains(percent) else { throw Failure(message: "Enter a percentage from 0.1 to 400.") }
      requestedWidth = max(1, (sourceWidth * percent / 100).rounded())
      requestedHeight = max(1, (sourceHeight * percent / 100).rounded())
    }
    let resizing = requestedWidth > 0 || requestedHeight > 0
    let outputWidth = requestedWidth > 0 ? requestedWidth : requestedHeight > 0 ? max(1, (requestedHeight * sourceWidth / sourceHeight).rounded()) : sourceWidth
    let outputHeight = requestedHeight > 0 ? requestedHeight : requestedWidth > 0 ? max(1, (requestedWidth * sourceHeight / sourceWidth).rounded()) : sourceHeight
    let target = (r["targetBytes"] as? NSNumber)?.intValue ?? 0
    guard target == 0 || target >= 10240 else { throw Failure(message: "Choose a target of at least 10 KB.") }
    if !preview && resizing { try ImageEditing.requireExportSize(CGSize(width: outputWidth, height: outputHeight), budget: budget) }
    // Source reduction belongs to explicit resizing/target-byte compression, never normal export.
    let decodeScale: Double
    if resizing { decodeScale = min(1, max(outputWidth / sourceWidth, outputHeight / sourceHeight)) }
    else if target > 0 && sourceWidth * sourceHeight > budget { decodeScale = sqrt(budget / (sourceWidth * sourceHeight)) * 0.999 }
    else { decodeScale = 1 }
    let decoded: CGImage
    if preview {
      guard let image = ImageEditing.load(uri: input.absoluteString, maxPixels: 1440) else { throw Failure(message: "Could not decode the image.") }
      decoded = image
    } else {
      decoded = try ImageEditing.loadExport(uri: input.absoluteString, maxPixels: resizing || target > 0 ? ceil(max(sourceWidth, sourceHeight) * decodeScale) : nil, budget: budget)
    }
    var image = CIImage(cgImage: decoded)
    if let points = r["perspective"] as? [[Double]], points.count == 4, points.allSatisfy({ $0.count == 2 }) {
      guard points.allSatisfy({ $0.allSatisfy({ $0.isFinite && (0...1).contains($0) }) }), (0..<4).allSatisfy({ i in
        let a = points[i], b = points[(i+1)%4], c = points[(i+2)%4]
        return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]) > 0.0001
      }) else { throw Failure(message: "Keep perspective corners in clockwise order without overlapping.") }
      let width = image.extent.width, height = image.extent.height
      func point(_ i: Int) -> CIVector { CIVector(x: min(max(points[i][0], 0), 1) * width, y: (1 - min(max(points[i][1], 0), 1)) * height) }
      image = image.applyingFilter("CIPerspectiveCorrection", parameters: ["inputTopLeft": point(0), "inputTopRight": point(1), "inputBottomRight": point(2), "inputBottomLeft": point(3)])
      guard !image.extent.isEmpty, !image.extent.isInfinite, image.extent.width.isFinite, image.extent.height.isFinite else { throw Failure(message: "These perspective corners overlap.") }
      image = zeroOrigin(image).transformed(by: CGAffineTransform(scaleX: width / image.extent.width, y: height / image.extent.height))
    }
    let exposure = number(r, "exposure", 0, -3...3), blur = number(r, "blur", 0, 0...0.035), sharpen = number(r, "sharpen", 0, 0...2)
    if exposure != 0 { image = image.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: exposure]) }
    if blur > 0 {
      let bounds = image.extent
      let filtered = image.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: blur * bounds.width]).cropped(to: bounds)
      if let area = r["blurRect"] as? [Double] {
        guard area.count == 4, area.allSatisfy({ $0.isFinite && (0...1).contains($0) }), area[2] > area[0], area[3] > area[1] else { throw Failure(message: "Select a blur area inside the image.") }
        let rect = CGRect(x: area[0]*bounds.width, y: (1-area[3])*bounds.height, width: (area[2]-area[0])*bounds.width, height: (area[3]-area[1])*bounds.height)
        let mask = CIImage(color: .white).cropped(to: rect).composited(over: CIImage(color: .black).cropped(to: bounds))
        image = filtered.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: image, kCIInputMaskImageKey: mask])
      } else { image = filtered }
    }
    if sharpen > 0 { image = image.applyingFilter("CISharpenLuminance", parameters: [kCIInputSharpnessKey: sharpen]) }
    if r["curves"] != nil || r["hsl"] != nil || r["levels"] != nil { image = try adjustColor(image, r, id: id) }
    try check(id)
    if resizing {
      var width = outputWidth
      var height = outputHeight
      let ratio = preview ? min(1, 1440 / max(width, height)) : 1
      width = max(1, (width * ratio).rounded()); height = max(1, (height * ratio).rounded())
      try ImageEditing.requireExportSize(CGSize(width: width, height: height), budget: budget)
      let mode = r["resizeMode"] as? String ?? "fit"
      let scale = mode == "fill" ? max(width / image.extent.width, height / image.extent.height) : min(width / image.extent.width, height / image.extent.height)
      image = image.transformed(by: CGAffineTransform(scaleX: mode == "stretch" ? width / image.extent.width : scale, y: mode == "stretch" ? height / image.extent.height : scale))
      image = zeroOrigin(image).transformed(by: CGAffineTransform(translationX: (width - image.extent.width) / 2, y: (height - image.extent.height) / 2))
      let bounds = CGRect(x: 0, y: 0, width: width, height: height)
      // Fit intentionally adds a background; fill/stretch retain transparent source pixels.
      if mode == "fit" { image = image.composited(over: CIImage(color: CIColor(color: color(r["background"] as? String ?? "#FFFFFF")))) }
      image = image.cropped(to: bounds)
    }
    let paddingFraction = number(r, "padding", 0, 0...0.3)
    var padding = (paddingFraction * min(image.extent.width, image.extent.height)).rounded()
    let paddedPixels = (image.extent.width + padding * 2) * (image.extent.height + padding * 2)
    if preview && padding > 0 && paddedPixels > budget {
      let scale = sqrt(budget / paddedPixels) * 0.999
      image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
      padding = (paddingFraction * min(image.extent.width, image.extent.height)).rounded()
    }
    if padding > 0 {
      let bounds = CGRect(x: 0, y: 0, width: image.extent.width + padding * 2, height: image.extent.height + padding * 2)
      try ImageEditing.requireExportSize(bounds.size, budget: budget)
      image = image.transformed(by: CGAffineTransform(translationX: padding, y: padding)).composited(over: CIImage(color: CIColor(color: color(r["background"] as? String ?? "#FFFFFF")))).cropped(to: bounds)
    }
    try ImageEditing.requireExportSize(image.extent.integral.size, budget: budget)
    guard let raster = context.createCGImage(image, from: image.extent.integral) else { throw Failure(message: "Could not render this image.") }
    let format = r["format"] as? String ?? "jpeg"
    guard supportedFormats().contains(format), let type = types[format] else { throw Failure(message: "Choose a format supported on this device.") }
    var rendered = try annotate(raster, r, opaque: format == "jpeg", id: id)
    guard target == 0 || !["png", "tiff"].contains(format) else { throw Failure(message: "Choose a lossy format for target-size compression.") }
    var quality = number(r, "quality", 90, 10...100)
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    var achieved = false
    for _ in 0...15 {
      try check(id)
      try? FileManager.default.removeItem(at: temporary)
      guard let writer = CGImageDestinationCreateWithURL(temporary as CFURL, type as CFString, 1, nil) else { throw Failure(message: "Could not create the image file.") }
      CGImageDestinationAddImage(writer, rendered, [kCGImageDestinationLossyCompressionQuality: quality / 100] as CFDictionary)
      guard CGImageDestinationFinalize(writer) else { throw Failure(message: "Could not encode this image.") }
      let bytes = (try temporary.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
      if target == 0 || bytes <= target { achieved = true; break }
      if quality > 30 { quality = max(25, quality - 12) }
      else {
        let scale = min(max(sqrt(Double(target) / Double(max(1, bytes))), 0.45), 0.85)
        let next = CIImage(cgImage: rendered).transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let raster = context.createCGImage(next, from: next.extent.integral) else { throw Failure(message: "Could not resize for the target size.") }; rendered = raster
      }
    }
    guard achieved else { throw Failure(message: "Could not reach that size. Try a larger target.") }
    try check(id); try FileManager.default.moveItem(at: temporary, to: destination)
    return ["uri": destination.absoluteString, "width": rendered.width, "height": rendered.height, "size": (try destination.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0, "mimeType": UTType(type)?.preferredMIMEType ?? "image/jpeg", "sourceWidth": original["width"]!, "sourceHeight": original["height"]!]
  }
  /// Same sRGB, straight-alpha equations as ImageTools.kt; bounded native raster and row cancellation.
  private func adjustColor(_ image: CIImage, _ request: [String: Any], id: String) throws -> CIImage {
    let levels = request["levels"] as? [String: Any]
    guard request["levels"] == nil || levels != nil else { throw Failure(message: "Choose valid input levels.") }
    let black = (levels?["black"] as? NSNumber)?.doubleValue ?? (levels == nil ? 0 : .nan)
    let white = (levels?["white"] as? NSNumber)?.doubleValue ?? (levels == nil ? 1 : .nan)
    let gamma = (levels?["gamma"] as? NSNumber)?.doubleValue ?? (levels == nil ? 1 : .nan)
    guard black.isFinite, white.isFinite, gamma.isFinite, (0...1).contains(black), (0...1).contains(white), white - black >= 1.0 / 255 - 1e-12, (0.1...3).contains(gamma) else { throw Failure(message: "Keep the black point below white and choose gamma from 0.1 to 3.") }
    let curveNames = ["rgb", "red", "green", "blue"]
    let curves = request["curves"] as? [String: Any]
    guard request["curves"] == nil || curves != nil else { throw Failure(message: "Choose valid tone curves.") }
    let anchors: [[Double]] = try curveNames.map { name in
      guard let curves else { return [0, 0.25, 0.5, 0.75, 1] }
      guard let values = curves[name] as? [Double], values.count == 5, values.allSatisfy({ $0.isFinite && (0...1).contains($0) }) else { throw Failure(message: "Each tone curve needs five anchors from 0 to 100%.") }
      return values
    }
    func curve(_ values: [Double], _ input: Double) -> Double {
      let x = min(1, max(0, input)) * 4, segment = min(3, Int(min(1, max(0, input)) * 4))
      return values[segment] + (values[segment + 1] - values[segment]) * (x - Double(segment))
    }
    let tables = (0..<3).map { channel in (0..<256).map { value in
      let leveled = pow(min(1, max(0, (Double(value) / 255 - black) / (white - black))), 1 / gamma)
      return Int((curve(anchors[channel + 1], curve(anchors[0], leveled)) * 255).rounded())
    } }
    let names = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"]
    let centers: [Double] = [0, 30, 60, 120, 180, 240, 270, 300, 360]
    let hsl = request["hsl"] as? [String: Any]
    guard request["hsl"] == nil || hsl != nil else { throw Failure(message: "Choose valid HSL adjustments.") }
    let adjustments: [[Double]] = try names.map { name in
      guard let hsl else { return [0, 0, 0] }
      guard let values = hsl[name] as? [String: Any] else { throw Failure(message: "Choose valid color ranges.") }
      return try ["hue", "saturation", "lightness"].enumerated().map { component, key in
        let limit = component == 0 ? 180.0 : 100.0
        guard let value = (values[key] as? NSNumber)?.doubleValue, value.isFinite, (-limit...limit).contains(value) else { throw Failure(message: "Choose a valid color adjustment.") }
        return value
      }
    }
    let usesHsl = adjustments.contains { $0.contains { $0 != 0 } }
    let usesCurves = tables.contains { values in values.enumerated().contains { $0.offset != $0.element } }
    if !usesCurves && !usesHsl { return image }
    try check(id)
    try ImageEditing.requireExportSize(image.extent.integral.size, budget: ImageEditing.exportPixelBudget())
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let raster = context.createCGImage(image, from: image.extent.integral, format: .RGBA8, colorSpace: space),
          let canvas = CGContext(data: nil, width: raster.width, height: raster.height, bitsPerComponent: 8, bytesPerRow: raster.width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue),
          let pixels = canvas.data?.assumingMemoryBound(to: UInt8.self) else { throw Failure(message: "Could not prepare native color adjustment memory.") }
    canvas.setBlendMode(.copy)
    canvas.draw(raster, in: CGRect(x: 0, y: 0, width: raster.width, height: raster.height))
    for y in 0..<raster.height {
      try check(id)
      for x in 0..<raster.width {
        let offset = y * canvas.bytesPerRow + x * 4, alpha = Int(pixels[offset + 3])
        if alpha == 0 { continue }
        // CGContext stores premultiplied bytes; curves/HSL operate on straight color.
        let inputRed = min(255, (Int(pixels[offset]) * 255 + alpha / 2) / alpha)
        let inputGreen = min(255, (Int(pixels[offset + 1]) * 255 + alpha / 2) / alpha)
        let inputBlue = min(255, (Int(pixels[offset + 2]) * 255 + alpha / 2) / alpha)
        var red = Double(tables[0][inputRed]) / 255, green = Double(tables[1][inputGreen]) / 255, blue = Double(tables[2][inputBlue]) / 255
        let upper = max(red, max(green, blue)), lower = min(red, min(green, blue)), delta = upper - lower
        if usesHsl && delta > 0.000001 {
          let section = upper == red ? (green - blue) / delta : upper == green ? (blue - red) / delta + 2 : (red - green) / delta + 4
          var hue = (section * 60 + 360).truncatingRemainder(dividingBy: 360)
          var lightness = (upper + lower) / 2
          var saturation = delta / (1 - abs(2 * lightness - 1))
          var band = 0
          while band < 7 && hue >= centers[band + 1] { band += 1 }
          let weight = (hue - centers[band]) / (centers[band + 1] - centers[band])
          func mix(_ component: Int) -> Double { adjustments[band][component] * (1 - weight) + adjustments[(band + 1) % 8][component] * weight }
          hue = (hue + mix(0) + 360).truncatingRemainder(dividingBy: 360)
          saturation = min(1, max(0, saturation * (1 + mix(1) / 100)))
          let light = mix(2) / 100
          lightness = light >= 0 ? lightness + (1 - lightness) * light : lightness * (1 + light)
          let chroma = (1 - abs(2 * lightness - 1)) * saturation
          let intermediate = chroma * (1 - abs((hue / 60).truncatingRemainder(dividingBy: 2) - 1))
          let base = lightness - chroma / 2
          switch Int(hue) / 60 {
          case 0: (red, green, blue) = (chroma, intermediate, 0)
          case 1: (red, green, blue) = (intermediate, chroma, 0)
          case 2: (red, green, blue) = (0, chroma, intermediate)
          case 3: (red, green, blue) = (0, intermediate, chroma)
          case 4: (red, green, blue) = (intermediate, 0, chroma)
          default: (red, green, blue) = (chroma, 0, intermediate)
          }
          red += base; green += base; blue += base
        }
        func premultiplied(_ value: Double) -> UInt8 { UInt8((min(255, max(0, Int((value * 255).rounded()))) * alpha + 127) / 255) }
        pixels[offset] = premultiplied(red); pixels[offset + 1] = premultiplied(green); pixels[offset + 2] = premultiplied(blue)
      }
    }
    try check(id)
    guard let output = canvas.makeImage() else { throw Failure(message: "Could not finish the color adjustment.") }
    return CIImage(cgImage: output)
  }
  private func color(_ value: String) -> UIColor {
    let hex = value.replacingOccurrences(of: "#", with: "")
    guard let n = UInt32(hex, radix: 16) else { return .black }
    return UIColor(red: CGFloat((n >> 16) & 255) / 255, green: CGFloat((n >> 8) & 255) / 255, blue: CGFloat(n & 255) / 255, alpha: 1)
  }
  private func annotate(_ image: CGImage, _ r: [String: Any], opaque: Bool, id: String) throws -> CGImage {
    let marks = r["marks"] as? [[String: Any]] ?? []
    guard marks.count <= 300, marks.reduce(0, { $0 + (($1["points"] as? [[Double]])?.count ?? 0) }) <= 20000 else { throw Failure(message: "Save before adding more marks.") }
    try check(id)
    let width = CGFloat(image.width), height = CGFloat(image.height)
    let mark = r["watermark"] as? [String: Any]
    if marks.isEmpty && mark == nil && !opaque { return image }
    var logo: CGImage?
    if let value = mark?["imageUri"] as? String, !value.isEmpty { logo = ImageEditing.load(uri: try local(value).absoluteString, maxPixels: 1024); if logo == nil { throw Failure(message: "Could not read the watermark image.") } }
    let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = opaque
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format)
    let result = renderer.image { rendererContext in
      let ctx = rendererContext.cgContext
      if opaque { UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: width, height: height)) }
      UIImage(cgImage: image).draw(in: CGRect(x: 0, y: 0, width: width, height: height))
      for mark in marks {
        guard let points = mark["points"] as? [[Double]], points.count >= 2, points.allSatisfy({ $0.count == 2 }) else { continue }
        let path = UIBezierPath()
        for (i, p) in points.enumerated() { let point = CGPoint(x: min(max(p[0],0),1)*width, y: min(max(p[1],0),1)*height); if i == 0 { path.move(to: point) } else { path.addLine(to: point) } }
        let kind = mark["kind"] as? String ?? "draw", redaction = mark["kind"] as? String == "redact"
        path.lineWidth = number(mark,"width",0.005,0.001...0.1)*width; path.lineCapStyle = .round; path.lineJoinStyle = .round
        let brush = mark["brush"] as? String ?? "pen", pattern = mark["pattern"] as? String ?? "solid"
        let fallback: Double = brush == "highlighter" ? 0.3 : brush == "pencil" ? 170.0/255 : brush == "marker" ? 210.0/255 : 1
        let alpha: CGFloat = redaction ? 1 : CGFloat(number(mark, "opacity", fallback, 0.01...1))
        if !redaction && kind != "polygon" && pattern == "dotted" {
          let vertices = points.map { CGPoint(x: min(max($0[0], 0), 1) * width, y: min(max($0[1], 0), 1) * height) }
          ctx.addPath(StrokeDots.path(vertices, width: path.lineWidth))
          ctx.setFillColor(color(mark["color"] as? String ?? "#1D4ED8").withAlphaComponent(alpha).cgColor)
          ctx.fillPath()
          continue
        }
        if !redaction && kind != "polygon" && pattern == "dashed" { let dash: [CGFloat] = [path.lineWidth*4,path.lineWidth*2]; path.setLineDash(dash,count:dash.count,phase:0) }
        if kind == "polygon" || redaction { path.close(); if redaction { UIColor.black.setFill(); path.fill() } else if let fill = mark["fillColor"] as? String, !fill.isEmpty { color(fill).withAlphaComponent((mark["opacity"] as? NSNumber)?.doubleValue.isFinite == true ? alpha : 1).setFill(); path.fill() } }
        (redaction ? UIColor.black : color(mark["color"] as? String ?? "#1D4ED8").withAlphaComponent(alpha)).setStroke(); path.stroke()
      }
      if let mark {
        let x = number(mark,"x",0.5,0...1)*width, y = number(mark,"y",0.5,0...1)*height
        let opacity = number(mark,"opacity",0.5,0.05...1)
        if let logo { let w = width*number(mark,"imageScale",0.25,0.05...0.8); let h = w*CGFloat(logo.height)/CGFloat(logo.width); UIImage(cgImage: logo).draw(in: CGRect(x: x-w/2, y: y-h/2, width: w, height: h), blendMode: .normal, alpha: opacity) }
        else {
          let text = String((mark["text"] as? String ?? "").prefix(200)) as NSString
          let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: number(mark,"size",0.06,0.01...0.3)*width), .foregroundColor: color(mark["color"] as? String ?? "#FFFFFF").withAlphaComponent(opacity)]
          let size = text.size(withAttributes: attributes); text.draw(at: CGPoint(x: x-size.width/2,y: y-size.height/2), withAttributes: attributes)
        }
      }
    }
    try check(id)
    guard let raster = result.cgImage else { throw Failure(message: "Could not render annotations.") }
    return raster
  }
  private struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }
}

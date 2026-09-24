import ExpoModulesCore
import UIKit
import CoreImage
import ImageIO
import UniformTypeIdentifiers

/// Colour and geometry settings shared by the live editor preview and the export.
struct ImageEdits {
  var rotation = 0
  var flipH = false
  var flipV = false
  var brightness: Double = 0
  var contrast: Double = 1
  var saturation: Double = 1
  var warmth: Double = 0
  var filter = "none"

  init() {}
  init(_ json: [String: Any]) {
    rotation = (((json["rotation"] as? Int) ?? 0) % 360 + 360) % 360
    flipH = json["flipH"] as? Bool ?? false
    flipV = json["flipV"] as? Bool ?? false
    brightness = min(max(json["brightness"] as? Double ?? 0, -0.5), 0.5)
    contrast = min(max(json["contrast"] as? Double ?? 1, 0.5), 1.5)
    saturation = min(max(json["saturation"] as? Double ?? 1, 0), 2)
    warmth = min(max(json["warmth"] as? Double ?? 0, -1), 1)
    filter = json["filter"] as? String ?? "none"
  }
  var turned: Bool { rotation == 90 || rotation == 270 }
}

enum ImageEditing {
  static let context = CIContext(options: [.cacheIntermediates: false])

  /// Downsampled, orientation-corrected source image.
  static func load(uri: String, maxPixels: CGFloat) -> CGImage? {
    guard let url = URL(string: uri), url.isFileURL,
          let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: max(1, Int(maxPixels)),
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }

  static func originalSize(uri: String) -> CGSize? {
    guard let url = URL(string: uri), let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? CGFloat, let height = properties[kCGImagePropertyPixelHeight] as? CGFloat else { return nil }
    let orientation = properties[kCGImagePropertyOrientation] as? UInt32 ?? 1
    return orientation >= 5 ? CGSize(width: height, height: width) : CGSize(width: width, height: height)
  }

  /// Flip, then rotate clockwise, then colour, matching the Android pipeline.
  static func apply(_ edits: ImageEdits, to input: CIImage) -> CIImage {
    var image = input
    if edits.flipH || edits.flipV {
      image = image.transformed(by: CGAffineTransform(scaleX: edits.flipH ? -1 : 1, y: edits.flipV ? -1 : 1))
    }
    if edits.rotation != 0 {
      image = image.transformed(by: CGAffineTransform(rotationAngle: -CGFloat(edits.rotation) * .pi / 180))
    }
    image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
    if edits.brightness != 0 || edits.contrast != 1 || edits.saturation != 1 {
      image = image.applyingFilter("CIColorControls", parameters: [kCIInputBrightnessKey: edits.brightness * 0.6, kCIInputContrastKey: edits.contrast, kCIInputSaturationKey: edits.saturation])
    }
    if edits.warmth != 0 {
      image = image.applyingFilter("CITemperatureAndTint", parameters: ["inputNeutral": CIVector(x: 6500, y: 0), "inputTargetNeutral": CIVector(x: 6500 + edits.warmth * 1800, y: 0)])
    }
    switch edits.filter {
    case "mono": image = image.applyingFilter("CIPhotoEffectMono")
    case "sepia": image = image.applyingFilter("CISepiaTone", parameters: [kCIInputIntensityKey: 0.9])
    case "vivid": image = image.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 1.35, kCIInputContrastKey: 1.08])
    case "fade": image = image.applyingFilter("CIPhotoEffectFade")
    case "cool": image = image.applyingFilter("CITemperatureAndTint", parameters: ["inputNeutral": CIVector(x: 6500, y: 0), "inputTargetNeutral": CIVector(x: 5200, y: 0)])
    default: break
    }
    return image
  }

  static func export(_ options: [String: Any]) throws -> [String: Any] {
    guard let uri = options["uri"] as? String, let output = options["outputUri"] as? String, let destination = URL(string: output), destination.isFileURL else {
      throw EditError.invalid("Choose an image to edit.")
    }
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath().path
    guard destination.resolvingSymlinksInPath().path.hasPrefix(documents + "/"), !FileManager.default.fileExists(atPath: destination.path) else {
      throw EditError.invalid("Could not save inside Versara.")
    }
    let lowMemory = ProcessInfo.processInfo.physicalMemory <= 2 * 1024 * 1024 * 1024
    guard let source = load(uri: uri, maxPixels: lowMemory ? 3072 : 4096) else { throw EditError.invalid("This image format cannot be edited on your device.") }
    let edits = ImageEdits(options["edits"] as? [String: Any] ?? [:])
    var image = apply(edits, to: CIImage(cgImage: source))
    let extent = image.extent
    if let crop = options["crop"] as? [String: Any], let x = crop["x"] as? Double, let y = crop["y"] as? Double,
       let w = crop["width"] as? Double, let h = crop["height"] as? Double {
      let rect = CGRect(x: x * extent.width, y: (1 - y - h) * extent.height, width: w * extent.width, height: h * extent.height).integral.intersection(extent)
      if !rect.isEmpty { image = image.cropped(to: rect).transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY)) }
    }
    let scale = min(max(options["scale"] as? Double ?? 1, 0.05), 1)
    if scale < 0.999 {
      image = image.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: scale, kCIInputAspectRatioKey: 1])
      image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
    }
    guard let rendered = context.createCGImage(image, from: image.extent.integral) else { throw EditError.invalid("Could not render the edited image.") }
    let format = options["format"] as? String ?? "jpeg"
    let type: UTType = format == "png" ? .png : .jpeg
    let quality = Double(min(max(options["quality"] as? Int ?? 90, 10), 100)) / 100
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let writer = CGImageDestinationCreateWithURL(destination as CFURL, type.identifier as CFString, 1, nil) else { throw EditError.invalid("Could not create the image file.") }
    CGImageDestinationAddImage(writer, rendered, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(writer) else {
      try? FileManager.default.removeItem(at: destination)
      throw EditError.invalid("Could not encode the image.")
    }
    let size = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
    return ["uri": output, "width": rendered.width, "height": rendered.height, "size": size, "mimeType": type == .png ? "image/png" : "image/jpeg"]
  }

  enum EditError: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case .invalid(let message) = self { return message }; return nil }
  }
}

/// Live edit preview with a native crop box. JS only sends settings and receives the crop.
final class ImageEditorView: ExpoView {
  let onLoad = EventDispatcher()
  let onError = EventDispatcher()
  let onCropChange = EventDispatcher()
  private let imageView = UIImageView()
  private let overlay = CropOverlay()
  private let queue = DispatchQueue(label: "com.versara.image-editor", qos: .userInitiated)
  private var source = ""
  private var base: CIImage?
  private var edits = ImageEdits()
  private var aspect = "none"
  private var renderTicket = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    imageView.contentMode = .scaleAspectFit
    imageView.isAccessibilityElement = true
    imageView.accessibilityLabel = "Image being edited"
    addSubview(imageView)
    overlay.onChange = { [weak self] rect in self?.emitCrop(rect) }
    addSubview(overlay)
  }

  func setSource(_ value: String) {
    guard value != source else { return }
    source = value
    let uri = value
    let lowMemory = ProcessInfo.processInfo.physicalMemory <= 2 * 1024 * 1024 * 1024
    let screen = UIScreen.main.bounds.size
    let target = min(max(screen.width, screen.height) * UIScreen.main.scale * 1.25, lowMemory ? 1440 : 2048)
    queue.async { [weak self] in
      let image = ImageEditing.load(uri: uri, maxPixels: target)
      let size = ImageEditing.originalSize(uri: uri)
      DispatchQueue.main.async {
        guard let self, uri == self.source else { return }
        guard let image else { self.onError(["message": "This image format cannot be edited on your device."]); return }
        self.base = CIImage(cgImage: image)
        self.render()
        self.onLoad(["width": size?.width ?? CGFloat(image.width), "height": size?.height ?? CGFloat(image.height)])
      }
    }
  }

  func setEdits(_ json: String) {
    let values = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
    let next = ImageEdits(values)
    let geometry = next.rotation != edits.rotation || next.flipH != edits.flipH || next.flipV != edits.flipV
    edits = next
    render()
    if geometry { setNeedsLayout(); resetCrop() }
  }

  func setAspect(_ value: String) {
    guard value != aspect else { return }
    aspect = value
    resetCrop()
  }

  private func render() {
    guard let base else { return }
    renderTicket += 1
    let ticket = renderTicket
    let edits = self.edits
    queue.async { [weak self] in
      let output = ImageEditing.apply(edits, to: base)
      guard let cg = ImageEditing.context.createCGImage(output, from: output.extent) else { return }
      DispatchQueue.main.async {
        guard let self, ticket == self.renderTicket else { return }
        self.imageView.image = UIImage(cgImage: cg)
        self.setNeedsLayout()
      }
    }
  }

  private func pixelSize() -> CGSize? {
    guard let base else { return nil }
    return edits.turned ? CGSize(width: base.extent.height, height: base.extent.width) : base.extent.size
  }

  private func ratio() -> CGFloat? {
    guard let size = pixelSize() else { return nil }
    let pixels: CGFloat
    switch aspect {
    case "1:1": pixels = 1
    case "4:3": pixels = 4 / 3
    case "3:4": pixels = 3 / 4
    case "16:9": pixels = 16 / 9
    case "9:16": pixels = 9 / 16
    default: return nil
    }
    return pixels * size.height / size.width
  }

  private func resetCrop() {
    overlay.isHidden = aspect == "none"
    overlay.ratio = ratio()
    var rect = CGRect(x: 0, y: 0, width: 1, height: 1)
    if let ratio = overlay.ratio {
      var w: CGFloat = 1, h = 1 / ratio
      if h > 1 { h = 1; w = ratio }
      rect = CGRect(x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h)
    }
    overlay.crop = rect
    overlay.setNeedsDisplay()
    emitCrop(rect)
  }

  private func emitCrop(_ rect: CGRect) {
    guard base != nil else { return }
    onCropChange(aspect == "none" ? [:] : ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height])
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let inset = bounds.insetBy(dx: 20, dy: 20)
    guard let size = pixelSize(), size.width > 0, size.height > 0, inset.width > 0, inset.height > 0 else { imageView.frame = inset; return }
    let scale = min(inset.width / size.width, inset.height / size.height)
    let frame = CGRect(x: bounds.midX - size.width * scale / 2, y: bounds.midY - size.height * scale / 2, width: size.width * scale, height: size.height * scale)
    imageView.frame = frame
    overlay.frame = bounds
    overlay.imageRect = frame
    overlay.setNeedsDisplay()
  }
}

private final class CropOverlay: UIView {
  var crop = CGRect(x: 0, y: 0, width: 1, height: 1)
  var imageRect = CGRect.zero
  var ratio: CGFloat?
  var onChange: ((CGRect) -> Void)?
  private var mode = 0
  private var last = CGPoint.zero

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isHidden = true
    addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(pan(_:))))
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  private var box: CGRect {
    CGRect(x: imageRect.minX + crop.minX * imageRect.width, y: imageRect.minY + crop.minY * imageRect.height, width: crop.width * imageRect.width, height: crop.height * imageRect.height)
  }

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { !isHidden && box.insetBy(dx: -32, dy: -32).contains(point) }

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext(), imageRect.width > 0 else { return }
    let box = self.box
    context.setFillColor(UIColor.black.withAlphaComponent(0.55).cgColor)
    context.addRect(imageRect); context.addRect(box)
    context.fillPath(using: .evenOdd)
    context.setStrokeColor(UIColor.white.withAlphaComponent(0.45).cgColor)
    context.setLineWidth(1)
    for i in 1...2 {
      let x = box.minX + box.width * CGFloat(i) / 3, y = box.minY + box.height * CGFloat(i) / 3
      context.move(to: CGPoint(x: x, y: box.minY)); context.addLine(to: CGPoint(x: x, y: box.maxY))
      context.move(to: CGPoint(x: box.minX, y: y)); context.addLine(to: CGPoint(x: box.maxX, y: y))
    }
    context.strokePath()
    context.setStrokeColor(UIColor.white.cgColor)
    context.setLineWidth(2); context.stroke(box)
    context.setLineWidth(4); context.setLineCap(.round)
    for (x, y) in [(box.minX, box.minY), (box.maxX, box.minY), (box.minX, box.maxY), (box.maxX, box.maxY)] {
      let dx: CGFloat = x == box.minX ? 18 : -18, dy: CGFloat = y == box.minY ? 18 : -18
      context.move(to: CGPoint(x: x + dx, y: y)); context.addLine(to: CGPoint(x: x, y: y)); context.addLine(to: CGPoint(x: x, y: y + dy))
    }
    context.strokePath()
  }

  @objc private func pan(_ gesture: UIPanGestureRecognizer) {
    let point = gesture.location(in: self)
    switch gesture.state {
    case .began:
      let box = self.box, reach: CGFloat = 32
      func near(_ x: CGFloat, _ y: CGFloat) -> Bool { abs(point.x - x) < reach && abs(point.y - y) < reach }
      mode = near(box.minX, box.minY) ? 2 : near(box.maxX, box.minY) ? 3 : near(box.minX, box.maxY) ? 4 : near(box.maxX, box.maxY) ? 5 : box.contains(point) ? 1 : 0
      last = point
    case .changed:
      guard mode != 0, imageRect.width > 0 else { return }
      let dx = (point.x - last.x) / imageRect.width, dy = (point.y - last.y) / imageRect.height
      last = point
      if mode == 1 {
        crop.origin.x = min(max(0, crop.minX + dx), 1 - crop.width)
        crop.origin.y = min(max(0, crop.minY + dy), 1 - crop.height)
      } else { resize(dx, dy) }
      setNeedsDisplay()
    case .ended, .cancelled:
      if mode != 0 { onChange?(crop) }
      mode = 0
    default: break
    }
  }

  private func resize(_ dx: CGFloat, _ dy: CGFloat) {
    let minimum: CGFloat = 0.08
    let left = mode == 2 || mode == 4, top = mode == 2 || mode == 3
    let anchorX = left ? crop.maxX : crop.minX, anchorY = top ? crop.maxY : crop.minY
    let maxW = left ? anchorX : 1 - anchorX, maxH = top ? anchorY : 1 - anchorY
    var w = min(max(crop.width + (left ? -dx : dx), minimum), maxW)
    var h = min(max(crop.height + (top ? -dy : dy), minimum), maxH)
    if let ratio {
      h = w / ratio
      if h > maxH { h = maxH; w = h * ratio }
      if w > maxW { w = maxW; h = w / ratio }
      if w < minimum || h < minimum { return }
    }
    crop = CGRect(x: left ? anchorX - w : anchorX, y: top ? anchorY - h : anchorY, width: w, height: h)
  }
}

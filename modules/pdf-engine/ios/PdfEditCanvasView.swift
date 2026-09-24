import ExpoModulesCore
import UIKit

/// Standard PDF font names (Helvetica, Times, Courier with Bold/Oblique/Italic) as iOS faces.
func versaraFont(_ name: String, _ size: CGFloat) -> UIFont {
  let bold = name.contains("Bold"), italic = name.contains("Oblique") || name.contains("Italic")
  let face: String
  if name.hasPrefix("Times") {
    face = bold && italic ? "TimesNewRomanPS-BoldItalicMT" : bold ? "TimesNewRomanPS-BoldMT" : italic ? "TimesNewRomanPS-ItalicMT" : "TimesNewRomanPSMT"
  } else {
    face = (name.hasPrefix("Courier") ? "Courier" : "Helvetica") + (bold && italic ? "-BoldOblique" : bold ? "-Bold" : italic ? "-Oblique" : "")
  }
  if let font = UIFont(name: face, size: size) { return font }
  var traits: UIFontDescriptor.SymbolicTraits = []
  if bold { traits.insert(.traitBold) }
  if italic { traits.insert(.traitItalic) }
  let system = UIFont.systemFont(ofSize: size)
  return system.fontDescriptor.withSymbolicTraits(traits).map { UIFont(descriptor: $0, size: size) } ?? system
}

/** Zoomable PDF page for the text editor with native hit-testing and an on-page text box. */
final class PdfEditCanvasView: ExpoView, UIScrollViewDelegate, UITextViewDelegate, UIGestureRecognizerDelegate {
  let onSelectObject = EventDispatcher()
  let onPlace = EventDispatcher()
  let onTextChange = EventDispatcher()
  let onSubmitText = EventDispatcher()

  private struct Box { let id: Int; let rect: CGRect }
  private struct TextBox: Equatable { var visible = false; var text = ""; var font = "Helvetica"; var size: CGFloat = 16; var color = 0x101020; var underline = false }

  private let scroll = UIScrollView()
  private let page = UIView()
  private let imageView = UIImageView()
  private let overlay = EditOverlay()
  // Multi-line: Return starts a new line and lines never wrap, matching how the PDF engine writes them.
  private let field = UITextView()
  private let placeholder = UILabel()
  private var lineHeight: CGFloat = 16
  private var fieldFont = UIFont.systemFont(ofSize: 16)
  private let handle = UIView()
  private let worker = DispatchQueue(label: "com.versara.pdf.edit-canvas", qos: .userInitiated)
  private var source = ""
  private var ticket = 0
  private var pageSize = CGSize(width: 1, height: 1)
  private var pointWidth: CGFloat = 0
  private var placement: CGPoint?
  private var textBox = TextBox()
  private var adding = false
  private var disabled = false
  private var boxes: [Box] = []
  private var lastBounds = CGSize.zero

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = UIColor(red: 0.91, green: 0.92, blue: 0.94, alpha: 1)
    scroll.delegate = self
    scroll.minimumZoomScale = 1
    scroll.maximumZoomScale = 5
    scroll.showsVerticalScrollIndicator = false
    scroll.showsHorizontalScrollIndicator = false
    scroll.contentInsetAdjustmentBehavior = .never
    scroll.keyboardDismissMode = .none
    addSubview(scroll)
    scroll.addSubview(page)
    page.backgroundColor = .white
    imageView.contentMode = .scaleToFill
    page.addSubview(imageView)
    overlay.isOpaque = false
    overlay.isUserInteractionEnabled = false
    overlay.contentMode = .redraw
    page.addSubview(overlay)

    field.isHidden = true
    field.delegate = self
    field.isScrollEnabled = false
    field.textContainer.lineFragmentPadding = 0
    field.textContainer.lineBreakMode = .byClipping
    field.textContainer.widthTracksTextView = true
    field.returnKeyType = .default
    field.autocapitalizationType = .sentences
    placeholder.text = "Type here"
    placeholder.textColor = UIColor.gray.withAlphaComponent(0.6)
    field.addSubview(placeholder)
    field.backgroundColor = UIColor(red: 0.08, green: 0.4, blue: 1, alpha: 0.1)
    field.layer.borderColor = UIColor(red: 0.08, green: 0.4, blue: 1, alpha: 1).cgColor
    field.layer.borderWidth = 0.5
    field.accessibilityLabel = "Text to add to the PDF"
    page.addSubview(field)

    handle.isHidden = true
    handle.backgroundColor = UIColor(red: 0.08, green: 0.4, blue: 1, alpha: 1)
    handle.layer.cornerRadius = 15
    handle.accessibilityLabel = "Drag to move the text box"
    let arrows = UIImageView(image: UIImage(systemName: "arrow.up.and.down.and.arrow.left.and.right"))
    arrows.tintColor = .white
    arrows.frame = CGRect(x: 6, y: 6, width: 18, height: 18)
    handle.addSubview(arrows)
    handle.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(dragHandle(_:))))
    addSubview(handle)

    let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
    doubleTap.numberOfTapsRequired = 2
    doubleTap.delegate = self
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    tap.require(toFail: doubleTap)
    tap.delegate = self
    scroll.addGestureRecognizer(doubleTap)
    scroll.addGestureRecognizer(tap)
  }

  func setSource(_ value: String) {
    guard value != source else { return }
    source = value
    ticket += 1
    let current = ticket
    worker.async { [weak self] in
      let url = URL(string: value)
      let image = url.flatMap { $0.isFileURL ? UIImage(contentsOfFile: $0.path) : nil } ?? UIImage(contentsOfFile: value)
      DispatchQueue.main.async {
        guard let self, current == self.ticket, let image else { return }
        self.imageView.image = image
      }
    }
  }
  func setPageLayout(_ json: String) {
    guard let item = parse(json) else { return }
    let size = CGSize(width: max(1, number(item["width"]) ?? 1), height: max(1, number(item["height"]) ?? 1))
    pointWidth = number(item["pointWidth"]) ?? 0
    overlay.pointWidth = pointWidth
    if size != pageSize { pageSize = size; lastBounds = .zero; setNeedsLayout() } else { layoutField() }
  }
  func setObjects(_ json: String) {
    let items = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [[String: Any]] ?? []
    boxes = items.compactMap { item in
      guard let id = item["id"] as? Int, let x = number(item["x"]), let y = number(item["y"]), let w = number(item["width"]), let h = number(item["height"]) else { return nil }
      return Box(id: id, rect: CGRect(x: x, y: y, width: w, height: h))
    }
    overlay.rects = boxes.prefix(600).map { $0.rect }
    overlay.ids = boxes.prefix(600).map { $0.id }
    overlay.setNeedsDisplay()
  }
  func setAnnotations(_ json: String) {
    let items = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [[String: Any]] ?? []
    overlay.marks = items.prefix(500).map { item in
      var mark = EditOverlay.Mark()
      if let erase = item["erase"] as? [String: Any], let x = number(erase["x"]), let y = number(erase["y"]), let w = number(erase["width"]), let h = number(erase["height"]) {
        let background = erase["background"] as? Int ?? 0xFFFFFF
        mark.erase = CGRect(x: x, y: y, width: w, height: h)
        mark.left = erase["left"] as? Int ?? background
        mark.right = erase["right"] as? Int ?? background
      }
      let text = item["text"] as? String ?? ""
      mark.lines = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? [] : Array(text.components(separatedBy: "\n").prefix(50))
      mark.underline = item["underline"] as? Bool ?? false
      mark.font = item["font"] as? String ?? "Helvetica"
      mark.size = number(item["size"]) ?? 16
      mark.color = item["color"] as? Int ?? 0x101010
      mark.point = CGPoint(x: number(item["x"]) ?? 0, y: number(item["y"]) ?? 0)
      return mark
    }
    overlay.setNeedsDisplay()
  }
  private var focusKey = ""
  private var focusRect: CGRect?
  /// Normalised rect to keep in view at a readable zoom, e.g. the line being edited.
  func setFocus(_ json: String) {
    guard json != focusKey else { return }
    focusKey = json
    if let item = parse(json), let x = number(item["x"]), let y = number(item["y"]), let w = number(item["width"]), let h = number(item["height"]) {
      focusRect = CGRect(x: x, y: y, width: w, height: h)
      DispatchQueue.main.async { self.focusOn() }
    } else { focusRect = nil }
  }
  private func focusOn() {
    guard let rect = focusRect, page.bounds.width > 0, scroll.bounds.width > 0 else { return }
    let base = page.bounds.size
    let rw = max(1, rect.width * base.width), rh = max(1, rect.height * base.height)
    // Readable first: the line fills about 36pt of height; long lines start at the left edge.
    let target = min(max(min(36 / rh, scroll.bounds.height * 0.45 / rh), 1.5), 4)
    let size = CGSize(width: scroll.bounds.width / target, height: scroll.bounds.height / target)
    let x = rw * target > scroll.bounds.width * 0.92 ? rect.minX * base.width - size.width * 0.04 : rect.midX * base.width - size.width / 2
    scroll.zoom(to: CGRect(x: x, y: rect.midY * base.height - size.height * 0.38, width: size.width, height: size.height), animated: true)
  }
  func setSelectedId(_ value: Int) { overlay.selectedId = value; overlay.setNeedsDisplay() }
  func setAdding(_ value: Bool) { adding = value; overlay.adding = value; overlay.setNeedsDisplay() }
  func setDisabled(_ value: Bool) { disabled = value; field.isEditable = !value; scroll.isUserInteractionEnabled = !value; updateHandle() }
  func setPlacement(_ json: String) {
    if let item = parse(json), let x = number(item["x"]), let y = number(item["y"]) { placement = CGPoint(x: x, y: y) } else { placement = nil }
    overlay.placement = placement
    overlay.setNeedsDisplay()
    layoutField()
  }
  func setTextBox(_ json: String) {
    var next = TextBox()
    if let item = parse(json) {
      next.visible = item["visible"] as? Bool ?? false
      next.text = item["text"] as? String ?? ""
      next.font = item["font"] as? String ?? "Helvetica"
      next.size = number(item["size"]) ?? 16
      next.color = item["color"] as? Int ?? 0x101020
      next.underline = item["underline"] as? Bool ?? false
    }
    let previous = textBox
    let opening = next.visible && !previous.visible
    textBox = next
    let restyle = opening || next.color != previous.color || next.underline != previous.underline || next.font != previous.font || next.size != previous.size
    if restyle { styleField() }
    if field.text != next.text || restyle {
      let selection = field.selectedRange
      field.attributedText = NSAttributedString(string: next.text, attributes: field.typingAttributes)
      field.selectedRange = NSRange(location: min(selection.location, (next.text as NSString).length), length: 0)
      placeholder.isHidden = !next.text.isEmpty
    }
    if next.visible != previous.visible {
      field.isHidden = !next.visible
      overlay.textVisible = next.visible
      overlay.setNeedsDisplay()
    }
    if opening || next.size != previous.size || next.font != previous.font || next.visible != previous.visible { layoutField() } else { updateHandle() }
    if opening { DispatchQueue.main.async { self.field.becomeFirstResponder() } }
    if !next.visible && field.isFirstResponder { field.resignFirstResponder() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    scroll.frame = bounds
    guard bounds.width > 0, bounds.height > 0, bounds.size != lastBounds else { updateHandle(); return }
    lastBounds = bounds.size
    let fit = min(bounds.width / pageSize.width, bounds.height / pageSize.height)
    scroll.zoomScale = 1
    page.frame = CGRect(x: 0, y: 0, width: pageSize.width * fit, height: pageSize.height * fit)
    imageView.frame = page.bounds
    overlay.frame = page.bounds
    scroll.contentSize = page.frame.size
    center()
    layoutField()
    if focusRect != nil { DispatchQueue.main.async { self.focusOn() } }
  }

  private func center() {
    let insetX = max(0, (scroll.bounds.width - scroll.contentSize.width) / 2)
    let insetY = max(0, (scroll.bounds.height - scroll.contentSize.height) / 2)
    scroll.contentInset = UIEdgeInsets(top: insetY, left: insetX, bottom: insetY, right: insetX)
  }

  private func textScale() -> CGFloat { page.bounds.width / (pointWidth > 0 ? pointWidth : 612) }
  private func styleField() {
    let scale = page.bounds.width > 0 ? textScale() : 1
    fieldFont = versaraFont(textBox.font, max(1, textBox.size * scale))
    lineHeight = fieldFont.pointSize * 1.2
    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = lineHeight
    paragraph.maximumLineHeight = lineHeight
    var attributes: [NSAttributedString.Key: Any] = [
      .font: fieldFont, .paragraphStyle: paragraph,
      .foregroundColor: UIColor(red: CGFloat(textBox.color >> 16 & 255) / 255, green: CGFloat(textBox.color >> 8 & 255) / 255, blue: CGFloat(textBox.color & 255) / 255, alpha: 1),
    ]
    if textBox.underline { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
    field.typingAttributes = attributes
    placeholder.font = fieldFont
  }

  private func layoutField() {
    let width = page.bounds.width, height = page.bounds.height
    guard let point = placement, textBox.visible, width > 0 else { updateHandle(); return }
    let scale = textScale()
    if abs(fieldFont.pointSize - max(1, textBox.size * scale)) > 0.01 {
      styleField()
      field.attributedText = NSAttributedString(string: field.text ?? "", attributes: field.typingAttributes)
    }
    let pad = max(1, 2 * scale)
    let lines = (field.text?.isEmpty ?? true) ? ["Type here"] : (field.text ?? "").components(separatedBy: "\n")
    let widest = lines.map { ceil(($0 as NSString).size(withAttributes: [.font: fieldFont]).width) }.max() ?? 0
    let x = point.x * width, baseline = point.y * height
    let frameWidth = min(max(widest + pad * 4, 48 * scale), max(48 * scale, width - x + pad))
    // A line box taller than the font puts the extra space above the glyphs.
    let firstBaseline = lineHeight + fieldFont.descender
    field.textContainerInset = UIEdgeInsets(top: pad, left: pad, bottom: pad, right: pad * 3)
    field.frame = CGRect(x: x - pad, y: baseline - firstBaseline - pad, width: frameWidth, height: CGFloat(max(1, lines.count)) * lineHeight + pad * 2)
    placeholder.frame = CGRect(x: pad, y: pad + firstBaseline - fieldFont.ascender, width: frameWidth, height: fieldFont.lineHeight)
    field.layer.borderWidth = 1 / max(1, scroll.zoomScale)
    updateHandle()
  }

  private func updateHandle() {
    guard textBox.visible, placement != nil, !disabled else { handle.isHidden = true; return }
    let rect = page.convert(field.frame, to: self)
    handle.isHidden = false
    handle.frame = CGRect(x: rect.minX - 34, y: rect.midY - 15, width: 30, height: 30)
  }

  private func ensureFieldVisible() {
    let rect = page.convert(field.frame, to: scroll)
    scroll.scrollRectToVisible(rect.insetBy(dx: -40, dy: -24), animated: true)
  }

  func viewForZooming(in scrollView: UIScrollView) -> UIView? { page }
  func scrollViewDidZoom(_ scrollView: UIScrollView) {
    center()
    updateHandle()
  }
  // Outline widths follow the zoom, but redraw once the pinch settles rather than every frame.
  func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
    overlay.zoom = scale
    overlay.setNeedsDisplay()
    field.layer.borderWidth = 1 / max(1, scale)
  }
  func scrollViewDidScroll(_ scrollView: UIScrollView) { updateHandle() }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    guard let view = touch.view else { return true }
    return !(view === field || view.isDescendant(of: field) || view === handle || view.isDescendant(of: handle))
  }

  @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
    guard !disabled, page.bounds.width > 0 else { return }
    let location = recognizer.location(in: page)
    let x = location.x / page.bounds.width, y = location.y / page.bounds.height
    guard (0...1).contains(x), (0...1).contains(y) else { return }
    if adding { onPlace(["x": Double(x), "y": Double(y)]); return }
    let tolX = 10 / (page.bounds.width * scroll.zoomScale), tolY = 10 / (page.bounds.height * scroll.zoomScale)
    let hits = boxes.filter { $0.rect.insetBy(dx: -tolX, dy: -tolY).contains(CGPoint(x: x, y: y)) }
    let best = hits.min { score($0, x, y) < score($1, x, y) }
    if let best { onSelectObject(["id": best.id]) }
  }
  private func score(_ box: Box, _ x: CGFloat, _ y: CGFloat) -> CGFloat {
    (box.rect.contains(CGPoint(x: x, y: y)) ? 0 : 100) + abs(y - box.rect.midY) + abs(x - box.rect.midX) * 0.01
  }

  @objc private func doubleTapped(_ recognizer: UITapGestureRecognizer) {
    guard !disabled else { return }
    if scroll.zoomScale > 1.1 { scroll.setZoomScale(1, animated: true); return }
    let point = recognizer.location(in: page)
    let target: CGFloat = 2.5
    let size = CGSize(width: scroll.bounds.width / target, height: scroll.bounds.height / target)
    scroll.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
  }

  @objc private func dragHandle(_ recognizer: UIPanGestureRecognizer) {
    guard !disabled, page.bounds.width > 0 else { return }
    let delta = recognizer.translation(in: page)
    recognizer.setTranslation(.zero, in: page)
    field.center = CGPoint(x: field.center.x + delta.x, y: field.center.y + delta.y)
    updateHandle()
    if recognizer.state == .ended || recognizer.state == .cancelled {
      let pad = field.textContainerInset.left
      let x = (field.frame.minX + pad) / page.bounds.width
      let y = (field.frame.minY + pad + lineHeight + fieldFont.descender) / page.bounds.height
      onPlace(["x": Double(min(1, max(0, x))), "y": Double(min(1, max(0, y)))])
    }
  }

  func textViewDidChange(_ textView: UITextView) {
    placeholder.isHidden = !textView.text.isEmpty
    onTextChange(["text": textView.text ?? ""])
    layoutField()
  }
  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    let next = (textView.text as NSString).replacingCharacters(in: range, with: text)
    return next.count <= 4000 && next.components(separatedBy: "\n").count <= 50
  }
  func textViewDidBeginEditing(_ textView: UITextView) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in self?.ensureFieldVisible() }
  }

  func dispose() {
    ticket += 1
    if field.isFirstResponder { field.resignFirstResponder() }
    imageView.image = nil
  }

  private func parse(_ json: String) -> [String: Any]? {
    guard !json.isEmpty else { return nil }
    return (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
  }
  private func number(_ value: Any?) -> CGFloat? {
    if let value = value as? NSNumber { return CGFloat(truncating: value) }
    return nil
  }
}

private final class EditOverlay: UIView {
  var rects: [CGRect] = []
  var ids: [Int] = []
  var selectedId = -1
  var adding = false
  var textVisible = false
  var placement: CGPoint?
  var zoom: CGFloat = 1
  struct Mark { var erase: CGRect?; var left = 0xFFFFFF; var right = 0xFFFFFF; var lines: [String] = []; var font = "Helvetica"; var size: CGFloat = 16; var color = 0x101010; var point = CGPoint.zero; var underline = false }
  var marks: [Mark] = []
  var pointWidth: CGFloat = 0

  private func color(_ value: Int) -> UIColor {
    UIColor(red: CGFloat(value >> 16 & 255) / 255, green: CGFloat(value >> 8 & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
  }

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    let blue = UIColor(red: 0.08, green: 0.4, blue: 1, alpha: 1)
    let w = bounds.width, h = bounds.height
    let scale = w / (pointWidth > 0 ? pointWidth : 612)
    // Covered lines and applied text, drawn live so edits never round-trip through image files.
    for mark in marks {
      if let erase = mark.erase {
        var frame = CGRect(x: erase.minX * w, y: erase.minY * h, width: erase.width * w, height: erase.height * h)
        let pad = max(1, frame.height * 0.15)
        frame = frame.insetBy(dx: -pad, dy: -pad)
        if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [color(mark.left).cgColor, color(mark.right).cgColor] as CFArray, locations: [0, 1]) {
          context.saveGState()
          context.addPath(UIBezierPath(roundedRect: frame, cornerRadius: pad).cgPath)
          context.clip()
          context.drawLinearGradient(gradient, start: CGPoint(x: frame.minX, y: 0), end: CGPoint(x: frame.maxX, y: 0), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
          context.restoreGState()
        }
      }
      if !mark.lines.isEmpty {
        let face = versaraFont(mark.font, max(1, mark.size * scale))
        var attributes: [NSAttributedString.Key: Any] = [.font: face, .foregroundColor: color(mark.color)]
        if mark.underline { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
        for (index, line) in mark.lines.enumerated() where !line.isEmpty {
          (line as NSString).draw(at: CGPoint(x: mark.point.x * w, y: mark.point.y * h + CGFloat(index) * face.pointSize * 1.2 - face.ascender), withAttributes: attributes)
        }
      }
    }
    if !adding {
      for (index, box) in rects.enumerated() {
        let frame = CGRect(x: box.minX * w, y: box.minY * h, width: box.width * w, height: box.height * h)
        if ids[index] == selectedId {
          context.setFillColor(blue.withAlphaComponent(0.13).cgColor); context.fill(frame)
          context.setStrokeColor(blue.cgColor); context.setLineWidth(1.5 / zoom)
        } else {
          context.setStrokeColor(blue.withAlphaComponent(0.4).cgColor); context.setLineWidth(0.8 / zoom)
        }
        context.stroke(frame)
      }
    }
    if adding, !textVisible, let point = placement {
      let r = 4 / zoom
      context.setFillColor(blue.cgColor)
      context.fillEllipse(in: CGRect(x: point.x * w - r, y: point.y * h - r, width: r * 2, height: r * 2))
    }
  }
}

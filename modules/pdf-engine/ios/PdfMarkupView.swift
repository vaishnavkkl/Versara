import ExpoModulesCore
import UIKit
import ImageIO

final class PdfMarkupView: ExpoView, UIGestureRecognizerDelegate {
  let onMark = EventDispatcher()
  let onSelection = EventDispatcher()
  let onZoom = EventDispatcher()
  let onPageSwipe = EventDispatcher()
  private var zoomSerial = ""
  private var lastZoom: CGFloat = 1
  private var loupeVisible = false
  private var loupeFinger = CGPoint.zero
  private var grab = CGPoint.zero
  private var image: UIImage?
  private var source = ""
  private var version = 0
  private var closed = false
  private var pendingSource: String?
  private var decoding = false
  private let decoder = DispatchQueue(label: "com.versara.pdf.markup-decode", qos: .userInitiated)
  private var marks: [[String: Any]] = []
  private var points: [[Double]] = []
  private var pageRect = CGRect.zero
  var mode = "draw" {
    didSet {
      guard mode != oldValue else { return }
      finishErase(commit: false)
      cancelSelection(); panning = false
      points = []; selectionStart = nil; loupeVisible = false
      if mode != "select" { selected = -1; emitSelection() } else { emitSelection() }
      lastErase = nil; erasedInGesture.removeAll(); setNeedsDisplay()
    }
  }
  var inkColor = "#1D4ED8"
  var fillColor = ""
  var shapePath = "[]"
  var brush = "pen"
  var pattern = "solid"
  var inkOpacity = -1.0
  private var cachedRect = CGRect.zero
  private var paths: [CGPath] = []
  private var selected = -1
  private var selectionStart: [String: Any]?
  private var selectionPoint = CGPoint.zero
  private var handle = -1
  private var lastSelection = ""
  private var lastErase: CGPoint?
  private var eraseStart: [[String: Any]]?
  private var erasedInGesture = Set<String>()
  private var zoom: CGFloat = 1
  private var pan = CGPoint.zero
  private var navigating = false
  // In select mode a drag that starts away from every mark moves the page instead.
  private var panning = false
  private var panStart = CGPoint.zero
  private var panLast = CGPoint.zero
  var inkWidth = 0.005
  var disabled = false
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = UIColor(red: 0.9, green: 0.92, blue: 0.95, alpha: 1)
    isMultipleTouchEnabled = true; contentMode = .redraw
    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinchPage(_:))); pinch.delegate = self; addGestureRecognizer(pinch)
    let move = UIPanGestureRecognizer(target: self, action: #selector(movePage(_:))); move.minimumNumberOfTouches = 2; move.delegate = self; addGestureRecognizer(move)
    accessibilityLabel = "PDF page. Drag to annotate."
  }
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
  @objc private func pinchPage(_ g: UIPinchGestureRecognizer) {
    cancelSelection()
    finishErase(commit: false)
    points = []; loupeVisible = false; let next = min(6, max(1, zoom * g.scale)), ratio = next / zoom, focus = g.location(in: self)
    pan.x = focus.x - bounds.midX - (focus.x - bounds.midX - pan.x) * ratio
    pan.y = focus.y - bounds.midY - (focus.y - bounds.midY - pan.y) * ratio
    zoom = next; g.scale = 1; setNeedsDisplay()
    if g.state == .ended || g.state == .cancelled { emitZoom() }
  }
  private func emitZoom() { if abs(zoom - lastZoom) > 0.001 { lastZoom = zoom; onZoom(["zoom": Double(zoom)]) } }
  func requestZoom(_ value: String) {
    let parts = value.split(separator: ":", maxSplits: 1).map(String.init)
    let serial = parts.first ?? "", factor = parts.count > 1 ? Double(parts[1]) : nil
    guard serial != zoomSerial else { return }
    let first = zoomSerial.isEmpty; zoomSerial = serial
    guard !first, let factor, factor.isFinite, factor > 0, !closed, bounds.width > 0, !pageRect.isEmpty else { return }
    let next = min(6, max(1, zoom * CGFloat(factor))), ratio = next / zoom
    var focus = CGPoint(x: bounds.midX, y: bounds.midY)
    let hasSelection = marks.indices.contains(selected)
    if hasSelection { let box = screenBox(boundsOf(marks[selected])); focus = CGPoint(x: box.midX, y: box.midY) }
    pan.x = focus.x - bounds.midX - (focus.x - bounds.midX - pan.x) * ratio
    pan.y = focus.y - bounds.midY - (focus.y - bounds.midY - pan.y) * ratio
    if hasSelection { pan.x += bounds.midX - focus.x; pan.y += bounds.midY - focus.y }
    zoom = next; setNeedsDisplay(); emitZoom()
  }
  @objc private func movePage(_ g: UIPanGestureRecognizer) { cancelSelection(); finishErase(commit: false); points = []; loupeVisible = false; if g.state == .ended { emitZoom() }; let delta = g.translation(in: self); pan.x += delta.x; pan.y += delta.y; g.setTranslation(.zero, in: self); setNeedsDisplay() }
  func setSource(_ value: String) {
    guard value != source, !closed else { return }
    source = value; version += 1; pendingSource = value; points = []; image = nil; setNeedsDisplay(); decodeNext()
  }
  private func decodeNext() {
    guard !closed, !decoding, let value = pendingSource, let url = URL(string: value) else { return }
    pendingSource = nil; decoding = true; let ticket = version
    decoder.async { [weak self] in
      let loaded: UIImage? = autoreleasepool {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let decoded = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { return nil }
        return UIImage(cgImage: decoded)
      }
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }; self.decoding = false
        if !self.closed && self.version == ticket { self.image = loaded; self.setNeedsDisplay() }
        self.decodeNext()
      }
    }
  }
  private let stampDecoder = DispatchQueue(label: "com.versara.signature-preview", qos: .userInitiated)
  private var stampImages: [String: UIImage] = [:]
  private var stampKey = ""
  private var stampDecoding = false
  private func loadStamps() {
    let uris = Array(Set(marks.filter { $0["kind"] as? String == "image" }.compactMap { $0["imageUri"] as? String })).sorted().prefix(16).map { $0 }
    let key = uris.joined(separator: "|")
    guard !closed, !stampDecoding, key != stampKey else { return }
    stampKey=key; stampDecoding=true
    stampImages = stampImages.filter { uris.contains($0.key) }
    let retained = stampImages
    stampDecoder.async { [weak self] in
      let loaded: [String: UIImage] = autoreleasepool {
        var images = retained
        let roots = [FileManager.default.urls(for: .cachesDirectory,in: .userDomainMask)[0],FileManager.default.urls(for: .documentDirectory,in: .userDomainMask)[0]]
        for uri in uris where images[uri] == nil {
          guard let url=URL(string:uri), url.isFileURL, roots.contains(where: { url.resolvingSymlinksInPath().path.hasPrefix($0.resolvingSymlinksInPath().path+"/") }),
            let source=CGImageSourceCreateWithURL(url as CFURL,nil),
            let image=CGImageSourceCreateThumbnailAtIndex(source,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceThumbnailMaxPixelSize:512,kCGImageSourceShouldCacheImmediately:true] as CFDictionary) else { continue }
          images[uri]=UIImage(cgImage:image)
        }
        return images
      }
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }; self.stampDecoding=false
        if !self.closed { self.stampImages=loaded; self.setNeedsDisplay(); self.loadStamps() }
      }
    }
  }
  func setMarks(_ value: String) {
    eraseStart = nil; lastErase = nil; erasedInGesture.removeAll()
    let previousIds = Set(marks.compactMap { $0["id"] as? String })
    let id = marks.indices.contains(selected) ? marks[selected]["id"] as? String : nil
    marks = (try? JSONSerialization.jsonObject(with: Data(value.utf8))) as? [[String: Any]] ?? []; cachedRect = .zero
    selected = id.flatMap { id in marks.firstIndex { $0["id"] as? String == id } } ?? -1
    if let added = marks.indices.reversed().first(where: { (mode == "select" || marks[$0]["kind"] as? String == "image") && !previousIds.contains(marks[$0]["id"] as? String ?? "") }) { selected=added }
    if selected < 0 { selectionStart = nil }
    if mode == "select" { emitSelection() }
    loadStamps()
    setNeedsDisplay()
  }
  func dispose() { closed = true; stampImages=[:]; pendingSource = nil; version += 1; image = nil; points = []; marks = []; paths = []; cachedRect = .zero; eraseStart = nil; lastErase = nil; erasedInGesture.removeAll(); lastSelection = "" }
  override func draw(_ rect: CGRect) {
    guard let image, let context = UIGraphicsGetCurrentContext() else { return }
    guard bounds.width > 0, bounds.height > 0, image.size.width > 0, image.size.height > 0 else { return }
    let scale = min(bounds.width / image.size.width, bounds.height / image.size.height)
    let size = CGSize(width: image.size.width * scale * zoom, height: image.size.height * scale * zoom)
    pan.x = min(max(0, (size.width - bounds.width) / 2), max(-max(0, (size.width - bounds.width) / 2), pan.x))
    pan.y = min(max(0, (size.height - bounds.height) / 2), max(-max(0, (size.height - bounds.height) / 2), pan.y))
    pageRect = CGRect(x: (bounds.width - size.width) / 2 + pan.x, y: (bounds.height - size.height) / 2 + pan.y, width: size.width, height: size.height)
    if cachedRect != pageRect || paths.count != marks.count { paths = marks.map { markPath($0) }; cachedRect = pageRect }
    let draft = points.count >= 2 ? currentMark() : nil
    drawScene(image, context, draft, 1)
    if loupeVisible { drawLoupe(image, context, draft) }
  }
  private func drawScene(_ image: UIImage, _ context: CGContext, _ draft: [String: Any]?, _ magnification: CGFloat) {
    image.draw(in: pageRect); context.saveGState(); context.clip(to: pageRect)
    for (index, mark) in marks.enumerated() where paths.indices.contains(index) { drawMark(mark, context, paths[index]) }
    if let draft { drawMark(draft, context) }
    context.restoreGState()
    if mode == "select", marks.indices.contains(selected) { drawSelection(marks[selected], context, magnification) }
  }
  private func screenBox(_ box: CGRect) -> CGRect {
    CGRect(x: pageRect.minX + box.minX * pageRect.width, y: pageRect.minY + box.minY * pageRect.height, width: box.width * pageRect.width, height: box.height * pageRect.height)
  }
  /// Corners first (0-3), then edge midpoints (4-7). Images resize from corners only to keep their shape.
  private func handlePoints(_ box: CGRect, image: Bool) -> [CGPoint] {
    let corners = [CGPoint(x: box.minX, y: box.minY), CGPoint(x: box.maxX, y: box.minY), CGPoint(x: box.maxX, y: box.maxY), CGPoint(x: box.minX, y: box.maxY)]
    return image ? corners : corners + [CGPoint(x: box.midX, y: box.minY), CGPoint(x: box.maxX, y: box.midY), CGPoint(x: box.midX, y: box.maxY), CGPoint(x: box.minX, y: box.midY)]
  }
  /// The move handle sits in the middle, or below a box too small to hold it beside the resize handles.
  private func moveHandle(_ box: CGRect) -> CGPoint {
    if box.width >= 64 && box.height >= 64 { return CGPoint(x: box.midX, y: box.midY) }
    let below = box.maxY + 30
    return CGPoint(x: box.midX, y: below + 16 <= bounds.height ? below : box.minY - 30)
  }
  private func drawSelection(_ mark: [String: Any], _ context: CGContext, _ magnification: CGFloat) {
    let d = 1 / magnification, box = screenBox(boundsOf(mark))
    let outline = UIColor(red: 124/255, green: 128/255, blue: 176/255, alpha: 1).cgColor
    context.saveGState()
    context.setStrokeColor(outline); context.setLineWidth(1.25 * d); context.setLineDash(phase: 0, lengths: [4 * d, 3 * d]); context.stroke(box); context.setLineDash(phase: 0, lengths: [])
    let move = moveHandle(box)
    if !box.contains(move) { context.move(to: CGPoint(x: box.midX, y: move.y > box.maxY ? box.maxY : box.minY)); context.addLine(to: move); context.strokePath() }
    let half = 5 * d
    for p in handlePoints(box, image: mark["kind"] as? String == "image") {
      let square = CGRect(x: p.x - half, y: p.y - half, width: half * 2, height: half * 2)
      context.setFillColor(UIColor.white.cgColor); context.fill(square); context.stroke(square)
    }
    context.setFillColor(UIColor(red: 57/255, green: 104/255, blue: 225/255, alpha: 1).cgColor)
    context.fillEllipse(in: CGRect(x: move.x - 13 * d, y: move.y - 13 * d, width: 26 * d, height: 26 * d))
    context.setStrokeColor(UIColor.white.cgColor); context.setLineWidth(1.6 * d); context.setLineCap(.round); context.setLineJoin(.round)
    let arm = 7 * d, tip = 2.6 * d
    context.move(to: CGPoint(x: move.x - arm, y: move.y)); context.addLine(to: CGPoint(x: move.x + arm, y: move.y))
    context.move(to: CGPoint(x: move.x, y: move.y - arm)); context.addLine(to: CGPoint(x: move.x, y: move.y + arm))
    for (dx, dy) in [(CGFloat(1), CGFloat(0)), (-1, 0), (0, 1), (0, -1)] {
      let end = CGPoint(x: move.x + dx * arm, y: move.y + dy * arm)
      context.move(to: end); context.addLine(to: CGPoint(x: end.x - dx * tip + dy * tip, y: end.y - dy * tip + dx * tip))
      context.move(to: end); context.addLine(to: CGPoint(x: end.x - dx * tip - dy * tip, y: end.y - dy * tip - dx * tip))
    }
    context.strokePath(); context.restoreGState()
  }
  /// A magnified view of the point being placed, shown only while a finger moves a shape or draws one.
  private func drawLoupe(_ image: UIImage, _ context: CGContext, _ draft: [String: Any]?) {
    let size: CGFloat = 128, margin: CGFloat = 12, radius: CGFloat = 16
    var frame = CGRect(x: bounds.width - margin - size, y: margin, width: size, height: size)
    if frame.insetBy(dx: -24, dy: -24).contains(loupeFinger) { frame.origin.x = margin }
    var focus = loupeFinger, magnification: CGFloat = 2.5
    if mode == "select", marks.indices.contains(selected) {
      let box = screenBox(boundsOf(marks[selected]))
      if handle < 0 { focus = CGPoint(x: box.midX, y: box.midY); magnification = min(4, max(1.5, size * 0.6 / max(box.width, box.height, 1))) }
      else if handlePoints(box, image: false).indices.contains(handle) { focus = handlePoints(box, image: false)[handle] }
    } else if draft != nil, let last = points.last, last.count == 2 {
      focus = CGPoint(x: pageRect.minX + CGFloat(last[0]) * pageRect.width, y: pageRect.minY + CGFloat(last[1]) * pageRect.height)
    }
    let clip = UIBezierPath(roundedRect: frame, cornerRadius: radius)
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: 2), blur: 8, color: UIColor.black.withAlphaComponent(0.25).cgColor)
    context.setFillColor(UIColor(red: 0.9, green: 0.92, blue: 0.95, alpha: 1).cgColor); context.addPath(clip.cgPath); context.fillPath()
    context.restoreGState()
    context.saveGState(); context.addPath(clip.cgPath); context.clip()
    context.translateBy(x: frame.midX, y: frame.midY); context.scaleBy(x: magnification, y: magnification); context.translateBy(x: -focus.x, y: -focus.y)
    drawScene(image, context, draft, magnification)
    context.restoreGState()
    context.saveGState()
    context.setStrokeColor(UIColor.white.cgColor); context.setLineWidth(1.5); context.addPath(clip.cgPath); context.strokePath()
    context.setStrokeColor(UIColor(red: 57/255, green: 104/255, blue: 225/255, alpha: 0.6).cgColor); context.setLineWidth(1)
    context.move(to: CGPoint(x: frame.midX - 6, y: frame.midY)); context.addLine(to: CGPoint(x: frame.midX + 6, y: frame.midY))
    context.move(to: CGPoint(x: frame.midX, y: frame.midY - 6)); context.addLine(to: CGPoint(x: frame.midX, y: frame.midY + 6))
    context.strokePath(); context.restoreGState()
  }
  private func currentMark() -> [String: Any] {
    var output = points
    if points.count >= 2 && ["polygon", "line", "highlight"].contains(mode) {
      let template = mode == "highlight" ? [[0.0,0],[1,0],[1,1],[0,1]] : ((try? JSONSerialization.jsonObject(with: Data(shapePath.utf8))) as? [[Double]] ?? [])
      if template.count >= 2 { output = template.filter { $0.count == 2 }.map { [points[0][0] + (points[1][0] - points[0][0]) * $0[0], points[0][1] + (points[1][1] - points[0][1]) * $0[1]] } }
    }
    var mark: [String: Any] = ["kind": mode, "brush": brush, "pattern": pattern, "color": inkColor, "fillColor": mode == "highlight" ? inkColor : fillColor, "width": inkWidth, "points": output]
    if inkOpacity.isFinite && inkOpacity >= 0 { mark["opacity"] = min(1, max(0.01, inkOpacity)) }
    return mark
  }
  private func markPath(_ mark: [String: Any]) -> CGPath {
    let path = CGMutablePath()
    let raw = (mark["points"] as? [[Double]] ?? []).filter { $0.count == 2 }
    if mark["pattern"] as? String == "dotted" && !["polygon", "highlight", "redact"].contains(mark["kind"] as? String ?? "") {
      let vertices = raw.map { CGPoint(x: pageRect.minX + CGFloat($0[0]) * pageRect.width, y: pageRect.minY + CGFloat($0[1]) * pageRect.height) }
      return StrokeDots.path(vertices, width: CGFloat(mark["width"] as? Double ?? 0.005) * pageRect.width)
    }
    for (index,p) in raw.enumerated() {
      let point = CGPoint(x: pageRect.minX + CGFloat(p[0])*pageRect.width,y: pageRect.minY + CGFloat(p[1])*pageRect.height)
      if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
    }
    if ["polygon","highlight"].contains(mark["kind"] as? String ?? "") { path.closeSubpath() }
    return path
  }
  private func drawMark(_ mark: [String: Any], _ context: CGContext, _ cached: CGPath? = nil) {
    guard let raw = mark["points"] as? [[Double]], raw.count >= 2, raw.allSatisfy({ $0.count == 2 }) else { return }
    if mark["kind"] as? String == "image" {
      if let uri=mark["imageUri"] as? String, let image=stampImages[uri] {
        let b=boundsOf(mark)
        image.draw(in: CGRect(x:pageRect.minX+b.minX*pageRect.width,y:pageRect.minY+b.minY*pageRect.height,width:b.width*pageRect.width,height:b.height*pageRect.height))
      }
      return
    }
    let kind = mark["kind"] as? String ?? "draw", hex = (mark["color"] as? String ?? "#1D4ED8").replacingOccurrences(of: "#", with: "")
    let rgb = UInt32(hex, radix: 16) ?? 0x1D4ED8
    let brush = mark["brush"] as? String ?? "pen"
    let defaultOpacity: CGFloat = kind.hasPrefix("highlight") || brush == "highlighter" ? 0.3 : brush == "pencil" ? 170.0/255 : brush == "marker" ? 210.0/255 : 1
    let explicit = (mark["opacity"] as? NSNumber)?.doubleValue
    let opacity: CGFloat = kind == "redact" ? 1 : explicit?.isFinite == true ? CGFloat(min(1, max(0.01, explicit!))) : defaultOpacity
    let color = UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: opacity)
    context.saveGState(); context.setStrokeColor(color.cgColor); context.setFillColor(color.cgColor); context.setLineWidth(CGFloat(mark["width"] as? Double ?? 0.005) * pageRect.width); context.setLineCap(.round); context.setLineJoin(.round)
    let unit = CGFloat(mark["width"] as? Double ?? 0.005) * pageRect.width
    let pattern = mark["pattern"] as? String ?? "solid"
    let openStroke = !["polygon", "highlight", "redact"].contains(kind)
    if openStroke && pattern == "dotted" {
      context.addPath(cached ?? markPath(mark)); context.fillPath(); context.restoreGState(); return
    }
    context.setLineDash(phase: 0, lengths: openStroke && pattern == "dashed" ? [unit * 4, unit * 2] : [])
    context.addPath(cached ?? markPath(mark))
    let closedShape = ["polygon", "highlight"].contains(kind)
    if closedShape { context.closePath() }
    let fill = mark["fillColor"] as? String ?? ""
    if closedShape && !fill.isEmpty {
      let rgb = UInt32(fill.replacingOccurrences(of: "#", with: ""), radix: 16) ?? 0
      context.setFillColor(UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: kind == "highlight" || explicit?.isFinite == true ? opacity : 1).cgColor)
      context.drawPath(using: kind == "highlight" ? .fill : .fillStroke)
    } else { context.strokePath() }
    context.restoreGState()
  }
  private func point(_ touch: UITouch) -> [Double] {
    let p = touch.location(in: self)
    return [Double(min(1, max(0, (p.x - pageRect.minX) / pageRect.width))), Double(min(1, max(0, (p.y - pageRect.minY) / pageRect.height)))]
  }
  private func boundsOf(_ mark: [String: Any]) -> CGRect {
    let points = mark["points"] as? [[Double]] ?? []
    let xs = points.map { $0[0] }, ys = points.map { $0[1] }
    return CGRect(x: xs.min() ?? 0, y: ys.min() ?? 0, width: (xs.max() ?? 0)-(xs.min() ?? 0), height: (ys.max() ?? 0)-(ys.min() ?? 0))
  }
  private func beginSelection(_ touch: UITouch) {
    let location = touch.location(in: self), p = point(touch); let x = CGFloat(p[0]), y = CGFloat(p[1])
    handle = -1; grab = .zero
    var grabbed = false
    if marks.indices.contains(selected) {
      let mark = marks[selected], box = screenBox(boundsOf(mark))
      var best: CGFloat = 24
      for (index, point) in handlePoints(box, image: mark["kind"] as? String == "image").enumerated() {
        let distance = hypot(point.x - location.x, point.y - location.y)
        if distance < best { best = distance; handle = index; grabbed = true; grab = CGPoint(x: (point.x - location.x) / pageRect.width, y: (point.y - location.y) / pageRect.height) }
      }
      let move = moveHandle(box)
      if hypot(move.x - location.x, move.y - location.y) < min(best, 28) { handle = -1; grabbed = true; grab = .zero }
    }
    if !grabbed { selected = marks.indices.reversed().first { boundsOf(marks[$0]).insetBy(dx:-24/pageRect.width,dy:-24/pageRect.height).contains(CGPoint(x:x,y:y)) } ?? -1 }
    selectionStart = marks.indices.contains(selected) ? marks[selected] : nil
    emitSelection()
    if selected < 0 { panning = true; panStart = location; panLast = location; setNeedsDisplay(); return }
    selectionPoint = rawPoint(location); loupeFinger = location; setNeedsDisplay()
  }
  private func rawPoint(_ location: CGPoint) -> CGPoint { CGPoint(x: (location.x - pageRect.minX) / pageRect.width, y: (location.y - pageRect.minY) / pageRect.height) }
  private func moveSelection(_ touch: UITouch) {
    guard let original = selectionStart, marks.indices.contains(selected) else { return }
    let location = touch.location(in: self); loupeVisible = true; loupeFinger = location
    let raw = rawPoint(location), b = boundsOf(original); var left = b.minX, right = b.maxX, top = b.minY, bottom = b.maxY
    let hx = min(1, max(0, raw.x + grab.x)), hy = min(1, max(0, raw.y + grab.y))
    if handle < 0 {
      let dx = min(1-b.maxX,max(-b.minX,raw.x-selectionPoint.x)), dy = min(1-b.maxY,max(-b.minY,raw.y-selectionPoint.y))
      left += dx; right += dx; top += dy; bottom += dy
    } else {
      if [0, 3, 7].contains(handle) { left = min(hx, right - 0.005) }
      if [1, 2, 5].contains(handle) { right = max(hx, left + 0.005) }
      if [0, 1, 4].contains(handle) { top = min(hy, bottom - 0.005) }
      if [2, 3, 6].contains(handle) { bottom = max(hy, top + 0.005) }
    }
    if handle >= 0 && original["kind"] as? String == "image" {
      let isLeft=handle == 0 || handle == 3, isTop=handle < 2
      let ax=isLeft ? b.maxX : b.minX, ay=isTop ? b.maxY : b.minY
      let maximum=min((isLeft ? ax : 1-ax)/max(0.0001,b.width),(isTop ? ay : 1-ay)/max(0.0001,b.height))
      let scale=min(maximum,max(min(0.05,maximum),max(abs(hx-ax)/max(0.0001,b.width),abs(hy-ay)/max(0.0001,b.height))))
      let w=b.width*scale,h=b.height*scale
      left=isLeft ? ax-w : ax; right=isLeft ? ax : ax+w; top=isTop ? ay-h : ay; bottom=isTop ? ay : ay+h
    }
    var next = original
    next["points"] = (original["points"] as? [[Double]] ?? []).map { p -> [Double] in
      [Double(min(1,max(0,left+(CGFloat(p[0])-b.minX)/max(0.0001,b.width)*(right-left)))),Double(min(1,max(0,top+(CGFloat(p[1])-b.minY)/max(0.0001,b.height)*(bottom-top))))]
    }
    marks[selected] = next; cachedRect = .zero; setNeedsDisplay()
  }
  private func emit(_ mark: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: mark, options: [.sortedKeys]), let string = String(data: data, encoding: .utf8) { onMark(["mark": string]) }
  }
  private func emitSelection() {
    var value = ""
    if marks.indices.contains(selected), let data = try? JSONSerialization.data(withJSONObject: marks[selected], options: [.sortedKeys]) { value = String(data: data, encoding: .utf8) ?? "" }
    if value != lastSelection { lastSelection = value; onSelection(["mark": value]) }
  }
  private func segmentDistance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
    let dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
    let t = length <= 0.0001 ? 0 : min(1, max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    let x = p.x - a.x - t * dx, y = p.y - a.y - t * dy
    return x * x + y * y
  }
  private func segmentsHit(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint, _ d: CGPoint, _ tolerance: CGFloat) -> Bool {
    if max(a.x, b.x) + tolerance < min(c.x, d.x) || min(a.x, b.x) - tolerance > max(c.x, d.x) || max(a.y, b.y) + tolerance < min(c.y, d.y) || min(a.y, b.y) - tolerance > max(c.y, d.y) { return false }
    let c1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    let c2 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)
    let c3 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x)
    let c4 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x)
    if c1 * c2 < 0 && c3 * c4 < 0 { return true }
    return min(min(segmentDistance(a, c, d), segmentDistance(b, c, d)), min(segmentDistance(c, a, b), segmentDistance(d, a, b))) <= tolerance * tolerance
  }
  private func eraseAt(_ end: CGPoint) {
    let start = lastErase ?? end
    for index in marks.indices.reversed() {
      let mark = marks[index]
      guard ["draw", "sign", "highlight-brush", "line"].contains(mark["kind"] as? String ?? ""),
            let id = mark["id"] as? String, !erasedInGesture.contains(id), let samples = mark["points"] as? [[Double]], samples.count >= 2 else { continue }
      let tolerance = max(12, CGFloat(mark["width"] as? Double ?? 0.005) * pageRect.width / 2)
      var hit = false
      for point in 1..<samples.count {
        let first = samples[point - 1], second = samples[point]
        guard first.count == 2 && second.count == 2 else { continue }
        let a = CGPoint(x: pageRect.minX + first[0] * pageRect.width, y: pageRect.minY + first[1] * pageRect.height)
        let b = CGPoint(x: pageRect.minX + second[0] * pageRect.width, y: pageRect.minY + second[1] * pageRect.height)
        if segmentsHit(start, end, a, b, tolerance) { hit = true; break }
      }
      if hit { erasedInGesture.insert(id); marks.remove(at: index); cachedRect = .zero; selected = -1 }
    }
    lastErase = end; emitSelection(); setNeedsDisplay()
  }
  private func finishErase(commit: Bool) {
    guard let original = eraseStart else { return }
    if commit { for id in erasedInGesture { emit(["id": id, "deleted": true]) } }
    else { marks = original }
    eraseStart = nil; lastErase = nil; erasedInGesture.removeAll(); cachedRect = .zero; setNeedsDisplay()
  }
  private func cancelSelection() {
    if let original = selectionStart, marks.indices.contains(selected) { marks[selected] = original; cachedRect = .zero }
    selectionStart = nil
  }
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    if (event?.allTouches?.count ?? 0) > 1 { cancelSelection(); finishErase(commit: false); points = []; loupeVisible = false; panning = false; navigating = true; setNeedsDisplay(); return }; navigating = false
    if mode == "select", !disabled, image != nil, !pageRect.isEmpty, let touch = touches.first { beginSelection(touch); return }
    guard !disabled, image != nil, let touch = touches.first, pageRect.contains(touch.location(in: self)) else { return }
    if mode == "erase" { eraseStart = marks; lastErase = nil; erasedInGesture.removeAll(); eraseAt(touch.location(in: self)); return }
    let p = point(touch); points = [p, p]; setNeedsDisplay()
  }
  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    if mode == "erase", !navigating, (event?.allTouches?.count ?? 0) <= 1, !disabled, lastErase != nil, let touch = touches.first { eraseAt(touch.location(in: self)); return }
    if mode == "select", panning, !navigating, (event?.allTouches?.count ?? 0) <= 1, let touch = touches.first {
      let location = touch.location(in: self); pan.x += location.x - panLast.x; pan.y += location.y - panLast.y; panLast = location; setNeedsDisplay(); return
    }
    if mode == "select", !navigating, (event?.allTouches?.count ?? 0) <= 1, !disabled, let touch = touches.first { moveSelection(touch); return }
    guard !navigating, (event?.allTouches?.count ?? 0) <= 1, !disabled, !points.isEmpty, let touch = touches.first else { return }
    if ["highlight", "polygon", "line"].contains(mode) { points[1] = point(touch); loupeVisible = true; loupeFinger = touch.location(in: self) } else if points.count < 4096 { points.append(point(touch)) }
    setNeedsDisplay()
  }
  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    loupeVisible = false
    if panning {
      panning = false
      if let touch = touches.first, !navigating, zoom <= 1.01 {
        let location = touch.location(in: self), dx = location.x - panStart.x, dy = location.y - panStart.y
        if abs(dx) > 64 && abs(dx) > 1.5 * abs(dy) { onPageSwipe(["direction": dx < 0 ? 1 : -1]) }
      }
      setNeedsDisplay(); return
    }
    if mode == "select" { if selectionStart != nil, marks.indices.contains(selected) { emit(marks[selected]) }; selectionStart = nil; emitSelection(); setNeedsDisplay(); return }
    if mode == "erase" { if !navigating, !disabled, lastErase != nil, let touch = touches.first { eraseAt(touch.location(in: self)) }; finishErase(commit: !navigating && !disabled); return }
    guard !points.isEmpty else { return }
    touchesMoved(touches, with: event)
    var mark = currentMark(); mark["id"] = UUID().uuidString; marks.append(mark); cachedRect = .zero
    emit(mark)
    points = []; loupeVisible = false; setNeedsDisplay()
  }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { loupeVisible = false; panning = false; if let original = selectionStart, marks.indices.contains(selected) { marks[selected] = original; cachedRect = .zero }; selectionStart = nil; points = []; finishErase(commit: false); emitSelection(); setNeedsDisplay() }
}

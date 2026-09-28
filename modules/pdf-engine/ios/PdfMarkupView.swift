import ExpoModulesCore
import UIKit
import ImageIO

final class PdfMarkupView: ExpoView, UIGestureRecognizerDelegate {
  let onMark = EventDispatcher()
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
  var mode = "draw"
  var inkColor = "#1D4ED8"
  var fillColor = ""
  var shapePath = "[]"
  var brush = "pen"
  var pattern = "solid"
  private var cachedRect = CGRect.zero
  private var paths: [CGPath] = []
  private var selected = -1
  private var selectionStart: [String: Any]?
  private var selectionPoint = CGPoint.zero
  private var handle = -1
  private var zoom: CGFloat = 1
  private var pan = CGPoint.zero
  private var navigating = false
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
    points = []; let next = min(6, max(1, zoom * g.scale)), ratio = next / zoom, focus = g.location(in: self)
    pan.x = focus.x - bounds.midX - (focus.x - bounds.midX - pan.x) * ratio
    pan.y = focus.y - bounds.midY - (focus.y - bounds.midY - pan.y) * ratio
    zoom = next; g.scale = 1; setNeedsDisplay()
  }
  @objc private func movePage(_ g: UIPanGestureRecognizer) { cancelSelection(); points = []; let delta = g.translation(in: self); pan.x += delta.x; pan.y += delta.y; g.setTranslation(.zero, in: self); setNeedsDisplay() }
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
  func setMarks(_ value: String) { marks = (try? JSONSerialization.jsonObject(with: Data(value.utf8))) as? [[String: Any]] ?? []; cachedRect = .zero; if selected >= marks.count { selected = -1 }; setNeedsDisplay() }
  func dispose() { closed = true; pendingSource = nil; version += 1; image = nil; points = []; marks = [] }
  override func draw(_ rect: CGRect) {
    guard let image, let context = UIGraphicsGetCurrentContext() else { return }
    let scale = min(bounds.width / image.size.width, bounds.height / image.size.height)
    let size = CGSize(width: image.size.width * scale * zoom, height: image.size.height * scale * zoom)
    pan.x = min(max(0, (size.width - bounds.width) / 2), max(-max(0, (size.width - bounds.width) / 2), pan.x))
    pan.y = min(max(0, (size.height - bounds.height) / 2), max(-max(0, (size.height - bounds.height) / 2), pan.y))
    pageRect = CGRect(x: (bounds.width - size.width) / 2 + pan.x, y: (bounds.height - size.height) / 2 + pan.y, width: size.width, height: size.height)
    image.draw(in: pageRect); context.saveGState(); context.clip(to: pageRect)
    if cachedRect != pageRect || paths.count != marks.count { paths = marks.map { markPath($0) }; cachedRect = pageRect }
    for (index, mark) in marks.enumerated() { drawMark(mark, context, paths[index]) }
    if points.count >= 2 { drawMark(currentMark(), context) }
    context.restoreGState()
    if mode == "select", marks.indices.contains(selected) {
      let box = boundsOf(marks[selected])
      let area = CGRect(x: pageRect.minX + box.minX * pageRect.width, y: pageRect.minY + box.minY * pageRect.height, width: box.width * pageRect.width, height: box.height * pageRect.height)
      context.setStrokeColor(UIColor.systemBlue.cgColor); context.setFillColor(UIColor.systemBlue.cgColor); context.setLineWidth(2); context.stroke(area)
      for point in [CGPoint(x: area.minX,y: area.minY),CGPoint(x: area.maxX,y: area.minY),CGPoint(x: area.maxX,y: area.maxY),CGPoint(x: area.minX,y: area.maxY)] { context.fillEllipse(in: CGRect(x: point.x-6,y: point.y-6,width:12,height:12)) }
    }
  }
  private func currentMark() -> [String: Any] {
    var output = points
    if points.count >= 2 && ["polygon", "line", "highlight"].contains(mode) {
      let template = mode == "highlight" ? [[0.0,0],[1,0],[1,1],[0,1]] : ((try? JSONSerialization.jsonObject(with: Data(shapePath.utf8))) as? [[Double]] ?? [])
      if template.count >= 2 { output = template.filter { $0.count == 2 }.map { [points[0][0] + (points[1][0] - points[0][0]) * $0[0], points[0][1] + (points[1][1] - points[0][1]) * $0[1]] } }
    }
    return ["kind": mode, "brush": brush, "pattern": pattern, "color": inkColor, "fillColor": mode == "highlight" ? inkColor : fillColor, "width": inkWidth, "points": output]
  }
  private func markPath(_ mark: [String: Any]) -> CGPath {
    let path = CGMutablePath()
    for (index,p) in (mark["points"] as? [[Double]] ?? []).enumerated() where p.count == 2 {
      let point = CGPoint(x: pageRect.minX + CGFloat(p[0])*pageRect.width,y: pageRect.minY + CGFloat(p[1])*pageRect.height)
      if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
    }
    if ["polygon","highlight"].contains(mark["kind"] as? String ?? "") { path.closeSubpath() }
    return path
  }
  private func drawMark(_ mark: [String: Any], _ context: CGContext, _ cached: CGPath? = nil) {
    guard let raw = mark["points"] as? [[Double]], raw.count >= 2, raw.allSatisfy({ $0.count == 2 }) else { return }
    let kind = mark["kind"] as? String ?? "draw", hex = (mark["color"] as? String ?? "#1D4ED8").replacingOccurrences(of: "#", with: "")
    let rgb = UInt32(hex, radix: 16) ?? 0x1D4ED8
    let brush = mark["brush"] as? String ?? "pen"
    let opacity: CGFloat = kind.hasPrefix("highlight") || brush == "highlighter" ? 0.3 : brush == "pencil" ? 170.0/255 : brush == "marker" ? 210.0/255 : 1
    let color = UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: opacity)
    context.saveGState(); context.setStrokeColor(color.cgColor); context.setFillColor(color.cgColor); context.setLineWidth(CGFloat(mark["width"] as? Double ?? 0.005) * pageRect.width); context.setLineCap(.round); context.setLineJoin(.round)
    let unit = max(1, CGFloat(mark["width"] as? Double ?? 0.005) * pageRect.width)
    let pattern = mark["pattern"] as? String ?? "solid"
    context.setLineDash(phase: 0, lengths: pattern == "dotted" ? [unit * 0.1,unit * 2.4] : pattern == "dashed" ? [unit * 4,unit * 2] : [])
    context.addPath(cached ?? markPath(mark))
    let closedShape = ["polygon", "highlight"].contains(kind)
    if closedShape { context.closePath() }
    let fill = mark["fillColor"] as? String ?? ""
    if closedShape && !fill.isEmpty {
      let rgb = UInt32(fill.replacingOccurrences(of: "#", with: ""), radix: 16) ?? 0
      context.setFillColor(UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: kind == "highlight" ? 0.3 : 1).cgColor)
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
    let p = point(touch); let x = CGFloat(p[0]), y = CGFloat(p[1]); handle = -1
    if marks.indices.contains(selected) {
      let b = boundsOf(marks[selected]); let corners = [CGPoint(x:b.minX,y:b.minY),CGPoint(x:b.maxX,y:b.minY),CGPoint(x:b.maxX,y:b.maxY),CGPoint(x:b.minX,y:b.maxY)]
      handle = corners.firstIndex { abs($0.x-x)*pageRect.width < 24 && abs($0.y-y)*pageRect.height < 24 } ?? -1
    }
    if handle < 0 { selected = marks.indices.reversed().first { boundsOf(marks[$0]).insetBy(dx:-24/pageRect.width,dy:-24/pageRect.height).contains(CGPoint(x:x,y:y)) } ?? -1 }
    selectionStart = marks.indices.contains(selected) ? marks[selected] : nil
    selectionPoint = CGPoint(x:x,y:y); setNeedsDisplay()
  }
  private func moveSelection(_ touch: UITouch) {
    guard let original = selectionStart, marks.indices.contains(selected) else { return }
    let p = point(touch), b = boundsOf(original); var left = b.minX, right = b.maxX, top = b.minY, bottom = b.maxY
    if handle < 0 {
      let dx = min(1-b.maxX,max(-b.minX,CGFloat(p[0])-selectionPoint.x)), dy = min(1-b.maxY,max(-b.minY,CGFloat(p[1])-selectionPoint.y))
      left += dx; right += dx; top += dy; bottom += dy
    } else {
      if handle == 0 || handle == 3 { left = min(CGFloat(p[0]),right - 0.005) } else { right = max(CGFloat(p[0]),left + 0.005) }
      if handle < 2 { top = min(CGFloat(p[1]),bottom - 0.005) } else { bottom = max(CGFloat(p[1]),top + 0.005) }
    }
    var next = original
    next["points"] = (original["points"] as? [[Double]] ?? []).map { p -> [Double] in
      [Double(min(1,max(0,left+(CGFloat(p[0])-b.minX)/max(0.0001,b.width)*(right-left)))),Double(min(1,max(0,top+(CGFloat(p[1])-b.minY)/max(0.0001,b.height)*(bottom-top))))]
    }
    marks[selected] = next; cachedRect = .zero; setNeedsDisplay()
  }
  private func emit(_ mark: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: mark), let string = String(data: data, encoding: .utf8) { onMark(["mark": string]) }
  }
  private func cancelSelection() {
    if let original = selectionStart, marks.indices.contains(selected) { marks[selected] = original; cachedRect = .zero }
    selectionStart = nil
  }
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    if (event?.allTouches?.count ?? 0) > 1 { cancelSelection(); points = []; navigating = true; return }; navigating = false
    guard !disabled, image != nil, let touch = touches.first, pageRect.contains(touch.location(in: self)) else { return }
    if mode == "select" { beginSelection(touch); return }
    let p = point(touch); points = [p, p]; setNeedsDisplay()
  }
  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    if mode == "select", !navigating, (event?.allTouches?.count ?? 0) <= 1, !disabled, let touch = touches.first { moveSelection(touch); return }
    guard !navigating, (event?.allTouches?.count ?? 0) <= 1, !disabled, !points.isEmpty, let touch = touches.first else { return }
    if ["highlight", "polygon", "line"].contains(mode) { points[1] = point(touch) } else if points.count < 4096 { points.append(point(touch)) }
    setNeedsDisplay()
  }
  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    if mode == "select" { if selectionStart != nil, marks.indices.contains(selected) { emit(marks[selected]) }; selectionStart = nil; return }
    guard !points.isEmpty else { return }
    touchesMoved(touches, with: event)
    var mark = currentMark(); mark["id"] = UUID().uuidString; marks.append(mark); cachedRect = .zero
    emit(mark)
    points = []; setNeedsDisplay()
  }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { if let original = selectionStart, marks.indices.contains(selected) { marks[selected] = original; cachedRect = .zero }; selectionStart = nil; points = []; setNeedsDisplay() }
}

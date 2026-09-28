import CoreGraphics

/** Keep spacing and the 2,048-dot limit aligned with Android and PDF export. */
enum StrokeDots {
  static func path(_ points: [CGPoint], width: CGFloat) -> CGPath {
    let path = CGMutablePath()
    guard let first = points.first else { return path }
    let lengths = zip(points, points.dropFirst()).map { pair in hypot(pair.1.x - pair.0.x, pair.1.y - pair.0.y) }
    let spacing = max(width * 3, max(lengths.reduce(0, +) / 2047, 0.001))
    let radius = width / 2
    func dot(_ point: CGPoint) { path.addEllipse(in: CGRect(x: point.x - radius, y: point.y - radius, width: width, height: width)) }
    dot(first)
    var next = spacing, travelled: CGFloat = 0
    var dots = 1
    for (index, length) in lengths.enumerated() {
      if length <= 0 { continue }
      let a = points[index], b = points[index + 1]
      while next <= travelled + length && dots < 2048 {
        let t = min(1, max(0, (next - travelled) / length))
        dot(CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
        next += spacing; dots += 1
      }
      travelled += length
    }
    return path
  }
}

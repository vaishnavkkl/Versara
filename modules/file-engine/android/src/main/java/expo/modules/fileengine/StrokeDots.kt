package expo.modules.fileengine

import android.graphics.Path
import android.graphics.PointF
import kotlin.math.hypot

/** Match the Swift and PDF vector exporters: round dots, spaced by arc length. */
internal object StrokeDots {
  fun path(points: List<PointF>, width: Float): Path {
    val result = Path()
    if (points.isEmpty()) return result
    val lengths = points.zipWithNext { a, b -> hypot(b.x - a.x, b.y - a.y) }
    val spacing = maxOf(width * 3f, lengths.sum() / 2047f, .001f)
    val radius = width / 2f
    result.addCircle(points[0].x, points[0].y, radius, Path.Direction.CW)
    var next = spacing
    var travelled = 0f
    var dots = 1
    for (i in lengths.indices) {
      val length = lengths[i]
      if (length <= 0f) continue
      val a = points[i]; val b = points[i + 1]
      while (next <= travelled + length && dots < 2048) {
        val t = ((next - travelled) / length).coerceIn(0f, 1f)
        result.addCircle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius, Path.Direction.CW)
        next += spacing; dots++
      }
      travelled += length
    }
    return result
  }
}

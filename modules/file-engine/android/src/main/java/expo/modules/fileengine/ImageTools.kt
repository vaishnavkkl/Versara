package expo.modules.fileengine

import android.content.Context
import android.graphics.*
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.Promise
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.*

/** Serial offline raster jobs. No pixels or source image bytes cross the JS bridge. */
internal class ImageTools {
  private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue(2))
  private val jobs = ConcurrentHashMap<String, AtomicBoolean>()
  fun cancel(id: String) { jobs[id]?.set(true) }
  fun destroy() { jobs.values.forEach { it.set(true) }; worker.shutdown() }
  fun run(context: Context, id: String, request: String, promise: Promise) {
    val stopped = AtomicBoolean(false)
    if (jobs.putIfAbsent(id, stopped) != null) { promise.reject("IMAGE_BUSY", "This image job is already running.", null); return }
    try { worker.execute {
      try { promise.resolve(process(context, JSONObject(request)) { check(!stopped.get()) { "Image operation cancelled." } }) }
      catch (_: OutOfMemoryError) { promise.reject("IMAGE_MEMORY", "Use a smaller image or output size on this device.", null) }
      catch (cause: Throwable) { promise.reject(if (stopped.get()) "IMAGE_CANCELLED" else "IMAGE_PROCESSING_FAILED", cause.message ?: "Could not process this image.", cause) }
      finally { jobs.remove(id) }
    } } catch (cause: Throwable) { jobs.remove(id); promise.reject("IMAGE_BUSY", "Wait for the current image operation.", cause) }
  }
  private fun local(context: Context, value: String): File {
    val uri = Uri.parse(value); require(uri.scheme == "file") { "Choose a local image." }
    return File(requireNotNull(uri.path)).canonicalFile.also {
      require(it.path.startsWith(context.cacheDir.canonicalPath + "/") || it.path.startsWith(context.filesDir.canonicalPath + "/")) { "Choose the image again." }
    }
  }
  private fun info(file: File): Map<String, Any> {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    val exif = runCatching { ExifInterface(file.path) }.getOrNull()
    val orientation = exif?.getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) ?: 1
    val swapped = orientation in 5..8
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "This image format cannot be read on this device." }
    return mapOf("width" to (if (swapped) bounds.outHeight else bounds.outWidth), "height" to (if (swapped) bounds.outWidth else bounds.outHeight), "size" to file.length(), "mimeType" to (bounds.outMimeType ?: "image/*"), "formats" to listOf("jpeg", "png", "webp"), "camera" to (exif?.getAttribute(ExifInterface.TAG_MODEL) ?: ""), "taken" to (exif?.getAttribute(ExifInterface.TAG_DATETIME) ?: ""), "hasLocation" to (exif?.getAttribute(ExifInterface.TAG_GPS_LATITUDE) != null))
  }
  private fun process(context: Context, r: JSONObject, check: () -> Unit): Map<String, Any> {
    if (r.optString("tool") == "signature") return SignatureImage.process(context, r, check)
    if (r.optString("tool") == "privacy") return ImagePrivacyExport.process(context, r, check)
    check(); val input = local(context, r.getString("uri")); require(input.isFile) { "The image is no longer available." }
    if (r.optString("action") == "info") return info(input)
    val target = local(context, r.getString("outputUri")); require(!target.exists()) { "Choose a new output name." }
    val temporary = File(target.path + ".partial")
    val preview = r.optString("action") == "preview"
    val budget = ImageProcessing.exportPixelBudget(context)
    val original = info(input)
    val sourceWidth = (original.getValue("width") as Number).toInt()
    val sourceHeight = (original.getValue("height") as Number).toInt()
    var requestedWidth = r.optInt("width", 0); var requestedHeight = r.optInt("height", 0)
    if (r.has("percent")) {
      val percent = r.getDouble("percent")
      require(percent.isFinite() && percent in .1..400.0) { "Enter a percentage from 0.1 to 400." }
      requestedWidth = max(1, (sourceWidth * percent / 100).roundToInt())
      requestedHeight = max(1, (sourceHeight * percent / 100).roundToInt())
    }
    val resizing = requestedWidth > 0 || requestedHeight > 0
    val outputWidth = if (requestedWidth > 0) requestedWidth else if (requestedHeight > 0) max(1, (requestedHeight * sourceWidth.toDouble() / sourceHeight).roundToInt()) else sourceWidth
    val outputHeight = if (requestedHeight > 0) requestedHeight else if (requestedWidth > 0) max(1, (requestedWidth * sourceHeight.toDouble() / sourceWidth).roundToInt()) else sourceHeight
    val targetBytes = r.optLong("targetBytes", 0)
    require(targetBytes == 0L || targetBytes >= 10_240) { "Choose a target of at least 10 KB." }
    if (!preview && resizing) ImageProcessing.requireExportSize(outputWidth, outputHeight, budget)
    // Only an explicit resize or target-byte compression may decode below the source resolution.
    val decodeScale = when {
      resizing -> min(1.0, max(outputWidth.toDouble() / sourceWidth, outputHeight.toDouble() / sourceHeight))
      targetBytes > 0 && sourceWidth.toLong() * sourceHeight > budget -> sqrt(budget.toDouble() / (sourceWidth.toDouble() * sourceHeight)) * .999
      else -> 1.0
    }
    val limit = if (preview) 1440 else max(1, ceil(max(sourceWidth, sourceHeight) * decodeScale).toInt())
    var bitmap = if (preview) ImageProcessing.decode(context, Uri.fromFile(input), limit)
      else ImageProcessing.decodeExport(context, Uri.fromFile(input), if (resizing || targetBytes > 0) limit else null, budget)
    fun swap(next: Bitmap) { if (next !== bitmap) { bitmap.recycle(); bitmap = next } }
    fun sized(w: Int, h: Int): Bitmap { ImageProcessing.requireExportSize(w, h, budget); return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888) }
    try {
      check()
      r.optJSONArray("perspective")?.let { points ->
        require(points.length() == 4) { "Choose four perspective corners." }
        val source = FloatArray(8)
        for (i in 0..3) { val p = points.getJSONArray(i); source[i * 2] = p.getDouble(0).coerceIn(0.0, 1.0).toFloat() * bitmap.width; source[i * 2 + 1] = p.getDouble(1).coerceIn(0.0, 1.0).toFloat() * bitmap.height }
        for (i in 0..3) {
          val b = (i + 1) % 4; val c = (i + 2) % 4
          val cross = (source[b*2]-source[i*2])*(source[c*2+1]-source[b*2+1])-(source[b*2+1]-source[i*2+1])*(source[c*2]-source[b*2])
          require(cross.isFinite() && cross > .0001f * bitmap.width * bitmap.height) { "Keep perspective corners in clockwise order without overlapping." }
        }
        val w = bitmap.width.toFloat(); val h = bitmap.height.toFloat()
        val matrix = Matrix(); require(matrix.setPolyToPoly(source, 0, floatArrayOf(0f, 0f, w, 0f, w, h, 0f, h), 0, 4)) { "These perspective corners overlap." }
        val next = sized(bitmap.width, bitmap.height); Canvas(next).drawBitmap(bitmap, matrix, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)); swap(next)
      }
      val exposure = r.optDouble("exposure", 0.0).coerceIn(-3.0, 3.0)
      if (exposure != 0.0) { val gain = 2.0.pow(exposure).toFloat(); val next = sized(bitmap.width, bitmap.height); Canvas(next).drawBitmap(bitmap, 0f, 0f, Paint(Paint.FILTER_BITMAP_FLAG).apply { colorFilter = ColorMatrixColorFilter(ColorMatrix(floatArrayOf(gain,0f,0f,0f,0f,0f,gain,0f,0f,0f,0f,0f,gain,0f,0f,0f,0f,0f,1f,0f))) }); swap(next) }
      val blur = r.optDouble("blur", 0.0).coerceIn(0.0, .035)
      val sharpen = r.optDouble("sharpen", 0.0).coerceIn(0.0, 2.0)
      if (blur > 0 || sharpen > 0) {
        val filtered = effects(bitmap, (blur * bitmap.width).roundToInt().coerceIn(0, 100), sharpen.toFloat(), check)
        val area = r.optJSONArray("blurRect")
        if (blur > 0 && area != null) {
          try {
            require(area.length() == 4) { "Select a blur area." }
            val rect = RectF(area.getDouble(0).toFloat()*bitmap.width, area.getDouble(1).toFloat()*bitmap.height, area.getDouble(2).toFloat()*bitmap.width, area.getDouble(3).toFloat()*bitmap.height)
            require(rect.width() > 0 && rect.height() > 0 && rect.intersect(0f, 0f, bitmap.width.toFloat(), bitmap.height.toFloat())) { "Select a blur area inside the image." }
            val next = bitmap.copy(Bitmap.Config.ARGB_8888, true)
            Canvas(next).apply { clipRect(rect); drawBitmap(filtered, 0f, 0f, Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC) }) }
            swap(next)
          } finally { filtered.recycle() }
        } else swap(filtered)
      }
      if (r.has("curves") || r.has("hsl") || r.has("levels")) {
        if (!bitmap.isMutable || bitmap.config != Bitmap.Config.ARGB_8888) swap(bitmap.copy(Bitmap.Config.ARGB_8888, true))
        adjustColor(bitmap, r, check)
      }
      check()
      if (resizing) {
        val w = outputWidth
        val h = outputHeight
        val ratio = if (preview) min(1.0, 1440.0 / max(w, h)) else 1.0
        val next = sized(max(1, (w * ratio).roundToInt()), max(1, (h * ratio).roundToInt()))
        val mode = r.optString("resizeMode", "fit")
        val canvas = Canvas(next)
        // Fit intentionally adds a background; fill/stretch preserve the source's alpha.
        if (mode == "fit") canvas.drawColor(color(r.optString("background", "#FFFFFF")))
        val scale = if (mode == "fill") max(next.width.toFloat() / bitmap.width, next.height.toFloat() / bitmap.height) else min(next.width.toFloat() / bitmap.width, next.height.toFloat() / bitmap.height)
        val bw = if (mode == "stretch") next.width.toFloat() else bitmap.width * scale; val bh = if (mode == "stretch") next.height.toFloat() else bitmap.height * scale
        canvas.drawBitmap(bitmap, null, RectF((next.width-bw)/2, (next.height-bh)/2, (next.width+bw)/2, (next.height+bh)/2), Paint(Paint.FILTER_BITMAP_FLAG)); swap(next)
      }
      val paddingFraction = r.optDouble("padding", 0.0).coerceIn(0.0, .3)
      var padding = (paddingFraction * min(bitmap.width, bitmap.height)).roundToInt()
      val paddedPixels = (bitmap.width + padding * 2).toDouble() * (bitmap.height + padding * 2)
      if (preview && padding > 0 && paddedPixels > budget) {
        val scale = sqrt(budget / paddedPixels) * .999
        swap(Bitmap.createScaledBitmap(bitmap, max(1, (bitmap.width * scale).toInt()), max(1, (bitmap.height * scale).toInt()), true))
        padding = (paddingFraction * min(bitmap.width, bitmap.height)).roundToInt()
      }
      if (padding > 0) { val next = sized(bitmap.width + padding * 2, bitmap.height + padding * 2); Canvas(next).apply { drawColor(color(r.optString("background", "#FFFFFF"))); drawBitmap(bitmap, padding.toFloat(), padding.toFloat(), null) }; swap(next) }
      if ((r.optJSONArray("marks")?.length() ?: 0) > 0 || r.has("watermark")) {
        if (!bitmap.isMutable || bitmap.config != Bitmap.Config.ARGB_8888) swap(bitmap.copy(Bitmap.Config.ARGB_8888, true))
        annotate(context, bitmap, r, check)
      }
      val format = r.optString("format", "jpeg")
      require(format in listOf("jpeg", "png", "webp")) { "Choose JPG, PNG or WebP on this device." }
      val compression = when(format) { "png" -> Bitmap.CompressFormat.PNG; "webp" -> if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP; else -> Bitmap.CompressFormat.JPEG }
      if (format == "jpeg" && bitmap.hasAlpha()) { val next = sized(bitmap.width, bitmap.height); Canvas(next).apply { drawColor(Color.WHITE); drawBitmap(bitmap, 0f, 0f, null) }; swap(next) }
      target.parentFile?.mkdirs()
      require(targetBytes == 0L || format != "png") { "Choose JPG or WebP for target-size compression." }
      var quality = r.optInt("quality", 90).coerceIn(10, 100)
      var achieved = false
      for (attempt in 0..15) {
        check(); temporary.outputStream().use { require(bitmap.compress(compression, quality, it)) { "Could not encode the image." } }
        if (targetBytes == 0L || temporary.length() <= targetBytes) { achieved = true; break }
        if (quality > 30) quality = max(25, quality - 12)
        else { val scale = sqrt(targetBytes.toDouble() / temporary.length()).coerceIn(.45, .85); swap(Bitmap.createScaledBitmap(bitmap, max(1, (bitmap.width * scale).toInt()), max(1, (bitmap.height * scale).toInt()), true)) }
      }
      require(achieved) { "Could not reach that size. Try a larger target." }
      check(); require(temporary.renameTo(target)) { "Could not save this image." }
      return mapOf("uri" to Uri.fromFile(target).toString(), "width" to bitmap.width, "height" to bitmap.height, "size" to target.length(), "mimeType" to "image/${if(format == "jpeg") "jpeg" else format}", "sourceWidth" to original.getValue("width"), "sourceHeight" to original.getValue("height"))
    } finally { bitmap.recycle(); temporary.delete() }
  }
  /** Same sRGB, straight-alpha equations as ImageTools.swift. No platform filter presets. */
  private fun adjustColor(bitmap: Bitmap, request: JSONObject, check: () -> Unit) {
    val levels = request.optJSONObject("levels")
    require(!request.has("levels") || levels != null) { "Choose valid input levels." }
    val black = levels?.getDouble("black") ?: 0.0
    val white = levels?.getDouble("white") ?: 1.0
    val gamma = levels?.getDouble("gamma") ?: 1.0
    require(black.isFinite() && white.isFinite() && gamma.isFinite() && black in 0.0..1.0 && white in 0.0..1.0 && white - black >= 1.0 / 255 - 1e-12 && gamma in .1..3.0) { "Keep the black point below white and choose gamma from 0.1 to 3." }
    val curveNames = arrayOf("rgb", "red", "green", "blue")
    val curves = request.optJSONObject("curves")
    require(!request.has("curves") || curves != null) { "Choose valid tone curves." }
    val anchors = Array(4) { channel ->
      val values = curves?.optJSONArray(curveNames[channel])
      require(curves == null || values?.length() == 5) { "Each tone curve needs five anchors." }
      DoubleArray(5) { index -> (values?.getDouble(index) ?: index / 4.0).also { require(it.isFinite() && it in 0.0..1.0) { "Choose tone values from 0 to 100%." } } }
    }
    fun curve(values: DoubleArray, input: Double): Double {
      val x = input.coerceIn(0.0, 1.0) * 4
      val segment = min(3, x.toInt())
      return values[segment] + (values[segment + 1] - values[segment]) * (x - segment)
    }
    val tables = Array(3) { channel -> IntArray(256) { value ->
      val leveled = ((value / 255.0 - black) / (white - black)).coerceIn(0.0, 1.0).pow(1 / gamma)
      (curve(anchors[channel + 1], curve(anchors[0], leveled)) * 255).roundToInt().coerceIn(0, 255)
    } }
    val names = arrayOf("red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta")
    val centers = doubleArrayOf(0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0, 360.0)
    val hsl = request.optJSONObject("hsl")
    require(!request.has("hsl") || hsl != null) { "Choose valid HSL adjustments." }
    val adjustments = Array(8) { band ->
      val values = hsl?.optJSONObject(names[band])
      require(hsl == null || values != null) { "Choose valid color ranges." }
      DoubleArray(3) { component ->
        val name = arrayOf("hue", "saturation", "lightness")[component]
        (values?.getDouble(name) ?: 0.0).also { require(it.isFinite() && it in (if (component == 0) -180.0..180.0 else -100.0..100.0)) { "Choose a valid color adjustment." } }
      }
    }
    val usesHsl = adjustments.any { band -> band.any { it != 0.0 } }
    val usesCurves = tables.indices.any { channel -> tables[channel].indices.any { tables[channel][it] != it } }
    if (!usesCurves && !usesHsl) return
    val row = IntArray(bitmap.width)
    for (y in 0 until bitmap.height) {
      check(); bitmap.getPixels(row, 0, bitmap.width, 0, y, bitmap.width, 1)
      for (x in row.indices) {
        val original = row[x]; val alpha = Color.alpha(original)
        if (alpha == 0) continue
        var red = tables[0][Color.red(original)] / 255.0
        var green = tables[1][Color.green(original)] / 255.0
        var blue = tables[2][Color.blue(original)] / 255.0
        val upper = max(red, max(green, blue)); val lower = min(red, min(green, blue)); val delta = upper - lower
        // Hue ranges never colorize neutral gray pixels.
        if (usesHsl && delta > 0.000001) {
          var hue = (when (upper) { red -> (green - blue) / delta; green -> (blue - red) / delta + 2; else -> (red - green) / delta + 4 } * 60 + 360) % 360
          var lightness = (upper + lower) / 2
          var saturation = delta / (1 - abs(2 * lightness - 1))
          var band = 0
          while (band < 7 && hue >= centers[band + 1]) band++
          val weight = (hue - centers[band]) / (centers[band + 1] - centers[band])
          fun mix(component: Int) = adjustments[band][component] * (1 - weight) + adjustments[(band + 1) % 8][component] * weight
          hue = (hue + mix(0) + 360) % 360
          saturation = (saturation * (1 + mix(1) / 100)).coerceIn(0.0, 1.0)
          val light = mix(2) / 100
          lightness = if (light >= 0) lightness + (1 - lightness) * light else lightness * (1 + light)
          val chroma = (1 - abs(2 * lightness - 1)) * saturation
          val intermediate = chroma * (1 - abs((hue / 60) % 2 - 1))
          val offset = lightness - chroma / 2
          when (hue.toInt() / 60) {
            0 -> { red = chroma; green = intermediate; blue = 0.0 }
            1 -> { red = intermediate; green = chroma; blue = 0.0 }
            2 -> { red = 0.0; green = chroma; blue = intermediate }
            3 -> { red = 0.0; green = intermediate; blue = chroma }
            4 -> { red = intermediate; green = 0.0; blue = chroma }
            else -> { red = chroma; green = 0.0; blue = intermediate }
          }
          red += offset; green += offset; blue += offset
        }
        row[x] = Color.argb(alpha, (red * 255).roundToInt().coerceIn(0,255), (green * 255).roundToInt().coerceIn(0,255), (blue * 255).roundToInt().coerceIn(0,255))
      }
      bitmap.setPixels(row, 0, bitmap.width, 0, y, bitmap.width, 1)
    }
  }
  private fun color(value: String) = runCatching { Color.parseColor(value) }.getOrDefault(Color.BLACK)
  private fun annotate(context: Context, bitmap: Bitmap, r: JSONObject, check: () -> Unit) {
    val canvas = Canvas(bitmap); val w = bitmap.width.toFloat(); val h = bitmap.height.toFloat()
    val marks = r.optJSONArray("marks"); require((marks?.length() ?: 0) <= 300) { "Save before adding more marks." }
    var samples = 0
    for (i in 0 until (marks?.length() ?: 0)) {
      check(); val mark = marks!!.getJSONObject(i); val points = mark.getJSONArray("points"); samples += points.length(); require(samples <= 20000) { "Save before adding more strokes." }
      if (points.length() < 2) continue
      val path = Path(); for (j in 0 until points.length()) { val point = points.getJSONArray(j); val x = point.getDouble(0).toFloat().coerceIn(0f,1f)*w; val y = point.getDouble(1).toFloat().coerceIn(0f,1f)*h; if(j == 0) path.moveTo(x,y) else path.lineTo(x,y) }
      val kind = mark.optString("kind"); val redaction = kind == "redact"
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = if(redaction) Color.BLACK else color(mark.optString("color", "#1D4ED8")); strokeWidth = mark.optDouble("width", .005).coerceIn(.001, .1).toFloat()*w; strokeJoin = Paint.Join.ROUND; strokeCap = Paint.Cap.ROUND; style = Paint.Style.STROKE }
      if (!redaction) {
        val opacity = mark.optDouble("opacity", Double.NaN)
        paint.alpha = if (opacity.isFinite()) (opacity.coerceIn(.01, 1.0) * 255).roundToInt() else when(mark.optString("brush")) { "highlighter" -> 77; "pencil" -> 170; "marker" -> 210; else -> 255 }
        val unit = paint.strokeWidth
        if (kind != "polygon" && mark.optString("pattern") == "dotted") {
          val vertices = (0 until points.length()).map { j -> val p = points.getJSONArray(j); PointF(p.getDouble(0).toFloat().coerceIn(0f, 1f) * w, p.getDouble(1).toFloat().coerceIn(0f, 1f) * h) }
          paint.style = Paint.Style.FILL
          canvas.drawPath(StrokeDots.path(vertices, unit), paint)
          continue
        }
        paint.pathEffect = if (kind != "polygon" && mark.optString("pattern") == "dashed") DashPathEffect(floatArrayOf(unit*4,unit*2),0f) else null
      }
      if (kind == "polygon" || redaction) { path.close(); val fill = mark.optString("fillColor"); if(fill.isNotEmpty() || redaction) { paint.style = Paint.Style.FILL; val border = paint.color; val alpha = paint.alpha; paint.color = if(redaction) Color.BLACK else color(fill); paint.alpha = if (redaction || !mark.optDouble("opacity", Double.NaN).isFinite()) 255 else alpha; canvas.drawPath(path,paint); paint.color = border; paint.style = Paint.Style.STROKE } }
      canvas.drawPath(path, paint)
    }
    r.optJSONObject("watermark")?.let { mark ->
      val x = mark.optDouble("x", .5).coerceIn(0.0, 1.0).toFloat()*w; val y = mark.optDouble("y", .5).coerceIn(0.0, 1.0).toFloat()*h
      val size = mark.optDouble("size", .06).coerceIn(.01,.3).toFloat()*w
      val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { color = color(mark.optString("color", "#FFFFFF")); alpha = (mark.optDouble("opacity", .5).coerceIn(.05,1.0)*255).roundToInt(); textSize = size; textAlign = Paint.Align.CENTER; typeface = Typeface.create("sans-serif", Typeface.BOLD) }
      val imageUri = mark.optString("imageUri")
      if (imageUri.isNotEmpty()) { val file = local(context,imageUri); val logo = ImageProcessing.decode(context,Uri.fromFile(file),1024); try { val lw = w * mark.optDouble("imageScale", .25).coerceIn(.05,.8).toFloat(); val lh = lw*logo.height/logo.width; canvas.drawBitmap(logo,null,RectF(x-lw/2,y-lh/2,x+lw/2,y+lh/2),paint) } finally { logo.recycle() } }
      else { val text = mark.optString("text"); require(text.length <= 200) { "Keep the watermark under 200 characters." }; canvas.drawText(text,x,y-(paint.ascent()+paint.descent())/2,paint) }
    }
  }
  private fun effects(source: Bitmap, radius: Int, sharp: Float, check: () -> Unit): Bitmap {
    val w = source.width; val h = source.height; val pixels = IntArray(w*h); source.getPixels(pixels,0,w,0,0,w,h)
    val buffer = IntArray(pixels.size)
    if (radius > 0) {
      fun pass(input: IntArray, output: IntArray, horizontal: Boolean) {
        val lines = if(horizontal) h else w; val length = if(horizontal) w else h; val span = radius*2+1
        for(line in 0 until lines) {
          check(); val sums = IntArray(4)
          fun index(at: Int) = if(horizontal) line*w+at.coerceIn(0,w-1) else at.coerceIn(0,h-1)*w+line
          fun accumulate(pixel: Int, sign: Int) { for(c in 0..3) sums[c] += ((pixel ushr (c*8)) and 255)*sign }
          for(offset in -radius..radius) accumulate(input[index(offset)],1)
          for(at in 0 until length) { var value = 0; for(c in 0..3) value = value or ((sums[c]/span) shl (c*8)); output[index(at)] = value; accumulate(input[index(at-radius)],-1); accumulate(input[index(at+radius+1)],1) }
        }
      }
      pass(pixels,buffer,true); pass(buffer,pixels,false)
    }
    if(sharp > 0) {
      for(y in 0 until h) { check(); for(x in 0 until w) { val at=y*w+x; val center=pixels[at]; var value=center and -0x1000000
        for(c in 0..2) {
          fun channel(p: Int): Int { return (p ushr (c*8)) and 255 }
          val v = channel(center)
          val neighbours = channel(pixels[y*w+max(0,x-1)]) + channel(pixels[y*w+min(w-1,x+1)]) + channel(pixels[max(0,y-1)*w+x]) + channel(pixels[min(h-1,y+1)*w+x])
          value = value or ((v+sharp*(4*v-neighbours)).roundToInt().coerceIn(0,255) shl(c*8))
        }
        buffer[at]=value
      } }
    }
    return Bitmap.createBitmap(if(sharp > 0) buffer else pixels,w,h,Bitmap.Config.ARGB_8888)
  }
}

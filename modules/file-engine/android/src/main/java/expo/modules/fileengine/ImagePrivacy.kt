package expo.modules.fileengine

import android.content.Context
import android.net.Uri
import expo.modules.kotlin.Promise
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

/** Local, bounded OCR suggestions. Rules intentionally never assert that an image is safe. */
internal class ImagePrivacy {
  private class Job {
    val stopped = AtomicBoolean(false)
    @Volatile var recognition: ImageText.Recognition? = null
  }
  private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue(1))
  private val jobs = ConcurrentHashMap<String, Job>()
  private val destroyed = AtomicBoolean(false)
  fun cancel(id: String) { jobs[id]?.let { it.stopped.set(true); it.recognition?.let(ImageText::cancelRecognition) } }
  fun cancelAll() { jobs.keys.forEach(::cancel) }
  fun destroy() { destroyed.set(true); cancelAll(); worker.shutdown() }
  private fun check(job: Job) {
    if (destroyed.get() || job.stopped.get() || Thread.currentThread().isInterrupted) throw InterruptedException("Privacy scan cancelled.")
  }
  fun scan(context: Context, id: String, uri: String, promise: Promise) {
    if (id.isBlank() || id.length > 128 || destroyed.get()) { promise.reject("PRIVACY_UNAVAILABLE", "Start a new privacy scan.", null); return }
    val job = Job()
    if (jobs.putIfAbsent(id, job) != null) { promise.reject("PRIVACY_BUSY", "This privacy scan is already running.", null); return }
    try { worker.execute {
      try {
        check(job)
        val source = Uri.parse(uri)
        require(source.scheme == "file") { "Choose a local image." }
        val file = File(requireNotNull(source.path)).canonicalFile
        require(file.path.startsWith(context.cacheDir.canonicalPath + "/") || file.path.startsWith(context.filesDir.canonicalPath + "/")) { "Choose the image again." }
        require(file.isFile && file.length() in 1..134_217_728L) { "Choose a readable image under 128 MB." }
        val size = ImageProcessing.sourceSize(context, Uri.fromFile(file))
        require(size.first.toLong() * size.second <= 200_000_000L) { "Choose an image below 200 megapixels for scanning." }
        check(job)
        val recognition = ImageText.prepareRecognition(uri, "privacy:" + id)
        job.recognition = recognition
        try {
          check(job)
          val result = ImageText.recognize(context, uri, recognition)
          check(job)
          val lines = result["lines"] as? List<*> ?: emptyList<Any>()
          val analysisWidth = (result["width"] as? Number)?.toDouble() ?: 2048.0
          val analysisHeight = (result["height"] as? Number)?.toDouble() ?: 2048.0
          var truncated = lines.size >= 400
          val findings = ArrayList<Map<String, Any>>()
          for ((index, value) in lines.withIndex()) {
            check(job)
            val line = value as? Map<*, *> ?: continue
            val raw = line["text"] as? String ?: continue
            if (raw.length > 1024) truncated = true
            val text = raw.take(1024).trim()
            val match = detect(text) ?: continue
            if (findings.size >= 200) { truncated = true; break }
            fun coordinate(key: String) = (line[key] as? Number)?.toDouble() ?: Double.NaN
            val x = coordinate("x"); val y = coordinate("y"); val w = coordinate("width"); val h = coordinate("height")
            if (!listOf(x, y, w, h).all { it.isFinite() } || w <= 0 || h <= 0) { truncated = true; continue }
            val padX = max(2 / analysisWidth, h * analysisHeight / analysisWidth * .12)
            val padY = max(2 / analysisHeight, h * .16)
            val left = max(0.0, x - padX); val top = max(0.0, y - padY)
            val right = min(1.0, x + w + padX); val bottom = min(1.0, y + h + padY)
            if (right <= left || bottom <= top) continue
            findings += mapOf("id" to "line-$index", "category" to match.category, "kind" to match.kind, "text" to text.take(512),
              "confidence" to match.confidence, "x" to left, "y" to top, "width" to right - left, "height" to bottom - top)
          }
          check(job)
          promise.resolve(mapOf("width" to size.first, "height" to size.second, "findings" to findings, "truncated" to truncated))
        } finally { job.recognition = null; ImageText.finishRecognition(recognition) }
      } catch (_: InterruptedException) { promise.reject("PRIVACY_CANCELLED", "Privacy scan cancelled.", null) }
      catch (_: OutOfMemoryError) { promise.reject("PRIVACY_MEMORY", "Use a smaller image for scanning on this device.", null) }
      catch (error: Throwable) { promise.reject(if (job.stopped.get() || destroyed.get()) "PRIVACY_CANCELLED" else "PRIVACY_FAILED", error.message ?: "Could not scan this image.", error) }
      finally { jobs.remove(id, job) }
    } } catch (error: java.util.concurrent.RejectedExecutionException) {
      jobs.remove(id, job); promise.reject("PRIVACY_BUSY", "Wait for the current privacy scan.", error)
    }
  }

  private data class Rule(val category: String, val kind: String, val confidence: Double, val pattern: Regex? = null)
  private val rules = listOf(
    Rule("authentication", "Credentials", 0.9, Regex("\\b(?:password|passwd|passcode|api[ _-]?key|secret|access[ _-]?token|auth[ _-]?token)\\s*[:=]\\s*\\S{2,}", RegexOption.IGNORE_CASE)),
    Rule("authentication", "One-time code", 0.84, Regex("\\b(?:otp|verification[ -]?code|security[ -]?code|one[ -]?time[ -]?(?:password|code))\\b[^A-Za-z0-9]{0,12}[0-9]{4,8}\\b", RegexOption.IGNORE_CASE)),
    Rule("authentication", "API key or token", 0.93, Regex("\\b(?:AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,})\\b", RegexOption.IGNORE_CASE)),
    Rule("financial", "Bank details", 0.83, Regex("\\b(?:account|acct|routing|iban|ifsc|swift|sort[ -]?code)\\b.{0,20}\\b[A-Z0-9][A-Z0-9 -]{4,33}[A-Z0-9]\\b", RegexOption.IGNORE_CASE)),
    Rule("identity", "Identity document", 0.82, Regex("\\b(?:passport|social[ -]?security|ssn|aadhaar|aadhar|pan|national[ -]?id|driv(?:er|ing)[ '-]?(?:s[ -]?)?licen[cs]e|id[ -]?(?:number|no))\\b.{0,16}\\b[A-Z0-9][A-Z0-9 -]{3,23}[A-Z0-9]\\b", RegexOption.IGNORE_CASE)),
    Rule("identity", "Social security number", 0.82, Regex("\\b[0-9]{3}-[0-9]{2}-[0-9]{4}\\b", RegexOption.IGNORE_CASE)),
    Rule("location", "Labeled address", 0.8, Regex("\\b(?:address|residence|location|ship[ -]?to|bill[ -]?to)\\s*[:=]\\s*\\S.{3,}", RegexOption.IGNORE_CASE)),
    Rule("location", "Street address", 0.72, Regex("\\b[0-9]{1,6}\\s+[A-Z0-9][A-Z0-9 .'-]{1,55}\\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|way)\\b", RegexOption.IGNORE_CASE)),
    Rule("personal", "Email address", 0.94, Regex("\\b[A-Z0-9.!#\$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\\b", RegexOption.IGNORE_CASE)),
    Rule("personal", "Labeled name", 0.76, Regex("\\b(?:full[ -]?name|first[ -]?name|last[ -]?name|name|customer|patient|recipient)\\s*[:=]\\s*[A-Z][A-Z .'-]{1,70}", RegexOption.IGNORE_CASE)),
    Rule("other", "Username", 0.65, Regex("(?:^|\\s)@[A-Z0-9_][A-Z0-9_.-]{1,31}\\b", RegexOption.IGNORE_CASE)),
    Rule("other", "Labeled username", 0.8, Regex("\\b(?:user[ -]?name|user[ -]?id|handle)\\s*[:=]\\s*[A-Z0-9_@][A-Z0-9_.@-]{1,80}", RegexOption.IGNORE_CASE))
  )
  private val cards = Regex("(?<![0-9])(?:[0-9][ -]?){12,18}[0-9](?![0-9])")
  private val phones = Regex("(?<![A-Za-z0-9])\\+?[0-9(][0-9() .-]{5,24}[0-9](?![A-Za-z0-9])")
  private val phoneLabel = Regex("\\b(?:phone|mobile|tel|telephone|fax|contact)\\b", RegexOption.IGNORE_CASE)
  private val coordinates = Regex("(?<![0-9])([-+]?[0-9]{1,2}\\.[0-9]{3,})\\s*[,;]\\s*([-+]?[0-9]{1,3}\\.[0-9]{3,})(?![0-9])")
  private fun detect(text: String): Rule? {
    // First match selects the label; coverage always includes the entire OCR line.
    rules.take(3).firstOrNull { it.pattern!!.containsMatchIn(text) }?.let { return it }
    for (candidate in cards.findAll(text)) {
      val digits = candidate.value.filter { it in '0'..'9' }
      if (digits.length !in 13..19 || digits.all { it == digits[0] }) continue
      var sum = 0
      digits.reversed().forEachIndexed { index, digit -> val n = (digit - '0') * if (index % 2 == 1) 2 else 1; sum += if (n > 9) n - 9 else n }
      if (sum % 10 == 0) return Rule("financial", "Payment card number", .92)
    }
    rules.drop(3).take(5).firstOrNull { it.pattern!!.containsMatchIn(text) }?.let { return it }
    for (candidate in coordinates.findAll(text)) {
      val lat = candidate.groupValues[1].toDoubleOrNull() ?: continue
      val lon = candidate.groupValues[2].toDoubleOrNull() ?: continue
      if (lat in -90.0..90.0 && lon in -180.0..180.0) return Rule("location", "GPS coordinates", .86)
    }
    rules.drop(8).take(2).firstOrNull { it.pattern!!.containsMatchIn(text) }?.let { return it }
    for (candidate in phones.findAll(text)) {
      val count = candidate.value.count { it in '0'..'9' }
      if (count in 7..15 && (phoneLabel.containsMatchIn(text) || count >= 9 && candidate.value.any { it == '+' || it == '(' || it == '-' }))
        return Rule("personal", "Phone number", .76)
    }
    return rules.drop(10).firstOrNull { it.pattern!!.containsMatchIn(text) }
  }
}

import ExpoModulesCore
import Foundation
import Vision

/// Offline suggestions. A heuristic score describes a rule match, not OCR certainty or safety.
final class ImagePrivacy {
  private final class Job {
    var stopped = false
    var recognition: ImageText.Recognition?
  }
  private let queue = DispatchQueue(label: "com.versara.image-privacy", qos: .userInitiated)
  private let lock = NSLock()
  private var jobs: [String: Job] = [:]
  private var destroyed = false
  func cancel(_ id: String) {
    lock.lock(); let job = jobs[id]; job?.stopped = true; let recognition = job?.recognition; lock.unlock()
    if let recognition { ImageText.cancelRecognition(recognition) }
  }
  func cancelAll() {
    lock.lock(); let ids = Array(jobs.keys); lock.unlock()
    ids.forEach(cancel)
  }
  func destroy() { lock.lock(); destroyed = true; lock.unlock(); cancelAll() }
  private func check(_ job: Job) throws {
    lock.lock(); let stopped = destroyed || job.stopped; lock.unlock()
    if stopped { throw CancellationError() }
  }
  func scan(_ id: String, uri: String, promise: Promise) {
    lock.lock()
    guard !destroyed, !id.isEmpty, id.count <= 128, jobs.count < 2, jobs[id] == nil else {
      lock.unlock(); promise.reject("PRIVACY_BUSY", "Wait for the current privacy scan."); return
    }
    let job = Job(); jobs[id] = job; lock.unlock()
    queue.async { autoreleasepool {
      defer { self.lock.lock(); self.jobs.removeValue(forKey: id); self.lock.unlock() }
      do {
        try self.check(job)
        guard let raw = URL(string: uri), raw.isFileURL else { throw ImageEditing.EditError.invalid("Choose a local image.") }
        let file = raw.resolvingSymlinksInPath().standardizedFileURL
        let roots = [FileManager.SearchPathDirectory.documentDirectory, .cachesDirectory].map { FileManager.default.urls(for: $0, in: .userDomainMask)[0].resolvingSymlinksInPath().path + "/" }
        guard roots.contains(where: { file.path.hasPrefix($0) }) else { throw ImageEditing.EditError.invalid("Choose the image again.") }
        let bytes = (try file.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0
        guard (1...134_217_728).contains(bytes) else { throw ImageEditing.EditError.invalid("Choose a readable image under 128 MB.") }
        guard let size = ImageEditing.originalSize(uri: file.absoluteString), size.width * size.height <= 200_000_000 else { throw ImageEditing.EditError.invalid("Choose a readable image below 200 megapixels for scanning.") }
        try self.check(job)
        let operation = try ImageText.prepareRecognition(uri: uri, key: "privacy:" + id)
        self.lock.lock(); job.recognition = operation; self.lock.unlock()
        defer {
          self.lock.lock(); job.recognition = nil; self.lock.unlock()
          ImageText.finishRecognition(operation)
        }
        try self.check(job)
        let result = try autoreleasepool { try ImageText.recognize(uri: uri, operation: operation) }
        try self.check(job)
        let lines = result["lines"] as? [[String: Any]] ?? []
        let analysisWidth = (result["width"] as? NSNumber)?.doubleValue ?? 2048
        let analysisHeight = (result["height"] as? NSNumber)?.doubleValue ?? 2048
        var truncated = lines.count >= 400
        var findings: [[String: Any]] = []
        for (index, line) in lines.enumerated() {
          try self.check(job)
          guard let rawText = line["text"] as? String else { continue }
          if rawText.count > 1024 { truncated = true }
          let text = String(rawText.prefix(1024)).trimmingCharacters(in: .whitespacesAndNewlines)
          guard let match = self.detect(text) else { continue }
          if findings.count >= 200 { truncated = true; break }
          func coordinate(_ key: String) -> Double { (line[key] as? NSNumber)?.doubleValue ?? .nan }
          let x = coordinate("x"), y = coordinate("y"), w = coordinate("width"), h = coordinate("height")
          guard [x, y, w, h].allSatisfy({ $0.isFinite }), w > 0, h > 0 else { truncated = true; continue }
          let padX = max(2 / analysisWidth, h * analysisHeight / analysisWidth * 0.12)
          let padY = max(2 / analysisHeight, h * 0.16)
          let left = max(0, x - padX), top = max(0, y - padY)
          let right = min(1, x + w + padX), bottom = min(1, y + h + padY)
          guard right > left, bottom > top else { continue }
          findings.append(["id": "line-\(index)", "category": match.category, "kind": match.kind, "text": String(text.prefix(512)),
            "confidence": match.confidence, "x": left, "y": top, "width": right - left, "height": bottom - top])
        }
        try self.check(job)
        promise.resolve(["width": Int(size.width), "height": Int(size.height), "findings": findings, "truncated": truncated])
      } catch is CancellationError { promise.reject("PRIVACY_CANCELLED", "Privacy scan cancelled.") }
      catch {
        self.lock.lock(); let stopped = self.destroyed || job.stopped; self.lock.unlock()
        promise.reject(stopped ? "PRIVACY_CANCELLED" : "PRIVACY_FAILED", error.localizedDescription)
      }
    } }
  }

  private struct Rule {
    let category: String
    let kind: String
    let confidence: Double
    let regex: NSRegularExpression?
    init(_ category: String, _ kind: String, _ confidence: Double, _ pattern: String? = nil) {
      self.category = category; self.kind = kind; self.confidence = confidence
      regex = pattern.flatMap { try? NSRegularExpression(pattern: $0, options: .caseInsensitive) }
    }
    func matches(_ text: String) -> Bool { regex?.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil }
  }
  private let rules = [
    Rule("authentication", "Credentials", 0.9, #"\b(?:password|passwd|passcode|api[ _-]?key|secret|access[ _-]?token|auth[ _-]?token)\s*[:=]\s*\S{2,}"#),
    Rule("authentication", "One-time code", 0.84, #"\b(?:otp|verification[ -]?code|security[ -]?code|one[ -]?time[ -]?(?:password|code))\b[^A-Za-z0-9]{0,12}[0-9]{4,8}\b"#),
    Rule("authentication", "API key or token", 0.93, #"\b(?:AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b"#),
    Rule("financial", "Bank details", 0.83, #"\b(?:account|acct|routing|iban|ifsc|swift|sort[ -]?code)\b.{0,20}\b[A-Z0-9][A-Z0-9 -]{4,33}[A-Z0-9]\b"#),
    Rule("identity", "Identity document", 0.82, #"\b(?:passport|social[ -]?security|ssn|aadhaar|aadhar|pan|national[ -]?id|driv(?:er|ing)[ '-]?(?:s[ -]?)?licen[cs]e|id[ -]?(?:number|no))\b.{0,16}\b[A-Z0-9][A-Z0-9 -]{3,23}[A-Z0-9]\b"#),
    Rule("identity", "Social security number", 0.82, #"\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b"#),
    Rule("location", "Labeled address", 0.8, #"\b(?:address|residence|location|ship[ -]?to|bill[ -]?to)\s*[:=]\s*\S.{3,}"#),
    Rule("location", "Street address", 0.72, #"\b[0-9]{1,6}\s+[A-Z0-9][A-Z0-9 .'-]{1,55}\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|way)\b"#),
    Rule("personal", "Email address", 0.94, #"\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b"#),
    Rule("personal", "Labeled name", 0.76, #"\b(?:full[ -]?name|first[ -]?name|last[ -]?name|name|customer|patient|recipient)\s*[:=]\s*[A-Z][A-Z .'-]{1,70}"#),
    Rule("other", "Username", 0.65, #"(?:^|\s)@[A-Z0-9_][A-Z0-9_.-]{1,31}\b"#),
    Rule("other", "Labeled username", 0.8, #"\b(?:user[ -]?name|user[ -]?id|handle)\s*[:=]\s*[A-Z0-9_@][A-Z0-9_.@-]{1,80}"#)
  ]
  private let cards = try! NSRegularExpression(pattern: #"(?<![0-9])(?:[0-9][ -]?){12,18}[0-9](?![0-9])"#)
  private let phones = try! NSRegularExpression(pattern: #"(?<![A-Za-z0-9])\+?[0-9(][0-9() .-]{5,24}[0-9](?![A-Za-z0-9])"#)
  private let phoneLabel = try! NSRegularExpression(pattern: #"\b(?:phone|mobile|tel|telephone|fax|contact)\b"#, options: .caseInsensitive)
  private let coordinates = try! NSRegularExpression(pattern: #"(?<![0-9])([-+]?[0-9]{1,2}\.[0-9]{3,})\s*[,;]\s*([-+]?[0-9]{1,3}\.[0-9]{3,})(?![0-9])"#)
  private func detect(_ text: String) -> Rule? {
    let range = NSRange(text.startIndex..., in: text)
    if let rule = rules[0..<3].first(where: { $0.matches(text) }) { return rule }
    for match in cards.matches(in: text, range: range) {
      let digits = (text as NSString).substring(with: match.range).utf8.filter { (48...57).contains($0) }.map { Int($0 - 48) }
      guard (13...19).contains(digits.count), Set(digits).count > 1 else { continue }
      let sum = digits.reversed().enumerated().reduce(0) { total, value in
        let n = value.element * (value.offset % 2 == 1 ? 2 : 1)
        return total + (n > 9 ? n - 9 : n)
      }
      if sum % 10 == 0 { return Rule("financial", "Payment card number", 0.92) }
    }
    if let rule = rules[3..<8].first(where: { $0.matches(text) }) { return rule }
    for match in coordinates.matches(in: text, range: range) {
      if let lat = Double((text as NSString).substring(with: match.range(at: 1))),
         let lon = Double((text as NSString).substring(with: match.range(at: 2))),
         (-90...90).contains(lat), (-180...180).contains(lon) { return Rule("location", "GPS coordinates", 0.86) }
    }
    if let rule = rules[8..<10].first(where: { $0.matches(text) }) { return rule }
    for match in phones.matches(in: text, range: range) {
      let candidate = (text as NSString).substring(with: match.range)
      let count = candidate.utf8.filter { (48...57).contains($0) }.count
      if (7...15).contains(count), phoneLabel.firstMatch(in: text, range: range) != nil || count >= 9 && candidate.contains(where: { "+(-".contains($0) }) {
        return Rule("personal", "Phone number", 0.76)
      }
    }
    return rules[10...].first(where: { $0.matches(text) })
  }
}


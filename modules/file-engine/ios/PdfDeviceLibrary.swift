import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers
import SQLite3

/** iOS grants access to chosen folders, never unrestricted device storage. */
final class PdfFolderAccess: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private static let key = "versara.pdf-folders.v1"
  private var promise: Promise?
  static func roots() -> [URL] {
    let bookmarks = UserDefaults.standard.array(forKey: key) as? [Data] ?? []
    return bookmarks.compactMap { data in
      var stale = false
      return try? URL(resolvingBookmarkData: data, options: .withoutUI, relativeTo: nil, bookmarkDataIsStale: &stale)
    }
  }
  static func status() -> [String: Any] {
    let granted = roots().contains { url in
      guard url.startAccessingSecurityScopedResource() else { return false }
      defer { url.stopAccessingSecurityScopedResource() }
      return FileManager.default.isReadableFile(atPath: url.path)
    }
    return ["granted": granted, "status": granted ? "granted" : "denied", "canAskAgain": true]
  }
  static func withAccess<T>(to file: URL, _ body: () throws -> T) throws -> T {
    let roots = roots().filter { file.path.hasPrefix($0.path + "/") || file.path == $0.path }
    let root = roots.first { $0.startAccessingSecurityScopedResource() }
    defer { root?.stopAccessingSecurityScopedResource() }
    return try body()
  }
  func request(from controller: UIViewController?, promise: Promise) {
    guard self.promise == nil, let controller = controller else { promise.reject("PDF_ACCESS_BUSY", "Close the current picker and try again."); return }
    self.promise = promise
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
    picker.allowsMultipleSelection = true
    picker.delegate = self
    picker.presentationController?.delegate = self
    controller.present(picker, animated: true)
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    defer { promise = nil }
    do {
      var bookmarks = UserDefaults.standard.array(forKey: Self.key) as? [Data] ?? []
      let existing = Set(Self.roots().map(\.path))
      for url in urls where !existing.contains(url.path) {
        guard url.startAccessingSecurityScopedResource() else { continue }
        defer { url.stopAccessingSecurityScopedResource() }
        bookmarks.append(try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil))
      }
      UserDefaults.standard.set(bookmarks, forKey: Self.key)
      promise?.resolve(Self.status())
    } catch { promise?.reject("PDF_ACCESS_FAILED", "Could not retain folder access. Choose the folder again.") }
  }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish() }
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finish() }
  private func finish() { promise?.resolve(Self.status()); promise = nil }
  func destroy() { promise?.reject("PDF_ACCESS_CANCELLED", "Folder selection was closed."); promise = nil }
}

final class PdfDeviceLibrary {
  private let queue = DispatchQueue(label: "com.versara.pdf-library", qos: .utility)
  private let lock = NSLock()
  private var jobs: [String: Bool] = [:]
  private var stopped = false
  func cancel(_ id: String) { lock.lock(); if jobs[id] != nil { jobs[id] = true }; lock.unlock() }
  func cancelAll() { lock.lock(); for id in Array(jobs.keys) { jobs[id] = true }; lock.unlock() }
  func destroy() { lock.lock(); stopped = true; lock.unlock() }
  private func check(_ id: String) throws {
    lock.lock(); let cancelled = stopped || jobs[id] == true; lock.unlock()
    if cancelled { throw NSError(domain: "PdfLibrary", code: 1, userInfo: [NSLocalizedDescriptionKey: "PDF scan cancelled."]) }
  }
  private func run(_ id: String, promise: Promise, work: @escaping () throws -> Any) {
    lock.lock()
    guard !stopped, jobs.count < 4, jobs[id] == nil else { lock.unlock(); promise.reject("PDF_LIBRARY_BUSY", "Another library request is finishing. Try again."); return }
    jobs[id] = false; lock.unlock()
    queue.async {
      defer { self.lock.lock(); self.jobs.removeValue(forKey: id); self.lock.unlock() }
      autoreleasepool {
        do { try self.check(id); promise.resolve(try work()) }
        catch { promise.reject("PDF_LIBRARY_FAILED", error.localizedDescription) }
      }
    }
  }
  func scan(_ id: String, promise: Promise) {
    run(id, promise: promise) {
      let db = try PdfIndex()
      try db.exec("BEGIN TRANSACTION")
      var committed = false
      defer { if !committed { try? db.exec("ROLLBACK") } }
      try db.exec("DELETE FROM pdfs")
      var count = 0
      var accessible = 0
      let keys: Set<URLResourceKey> = [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey]
      for root in PdfFolderAccess.roots() {
        try self.check(id)
        guard root.startAccessingSecurityScopedResource() else { continue }
        defer { root.stopAccessingSecurityScopedResource() }
        guard let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: Array(keys), options: [.skipsPackageDescendants]) else { continue }
        accessible += 1
        for case let file as URL in files {
          try self.check(id)
          try autoreleasepool {
            guard let values = try? file.resourceValues(forKeys: keys) else { return }
            if values.isSymbolicLink == true { if values.isDirectory == true { files.skipDescendants() }; return }
            guard values.isRegularFile == true, file.pathExtension.lowercased() == "pdf" else { return }
            try db.insert(uri: file.absoluteString, name: file.lastPathComponent, size: Int64(values.fileSize ?? 0), modified: Int64((values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000))
            count += 1
          }
        }
      }
      guard accessible > 0 else { throw NSError(domain: "PdfLibrary", code: 2, userInfo: [NSLocalizedDescriptionKey: "Choose a readable PDF folder to find files."]) }
      try self.check(id)
      try db.exec("COMMIT"); committed = true
      return count
    }
  }
  /// Newest PDFs in the chosen folders. Walks at most three levels and a bounded number of entries; no index is built.
  func recent(limit: Int, search: String, promise: Promise) {
    let id = UUID().uuidString
    run(id, promise: promise) {
      let keys: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey]
      let needle = search.lowercased()
      var found: [(uri: String, name: String, size: Int64, modified: Int64)] = []
      var visited = 0
      for root in PdfFolderAccess.roots() {
        guard root.startAccessingSecurityScopedResource() else { continue }
        defer { root.stopAccessingSecurityScopedResource() }
        guard let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: Array(keys), options: [.skipsPackageDescendants, .skipsHiddenFiles]) else { continue }
        for case let file as URL in files {
          visited += 1
          if visited > 4000 { break }
          if visited % 200 == 0 { try self.check(id) }
          if files.level > 3 { files.skipDescendants(); continue }
          guard file.pathExtension.lowercased() == "pdf", let values = try? file.resourceValues(forKeys: keys),
                values.isRegularFile == true, values.isSymbolicLink != true else { continue }
          let name = file.lastPathComponent
          if !needle.isEmpty && !name.lowercased().contains(needle) { continue }
          found.append((file.absoluteString, name, Int64(values.fileSize ?? 0), Int64((values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000)))
          if found.count > limit * 4 { found.sort { $0.modified > $1.modified }; found.removeLast(found.count - limit) }
        }
      }
      found.sort { $0.modified > $1.modified }
      return found.prefix(limit).map { item -> [String: Any] in
        ["id": "device-pdf-\(item.uri)", "uri": item.uri, "name": item.name, "mimeType": "application/pdf",
         "size": item.size, "modified": item.modified, "kind": "pdf", "source": "device"]
      }
    }
  }
  func page(offset: Int, limit: Int, search: String, promise: Promise) {
    run(UUID().uuidString, promise: promise) {
      guard PdfFolderAccess.status()["granted"] as? Bool == true else { return ["items": [], "total": 0] as [String: Any] }
      return try PdfIndex().page(offset: max(0, offset), limit: min(80, max(1, limit)), search: search)
    }
  }
}

/** Only native SQLite keeps the complete index; page metadata is bounded. */
private final class PdfIndex {
  private var db: OpaquePointer?
  private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  init() throws {
    let path = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("device-pdfs.db").path
    guard sqlite3_open(path, &db) == SQLITE_OK else { sqlite3_close(db); db = nil; throw failure() }
    do {
      try exec("CREATE TABLE IF NOT EXISTS pdfs(uri TEXT PRIMARY KEY,name TEXT NOT NULL,size INTEGER NOT NULL,modified INTEGER NOT NULL)")
      try exec("CREATE INDEX IF NOT EXISTS pdfs_recent ON pdfs(modified DESC,uri)")
    } catch { sqlite3_close(db); db = nil; throw error }
  }
  deinit { sqlite3_close(db) }
  private func failure() -> NSError { NSError(domain: "PdfLibrary", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not update the PDF catalog. Check available storage and try again."]) }
  func exec(_ sql: String) throws { guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw failure() } }
  private func prepare(_ sql: String) throws -> OpaquePointer {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement = statement else { throw failure() }
    return statement
  }
  func insert(uri: String, name: String, size: Int64, modified: Int64) throws {
    let statement = try prepare("INSERT OR REPLACE INTO pdfs(uri,name,size,modified) VALUES(?,?,?,?)")
    defer { sqlite3_finalize(statement) }
    sqlite3_bind_text(statement, 1, uri, -1, transient); sqlite3_bind_text(statement, 2, name, -1, transient)
    sqlite3_bind_int64(statement, 3, size); sqlite3_bind_int64(statement, 4, modified)
    guard sqlite3_step(statement) == SQLITE_DONE else { throw failure() }
  }
  func page(offset: Int, limit: Int, search: String) throws -> [String: Any] {
    let filter = "instr(lower(name),lower(?)) > 0"
    let counter = try prepare("SELECT count(*) FROM pdfs WHERE \(filter)")
    defer { sqlite3_finalize(counter) }
    sqlite3_bind_text(counter, 1, search.trimmingCharacters(in: .whitespacesAndNewlines), -1, transient)
    guard sqlite3_step(counter) == SQLITE_ROW else { throw failure() }
    let total = Int(sqlite3_column_int64(counter, 0))
    let statement = try prepare("SELECT uri,name,size,modified FROM pdfs WHERE \(filter) ORDER BY modified DESC,uri LIMIT \(limit) OFFSET \(offset)")
    defer { sqlite3_finalize(statement) }
    sqlite3_bind_text(statement, 1, search.trimmingCharacters(in: .whitespacesAndNewlines), -1, transient)
    var items: [[String: Any]] = []
    var result = sqlite3_step(statement)
    while result == SQLITE_ROW {
      let uri = String(cString: sqlite3_column_text(statement, 0))
      items.append(["id": "device-pdf-\(uri)", "uri": uri, "name": String(cString: sqlite3_column_text(statement, 1)), "size": sqlite3_column_int64(statement, 2), "modified": sqlite3_column_int64(statement, 3), "kind": "pdf", "mimeType": "application/pdf", "source": "device"])
      result = sqlite3_step(statement)
    }
    guard result == SQLITE_DONE else { throw failure() }
    return ["items": items, "total": total]
  }
}

import Foundation
import UniformTypeIdentifiers

/// iOS apps can only browse their own sandbox, so the explorer is rooted at Documents (also visible in the Files app).
enum FileExplorer {
  private static let maxEntries = 4000
  private static let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey, .isHiddenKey]

  private static func root() -> URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].standardizedFileURL.resolvingSymlinksInPath()
  }

  static func roots() -> [[String: Any]] {
    let url = root()
    let values = try? url.resourceValues(forKeys: [.volumeTotalCapacityKey, .volumeAvailableCapacityForImportantUsageKey])
    return [[
      "id": "internal", "name": "Versara files", "path": url.path,
      "total": values?.volumeTotalCapacity ?? 0, "free": values?.volumeAvailableCapacityForImportantUsage ?? 0,
      "allowed": true,
    ]]
  }

  static func list(path: String, showHidden: Bool) throws -> [String: Any] {
    let base = root()
    let folder = URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath()
    guard folder.path == base.path || folder.path.hasPrefix(base.path + "/") else { throw ExplorerError.outside }
    let options: FileManager.DirectoryEnumerationOptions = showHidden ? [] : [.skipsHiddenFiles]
    let children = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: keys, options: options)
    let sorted = children.map { ($0, (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false) }
      .sorted { $0.1 != $1.1 ? $0.1 : $0.0.lastPathComponent.localizedStandardCompare($1.0.lastPathComponent) == .orderedAscending }
      .prefix(maxEntries)
    let items = sorted.map { url, directory -> [String: Any] in
      let count = directory ? ((try? FileManager.default.contentsOfDirectory(atPath: url.path).filter { showHidden || !$0.hasPrefix(".") }.count) ?? 0) : -1
      return entry(url, directory: directory, count: count)
    }
    return ["path": folder.path, "parent": folder.path == base.path ? NSNull() : folder.deletingLastPathComponent().path, "items": items, "truncated": children.count > maxEntries]
  }

  static func search(query: String, limit: Int) -> [[String: Any]] {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !needle.isEmpty, let walker = FileManager.default.enumerator(at: root(), includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]) else { return [] }
    var results: [[String: Any]] = []
    for case let url as URL in walker {
      if results.count >= limit { break }
      let directory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
      if !directory && url.lastPathComponent.lowercased().contains(needle) { results.append(entry(url, directory: false, count: -1)) }
    }
    return results
  }

  private static func entry(_ url: URL, directory: Bool, count: Int) -> [String: Any] {
    let values = try? url.resourceValues(forKeys: Set(keys))
    let ext = url.pathExtension.lowercased()
    let mime = directory ? "" : (UTType(filenameExtension: ext)?.preferredMIMEType ?? "")
    return [
      "name": url.lastPathComponent, "path": url.path, "uri": url.absoluteString, "directory": directory,
      "size": directory ? 0 : (values?.fileSize ?? 0),
      "modified": ((values?.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000).rounded(),
      "count": count, "mimeType": mime, "kind": kind(mime: mime, ext: ext, directory: directory),
    ]
  }

  private static func kind(mime: String, ext: String, directory: Bool) -> String {
    if directory { return "folder" }
    if mime == "application/pdf" || ext == "pdf" { return "pdf" }
    if mime.hasPrefix("image/") { return "image" }
    if mime.hasPrefix("video/") { return "video" }
    if mime.hasPrefix("audio/") { return "audio" }
    if ["zip", "rar", "7z", "tar", "gz"].contains(ext) { return "archive" }
    if ["doc", "docx", "txt", "rtf", "odt", "xls", "xlsx", "csv", "ppt", "pptx", "pages", "numbers", "key"].contains(ext) { return "document" }
    return "other"
  }

  enum ExplorerError: LocalizedError {
    case outside
    var errorDescription: String? { "This folder is outside Versara's files." }
  }
}

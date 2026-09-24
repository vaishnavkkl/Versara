import Foundation

/// Saves into Documents/Saved, which the Files app shows under On My iPhone › Versara.
enum DeviceSaver {
  struct Failure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }

  static func save(sourceUri: String, name requested: String, mimeType: String, replaceUri: String) throws -> [String: Any] {
    guard let source = URL(string: sourceUri), source.isFileURL, FileManager.default.fileExists(atPath: source.path) else {
      throw Failure(message: "This file is empty or missing.")
    }
    let manager = FileManager.default
    let documents = try manager.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let folder = documents.appendingPathComponent("Saved", isDirectory: true)
    try manager.createDirectory(at: folder, withIntermediateDirectories: true)
    let invalid = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
    var name = requested.components(separatedBy: invalid).joined(separator: "_").trimmingCharacters(in: .whitespaces)
    if name.isEmpty { name = source.lastPathComponent }
    name = String(name.prefix(120))

    var target: URL
    if let previous = URL(string: replaceUri), previous.isFileURL, previous.deletingLastPathComponent().standardizedFileURL == folder.standardizedFileURL {
      target = previous
    } else {
      target = folder.appendingPathComponent(name)
      let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
      var index = 1
      while manager.fileExists(atPath: target.path) && index < 1000 {
        target = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(index))" : "\(base) (\(index)).\(ext)")
        index += 1
      }
    }
    let staging = folder.appendingPathComponent(".saving-\(UUID().uuidString)")
    try manager.copyItem(at: source, to: staging)
    if manager.fileExists(atPath: target.path) { _ = try manager.replaceItemAt(target, withItemAt: staging) }
    else { try manager.moveItem(at: staging, to: target) }
    let size = (try? manager.attributesOfItem(atPath: target.path)[.size] as? NSNumber)?.int64Value ?? 0
    return ["uri": target.absoluteString, "name": target.lastPathComponent, "location": "Files › On My iPhone › Versara › Saved", "size": size, "mimeType": mimeType]
  }
}

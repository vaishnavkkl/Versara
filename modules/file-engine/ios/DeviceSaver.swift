import Foundation
import CryptoKit

/// Saves into Documents/Saved, which the Files app shows under On My iPhone › Versara.
enum DeviceSaver {
  private static let maximumBackupSize: Int64 = 512 * 1024 * 1024
  private struct Fingerprint: Codable, Equatable { let size: Int64; let hash: String }
  private struct Journal: Codable { let version: Int; let targetName: String; let original: Fingerprint; var committed: Bool }
  private struct Recovery { let directory: URL; var journal: Journal }
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
    let sourcePath = source.resolvingSymlinksInPath().path
    let caches = try manager.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let sourceSize = (try manager.attributesOfItem(atPath: sourcePath)[.size] as? NSNumber)?.int64Value ?? 0
    guard [documents, caches].contains(where: { sourcePath.hasPrefix($0.resolvingSymlinksInPath().path + "/") }),
          sourceSize > 0 else {
      throw Failure(message: "Only nonempty app files can be saved to the device.")
    }
    let folder = documents.appendingPathComponent("Saved", isDirectory: true)
    try manager.createDirectory(at: folder, withIntermediateDirectories: true)
    try recoverInterruptedReplacements(folder: folder)
    let invalid = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
    var name = requested.components(separatedBy: invalid).joined(separator: "_").trimmingCharacters(in: .whitespaces)
    if name.isEmpty { name = source.lastPathComponent }
    name = String(name.prefix(120))

    var target: URL
    if let previous = URL(string: replaceUri), previous.isFileURL, previous.resolvingSymlinksInPath().deletingLastPathComponent() == folder.resolvingSymlinksInPath() {
      target = previous
    } else {
      target = folder.appendingPathComponent(name)
      let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
      var index = 1
      while manager.fileExists(atPath: target.path) && index < 1000 {
        target = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(index))" : "\(base) (\(index)).\(ext)")
        index += 1
      }
      guard !manager.fileExists(atPath: target.path) else { throw Failure(message: "Too many files have this name. Choose another name.") }
    }
    let staging = folder.appendingPathComponent(".saving-\(UUID().uuidString)")
    defer { try? manager.removeItem(at: staging) }
    try manager.copyItem(at: source, to: staging)
    try synchronize(staging)
    let expected = try fingerprint(source)
    guard try fingerprint(staging) == expected else { throw Failure(message: "Could not verify the staged file. The original has not been changed.") }
    let recovery: Recovery? = manager.fileExists(atPath: target.path) ? try backupOriginal(target: target) : nil
    do {
      if recovery != nil { _ = try manager.replaceItemAt(target, withItemAt: staging) }
      else { try manager.moveItem(at: staging, to: target) }
      guard try fingerprint(target) == expected else { throw Failure(message: "The saved file could not be verified.") }
      if let recovery { try commit(recovery) }
    } catch {
      let failure = error
      if let recovery {
        do { try restore(recovery, folder: folder) }
        catch { throw Failure(message: "The save failed and its original could not be fully restored. A recovery copy is kept inside Versara. Free storage space and save again to retry recovery.") }
        throw Failure(message: "The save failed. The original saved file was restored; your Versara original has not been replaced. \(failure.localizedDescription)")
      }
      try? manager.removeItem(at: target)
      throw failure
    }
    return ["uri": target.absoluteString, "name": target.lastPathComponent, "location": "Files › On My iPhone › Versara › Saved", "size": expected.size, "mimeType": mimeType]
  }

  private static func recoveryRoot() throws -> URL {
    let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("VersaraSaveRecovery", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
  }

  private static func fingerprint(_ url: URL) throws -> Fingerprint {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hash = SHA256(), size: Int64 = 0
    while let data = try handle.read(upToCount: 128 * 1024), !data.isEmpty { size += Int64(data.count); hash.update(data: data) }
    return Fingerprint(size: size, hash: hash.finalize().map { String(format: "%02x", $0) }.joined())
  }

  private static func synchronize(_ url: URL) throws {
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    try handle.synchronize()
  }

  private static func writeJournal(_ recovery: Recovery) throws {
    let url = recovery.directory.appendingPathComponent("journal.json")
    try JSONEncoder().encode(recovery.journal).write(to: url, options: .atomic)
    try synchronize(url)
  }

  private static func backupOriginal(target: URL) throws -> Recovery {
    let manager = FileManager.default
    let root = try recoveryRoot()
    guard try manager.contentsOfDirectory(atPath: root.path).count < 4 else { throw Failure(message: "An earlier save needs recovery. Free storage space and try again.") }
    let original = try fingerprint(target)
    guard original.size <= maximumBackupSize else { throw Failure(message: "This file is too large for a safe replacement. Choose Save as new.") }
    let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try manager.createDirectory(at: directory, withIntermediateDirectories: true)
    do {
      let backup = directory.appendingPathComponent("original")
      try manager.copyItem(at: target, to: backup)
      try synchronize(backup)
      guard try fingerprint(backup) == original else { throw Failure(message: "Could not verify the original recovery copy.") }
      let recovery = Recovery(directory: directory, journal: Journal(version: 1, targetName: target.lastPathComponent, original: original, committed: false))
      try writeJournal(recovery)
      return recovery
    } catch { try? manager.removeItem(at: directory); throw Failure(message: "Could not create a safe replacement backup. Choose Save as new or free storage space. The original has not been changed.") }
  }

  private static func commit(_ original: Recovery) throws {
    var recovery = original
    recovery.journal.committed = true
    try writeJournal(recovery)
    try? FileManager.default.removeItem(at: recovery.directory)
  }

  private static func restore(_ recovery: Recovery, folder: URL) throws {
    let manager = FileManager.default
    let target = folder.appendingPathComponent(recovery.journal.targetName)
    guard target.resolvingSymlinksInPath().deletingLastPathComponent() == folder.resolvingSymlinksInPath() else { throw Failure(message: "The recovery destination is outside Versara's saved folder.") }
    let backup = recovery.directory.appendingPathComponent("original")
    guard try fingerprint(backup) == recovery.journal.original else { throw Failure(message: "The recovery copy could not be verified.") }
    let staging = folder.appendingPathComponent(".restoring-\(UUID().uuidString)")
    defer { try? manager.removeItem(at: staging) }
    try manager.copyItem(at: backup, to: staging)
    try synchronize(staging)
    if manager.fileExists(atPath: target.path) { _ = try manager.replaceItemAt(target, withItemAt: staging) }
    else { try manager.moveItem(at: staging, to: target) }
    guard try fingerprint(target) == recovery.journal.original else { throw Failure(message: "The restored original could not be verified.") }
    try commit(recovery)
  }

  private static func recoverInterruptedReplacements(folder: URL) throws {
    let manager = FileManager.default
    for directory in try manager.contentsOfDirectory(at: recoveryRoot(), includingPropertiesForKeys: [.isDirectoryKey]) {
      guard (try directory.resourceValues(forKeys: [.isDirectoryKey])).isDirectory == true else { continue }
      let url = directory.appendingPathComponent("journal.json")
      if !manager.fileExists(atPath: url.path) { try? manager.removeItem(at: directory); continue }
      do {
        let journal = try JSONDecoder().decode(Journal.self, from: Data(contentsOf: url))
        guard journal.version == 1 else { throw Failure(message: "Unsupported recovery record.") }
        if journal.committed { try? manager.removeItem(at: directory) }
        else { try restore(Recovery(directory: directory, journal: journal), folder: folder) }
      } catch { throw Failure(message: "An interrupted save needs recovery. Its original copy has been kept. Free storage space and try saving again.") }
    }
  }
}

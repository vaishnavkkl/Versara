import AVFoundation
import ExpoModulesCore
import Photos
import UniformTypeIdentifiers

public class FileEngineModule: Module {
  private let access = FileAccess()
  private let library = DeviceLibrary()
  private let pdfFolders = PdfFolderAccess()
  private let pdfs = PdfDeviceLibrary()
  private let queue = DispatchQueue(label: "com.versara.fileengine", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("FileEngine")
    Constant("nativeImageListVersion") { 2 }
    Constant("nativePdfLibraryVersion") { 1 }
    Constant("nativeZoomImageVersion") { 1 }
    Constant("nativeVideoVersion") { 1 }
    Constant("nativeImageEditorVersion") { 1 }
    Constant("nativeImageTextVersion") { 1 }
    Constant("nativeDeviceSaveVersion") { 1 }
    AsyncFunction("saveToDevice") { (sourceUri: String, name: String, mimeType: String, replaceUri: String, promise: Promise) in
      self.queue.async {
        do { promise.resolve(try DeviceSaver.save(sourceUri: sourceUri, name: name, mimeType: mimeType, replaceUri: replaceUri)) }
        catch { promise.reject("SAVE_FAILED", error.localizedDescription) }
      }
    }
    AsyncFunction("recognizeImageText") { (uri: String, promise: Promise) in
      self.queue.async {
        do { promise.resolve(try ImageText.recognize(uri: uri)) }
        catch { promise.reject("IMAGE_TEXT_FAILED", error.localizedDescription) }
      }
    }
    AsyncFunction("renderImageText") { (options: String, promise: Promise) in
      self.queue.async {
        do {
          let values = (try JSONSerialization.jsonObject(with: Data(options.utf8))) as? [String: Any] ?? [:]
          promise.resolve(try ImageText.render(values))
        } catch { promise.reject("IMAGE_TEXT_FAILED", error.localizedDescription) }
      }
    }
    Constant("nativeRecentPdfsVersion") { 1 }
    View(RecentImagesView.self) {
      Events("onOpen", "onRemove")
      Prop("items") { (view: RecentImagesView, value: String) in view.setItems(value) }
      Prop("grid") { (view: RecentImagesView, value: Bool) in view.setGrid(value) }
      Prop("palette") { (view: RecentImagesView, value: String) in view.setPalette(value) }
      Prop("disabled") { (view: RecentImagesView, value: Bool) in view.disabled = value }
    }
    View(NativeVideoView.self) {
      Events("onLoad", "onError")
      Prop("source") { (view: NativeVideoView, value: String) in view.setSource(value) }
      Prop("palette") { (view: NativeVideoView, value: String) in view.setPalette(value) }
    }
    View(ImageEditorView.self) {
      Events("onLoad", "onError", "onCropChange")
      Prop("source") { (view: ImageEditorView, value: String) in view.setSource(value) }
      Prop("edits") { (view: ImageEditorView, value: String) in view.setEdits(value) }
      Prop("aspect") { (view: ImageEditorView, value: String) in view.setAspect(value) }
    }
    AsyncFunction("editImage") { (options: String, promise: Promise) in
      self.queue.async {
        do {
          let values = (try JSONSerialization.jsonObject(with: Data(options.utf8))) as? [String: Any] ?? [:]
          promise.resolve(try ImageEditing.export(values))
        } catch { promise.reject("IMAGE_EDIT_FAILED", error.localizedDescription) }
      }
    }
    View(ZoomableImageView.self) {
      Events("onLoad", "onError", "onDismiss")
      Prop("source") { (view: ZoomableImageView, value: String) in view.setSource(value) }
    }

    AsyncFunction("getPdfAccessAsync") { (promise: Promise) in promise.resolve(PdfFolderAccess.status()) }
    AsyncFunction("requestPdfAccessAsync") { (promise: Promise) in
      self.pdfFolders.request(from: self.appContext?.utilities?.currentViewController(), promise: promise)
    }.runOnQueue(.main)
    AsyncFunction("scanPdfFiles") { (id: String, promise: Promise) in self.pdfs.scan(id, promise: promise) }
    AsyncFunction("listPdfPage") { (offset: Int, limit: Int, search: String, promise: Promise) in self.pdfs.page(offset: offset, limit: limit, search: search, promise: promise) }
    Function("cancelPdfScan") { (id: String) in self.pdfs.cancel(id) }
    AsyncFunction("listRecentPdfs") { (limit: Int, search: String, promise: Promise) in
      self.pdfs.recent(limit: max(1, min(limit, 60)), search: search.trimmingCharacters(in: .whitespacesAndNewlines), promise: promise)
    }
    Constant("nativeExplorerVersion") { 1 }
    AsyncFunction("getStorageRoots") { (promise: Promise) in promise.resolve(FileExplorer.roots()) }
    AsyncFunction("listDirectory") { (path: String, showHidden: Bool, promise: Promise) in
      self.queue.async {
        do { promise.resolve(try FileExplorer.list(path: path, showHidden: showHidden)) }
        catch { promise.reject("FOLDER_FAILED", error.localizedDescription) }
      }
    }
    AsyncFunction("searchFiles") { (query: String, limit: Int, promise: Promise) in
      self.queue.async { promise.resolve(FileExplorer.search(query: query, limit: max(1, min(limit, 200)))) }
    }
    OnDestroy { self.pdfs.destroy(); self.pdfFolders.destroy() }
    OnAppEntersBackground { self.pdfs.cancelAll() }

    AsyncFunction("getFileAccessAsync") { (promise: Promise) in
      promise.resolve(self.access.status())
    }

    AsyncFunction("requestFileAccessAsync") { (promise: Promise) in
      self.access.request { result in promise.resolve(result) }
    }

    AsyncFunction("listDeviceRecents") { (kind: String, limit: Int, search: String, promise: Promise) in
      guard self.access.hasAccess(for: kind) else {
        promise.resolve([])
        return
      }
      self.queue.async {
        do {
          let items = try self.library.list(kind: kind, limit: max(1, min(limit, 100)), search: search.trimmingCharacters(in: .whitespacesAndNewlines))
          promise.resolve(items)
        } catch {
          promise.reject("FILE_LIST_FAILED", error.localizedDescription)
        }
      }
    }

    AsyncFunction("importDeviceFile") { (uri: String, kind: String, destinationUri: String, promise: Promise) in
      self.queue.async {
        do {
          promise.resolve(try self.library.importFile(uri: uri, kind: kind, destinationUri: destinationUri))
        } catch {
          promise.reject("FILE_IMPORT_FAILED", error.localizedDescription)
        }
      }
    }
  }
}

final class FileAccess {
  func status() -> [String: Any] {
    let state = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    switch state {
    case .authorized, .limited:
      return ["status": "granted", "granted": true, "canAskAgain": false]
    case .denied, .restricted:
      return ["status": "denied", "granted": false, "canAskAgain": false]
    case .notDetermined:
      return ["status": "undetermined", "granted": false, "canAskAgain": true]
    @unknown default:
      return ["status": "undetermined", "granted": false, "canAskAgain": true]
    }
  }

  func hasAccess(for kind: String) -> Bool {
    if kind == "pdf" || kind == "audio" { return true }
    let state = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    return state == .authorized || state == .limited
  }

  func request(completion: @escaping ([String: Any]) -> Void) {
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in
      DispatchQueue.main.async { completion(self.status()) }
    }
  }
}

final class DeviceLibrary {
  func list(kind: String, limit: Int, search: String) throws -> [[String: Any]] {
    switch kind {
    case "image":
      return fetch(mediaType: .image, kind: "image", limit: limit, search: search, defaultMime: "image/jpeg")
    case "video":
      return fetch(mediaType: .video, kind: "video", limit: limit, search: search, defaultMime: "video/mp4")
    case "pdf", "audio":
      return []
    default:
      return []
    }
  }

  private func fetch(mediaType: PHAssetMediaType, kind: String, limit: Int, search: String, defaultMime: String) -> [[String: Any]] {
    let options = PHFetchOptions()
    options.sortDescriptors = [NSSortDescriptor(key: "modificationDate", ascending: false)]
    options.fetchLimit = limit * 2
    let assets = PHAsset.fetchAssets(with: mediaType, options: options)
    var results: [[String: Any]] = []
    let needle = search.lowercased()
    assets.enumerateObjects { asset, _, stop in
      if results.count >= limit { stop.pointee = true; return }
      let resources = PHAssetResource.assetResources(for: asset)
      guard let resource = resources.first else { return }
      let name = resource.originalFilename
      if !needle.isEmpty && !name.lowercased().contains(needle) { return }
      let mime = UTType(filenameExtension: (name as NSString).pathExtension)?.preferredMIMEType ?? defaultMime
      results.append([
        "id": "device-\(kind)-\(asset.localIdentifier)",
        "uri": "ph://\(asset.localIdentifier)",
        "name": name,
        "mimeType": mime,
        "size": resource.value(forKey: "fileSize") as? Int64 ?? 0,
        "modified": Int64(((asset.modificationDate ?? asset.creationDate)?.timeIntervalSince1970 ?? 0) * 1000),
        "kind": kind,
        "source": "device",
      ])
    }
    return results
  }

  func importFile(uri: String, kind: String, destinationUri: String) throws -> [String: Any] {
    guard let destination = URL(string: destinationUri), destination.isFileURL else {
      throw FileEngineError.invalidDestination
    }
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath().path
    let path = destination.resolvingSymlinksInPath().path
    guard path.hasPrefix(documents + "/") else { throw FileEngineError.invalidDestination }
    guard !FileManager.default.fileExists(atPath: path) else { throw FileEngineError.invalidDestination }
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)

    if uri.hasPrefix("ph://") {
      let id = String(uri.dropFirst("ph://".count))
      let assets = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil)
      guard let asset = assets.firstObject else { throw FileEngineError.missing }
      let name = PHAssetResource.assetResources(for: asset).first?.originalFilename ?? destination.lastPathComponent
      try export(asset: asset, to: destination)
      let size = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
      let mime = UTType(filenameExtension: destination.pathExtension)?.preferredMIMEType
        ?? (kind == "video" ? "video/mp4" : "image/jpeg")
      return ["uri": destinationUri, "name": name, "mimeType": mime, "size": size, "kind": kind]
    }

    guard let source = URL(string: uri) else { throw FileEngineError.missing }
    try PdfFolderAccess.withAccess(to: source) { try FileManager.default.copyItem(at: source, to: destination) }
    let size = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
    let mime = UTType(filenameExtension: destination.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    return ["uri": destinationUri, "name": destination.lastPathComponent, "mimeType": mime, "size": size, "kind": kind]
  }

  private func export(asset: PHAsset, to destination: URL) throws {
    let semaphore = DispatchSemaphore(value: 0)
    var failure: Error?
    if asset.mediaType == .image {
      let options = PHImageRequestOptions()
      options.isNetworkAccessAllowed = true
      options.deliveryMode = .highQualityFormat
      options.isSynchronous = true
      PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, _, _, info in
        defer { semaphore.signal() }
        if let error = info?[PHImageErrorKey] as? Error { failure = error; return }
        guard let data = data else { failure = FileEngineError.missing; return }
        do { try data.write(to: destination, options: .atomic) } catch { failure = error }
      }
    } else {
      let options = PHVideoRequestOptions()
      options.isNetworkAccessAllowed = true
      PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { avAsset, _, info in
        defer { semaphore.signal() }
        if let error = info?[PHImageErrorKey] as? Error { failure = error; return }
        guard let urlAsset = avAsset as? AVURLAsset else { failure = FileEngineError.missing; return }
        do {
          if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
          }
          try FileManager.default.copyItem(at: urlAsset.url, to: destination)
        } catch { failure = error }
      }
      _ = semaphore.wait(timeout: .now() + 60)
      if let failure = failure { throw failure }
      return
    }
    _ = semaphore.wait(timeout: .now() + 60)
    if let failure = failure { throw failure }
  }
}

enum FileEngineError: LocalizedError {
  case invalidDestination, missing
  var errorDescription: String? {
    switch self {
    case .invalidDestination: return "Could not save this file inside Versara."
    case .missing: return "This file is no longer available."
    }
  }
}

import AVFoundation
import ExpoModulesCore
import Photos
import UniformTypeIdentifiers

public class FileEngineModule: Module {
  private let access = FileAccess()
  private let library = DeviceLibrary()
  private let pdfFolders = PdfFolderAccess()
  private let pdfs = PdfDeviceLibrary()
  private let imageTools = ImageTools()
  private let privacy = ImagePrivacy()
  private let queue = DispatchQueue(label: "com.versara.fileengine", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("FileEngine")
    Constant("nativeImagePrivacyVersion") { 1 }
    Constant("nativeSignatureImageVersion") { 1 }
    AsyncFunction("scanImagePrivacy") { (id: String, uri: String, promise: Promise) in self.privacy.scan(id, uri: uri, promise: promise) }
    Function("cancelPrivacyScan") { (id: String) in self.privacy.cancel(id) }
    Constant("nativeImageToolsVersion") { 1 }
    Constant("nativeImageColorVersion") { 2 }
    Constant("nativeStrokePatternsVersion") { 1 }
    Constant("nativeMarkupEditingVersion") { 1 }
    Constant("nativeImageResizeVersion") { 1 }
    AsyncFunction("processImage") { (id: String, request: String, promise: Promise) in self.imageTools.run(id, request: request, promise: promise) }
    Function("cancelImageJob") { (id: String) in self.imageTools.cancel(id) }
    Constant("nativeImageListVersion") { 5 }
    Constant("nativePdfLibraryVersion") { 1 }
    Constant("nativeZoomImageVersion") { 1 }
    Constant("nativeVideoVersion") { 1 }
    Constant("nativeImageEditorVersion") { 1 }
    Constant("nativeImageHistoryVersion") { 1 }
    Constant("nativeImageTextVersion") { 2 }
    Function("cancelImageTextRecognition") { (uri: String) in ImageText.cancelRecognition(uri: uri) }
    Constant("nativeDeviceSaveVersion") { 2 }
    AsyncFunction("saveToDevice") { (sourceUri: String, name: String, mimeType: String, replaceUri: String, promise: Promise) in
      self.queue.async {
        do { promise.resolve(try DeviceSaver.save(sourceUri: sourceUri, name: name, mimeType: mimeType, replaceUri: replaceUri)) }
        catch { promise.reject("SAVE_FAILED", error.localizedDescription) }
      }
    }
    AsyncFunction("recognizeImageText") { (uri: String, fonts: String?, promise: Promise) in
      let catalog = (try? JSONSerialization.jsonObject(with: Data((fonts ?? "{}").utf8))) as? [String: String] ?? [:]
      do {
        let operation = try ImageText.prepareRecognition(uri: uri)
        self.queue.async { autoreleasepool {
          defer { ImageText.finishRecognition(operation) }
          do { promise.resolve(try ImageText.recognize(uri: uri, operation: operation, fonts: catalog)) }
          catch is CancellationError { promise.reject("IMAGE_TEXT_CANCELLED", "Text recognition was cancelled.") }
          catch { promise.reject("IMAGE_TEXT_FAILED", error.localizedDescription) }
        } }
      } catch { promise.reject("IMAGE_TEXT_BUSY", error.localizedDescription) }
    }
    AsyncFunction("renderImageText") { (options: String, promise: Promise) in
      self.queue.async { autoreleasepool {
        do {
          let values = (try JSONSerialization.jsonObject(with: Data(options.utf8))) as? [String: Any] ?? [:]
          promise.resolve(try ImageText.render(values))
        } catch { promise.reject("IMAGE_TEXT_FAILED", error.localizedDescription) }
      } }
    }
    Constant("nativeRecentPdfsVersion") { 1 }
    View(RecentImagesView.self) {
      Events("onOpen", "onRemove", "onLongPress", "onRefresh")
      Prop("items") { (view: RecentImagesView, value: String) in view.setItems(value) }
      Prop("refreshing") { (view: RecentImagesView, value: Bool) in view.setRefreshing(value) }
      Prop("grid") { (view: RecentImagesView, value: Bool) in view.setGrid(value) }
      Prop("palette") { (view: RecentImagesView, value: String) in view.setPalette(value) }
      Prop("disabled") { (view: RecentImagesView, value: Bool) in view.disabled = value }
      Prop("active") { (view: RecentImagesView, value: Bool) in view.setActive(value) }
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
      Prop("cropRequest") { (view: ImageEditorView, value: String) in view.setCropRequest(value) }
      OnViewDestroys { (view: ImageEditorView) in view.dispose() }
    }
    AsyncFunction("editImage") { (options: String, promise: Promise) in
      self.queue.async { autoreleasepool {
        do {
          let values = (try JSONSerialization.jsonObject(with: Data(options.utf8))) as? [String: Any] ?? [:]
          promise.resolve(try ImageEditing.export(values))
        } catch { promise.reject("IMAGE_EDIT_FAILED", error.localizedDescription) }
      } }
    }
    View(ZoomableImageView.self) {
      Events("onLoad", "onError", "onDismiss")
      Prop("source") { (view: ZoomableImageView, value: String) in view.setSource(value) }
      OnViewDestroys { (view: ZoomableImageView) in view.dispose() }
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
    Constant("nativeDeviceDeleteVersion") { 1 }
    AsyncFunction("deleteDeviceFile") { (uri: String, promise: Promise) in
      if uri.hasPrefix("ph://") {
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: [String(uri.dropFirst(5))], options: nil)
        guard assets.count > 0 else { promise.reject("DELETE_FAILED", "This photo is no longer available."); return }
        PHPhotoLibrary.shared().performChanges({ PHAssetChangeRequest.deleteAssets(assets) }) { done, error in
          if done { promise.resolve(true) } else { promise.reject("DELETE_FAILED", error?.localizedDescription ?? "The photo was not deleted.") }
        }
        return
      }
      guard let url = URL(string: uri), url.isFileURL else { promise.reject("DELETE_FAILED", "This file can't be deleted here."); return }
      self.queue.async {
        do {
          try PdfFolderAccess.withAccess(to: url) { try FileManager.default.removeItem(at: url) }
          promise.resolve(true)
        } catch { promise.reject("DELETE_FAILED", error.localizedDescription) }
      }
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
    OnDestroy { self.privacy.destroy(); ImageText.cancelAllRecognition(); self.imageTools.destroy(); self.pdfs.destroy(); self.pdfFolders.destroy() }
    OnAppEntersBackground { self.privacy.cancelAll(); self.pdfs.cancelAll() }

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
        } catch FileEngineError.notLocal {
          promise.reject("FILE_NOT_LOCAL", FileEngineError.notLocal.localizedDescription)
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
    let sourceType = try PdfFolderAccess.withAccess(to: source) { () -> UTType? in
      try FileManager.default.copyItem(at: source, to: destination)
      return (try? source.resourceValues(forKeys: [.contentTypeKey]))?.contentType
    }
    let size = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
    // External imports first copy to an extensionless staging path. Inspect the
    // received file's type rather than guessing from that temporary destination.
    let mime = sourceType?.preferredMIMEType ?? UTType(filenameExtension: source.pathExtension)?.preferredMIMEType
      ?? UTType(filenameExtension: destination.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    return ["uri": destinationUri, "name": source.lastPathComponent, "mimeType": mime, "size": size, "kind": kind]
  }

  private func export(asset: PHAsset, to destination: URL) throws {
    let manager = PHImageManager.default()
    if asset.mediaType == .image {
      let options = PHImageRequestOptions()
      options.isNetworkAccessAllowed = false
      options.deliveryMode = .highQualityFormat
      let pending = LocalAssetResult<Data>()
      let request = manager.requestImageDataAndOrientation(for: asset, options: options) { data, _, _, info in
        if let data { pending.finish(.success(data)); return }
        if (info?[PHImageResultIsInCloudKey] as? Bool) == true { pending.finish(.failure(FileEngineError.notLocal)); return }
        pending.finish(.failure(info?[PHImageErrorKey] as? Error ?? FileEngineError.missing))
      }
      guard let result = pending.wait() else { manager.cancelImageRequest(request); throw FileEngineError.timedOut }
      try result.get().write(to: destination, options: .atomic)
    } else {
      let options = PHVideoRequestOptions()
      options.isNetworkAccessAllowed = false
      let pending = LocalAssetResult<URL>()
      let request = manager.requestAVAsset(forVideo: asset, options: options) { avAsset, _, info in
        if let local = avAsset as? AVURLAsset { pending.finish(.success(local.url)); return }
        if (info?[PHImageResultIsInCloudKey] as? Bool) == true { pending.finish(.failure(FileEngineError.notLocal)); return }
        pending.finish(.failure(info?[PHImageErrorKey] as? Error ?? FileEngineError.missing))
      }
      guard let result = pending.wait() else { manager.cancelImageRequest(request); throw FileEngineError.timedOut }
      try FileManager.default.copyItem(at: result.get(), to: destination)
    }
  }
}

/** A timed-out Photos callback must never create an import after the caller has left. */
private final class LocalAssetResult<Value> {
  private let lock = NSLock()
  private let semaphore = DispatchSemaphore(value: 0)
  private var completed = false
  private var result: Result<Value, Error>?

  func finish(_ value: Result<Value, Error>) {
    lock.lock()
    guard !completed else { lock.unlock(); return }
    completed = true; result = value
    lock.unlock()
    semaphore.signal()
  }

  func wait() -> Result<Value, Error>? {
    let status = semaphore.wait(timeout: .now() + 60)
    lock.lock(); defer { lock.unlock() }
    if status == .timedOut { completed = true; result = nil; return nil }
    return result
  }
}

enum FileEngineError: LocalizedError {
  case invalidDestination, missing, notLocal, timedOut
  var errorDescription: String? {
    switch self {
    case .invalidDestination: return "Could not save this file inside Versara."
    case .missing: return "This file is no longer available."
    case .notLocal: return "This file is stored in iCloud and is not available on this device. Versara only opens local files. Choose a file already saved on your device."
    case .timedOut: return "This local file could not be opened in time. Try opening it again."
    }
  }
}

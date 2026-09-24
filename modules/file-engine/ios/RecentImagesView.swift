import ExpoModulesCore
import UIKit
import Photos
import ImageIO
import CoreGraphics
import AVFoundation

private struct RecentImage: Decodable {
  let id: String
  let uri: String
  let name: String
  let detail: String
  let removable: Bool
  let kind: String?
}

final class RecentImagesView: ExpoView, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
  let onOpen = EventDispatcher()
  let onRemove = EventDispatcher()
  var disabled = false
  private var items: [RecentImage] = []
  private var grid = false
  private var label = UIColor.label
  private var secondary = UIColor.secondaryLabel
  private var surface = UIColor.secondarySystemBackground
  private let flow = UICollectionViewFlowLayout()
  private lazy var list = UICollectionView(frame: .zero, collectionViewLayout: flow)
  private let cache = NSCache<NSString, UIImage>()
  private let worker = OperationQueue()
  private let photos = PHImageManager()
  private var memoryObserver: NSObjectProtocol?
  private let lowMemory = ProcessInfo.processInfo.physicalMemory <= 2 * 1024 * 1024 * 1024
  // Rows show 40pt thumbnails, grid cells about half the screen width; decode no larger than that.
  private lazy var listPixels = lowMemory ? 72 : 112
  private lazy var gridPixels = lowMemory ? 144 : 208

  required init(appContext: AppContext) {
    super.init(appContext: appContext)
    worker.maxConcurrentOperationCount = lowMemory ? 1 : 2
    worker.qualityOfService = .utility
    cache.totalCostLimit = lowMemory ? 2 * 1024 * 1024 : 4 * 1024 * 1024
    cache.countLimit = 64
    flow.minimumLineSpacing = 8
    flow.minimumInteritemSpacing = 8
    flow.sectionInset = UIEdgeInsets(top: 4, left: 20, bottom: 24, right: 20)
    list.backgroundColor = .clear
    list.dataSource = self
    list.delegate = self
    list.isPrefetchingEnabled = false
    list.alwaysBounceVertical = true
    list.register(RecentImageCell.self, forCellWithReuseIdentifier: "image")
    addSubview(list)
    memoryObserver = NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in
      self?.cache.removeAllObjects()
    }
  }

  deinit {
    worker.cancelAllOperations()
    if let observer = memoryObserver { NotificationCenter.default.removeObserver(observer) }
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    if list.frame.size != bounds.size { flow.invalidateLayout() }
    list.frame = bounds
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      // Covered by another screen: stop decoding but keep the small bounded cache for a flicker-free return.
      list.visibleCells.compactMap { $0 as? RecentImageCell }.forEach { $0.cancelLoad() }
      worker.cancelAllOperations()
    } else { list.reloadData() }
  }
  func setItems(_ value: String) {
    items = Array(((try? JSONDecoder().decode([RecentImage].self, from: Data(value.utf8))) ?? []).prefix(160))
    list.reloadData()
  }
  func setGrid(_ value: Bool) {
    guard grid != value else { return }
    grid = value
    flow.invalidateLayout()
    list.reloadData()
  }
  func setPalette(_ value: String) {
    guard let values = try? JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: String] else { return }
    func color(_ key: String) -> UIColor {
      let hex = values[key, default: "#000000"].trimmingCharacters(in: CharacterSet(charactersIn: "#"))
      let rgb = UInt32(hex, radix: 16) ?? 0
      return UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: 1)
    }
    label = color("label"); secondary = color("secondary"); surface = color("surface")
    list.reloadData()
  }
  func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { items.count }
  func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
    let width = max(1, (collectionView.bounds.width - 40 - (grid ? 8 : 0)) / (grid ? 2 : 1))
    let scale = UIFontMetrics.default.scaledValue(for: 1)
    return CGSize(width: width, height: grid ? width - 16 + max(52, 48 * scale) + 16 : max(60, 52 * scale))
  }
  func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "image", for: indexPath) as! RecentImageCell
    let item = items[indexPath.item]
    cell.configure(item, grid: grid, label: label, secondary: secondary, surface: surface)
    cell.removeAction = { [weak self] in
      guard let self = self, !self.disabled else { return }
      self.onRemove(["id": item.id])
    }
    load(item, into: cell)
    return cell
  }
  func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
    guard !disabled, indexPath.item < items.count else { return }
    onOpen(["id": items[indexPath.item].id])
  }
  func collectionView(_ collectionView: UICollectionView, didEndDisplaying cell: UICollectionViewCell, forItemAt indexPath: IndexPath) {
    (cell as? RecentImageCell)?.releaseImage()
  }

  private func load(_ item: RecentImage, into cell: RecentImageCell) {
    let size = grid ? gridPixels : listPixels
    let key = "\(item.uri)|\(item.kind ?? "image")|\(size)" as NSString
    if let image = cache.object(forKey: key) { cell.image.image = image; return }
    let token = cell.token
    let finish: (UIImage?) -> Void = { [weak self, weak cell] image in
      DispatchQueue.main.async {
        guard let self = self, let cell = cell, cell.token == token, self.window != nil, let image = image else { return }
        if let cg = image.cgImage { self.cache.setObject(image, forKey: key, cost: cg.bytesPerRow * cg.height) }
        cell.image.image = image
      }
    }
    if item.uri.hasPrefix("ph://") {
      let id = String(item.uri.dropFirst(5))
      guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else { return }
      let options = PHImageRequestOptions()
      options.isNetworkAccessAllowed = false
      options.deliveryMode = .fastFormat
      options.resizeMode = .exact
      let request = photos.requestImage(for: asset, targetSize: CGSize(width: CGFloat(size), height: CGFloat(size)), contentMode: .aspectFit, options: options) { image, _ in finish(image) }
      cell.cancel = { [photos] in photos.cancelImageRequest(request) }
    } else if let url = URL(string: item.uri), url.isFileURL, worker.operationCount < 24 {
      let operation = BlockOperation()
      operation.addExecutionBlock { [weak operation] in
        guard operation?.isCancelled == false else { return }
        autoreleasepool {
          if item.kind == "pdf" {
            let image = try? PdfFolderAccess.withAccess(to: url) { () -> UIImage? in
              guard let document = CGPDFDocument(url as CFURL), !document.isEncrypted || document.isUnlocked,
                let page = document.page(at: 1) else { return nil }
              let box = page.getBoxRect(.cropBox)
              let rotated = page.rotationAngle % 180 != 0
              let width = rotated ? box.height : box.width
              let height = rotated ? box.width : box.height
              let factor = CGFloat(size) / max(1, max(width, height))
              let w = max(1, Int(width * factor)), h = max(1, Int(height * factor))
              guard let context = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
              let target = CGRect(x: 0, y: 0, width: CGFloat(w), height: CGFloat(h))
              context.setFillColor(UIColor.white.cgColor); context.fill(target)
              context.concatenate(page.getDrawingTransform(.cropBox, rect: target, rotate: 0, preserveAspectRatio: true))
              context.drawPDFPage(page)
              return context.makeImage().map { UIImage(cgImage: $0) }
            }
            if operation?.isCancelled == false { finish(image ?? nil) }
            return
          }
          if item.kind == "video" || item.kind == "audio" {
            let image = item.kind == "video" ? Self.videoFrame(url, size: size) : Self.audioArtwork(url, size: size)
            if operation?.isCancelled == false { finish(image) }
            return
          }
          guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
            let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
              kCGImageSourceCreateThumbnailFromImageAlways: true,
              kCGImageSourceCreateThumbnailWithTransform: true,
              kCGImageSourceThumbnailMaxPixelSize: size,
              kCGImageSourceShouldCacheImmediately: true
            ] as CFDictionary), operation?.isCancelled == false else { return }
          finish(UIImage(cgImage: image))
        }
      }
      cell.cancel = { operation.cancel() }
      worker.addOperation(operation)
    }
  }

  private static func videoFrame(_ url: URL, size: Int) -> UIImage? {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: size, height: size)
    guard let frame = try? generator.copyCGImage(at: CMTime(seconds: 1, preferredTimescale: 600), actualTime: nil) else { return nil }
    return UIImage(cgImage: frame)
  }

  private static func audioArtwork(_ url: URL, size: Int) -> UIImage? {
    let metadata = AVURLAsset(url: url).commonMetadata
    guard let data = AVMetadataItem.metadataItems(from: metadata, filteredByIdentifier: .commonIdentifierArtwork).first?.dataValue,
      let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
      let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceThumbnailMaxPixelSize: size,
        kCGImageSourceShouldCacheImmediately: true
      ] as CFDictionary) else { return nil }
    return UIImage(cgImage: image)
  }
}

private final class RecentImageCell: UICollectionViewCell {
  let image = UIImageView()
  private let name = UILabel()
  private let detail = UILabel()
  private let remove = UIButton(type: .system)
  private var grid = false
  var token = UUID()
  var cancel: (() -> Void)?
  var removeAction: (() -> Void)?
  override init(frame: CGRect) {
    super.init(frame: frame)
    contentView.layer.cornerRadius = 10
    image.contentMode = .scaleAspectFill
    image.clipsToBounds = true
    image.layer.cornerRadius = 6
    name.font = UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .systemFont(ofSize: 12, weight: .medium))
    detail.font = UIFontMetrics(forTextStyle: .caption2).scaledFont(for: .systemFont(ofSize: 10))
    name.adjustsFontForContentSizeCategory = true
    detail.adjustsFontForContentSizeCategory = true
    name.numberOfLines = 2; detail.numberOfLines = 2
    remove.setImage(UIImage(systemName: "xmark.circle.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .regular)), for: .normal)
    remove.addTarget(self, action: #selector(removeTapped), for: .touchUpInside)
    [image, name, detail, remove].forEach { contentView.addSubview($0) }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  @objc private func removeTapped() { removeAction?() }
  func configure(_ item: RecentImage, grid: Bool, label: UIColor, secondary: UIColor, surface: UIColor) {
    releaseImage()
    self.grid = grid
    image.contentMode = item.kind == "pdf" ? .scaleAspectFit : .scaleAspectFill
    contentView.backgroundColor = surface
    name.text = item.name; name.textColor = label
    detail.text = item.detail; detail.textColor = secondary
    let symbol = item.kind == "pdf" ? "doc.richtext" : item.kind == "video" ? "play.rectangle" : item.kind == "audio" ? "waveform" : "photo"
    image.image = UIImage(systemName: symbol); image.tintColor = secondary
    remove.tintColor = grid ? .white : secondary.withAlphaComponent(0.55)
    remove.layer.shadowOpacity = grid ? 0.45 : 0
    remove.layer.shadowRadius = 3
    remove.layer.shadowOffset = .zero
    remove.isHidden = !item.removable
    remove.accessibilityLabel = "Remove \(item.name) from Recents"
    name.accessibilityLabel = "Open \(item.name)"
    setNeedsLayout()
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    let width = contentView.bounds.width
    if grid {
      image.frame = CGRect(x: 8, y: 8, width: width - 16, height: width - 16)
      let textWidth = max(1, width - 20)
      name.frame = CGRect(x: 10, y: image.frame.maxY + 6, width: textWidth, height: name.font.lineHeight * 2)
      detail.frame = CGRect(x: 10, y: name.frame.maxY + 2, width: textWidth, height: detail.font.lineHeight * 2)
      remove.frame = CGRect(x: image.frame.maxX - 46, y: image.frame.minY + 2, width: 44, height: 44)
      contentView.bringSubviewToFront(remove)
    } else {
      image.frame = CGRect(x: 10, y: (bounds.height - 40) / 2, width: 40, height: 40)
      let textWidth = max(1, width - 72 - (remove.isHidden ? 0 : 48))
      name.frame = CGRect(x: 62, y: 6, width: textWidth, height: name.font.lineHeight * 2)
      detail.frame = CGRect(x: 62, y: name.frame.maxY, width: textWidth, height: detail.font.lineHeight)
      remove.frame = CGRect(x: width - 48, y: 2, width: 48, height: 44)
    }
  }
  func cancelLoad() { token = UUID(); cancel?(); cancel = nil }
  func releaseImage() { cancelLoad(); image.image = nil }
  override func prepareForReuse() { super.prepareForReuse(); releaseImage(); removeAction = nil }
  deinit { cancel?() }
}

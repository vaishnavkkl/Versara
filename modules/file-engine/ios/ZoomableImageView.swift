import ExpoModulesCore
import UIKit
import ImageIO

/// Full-screen image preview: decode, zoom, pan and swipe-to-dismiss stay in native code.
final class ZoomableImageView: ExpoView, UIScrollViewDelegate {
  let onLoad = EventDispatcher()
  let onError = EventDispatcher()
  let onDismiss = EventDispatcher()
  let onTap = EventDispatcher()
  private let scroll = UIScrollView()
  private let imageView = UIImageView()
  private var source = ""
  private var ticket = 0
  private let worker = OperationQueue()
  private var requestedTarget: CGFloat = 0
  private var loadedTarget: CGFloat = 0
  private var disposed = false
  private var dismissing = false
  private static let dismissDistance: CGFloat = 120
  private static let maxZoom: CGFloat = 5
  private static let doubleTapZoom: CGFloat = 2.5

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    worker.maxConcurrentOperationCount = 1
    worker.qualityOfService = .utility
    clipsToBounds = true
    scroll.delegate = self
    scroll.minimumZoomScale = 1
    scroll.maximumZoomScale = Self.maxZoom
    scroll.alwaysBounceVertical = true
    scroll.showsVerticalScrollIndicator = false
    scroll.showsHorizontalScrollIndicator = false
    scroll.contentInsetAdjustmentBehavior = .never
    scroll.decelerationRate = .fast
    imageView.contentMode = .scaleAspectFit
    scroll.addSubview(imageView)
    addSubview(scroll)
    let doubleTap = UITapGestureRecognizer(target: self, action: #selector(handleDoubleTap(_:)))
    doubleTap.numberOfTapsRequired = 2
    scroll.addGestureRecognizer(doubleTap)
    let singleTap = UITapGestureRecognizer(target: self, action: #selector(handleSingleTap(_:)))
    singleTap.require(toFail: doubleTap)
    scroll.addGestureRecognizer(singleTap)
    isAccessibilityElement = true
    accessibilityTraits = .image
    accessibilityLabel = "Image preview"
    accessibilityHint = "Pinch or double tap to zoom. Swipe down to close."
  }

  func setSource(_ value: String) {
    guard value != source else { return }
    source = value
    ticket += 1
    worker.cancelAllOperations()
    requestedTarget = 0; loadedTarget = 0
    imageView.image = nil
    scroll.setZoomScale(1, animated: false)
    load()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      ticket += 1
      worker.cancelAllOperations()
      requestedTarget = 0; loadedTarget = 0
      imageView.image = nil
    } else { load() }
  }

  func dispose() {
    guard !disposed else { return }
    disposed = true
    ticket += 1
    worker.cancelAllOperations()
    imageView.layer.removeAllAnimations()
    scroll.delegate = nil
    imageView.image = nil
  }

  deinit { worker.cancelAllOperations() }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard scroll.frame != bounds else { return }
    scroll.frame = bounds
    scroll.setZoomScale(1, animated: false)
    layoutImage()
    load()
  }

  private func load(detail: Bool = false) {
    guard !disposed, window != nil, !source.isEmpty, bounds.width > 0, bounds.height > 0 else { return }
    let screenScale = window?.screen.scale ?? UIScreen.main.scale
    let lowMemory = ProcessInfo.processInfo.physicalMemory <= 2 * 1024 * 1024 * 1024
    let cap: CGFloat = detail ? (lowMemory ? 2048 : 4096) : (lowMemory ? 1536 : 2048)
    let magnification: CGFloat = detail ? min(2, max(1, scroll.zoomScale)) : 1
    let target = min(max(bounds.width, bounds.height) * screenScale * magnification, cap)
    guard target > requestedTarget else { return }
    requestedTarget = target
    ticket += 1
    let current = ticket
    let uri = source
    worker.cancelAllOperations()
    let operation = BlockOperation()
    operation.addExecutionBlock { [weak self, weak operation] in
      guard operation?.isCancelled == false else { return }
      autoreleasepool {
        let image = Self.decode(uri: uri, maxPixels: target)
        guard operation?.isCancelled == false else { return }
        DispatchQueue.main.async { [weak self] in
          guard let self, !self.disposed, self.window != nil, current == self.ticket else { return }
          guard let image else {
            self.requestedTarget = self.loadedTarget
            // Keep a working fit preview if the optional zoom detail cannot be decoded.
            if self.imageView.image == nil { self.onError(["message": "This image format could not be previewed on your device."]) }
            return
          }
          let firstImage = self.imageView.image == nil
          self.imageView.image = image
          self.loadedTarget = target
          if firstImage {
            self.scroll.setZoomScale(1, animated: false)
            self.layoutImage()
          }
          if firstImage { self.onLoad(["width": image.size.width, "height": image.size.height]) }
        }
      }
    }
    worker.addOperation(operation)
  }

  private static func decode(uri: String, maxPixels: CGFloat) -> UIImage? {
    guard let url = URL(string: uri), url.isFileURL,
          let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: max(1, Int(maxPixels)),
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: image)
  }

  private func layoutImage() {
    guard let image = imageView.image, image.size.width > 0, image.size.height > 0, bounds.width > 0 else { return }
    let fit = min(bounds.width / image.size.width, bounds.height / image.size.height)
    let size = CGSize(width: image.size.width * fit, height: image.size.height * fit)
    imageView.frame = CGRect(origin: .zero, size: size)
    scroll.contentSize = size
    centerImage()
  }

  private func centerImage() {
    let horizontal = max(0, (scroll.bounds.width - scroll.contentSize.width) / 2)
    let vertical = max(0, (scroll.bounds.height - scroll.contentSize.height) / 2)
    scroll.contentInset = UIEdgeInsets(top: vertical, left: horizontal, bottom: vertical, right: horizontal)
  }

  @objc private func handleSingleTap(_ gesture: UITapGestureRecognizer) {
    if !dismissing { onTap([:]) }
  }
  @objc private func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
    if scroll.zoomScale > 1.05 {
      scroll.setZoomScale(1, animated: true)
      return
    }
    let point = gesture.location(in: imageView)
    let width = scroll.bounds.width / Self.doubleTapZoom
    let height = scroll.bounds.height / Self.doubleTapZoom
    scroll.zoom(to: CGRect(x: point.x - width / 2, y: point.y - height / 2, width: width, height: height), animated: true)
  }

  func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

  func scrollViewDidZoom(_ scrollView: UIScrollView) { centerImage() }

  func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
    load(detail: true)
  }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    guard scrollView.zoomScale <= 1.01, !dismissing else { imageView.alpha = 1; return }
    let pull = max(0, -(scrollView.contentOffset.y + scrollView.contentInset.top))
    imageView.alpha = 1 - min(0.6, pull / max(1, bounds.height) * 1.2)
  }

  func scrollViewWillEndDragging(_ scrollView: UIScrollView, withVelocity velocity: CGPoint, targetContentOffset: UnsafeMutablePointer<CGPoint>) {
    guard scrollView.zoomScale <= 1.01, !dismissing else { return }
    let pull = -(scrollView.contentOffset.y + scrollView.contentInset.top)
    guard pull > Self.dismissDistance || (pull > 16 && velocity.y < -1.2) else { return }
    dismissing = true
    targetContentOffset.pointee = scrollView.contentOffset
    UIView.animate(withDuration: 0.18, animations: {
      self.imageView.transform = CGAffineTransform(translationX: 0, y: self.bounds.height)
      self.imageView.alpha = 0
    }, completion: { _ in self.onDismiss([:]) })
  }
}

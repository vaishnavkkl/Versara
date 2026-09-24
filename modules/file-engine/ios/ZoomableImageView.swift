import ExpoModulesCore
import UIKit
import ImageIO

/// Full-screen image preview: decode, zoom, pan and swipe-to-dismiss stay in native code.
final class ZoomableImageView: ExpoView, UIScrollViewDelegate {
  let onLoad = EventDispatcher()
  let onError = EventDispatcher()
  let onDismiss = EventDispatcher()
  private let scroll = UIScrollView()
  private let imageView = UIImageView()
  private var source = ""
  private var ticket = 0
  private var dismissing = false
  private static let dismissDistance: CGFloat = 120
  private static let maxZoom: CGFloat = 5
  private static let doubleTapZoom: CGFloat = 2.5

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
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
    isAccessibilityElement = true
    accessibilityTraits = .image
    accessibilityLabel = "Image preview"
    accessibilityHint = "Pinch or double tap to zoom. Swipe down to close."
  }

  func setSource(_ value: String) {
    guard value != source else { return }
    source = value
    load()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard scroll.frame != bounds else { return }
    scroll.frame = bounds
    scroll.setZoomScale(1, animated: false)
    layoutImage()
    if imageView.image == nil { load() }
  }

  private func load() {
    guard !source.isEmpty, bounds.width > 0, bounds.height > 0 else { return }
    ticket += 1
    let current = ticket
    let uri = source
    let screenScale = window?.screen.scale ?? UIScreen.main.scale
    let lowMemory = ProcessInfo.processInfo.physicalMemory <= 2 * 1024 * 1024 * 1024
    // Twice the screen's longest side keeps zoomed detail sharp without full-resolution decodes.
    let target = min(max(bounds.width, bounds.height) * screenScale * 2, lowMemory ? 2048 : 4096)
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let image = Self.decode(uri: uri, maxPixels: target)
      DispatchQueue.main.async {
        guard let self, current == self.ticket else { return }
        guard let image else {
          self.onError(["message": "This image format could not be previewed on your device."])
          return
        }
        self.imageView.image = image
        self.scroll.setZoomScale(1, animated: false)
        self.layoutImage()
        self.onLoad(["width": image.size.width, "height": image.size.height])
      }
    }
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

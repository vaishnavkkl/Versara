import ExpoModulesCore
import PDFKit

final class PdfEngineView: ExpoView {
  let onLoad = EventDispatcher()
  let onPageChange = EventDispatcher()
  let onZoomChange = EventDispatcher()
  let onError = EventDispatcher()
  var source = ""
  var requestedPage = 0
  var pageRevision = 0
  var vertical = true
  var requestedZoom = 1.0
  var zoomRevision = 0
  var dark = true

  private let pdfView = PDFView()
  private let worker = DispatchQueue(label: "com.versara.pdf.open", qos: .userInitiated)
  private var loadedSource = ""
  private var generation = UUID()
  private var observer: NSObjectProtocol?
  private var zoomObserver: NSObjectProtocol?
  private var applyingZoom = false
  private var zoomNotification: DispatchWorkItem?
  private var lastPageRequest = -1
  private var lastZoomRevision = -1
  private var lastSize = CGSize.zero
  private let scrollThumb = UIView()
  private let thumbPill = UIView()
  private weak var observedScroll: UIScrollView?
  private var scrollObservation: NSKeyValueObservation?
  private var thumbHide: DispatchWorkItem?
  private var draggingThumb = false
  private var thumbStartOffset: CGFloat = 0
  private let badge = UILabel()
  private var badgeHide: DispatchWorkItem?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    pdfView.autoScales = true
    pdfView.displayMode = .singlePageContinuous
    pdfView.displayDirection = .vertical
    pdfView.displaysPageBreaks = true
    pdfView.accessibilityLabel = "PDF document. Pinch to zoom and scroll to read."
    addSubview(pdfView)
    badge.font = .boldSystemFont(ofSize: 13)
    badge.textColor = .white
    badge.textAlignment = .center
    badge.backgroundColor = UIColor(red: 0.105, green: 0.12, blue: 0.165, alpha: 0.8)
    badge.layer.cornerRadius = 15
    badge.clipsToBounds = true
    badge.alpha = 0
    badge.isAccessibilityElement = false
    badge.isUserInteractionEnabled = false
    addSubview(badge)
    scrollThumb.alpha = 0
    scrollThumb.isAccessibilityElement = true
    scrollThumb.accessibilityLabel = "Scroll PDF pages"
    thumbPill.backgroundColor = UIColor(red: 0.32, green: 0.47, blue: 0.91, alpha: 0.94)
    thumbPill.layer.cornerRadius = 7
    thumbPill.isUserInteractionEnabled = false
    scrollThumb.addSubview(thumbPill)
    for y in [19.0, 23.0, 27.0] {
      let grip = UIView(frame: CGRect(x: 16, y: y, width: 6, height: 1.5))
      grip.backgroundColor = .white; grip.layer.cornerRadius = 0.75; grip.isUserInteractionEnabled = false
      scrollThumb.addSubview(grip)
    }
    scrollThumb.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(scrubPages(_:))))
    addSubview(scrollThumb)
    observer = NotificationCenter.default.addObserver(
      forName: .PDFViewPageChanged, object: pdfView, queue: .main
    ) { [weak self] _ in self?.reportPage() }
    zoomObserver = NotificationCenter.default.addObserver(
      forName: .PDFViewScaleChanged, object: pdfView, queue: .main
    ) { [weak self] _ in self?.reportZoom() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    pdfView.frame = bounds
    updateScrollThumb(reveal: false)
    if bounds.size != lastSize {
      lastSize = bounds.size
      applyZoom()
    }
  }

  func applyProps() {
    let display: PDFDisplayMode = vertical ? .singlePageContinuous : .singlePage
    if pdfView.displayMode != display {
      let page = pdfView.currentPage
      pdfView.displayMode = display
      if let page { pdfView.go(to: page) }
      applyZoom()
    }
    pdfView.backgroundColor = dark
      ? UIColor.black
      : UIColor(red: 244.0 / 255, green: 245.0 / 255, blue: 253.0 / 255, alpha: 1)
    configureScrolling()
    if source != loadedSource {
      openDocument()
      return
    }
    applyPageAndZoom()
  }

  private func openDocument() {
    loadedSource = source
    let ticket = UUID()
    generation = ticket
    pdfView.document = nil
    lastPageRequest = -1
    lastZoomRevision = -1
    guard let url = URL(string: source), url.isFileURL else {
      onError(["code": "PDF_INVALID_URI", "message": "Choose a PDF stored on this device."])
      return
    }
    // Parsing and file access run off the main/React Native threads. No file bytes cross JS.
    worker.async { [weak self] in
      autoreleasepool {
        let document = PDFDocument(url: url)
        DispatchQueue.main.async { [weak self] in
          guard let self, self.generation == ticket else { return }
          guard let document else {
            self.onError(["code": "PDF_INVALID_DOCUMENT", "message": "This file could not be opened as a PDF."])
            return
          }
          guard !document.isLocked else {
            self.onError(["code": "PDF_PASSWORD_REQUIRED", "message": "This PDF is password protected. Open an unlocked copy."])
            return
          }
          guard document.pageCount > 0 else {
            self.onError(["code": "PDF_EMPTY_DOCUMENT", "message": "This PDF has no readable pages."])
            return
          }
          self.pdfView.document = document
          self.configureScrolling()
          self.onLoad(["pageCount": document.pageCount])
          self.applyPageAndZoom()
          self.reportPage()
        }
      }
    }
  }

  private func applyPageAndZoom() {
    guard let document = pdfView.document else { return }
    if pageRevision != lastPageRequest {
      lastPageRequest = pageRevision
      let index = min(max(0, requestedPage), document.pageCount - 1)
      if let page = document.page(at: index), pdfView.currentPage !== page {
        pdfView.go(to: page)
      }
    }
    if zoomRevision != lastZoomRevision {
      lastZoomRevision = zoomRevision
      applyZoom()
    }
  }

  private func applyZoom() {
    guard pdfView.document != nil, bounds.width > 0, bounds.height > 0 else { return }
    let fit = pdfView.scaleFactorForSizeToFit
    guard fit.isFinite, fit > 0 else { return }
    zoomNotification?.cancel()
    applyingZoom = true
    pdfView.minScaleFactor = fit
    pdfView.maxScaleFactor = fit * 5
    pdfView.scaleFactor = fit * CGFloat(min(max(requestedZoom, 1), 5))
    applyingZoom = false
  }

  private func reportZoom() {
    guard !applyingZoom, pdfView.document != nil else { return }
    let fit = pdfView.scaleFactorForSizeToFit
    guard fit.isFinite, fit > 0 else { return }
    let zoom = min(max(Double(pdfView.scaleFactor / fit), 1), 5)
    // Publish after the native gesture settles. JS updates must never drive a pinch frame.
    zoomNotification?.cancel()
    let notification = DispatchWorkItem { [weak self] in self?.onZoomChange(["zoom": zoom]) }
    zoomNotification = notification
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.08, execute: notification)
  }

  private func reportPage() {
    guard let document = pdfView.document, let page = pdfView.currentPage else { return }
    let index = document.index(for: page)
    onPageChange(["page": index, "pageCount": document.pageCount])
    showBadge(index: index, count: document.pageCount)
  }

  /// PDFKit's own scroll view: keep its draggable indicator visible for fast scrolling.
  private func configureScrolling() {
    guard let scroll = pdfView.documentView?.superview as? UIScrollView else { return }
    scroll.showsVerticalScrollIndicator = false
    scroll.decelerationRate = .normal
    if observedScroll !== scroll {
      scrollObservation?.invalidate()
      observedScroll = scroll
      scrollObservation = scroll.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
        self?.updateScrollThumb(reveal: true)
      }
    }
    updateScrollThumb(reveal: false)
  }

  private func updateScrollThumb(reveal: Bool) {
    guard vertical, let scroll = observedScroll, scroll.contentSize.height > scroll.bounds.height else {
      scrollThumb.isHidden = true; return
    }
    scrollThumb.isHidden = false
    let range = max(1, scroll.contentSize.height - scroll.bounds.height)
    let progress = min(1, max(0, scroll.contentOffset.y / range))
    let travel = max(0, bounds.height - 72)
    scrollThumb.frame = CGRect(x: bounds.width - 32, y: 12 + travel * progress, width: 32, height: 48)
    thumbPill.frame = CGRect(x: 12, y: 2, width: 14, height: 44)
    if reveal {
      thumbHide?.cancel(); scrollThumb.layer.removeAllAnimations(); scrollThumb.alpha = 1
      if !draggingThumb { scheduleThumbHide() }
    }
  }

  private func scheduleThumbHide() {
    thumbHide?.cancel()
    let hide = DispatchWorkItem { [weak self] in
      guard let self, !self.draggingThumb else { return }
      UIView.animate(withDuration: 0.18) { self.scrollThumb.alpha = 0 }
    }
    thumbHide = hide
    DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: hide)
  }

  @objc private func scrubPages(_ gesture: UIPanGestureRecognizer) {
    guard let scroll = observedScroll else { return }
    switch gesture.state {
    case .began:
      draggingThumb = true; thumbHide?.cancel(); thumbStartOffset = scroll.contentOffset.y
    case .changed:
      let range = max(0, scroll.contentSize.height - scroll.bounds.height)
      let delta = gesture.translation(in: self).y / max(1, bounds.height - 72) * range
      scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: min(range, max(0, thumbStartOffset + delta))), animated: false)
    case .ended, .cancelled, .failed:
      draggingThumb = false; scheduleThumbHide()
    default: break
    }
  }

  private func showBadge(index: Int, count: Int) {
    guard vertical, count > 1, window != nil else { return }
    badge.text = "  \(index + 1) / \(count)  "
    badge.sizeToFit()
    badge.frame = CGRect(x: (bounds.width - badge.bounds.width - 16) / 2, y: 12, width: badge.bounds.width + 16, height: 30)
    badgeHide?.cancel()
    UIView.animate(withDuration: 0.12) { self.badge.alpha = 1 }
    let hide = DispatchWorkItem { [weak self] in UIView.animate(withDuration: 0.25) { self?.badge.alpha = 0 } }
    badgeHide = hide
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: hide)
  }

  deinit {
    thumbHide?.cancel(); scrollObservation?.invalidate()
    zoomNotification?.cancel()
    badgeHide?.cancel()
    if let observer { NotificationCenter.default.removeObserver(observer) }
    if let zoomObserver { NotificationCenter.default.removeObserver(zoomObserver) }
    // PDFKit releases its document and tiles with the view. Pending opens hold only a weak reference.
  }
}

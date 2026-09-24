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

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    pdfView.autoScales = true
    pdfView.displayMode = .singlePageContinuous
    pdfView.displayDirection = .vertical
    pdfView.displaysPageBreaks = true
    pdfView.accessibilityLabel = "PDF document. Pinch to zoom and scroll to read."
    addSubview(pdfView)
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
    onPageChange(["page": document.index(for: page), "pageCount": document.pageCount])
  }

  deinit {
    zoomNotification?.cancel()
    if let observer { NotificationCenter.default.removeObserver(observer) }
    if let zoomObserver { NotificationCenter.default.removeObserver(zoomObserver) }
    // PDFKit releases its document and tiles with the view. Pending opens hold only a weak reference.
  }
}

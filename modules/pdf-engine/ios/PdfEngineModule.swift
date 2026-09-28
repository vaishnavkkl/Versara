import ExpoModulesCore
import PDFKit

public class PdfEngineModule: Module {
  private let converter = ImagePdfConverter()
  private let organizer = PdfOrganizer()
  private let textEditor = PdfTextEditor()
  private let thumbnails = FileThumbnailer()
  private let advanced = PdfAdvancedTools()
  public func definition() -> ModuleDefinition {
    Name("PdfEngine")
    Events("onConversionProgress")
    Constant("nativeAdvancedToolsVersion") { 2 }
    AsyncFunction("processPdf") { (id: String, request: String, promise: Promise) in
      self.advanced.run(id, request: request, promise: promise) { [weak self] completed, total in
        self?.sendEvent("onConversionProgress", ["jobId": id, "completed": completed, "total": total])
      }
    }
    Function("cancelPdfTool") { (id: String) in self.advanced.cancel(id) }
    AsyncFunction("renderFileThumbnail") { (id: String, uri: String, kind: String, page: Int, output: String, promise: Promise) in
      self.thumbnails.render(id, uri: uri, kind: kind, page: page, outputUri: output, promise: promise)
    }
    Function("cancelThumbnail") { (id: String) in self.thumbnails.cancel(id) }
    AsyncFunction("editPdfText") { (id: String, request: String, promise: Promise) in
      self.textEditor.run(id, request: request, progress: { [weak self] completed, total in
        self?.sendEvent("onConversionProgress", ["jobId": id, "completed": completed, "total": total])
      }, completion: { result, code, message in
        if let code = code { promise.reject(code, message ?? "Could not edit this PDF.") }
        else { promise.resolve(result) }
      })
    }
    Function("cancelTextEdit") { (id: String) in self.textEditor.cancel(id) }
    AsyncFunction("imagesToPdf") { (options: ImagePdfOptions, promise: Promise) in
      self.converter.start(options, promise: promise) { [weak self] completed, total in
        self?.sendEvent("onConversionProgress", ["jobId": options.jobId, "completed": completed, "total": total])
      }
    }
    Function("cancelConversion") { (id: String) in self.converter.cancel(id) }
    AsyncFunction("inspectPdfs") { (id: String, uris: [String], promise: Promise) in self.organizer.inspect(id, uris: uris, promise: promise) }
    AsyncFunction("organizePdfs") { (options: PdfOrganizeOptions, promise: Promise) in
      self.organizer.organize(options, promise: promise) { [weak self] completed, total in
        self?.sendEvent("onConversionProgress", ["jobId": options.jobId, "completed": completed, "total": total])
      }
    }
    Function("cancelPdfJob") { (id: String) in self.organizer.cancel(id) }
    OnDestroy { self.converter.destroy(); self.organizer.destroy(); self.textEditor.destroy(); self.thumbnails.destroy(); self.advanced.destroy() }
    // Keep the reader as the default for older JavaScript bundles.
    View(PdfEngineView.self) {
      Events("onLoad", "onPageChange", "onZoomChange", "onError")
      Prop("uri") { (view: PdfEngineView, uri: String) in view.source = uri }
      Prop("page") { (view: PdfEngineView, page: Int) in view.requestedPage = page }
      Prop("pageRevision") { (view: PdfEngineView, revision: Int) in view.pageRevision = revision }
      Prop("vertical") { (view: PdfEngineView, vertical: Bool) in view.vertical = vertical }
      Prop("zoom") { (view: PdfEngineView, zoom: Double) in view.requestedZoom = zoom }
      Prop("zoomRevision") { (view: PdfEngineView, revision: Int) in view.zoomRevision = revision }
      Prop("dark") { (view: PdfEngineView, dark: Bool) in view.dark = dark }
      OnViewDidUpdateProps { (view: PdfEngineView) in view.applyProps() }
    }
    View(PdfMarkupView.self) {
      Events("onMark")
      Prop("source") { (view: PdfMarkupView, value: String) in view.setSource(value) }
      Prop("marks") { (view: PdfMarkupView, value: String) in view.setMarks(value) }
      Prop("mode") { (view: PdfMarkupView, value: String) in view.mode = value }
      Prop("inkColor") { (view: PdfMarkupView, value: String) in view.inkColor = value }
      Prop("fillColor") { (view: PdfMarkupView, value: String) in view.fillColor = value }
      Prop("shapePath") { (view: PdfMarkupView, value: String) in view.shapePath = value }
      Prop("inkWidth") { (view: PdfMarkupView, value: Double) in view.inkWidth = value }
      Prop("brush") { (view: PdfMarkupView, value: String) in view.brush = value }
      Prop("pattern") { (view: PdfMarkupView, value: String) in view.pattern = value }
      Prop("disabled") { (view: PdfMarkupView, value: Bool) in view.disabled = value }
      OnViewDestroys { (view: PdfMarkupView) in view.dispose() }
    }
    View(PdfEditCanvasView.self) {
      Events("onSelectObject", "onPlace", "onTextChange", "onSubmitText")
      Prop("source") { (view: PdfEditCanvasView, value: String) in view.setSource(value) }
      Prop("pageLayout") { (view: PdfEditCanvasView, value: String) in view.setPageLayout(value) }
      Prop("objects") { (view: PdfEditCanvasView, value: String) in view.setObjects(value) }
      Prop("selectedId") { (view: PdfEditCanvasView, value: Int) in view.setSelectedId(value) }
      Prop("adding") { (view: PdfEditCanvasView, value: Bool) in view.setAdding(value) }
      Prop("disabled") { (view: PdfEditCanvasView, value: Bool) in view.setDisabled(value) }
      Prop("placement") { (view: PdfEditCanvasView, value: String) in view.setPlacement(value) }
      Prop("textBox") { (view: PdfEditCanvasView, value: String) in view.setTextBox(value) }
      Prop("annotations") { (view: PdfEditCanvasView, value: String) in view.setAnnotations(value) }
      Prop("focus") { (view: PdfEditCanvasView, value: String) in view.setFocus(value) }
      OnViewDestroys { (view: PdfEditCanvasView) in view.dispose() }
    }
    Constant("nativeEditCanvasVersion") { 2 }
  }
}

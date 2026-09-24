package expo.modules.pdfengine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PdfEngineModule : Module() {
  private val converter = ImagePdfConverter()
  private val organizer = PdfOrganizer()
  private val textEditor = PdfTextEditor()
  private val thumbnails = FileThumbnailer()
  override fun definition() = ModuleDefinition {
    Name("PdfEngine")
    Events("onConversionProgress")
    AsyncFunction("renderFileThumbnail") { id: String, uri: String, kind: String, page: Int, output: String, promise: expo.modules.kotlin.Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject("THUMBNAIL_UNAVAILABLE", "Preview unavailable.", null)
      else thumbnails.render(context, id, uri, kind, page, output, promise)
    }
    Function("cancelThumbnail") { id: String -> thumbnails.cancel(id) }
    AsyncFunction("editPdfText") { id: String, request: String, promise: expo.modules.kotlin.Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject("PDF_UNAVAILABLE", "The app is not ready.", null)
      else textEditor.run(context, id, request, promise) { completed, total ->
        sendEvent("onConversionProgress", mapOf("jobId" to id, "completed" to completed, "total" to total))
      }
    }
    Function("cancelTextEdit") { id: String -> textEditor.cancel(id) }
    AsyncFunction("imagesToPdf") { options: ImagePdfOptions, promise: expo.modules.kotlin.Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject("PDF_UNAVAILABLE", "The app is not ready.", null)
      else converter.start(context, options, promise) { completed, total ->
        sendEvent("onConversionProgress", mapOf("jobId" to options.jobId, "completed" to completed, "total" to total))
      }
    }
    Function("cancelConversion") { id: String -> converter.cancel(id) }
    AsyncFunction("inspectPdfs") { id: String, uris: List<String>, promise: expo.modules.kotlin.Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject("PDF_UNAVAILABLE", "The app is not ready.", null)
      else organizer.inspect(context, id, uris, promise)
    }
    AsyncFunction("organizePdfs") { options: PdfOrganizeOptions, promise: expo.modules.kotlin.Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject("PDF_UNAVAILABLE", "The app is not ready.", null)
      else organizer.organize(context, options, promise) { completed, total ->
        sendEvent("onConversionProgress", mapOf("jobId" to options.jobId, "completed" to completed, "total" to total))
      }
    }
    Function("cancelPdfJob") { id: String -> organizer.cancel(id) }
    OnDestroy { converter.destroy(); organizer.destroy(); textEditor.destroy(); thumbnails.destroy() }
    View(PdfEngineView::class) {
      Events("onLoad", "onPageChange", "onZoomChange", "onError")
      Prop("uri") { view: PdfEngineView, uri: String -> view.source = uri }
      Prop("page") { view: PdfEngineView, page: Int -> view.requestedPage = page }
      Prop("pageRevision") { view: PdfEngineView, revision: Int -> view.pageRevision = revision }
      Prop("vertical") { view: PdfEngineView, vertical: Boolean -> view.vertical = vertical }
      Prop("zoom") { view: PdfEngineView, zoom: Double -> view.requestedZoom = zoom.toFloat() }
      Prop("zoomRevision") { view: PdfEngineView, revision: Int -> view.zoomRevision = revision }
      Prop("dark") { view: PdfEngineView, dark: Boolean -> view.dark = dark }
      OnViewDidUpdateProps { view: PdfEngineView -> view.applyProps() }
      OnViewDestroys { view: PdfEngineView -> view.dispose() }
    }
    View(PdfEditCanvasView::class) {
      Events("onSelectObject", "onPlace", "onTextChange", "onSubmitText")
      Prop("source") { view: PdfEditCanvasView, value: String -> view.setSource(value) }
      Prop("pageLayout") { view: PdfEditCanvasView, value: String -> view.setPageLayout(value) }
      Prop("objects") { view: PdfEditCanvasView, value: String -> view.setObjects(value) }
      Prop("selectedId") { view: PdfEditCanvasView, value: Int -> view.setSelectedId(value) }
      Prop("adding") { view: PdfEditCanvasView, value: Boolean -> view.setAdding(value) }
      Prop("disabled") { view: PdfEditCanvasView, value: Boolean -> view.setDisabled(value) }
      Prop("placement") { view: PdfEditCanvasView, value: String -> view.setPlacement(value) }
      Prop("textBox") { view: PdfEditCanvasView, value: String -> view.setTextBox(value) }
      Prop("annotations") { view: PdfEditCanvasView, value: String -> view.setAnnotations(value) }
      Prop("focus") { view: PdfEditCanvasView, value: String -> view.setFocus(value) }
      OnViewDestroys { view: PdfEditCanvasView -> view.dispose() }
    }
    Constant("nativeEditCanvasVersion") { 2 }
  }
}

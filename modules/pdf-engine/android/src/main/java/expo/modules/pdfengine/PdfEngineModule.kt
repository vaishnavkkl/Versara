package expo.modules.pdfengine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PdfEngineModule : Module() {
  private val converter = ImagePdfConverter()
  private val organizer = PdfOrganizer()
  private val textEditor = PdfTextEditor()
  private val thumbnails = FileThumbnailer()
  private val advanced = PdfAdvancedTools()
  override fun definition() = ModuleDefinition {
    Name("PdfEngine")
    Events("onConversionProgress")
    Constant("nativeAdvancedToolsVersion") { 2 }
    Constant("nativePdfPrivacyVersion") { 1 }
    Constant("nativeSignatureImageVersion") { 1 }
    Constant("nativeStrokePatternsVersion") { 1 }
    Constant("nativeMarkupZoomVersion") { 1 }
    Constant("nativeMarkupPanVersion") { 1 }
    Constant("nativeReaderSearchVersion") { 1 }
    Constant("nativeFindReplaceVersion") { 1 }
    Constant("nativeReaderFocusVersion") { 1 }
    Constant("nativeSearchableOcrVersion") { 1 }
    Constant("nativeMarkupEditingVersion") { 1 }
    Constant("nativeAnnotationsVersion") { 1 }
    AsyncFunction("processPdf") { id: String, request: String, promise: expo.modules.kotlin.Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject("PDF_UNAVAILABLE", "The app is not ready.", null)
      else advanced.run(context, id, request, promise) { completed, total ->
        sendEvent("onConversionProgress", mapOf("jobId" to id, "completed" to completed, "total" to total))
      }
    }
    Function("cancelPdfTool") { id: String -> advanced.cancel(id) }
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
    OnDestroy { converter.destroy(); organizer.destroy(); textEditor.destroy(); thumbnails.destroy(); advanced.destroy() }
    // Keep the reader as the default for older JavaScript bundles.
    View(PdfEngineView::class) {
      Events("onLoad", "onPageChange", "onZoomChange", "onError")
      Prop("uri") { view: PdfEngineView, uri: String -> view.source = uri }
      Prop("page") { view: PdfEngineView, page: Int -> view.requestedPage = page }
      Prop("pageRevision") { view: PdfEngineView, revision: Int -> view.pageRevision = revision }
      Prop("vertical") { view: PdfEngineView, vertical: Boolean -> view.vertical = vertical }
      Prop("zoom") { view: PdfEngineView, zoom: Double -> view.requestedZoom = zoom.toFloat() }
      Prop("zoomRevision") { view: PdfEngineView, revision: Int -> view.zoomRevision = revision }
      Prop("dark") { view: PdfEngineView, dark: Boolean -> view.dark = dark }
      Prop("focusCurrent") { view: PdfEngineView, value: Boolean -> view.focusCurrent = value }
      Prop("searchHighlights") { view: PdfEngineView, value: String -> view.setSearchHighlights(value) }
      OnViewDidUpdateProps { view: PdfEngineView -> view.applyProps() }
      OnViewDestroys { view: PdfEngineView -> view.dispose() }
    }
    View(PdfMarkupView::class) {
      Events("onMark", "onSelection", "onZoom", "onPageSwipe")
      Prop("source") { view: PdfMarkupView, value: String -> view.setSource(value) }
      Prop("zoomRequest") { view: PdfMarkupView, value: String -> view.requestZoom(value) }
      Prop("marks") { view: PdfMarkupView, value: String -> view.setMarks(value) }
      Prop("mode") { view: PdfMarkupView, value: String -> view.mode = value }
      Prop("inkColor") { view: PdfMarkupView, value: String -> view.inkColor = value }
      Prop("fillColor") { view: PdfMarkupView, value: String -> view.fillColor = value }
      Prop("shapePath") { view: PdfMarkupView, value: String -> view.shapePath = value }
      Prop("inkWidth") { view: PdfMarkupView, value: Double -> view.inkWidth = value }
      Prop("inkOpacity") { view: PdfMarkupView, value: Double -> view.inkOpacity = value }
      Prop("brush") { view: PdfMarkupView, value: String -> view.brush = value }
      Prop("pattern") { view: PdfMarkupView, value: String -> view.pattern = value }
      Prop("disabled") { view: PdfMarkupView, value: Boolean -> view.disabled = value }
      OnViewDestroys { view: PdfMarkupView -> view.dispose() }
    }
    View(PdfEditCanvasView::class) {
      Events("onSelectObject", "onPlace", "onTextChange", "onSubmitText")
      Prop("source") { view: PdfEditCanvasView, value: String -> view.setSource(value) }
      Prop("pageLayout") { view: PdfEditCanvasView, value: String -> view.setPageLayout(value) }
      Prop("objects") { view: PdfEditCanvasView, value: String -> view.setObjects(value) }
      Prop("selectedId") { view: PdfEditCanvasView, value: Int -> view.setSelectedId(value) }
      Prop("markedIds") { view: PdfEditCanvasView, value: String -> view.setMarkedIds(value) }
      Prop("adding") { view: PdfEditCanvasView, value: Boolean -> view.setAdding(value) }
      Prop("disabled") { view: PdfEditCanvasView, value: Boolean -> view.setDisabled(value) }
      Prop("placement") { view: PdfEditCanvasView, value: String -> view.setPlacement(value) }
      Prop("textBox") { view: PdfEditCanvasView, value: String -> view.setTextBox(value) }
      Prop("annotations") { view: PdfEditCanvasView, value: String -> view.setAnnotations(value) }
      Prop("focus") { view: PdfEditCanvasView, value: String -> view.setFocus(value) }
      OnViewDestroys { view: PdfEditCanvasView -> view.dispose() }
    }
    Constant("nativeEditCanvasVersion") { 3 }
  }
}

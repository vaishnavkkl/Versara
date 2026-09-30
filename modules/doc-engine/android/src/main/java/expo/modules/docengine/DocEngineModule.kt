package expo.modules.docengine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DocEngineModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DocEngine")
    Constant("nativeDocEditorVersion") { 3 }
    Constant("nativeCokitAvailable") { NativeCokit.available() }
    View(DocEditorView::class) {
      Events("onReady", "onDocChange", "onError", "onFormat", "onBand")
      Prop("source") { view: DocEditorView, value: String -> view.sourceProp = value }
      Prop("format") { view: DocEditorView, value: String -> view.formatProp = value }
      Prop("blank") { view: DocEditorView, value: Boolean -> view.blankProp = value }
      Prop("dark") { view: DocEditorView, value: Boolean -> view.darkProp = value }
      Prop("ruler") { view: DocEditorView, value: Boolean -> view.rulerProp = value }
      Prop("pages") { view: DocEditorView, value: Boolean -> view.pagesProp = value }
      OnViewDidUpdateProps { view: DocEditorView -> view.applyProps() }
      OnViewDestroys { view: DocEditorView -> view.dispose() }
    }
    AsyncFunction("command") { name: String, value: String -> editor().command(name, value) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("insertImage") { path: String -> editor().insertImage(path) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("resizeImage") { percent: Int -> editor().resizeImage(percent) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("setHeaderFooter") { value: String -> editor().setHeaderFooter(value) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("setSection") { index: Int -> editor().setSection(index) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("save") { output: String -> editor().save(output) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("setPage") { value: String -> editor().setPage(value) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("exportPdf") { output: String -> editor().exportPdf(output) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("exportText") { output: String -> editor().exportText(output) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    Function("discard") { DocEditors.active?.discard() }
    OnDestroy { DocEditors.active = null }
  }
  private fun editor(): DocEditorView = DocEditors.active ?: throw IllegalStateException("Open a document first.")
}

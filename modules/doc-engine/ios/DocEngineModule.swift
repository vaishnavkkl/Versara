import ExpoModulesCore

public class DocEngineModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DocEngine")
    Constant("nativeDocEditorVersion") { 3 }
    Constant("nativeCokitAvailable") { CokitBridge.isAvailable() }
    View(DocEditorView.self) {
      Events("onReady", "onDocChange", "onError", "onFormat", "onBand")
      Prop("source") { (view: DocEditorView, value: String) in view.sourceProp = value }
      Prop("format") { (view: DocEditorView, value: String) in view.formatProp = value }
      Prop("blank") { (view: DocEditorView, value: Bool) in view.blankProp = value }
      Prop("dark") { (view: DocEditorView, dark: Bool) in view.darkProp = dark }
      Prop("ruler") { (view: DocEditorView, value: Bool) in view.rulerProp = value }
      Prop("pages") { (view: DocEditorView, value: Bool) in view.pagesProp = value }
      OnViewDidUpdateProps { (view: DocEditorView) in view.applyProps() }
      OnViewDestroys { (view: DocEditorView) in view.dispose() }
    }
    AsyncFunction("command") { (name: String, value: String) in try DocSession.editor().command(name, value: value) }.runOnQueue(.main)
    AsyncFunction("insertImage") { (path: String) in try DocSession.editor().insertImage(path) }.runOnQueue(.main)
    AsyncFunction("resizeImage") { (percent: Int) in try DocSession.editor().resizeImage(percent) }.runOnQueue(.main)
    AsyncFunction("setHeaderFooter") { (value: String) in try DocSession.editor().setHeaderFooter(value) }.runOnQueue(.main)
    AsyncFunction("setSection") { (index: Int) in try DocSession.editor().setSection(index) }.runOnQueue(.main)
    AsyncFunction("save") { (output: String) in try DocSession.editor().save(output) }.runOnQueue(.main)
    AsyncFunction("setPage") { (value: String) in try DocSession.editor().setPage(value) }.runOnQueue(.main)
    AsyncFunction("exportPdf") { (output: String) in try DocSession.editor().exportPdf(output) }.runOnQueue(.main)
    AsyncFunction("exportText") { (output: String) in try DocSession.editor().exportText(output) }.runOnQueue(.main)
    Function("discard") { DispatchQueue.main.async { DocSession.active?.discard() } }
    OnDestroy { DocSession.active = nil }
  }
}

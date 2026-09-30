package expo.modules.docengine

internal class NativeDoc {
  companion object {
    init { System.loadLibrary("versara_doc") }
    private val gate = Any()
    @JvmStatic external fun run(request: String): String
    fun call(request: String) = synchronized(gate) { run(request) }
  }
}

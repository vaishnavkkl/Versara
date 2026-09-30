package expo.modules.docengine

import android.content.res.AssetManager
import android.graphics.Bitmap

/** One worker thread owns a COKit session. Never call these methods on the UI thread. */
internal object NativeCokit {
  init { System.loadLibrary("versara_doc") }

  external fun available(): Boolean
  external fun prepare(dataDir: String, cacheDir: String, apkFile: String, assets: AssetManager): Boolean
  external fun open(installPath: String, profileUrl: String, inputUrl: String): Long
  external fun close(handle: Long)
  external fun size(handle: Long): IntArray
  external fun pageRectangles(handle: Long): String
  external fun paint(handle: Long, x: Int, y: Int, width: Int, height: Int, bitmap: Bitmap): Boolean
  external fun uno(handle: Long, command: String, arguments: String): Boolean
  external fun key(handle: Long, type: Int, character: Int, keyCode: Int): Boolean
  external fun mouse(handle: Long, type: Int, x: Int, y: Int, clicks: Int, buttons: Int, modifiers: Int): Boolean
  external fun save(handle: Long, outputUrl: String, format: String): Boolean
  external fun nextEvent(handle: Long): Array<String>?
}

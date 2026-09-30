package expo.modules.docengine

import android.content.Context
import android.content.res.AssetManager
import java.io.File

/** Prepares the exact runtime files packaged with the COKit binary. Call from its worker thread. */
internal object CokitRuntime {
  private const val revision = "5ae1c42aee3b09be881c5a3a97c0581f63404505"
  private val lock = Any()
  private var initialized = false

  fun prepare(context: Context): File {
    check(NativeCokit.available()) { "The offline document engine is not bundled in this build." }
    val app = context.applicationContext
    synchronized(lock) {
      val data = File(app.applicationInfo.dataDir)
      val marker = File(data, "versara-cokit-$revision.ready")
      if (!marker.isFile || !File(data, "program/sofficerc").isFile) {
        copyAssets(app.assets, "unpack", data)
        check(File(data, "program/sofficerc").isFile) {
          "The document engine bootstrap files were not installed."
        }
        marker.writeText(revision)
      }
      if (!initialized) {
        check(NativeCokit.prepare(data.absolutePath, app.cacheDir.absolutePath,
          app.packageResourcePath, app.assets)) { "Could not initialize the offline document engine." }
        initialized = true
      }
      return data
    }
  }

  private fun copyAssets(assets: AssetManager, path: String, target: File) {
    val children = assets.list(path) ?: error("Missing document engine assets: $path")
    check(children.isNotEmpty()) { "Missing document engine assets: $path" }
    target.mkdirs()
    for (name in children) {
      check(name.isNotEmpty() && name != "." && name != ".." && '/' !in name && '\\' !in name)
      val assetPath = "$path/$name"
      val destination = File(target, name)
      val nested = assets.list(assetPath) ?: emptyArray()
      if (nested.isNotEmpty()) {
        copyAssets(assets, assetPath, destination)
      } else {
        destination.parentFile?.mkdirs()
        val temporary = File(destination.parentFile, "$name.versara-part")
        try {
          assets.open(assetPath).use { input -> temporary.outputStream().use { output -> input.copyTo(output) } }
          if (destination.exists()) check(destination.delete())
          check(temporary.renameTo(destination)) { "Could not install document engine asset: $name" }
        } finally {
          if (temporary.exists()) temporary.delete()
        }
      }
    }
  }
}

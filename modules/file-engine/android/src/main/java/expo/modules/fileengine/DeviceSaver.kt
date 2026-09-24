package expo.modules.fileengine

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.InputStream
import java.io.OutputStream

/** Writes app files into shared device folders (Download/Pictures/Movies/Music › Versara) so other apps can see them. */
internal object DeviceSaver {
  private const val FOLDER = "Versara"

  fun save(context: Context, sourceUri: String, requestedName: String, mimeType: String, replaceUri: String): Map<String, Any?> {
    val source = Uri.parse(sourceUri)
    require(source.scheme == "file") { "Only app files can be saved to the device." }
    val input = File(requireNotNull(source.path)).canonicalFile
    require(input.path.startsWith(context.filesDir.canonicalPath + "/") || input.path.startsWith(context.cacheDir.canonicalPath + "/")) { "Only app files can be saved to the device." }
    require(input.isFile && input.length() > 0) { "This file is empty or missing." }
    val name = requestedName.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]"), "_").trim().take(120).ifEmpty { input.name }
    val directory = when {
      mimeType.startsWith("image/") -> Environment.DIRECTORY_PICTURES
      mimeType.startsWith("video/") -> Environment.DIRECTORY_MOVIES
      mimeType.startsWith("audio/") -> Environment.DIRECTORY_MUSIC
      else -> Environment.DIRECTORY_DOWNLOADS
    }
    return if (Build.VERSION.SDK_INT >= 29) saveScoped(context, input, name, mimeType, directory, replaceUri)
    else saveLegacy(context, input, name, mimeType, directory, replaceUri)
  }

  private fun collection(directory: String): Uri = when (directory) {
    Environment.DIRECTORY_PICTURES -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    Environment.DIRECTORY_MOVIES -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    Environment.DIRECTORY_MUSIC -> MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    else -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
  }

  private fun saveScoped(context: Context, input: File, name: String, mimeType: String, directory: String, replaceUri: String): Map<String, Any?> {
    val resolver = context.contentResolver
    if (replaceUri.startsWith("content://")) {
      val target = Uri.parse(replaceUri)
      val replaced = runCatching {
        resolver.openOutputStream(target, "wt")?.use { output -> input.inputStream().use { copy(it, output) } } ?: error("missing")
        resolver.update(target, ContentValues().apply { put(MediaStore.MediaColumns.SIZE, input.length()) }, null, null)
        true
      }.getOrDefault(false)
      if (replaced) return result(target.toString(), displayName(context, target) ?: name, "$directory/$FOLDER", input.length(), mimeType)
    }
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, name)
      put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
      put(MediaStore.MediaColumns.RELATIVE_PATH, "$directory/$FOLDER")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val target = resolver.insert(collection(directory), values) ?: error("Could not create the file on this device.")
    try {
      resolver.openOutputStream(target, "w")?.use { output -> input.inputStream().use { copy(it, output) } } ?: error("Could not write the file on this device.")
      resolver.update(target, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (error: Throwable) {
      runCatching { resolver.delete(target, null, null) }
      throw error
    }
    return result(target.toString(), displayName(context, target) ?: name, "$directory/$FOLDER", input.length(), mimeType)
  }

  @Suppress("DEPRECATION")
  private fun saveLegacy(context: Context, input: File, name: String, mimeType: String, directory: String, replaceUri: String): Map<String, Any?> {
    val folder = File(Environment.getExternalStoragePublicDirectory(directory), FOLDER)
    val previous = if (replaceUri.startsWith("file://")) Uri.parse(replaceUri).path?.let { File(it).canonicalFile } else null
    val target = if (previous != null && previous.parentFile?.canonicalPath == folder.canonicalPath) previous else unique(folder, name)
    try {
      folder.mkdirs()
      target.outputStream().use { output -> input.inputStream().use { copy(it, output) } }
    } catch (error: SecurityException) {
      throw IllegalStateException("Allow storage access for Versara in system Settings to save files.", error)
    }
    MediaScannerConnection.scanFile(context, arrayOf(target.path), arrayOf(mimeType), null)
    return result(Uri.fromFile(target).toString(), target.name, "$directory/$FOLDER", target.length(), mimeType)
  }

  private fun unique(folder: File, name: String): File {
    var file = File(folder, name)
    val dot = name.lastIndexOf('.')
    val base = if (dot > 0) name.substring(0, dot) else name
    val extension = if (dot > 0) name.substring(dot) else ""
    var index = 1
    while (file.exists() && index < 1000) { file = File(folder, "$base ($index)$extension"); index++ }
    return file
  }

  private fun displayName(context: Context, uri: Uri): String? = runCatching {
    context.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
  }.getOrNull()

  private fun copy(input: InputStream, output: OutputStream) {
    val buffer = ByteArray(128 * 1024)
    while (true) {
      val read = input.read(buffer)
      if (read <= 0) break
      output.write(buffer, 0, read)
    }
  }

  private fun result(uri: String, name: String, location: String, size: Long, mimeType: String) =
    mapOf("uri" to uri, "name" to name, "location" to location, "size" to size, "mimeType" to mimeType)
}

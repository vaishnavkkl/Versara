package expo.modules.fileengine

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.system.Os
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.UUID

/** Writes app files into shared device folders (Download/Pictures/Movies/Music › Versara) so other apps can see them. */
internal object DeviceSaver {
  private const val FOLDER = "Versara"
  private const val MAX_BACKUP_BYTES = 512L * 1024 * 1024
  private data class Fingerprint(val size: Long, val hash: String)
  private data class Recovery(val directory: File, val target: Uri, val original: Fingerprint)

  fun save(context: Context, sourceUri: String, requestedName: String, mimeType: String, replaceUri: String): Map<String, Any?> {
    val source = Uri.parse(sourceUri)
    require(source.scheme == "file") { "Only app files can be saved to the device." }
    val input = File(requireNotNull(source.path)).canonicalFile
    require(input.path.startsWith(context.filesDir.canonicalPath + "/") || input.path.startsWith(context.cacheDir.canonicalPath + "/")) { "Only app files can be saved to the device." }
    require(input.isFile && input.length() > 0) { "This file is empty or missing." }
    recoverInterruptedReplacements(context)
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
      require(target.authority == MediaStore.AUTHORITY) { "This saved location cannot be safely replaced. Choose Save as new." }
      val exists = resolver.query(target, arrayOf(MediaStore.MediaColumns.RELATIVE_PATH), null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) false else {
          require(cursor.getString(0)?.trimEnd('/') == "$directory/$FOLDER") { "This saved file is outside Versara's folder. Choose Save as new." }
          true
        }
      } ?: false
      if (exists) {
        val recovery = backupOriginal(context, target)
        try {
          val expected = resolver.openOutputStream(target, "wt")?.use { output -> input.inputStream().use { copy(it, output) } }
            ?: error("Could not open the existing device file for writing.")
          require(fingerprint(context, target) == expected) { "The device copy could not be verified." }
          // MediaStore treats SIZE as read-only and rescans the file when the stream closes, so the
          // update usually changes no rows; the verified fingerprint above is the real success check.
          runCatching { resolver.update(target, ContentValues().apply { put(MediaStore.MediaColumns.SIZE, input.length()) }, null, null) }
          commitRecovery(recovery)
        } catch (cause: Throwable) {
          restoreAfterFailure(context, recovery, cause)
        }
        return result(target.toString(), displayName(context, target) ?: name, "$directory/$FOLDER", input.length(), mimeType)
      }
    }
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, name)
      put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
      put(MediaStore.MediaColumns.RELATIVE_PATH, "$directory/$FOLDER")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val target = resolver.insert(collection(directory), values) ?: error("Could not create the file on this device.")
    try {
      val expected = resolver.openOutputStream(target, "w")?.use { output -> input.inputStream().use { copy(it, output) } } ?: error("Could not write the file on this device.")
      require(fingerprint(context, target) == expected) { "The device copy could not be verified." }
      require(resolver.update(target, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null) > 0) { "Could not publish the saved file." }
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
    var recovery: Recovery? = null
    try {
      require(folder.isDirectory || folder.mkdirs()) { "Could not create the device folder." }
      if (previous != null && target == previous && target.exists()) recovery = backupOriginal(context, Uri.fromFile(target))
      val expected = replaceLocalFile(input, target)
      require(fingerprint(context, Uri.fromFile(target)) == expected) { "The device copy could not be verified." }
      recovery?.let(::commitRecovery)
    } catch (error: SecurityException) {
      recovery?.let { restoreAfterFailure(context, it, error) }
      throw IllegalStateException("Allow storage access for Versara in system Settings to save files.", error)
    } catch (error: Throwable) {
      recovery?.let { restoreAfterFailure(context, it, error) }
      throw error
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
    require(!file.exists()) { "Too many files have this name. Choose another name." }
    return file
  }

  private fun displayName(context: Context, uri: Uri): String? = runCatching {
    context.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
  }.getOrNull()

  private fun copy(input: InputStream, output: OutputStream, limit: Long = Long.MAX_VALUE): Fingerprint {
    val buffer = ByteArray(128 * 1024)
    val digest = MessageDigest.getInstance("SHA-256")
    var size = 0L
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      if (read == 0) continue
      size += read
      require(size <= limit) { "This file is too large for a safe replacement. Choose Save as new." }
      output.write(buffer, 0, read)
      digest.update(buffer, 0, read)
    }
    output.flush()
    if (output is FileOutputStream) output.fd.sync()
    return Fingerprint(size, digest.digest().joinToString("") { "%02x".format(it) })
  }

  private fun openInput(context: Context, uri: Uri): InputStream = if (uri.scheme == "file") File(requireNotNull(uri.path)).inputStream()
    else requireNotNull(context.contentResolver.openInputStream(uri)) { "The existing device file could not be read safely. Choose Save as new." }

  private fun fingerprint(context: Context, uri: Uri): Fingerprint = openInput(context, uri).use { source ->
    copy(source, object : OutputStream() { override fun write(value: Int) {} ; override fun write(bytes: ByteArray, offset: Int, count: Int) {} })
  }

  private fun writeRecovery(recovery: Recovery, committed: Boolean) {
    val file = AtomicFile(File(recovery.directory, "journal.json"))
    val stream = file.startWrite()
    try {
      stream.write(JSONObject().put("version", 1).put("target", recovery.target.toString()).put("size", recovery.original.size).put("hash", recovery.original.hash).put("committed", committed).toString().toByteArray(Charsets.UTF_8))
      file.finishWrite(stream)
    } catch (cause: Throwable) { file.failWrite(stream); throw cause }
  }

  private fun backupOriginal(context: Context, target: Uri): Recovery {
    val root = File(context.noBackupFilesDir, "versara-device-save-recovery")
    require(root.isDirectory || root.mkdirs()) { "Could not create a recovery copy. The original has not been changed." }
    require((root.listFiles()?.size ?: 0) < 4) { "An earlier device save needs recovery. Restore storage access and try again." }
    val directory = File(root, UUID.randomUUID().toString())
    require(directory.mkdir()) { "Could not create a recovery copy. The original has not been changed." }
    try {
      val original = openInput(context, target).use { from -> File(directory, "original").outputStream().use { copy(from, it, MAX_BACKUP_BYTES) } }
      val recovery = Recovery(directory, target, original)
      writeRecovery(recovery, false)
      return recovery
    } catch (cause: Throwable) { directory.deleteRecursively(); throw IllegalStateException("Could not create a safe replacement backup. Choose Save as new or free storage space. The original has not been changed.", cause) }
  }

  /** Same-directory rename avoids truncating an existing filesystem destination. */
  private fun replaceLocalFile(source: File, target: File): Fingerprint {
    val staging = File.createTempFile(".versara-saving-", ".partial", requireNotNull(target.parentFile))
    try {
      val expected = source.inputStream().use { from -> staging.outputStream().use { copy(from, it) } }
      Os.rename(staging.path, target.path)
      return expected
    } finally { staging.delete() }
  }

  private fun restore(context: Context, recovery: Recovery) {
    val backup = File(recovery.directory, "original")
    require(fingerprint(context, Uri.fromFile(backup)) == recovery.original) { "The recovery copy could not be verified." }
    if (recovery.target.scheme == "content") {
      require(recovery.target.authority == MediaStore.AUTHORITY) { "The recovery destination is unsupported." }
      context.contentResolver.openOutputStream(recovery.target, "wt")?.use { out -> backup.inputStream().use { copy(it, out) } }
        ?: error("Could not restore the device file.")
    } else {
      val target = File(requireNotNull(recovery.target.path)).canonicalFile
      @Suppress("DEPRECATION") val parents = listOf(Environment.DIRECTORY_DOWNLOADS, Environment.DIRECTORY_PICTURES, Environment.DIRECTORY_MOVIES, Environment.DIRECTORY_MUSIC)
        .map { File(Environment.getExternalStoragePublicDirectory(it), FOLDER).canonicalPath }
      val parent = target.parentFile?.canonicalPath ?: error("The recovery destination has no folder.")
      require(parent in parents) { "The recovery destination is outside Versara's folders." }
      replaceLocalFile(backup, target)
    }
    require(fingerprint(context, recovery.target) == recovery.original) { "The restored device file could not be verified." }
    commitRecovery(recovery)
  }

  private fun commitRecovery(recovery: Recovery) {
    writeRecovery(recovery, true)
    runCatching { recovery.directory.deleteRecursively() }
  }

  private fun restoreAfterFailure(context: Context, recovery: Recovery, cause: Throwable): Nothing {
    try { restore(context, recovery) }
    catch (restoreError: Throwable) {
      throw IllegalStateException("The device save failed and could not be fully restored. Its original recovery copy is kept on this device. Restore storage access or free space, then save again to retry recovery. ${cause.message.orEmpty()}", restoreError)
    }
    throw IllegalStateException("The device save failed. The original device copy was restored; your Versara original has not been replaced. Try again or choose Save as new. ${cause.message.orEmpty()}", cause)
  }

  private fun recoverInterruptedReplacements(context: Context) {
    val root = File(context.noBackupFilesDir, "versara-device-save-recovery")
    for (directory in root.listFiles().orEmpty()) {
      if (!directory.isDirectory) continue
      val journal = AtomicFile(File(directory, "journal.json"))
      if (!journal.baseFile.exists() && !File(directory, "journal.json.bak").exists()) { directory.deleteRecursively(); continue }
      try {
        val value = journal.openRead().use { JSONObject(it.bufferedReader().readText()) }
        require(value.getInt("version") == 1) { "Unsupported recovery record." }
        if (value.optBoolean("committed")) directory.deleteRecursively()
        else restore(context, Recovery(directory, Uri.parse(value.getString("target")), Fingerprint(value.getLong("size"), value.getString("hash"))))
      } catch (cause: Throwable) { throw IllegalStateException("An interrupted device save needs recovery. Its original copy has been kept. Restore storage access or free space and try saving again.", cause) }
    }
  }

  private fun result(uri: String, name: String, location: String, size: Long, mimeType: String) =
    mapOf("uri" to uri, "name" to name, "location" to location, "size" to size, "mimeType" to mimeType)
}

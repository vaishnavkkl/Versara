package expo.modules.fileengine

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import java.io.File

/** Folder browsing inside shared storage. Metadata only; listings are capped so huge folders stay responsive. */
internal object FileExplorer {
  private const val MAX_ENTRIES = 4000
  private const val MAX_COUNTED_FOLDERS = 400

  private fun storageRoot(): File = Environment.getExternalStorageDirectory().canonicalFile

  fun roots(context: Context): List<Map<String, Any?>> {
    val root = storageRoot()
    val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).canonicalFile
    val stat = try { StatFs(root.path) } catch (_: Throwable) { null }
    return listOf(
      mapOf(
        "id" to "internal", "name" to "Internal storage", "path" to root.path,
        "total" to (stat?.totalBytes ?: 0L), "free" to (stat?.availableBytes ?: 0L),
        "allowed" to PdfDeviceLibrary.allowed(context),
      ),
      mapOf(
        "id" to "downloads", "name" to "Downloads", "path" to downloads.path,
        "total" to 0L, "free" to 0L, "allowed" to PdfDeviceLibrary.allowed(context),
      ),
    )
  }

  fun list(context: Context, path: String, showHidden: Boolean): Map<String, Any?> {
    require(PdfDeviceLibrary.allowed(context)) { "Allow All files access to browse your storage." }
    val root = storageRoot()
    val folder = File(path).canonicalFile
    require(folder.path == root.path || folder.path.startsWith(root.path + "/")) { "This folder is outside your storage." }
    require(folder.isDirectory) { "This folder is no longer available." }
    val children = folder.listFiles() ?: throw IllegalStateException("Versara cannot read this folder.")
    val visible = children.asSequence()
      .filter { showHidden || !it.name.startsWith(".") }
      .sortedWith(compareBy<File>({ !it.isDirectory }, { it.name.lowercase() }))
      .take(MAX_ENTRIES)
      .toList()
    var counted = 0
    val items = visible.map { file ->
      val directory = file.isDirectory
      val count = if (directory && counted++ < MAX_COUNTED_FOLDERS) file.list()?.count { showHidden || !it.startsWith(".") } ?: 0 else -1
      entry(file, directory, count)
    }
    return mapOf(
      "path" to folder.path,
      "parent" to if (folder.path == root.path) null else folder.parentFile?.path,
      "items" to items,
      "truncated" to (children.size > MAX_ENTRIES),
    )
  }

  /** Name search over the system file index; with All files access it covers every indexed file, not only media. */
  fun search(context: Context, query: String, limit: Int): List<Map<String, Any?>> {
    require(PdfDeviceLibrary.allowed(context)) { "Allow All files access to search your storage." }
    val needle = query.trim()
    if (needle.isEmpty()) return emptyList()
    val collection = MediaStore.Files.getContentUri("external")
    @Suppress("DEPRECATION") val dataColumn = MediaStore.Files.FileColumns.DATA
    val projection = arrayOf(MediaStore.Files.FileColumns.DISPLAY_NAME, dataColumn)
    val selection = "${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ? ESCAPE '\\' AND ${MediaStore.Files.FileColumns.SIZE}>0"
    val args = arrayOf("%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    val sort = "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC"
    val results = ArrayList<Map<String, Any?>>(limit)
    val cursor = if (Build.VERSION.SDK_INT >= 30) {
      val queryArgs = android.os.Bundle().apply {
        putString(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
        putStringArray(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args)
        putString(android.content.ContentResolver.QUERY_ARG_SQL_SORT_ORDER, sort)
        putInt(android.content.ContentResolver.QUERY_ARG_LIMIT, limit * 2)
      }
      context.contentResolver.query(collection, projection, queryArgs, null)
    } else context.contentResolver.query(collection, projection, selection, args, "$sort LIMIT ${limit * 2}")
    cursor?.use {
      val dataIndex = it.getColumnIndexOrThrow(dataColumn)
      while (it.moveToNext() && results.size < limit) {
        val filePath = it.getString(dataIndex) ?: continue
        val file = File(filePath)
        if (!file.isFile || file.name.startsWith(".")) continue
        results.add(entry(file, false, -1))
      }
    }
    return results
  }

  private fun entry(file: File, directory: Boolean, count: Int): Map<String, Any?> {
    val extension = file.extension.lowercase()
    val mime = if (directory) "" else MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: ""
    return mapOf(
      "name" to file.name,
      "path" to file.path,
      "uri" to Uri.fromFile(file).toString(),
      "directory" to directory,
      "size" to if (directory) 0L else file.length(),
      "modified" to file.lastModified(),
      "count" to count,
      "mimeType" to mime,
      "kind" to kindOf(mime, extension, directory),
    )
  }

  fun kindOf(mime: String, extension: String, directory: Boolean): String = when {
    directory -> "folder"
    mime == "application/pdf" || extension == "pdf" -> "pdf"
    mime.startsWith("image/") -> "image"
    mime.startsWith("video/") -> "video"
    mime.startsWith("audio/") -> "audio"
    extension in setOf("zip", "rar", "7z", "tar", "gz") -> "archive"
    extension in setOf("doc", "docx", "txt", "rtf", "odt", "xls", "xlsx", "csv", "ppt", "pptx") -> "document"
    extension == "apk" -> "app"
    else -> "other"
  }
}

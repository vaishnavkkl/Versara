package expo.modules.fileengine

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.Settings
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.Executors

class FileEngineModule : Module() {
  private val worker = Executors.newSingleThreadExecutor()
  // Separate from `worker` so folder browsing never waits behind image or save jobs.
  private val explorer = Executors.newSingleThreadExecutor()
  private val access = FileAccess()
  private val library = DeviceLibrary()
  private val pdfs = PdfDeviceLibrary()

  override fun definition() = ModuleDefinition {
    Name("FileEngine")
    Constant("nativeImageListVersion") { 2 }
    Constant("nativePdfLibraryVersion") { 1 }
    Constant("nativeZoomImageVersion") { 1 }
    Constant("nativeVideoVersion") { 1 }
    Constant("nativeImageEditorVersion") { 1 }
    Constant("nativeImageTextVersion") { 1 }
    AsyncFunction("recognizeImageText") { uri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) { promise.reject("IMAGE_TEXT_UNAVAILABLE", "The app is not ready.", null); return@AsyncFunction }
      worker.execute {
        try { promise.resolve(ImageText.recognize(context, uri)) }
        catch (_: OutOfMemoryError) { promise.reject("IMAGE_TEXT_MEMORY", "This image is too large to read on this device.", null) }
        catch (error: Throwable) { promise.reject("IMAGE_TEXT_FAILED", error.message ?: "Could not read text in this image.", error) }
      }
    }
    AsyncFunction("renderImageText") { options: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) { promise.reject("IMAGE_TEXT_UNAVAILABLE", "The app is not ready.", null); return@AsyncFunction }
      worker.execute {
        try { promise.resolve(ImageText.render(context, org.json.JSONObject(options))) }
        catch (_: OutOfMemoryError) { promise.reject("IMAGE_TEXT_MEMORY", "This image is too large to edit on this device.", null) }
        catch (error: Throwable) { promise.reject("IMAGE_TEXT_FAILED", error.message ?: "Could not update the image text.", error) }
      }
    }
    Constant("nativeDeviceSaveVersion") { 1 }
    AsyncFunction("saveToDevice") { sourceUri: String, name: String, mimeType: String, replaceUri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) { promise.reject("SAVE_UNAVAILABLE", "The app is not ready.", null); return@AsyncFunction }
      worker.execute {
        try { promise.resolve(DeviceSaver.save(context, sourceUri, name, mimeType, replaceUri)) }
        catch (error: Throwable) { promise.reject("SAVE_FAILED", error.message ?: "Could not save this file to your device.", error) }
      }
    }
    Constant("nativeRecentPdfsVersion") { 1 }
    View(RecentImagesView::class) {
      Events("onOpen", "onRemove")
      Prop("items") { view: RecentImagesView, value: String -> view.setItems(value) }
      Prop("grid") { view: RecentImagesView, value: Boolean -> view.setGrid(value) }
      Prop("palette") { view: RecentImagesView, value: String -> view.setPalette(value) }
      Prop("disabled") { view: RecentImagesView, value: Boolean -> view.disabled = value }
      OnViewDestroys { view: RecentImagesView -> view.dispose() }
    }
    View(NativeVideoView::class) {
      Events("onLoad", "onError")
      Prop("source") { view: NativeVideoView, value: String -> view.setSource(value) }
      Prop("palette") { view: NativeVideoView, value: String -> view.setPalette(value) }
      OnViewDestroys { view: NativeVideoView -> view.dispose() }
    }
    View(ImageEditorView::class) {
      Events("onLoad", "onError", "onCropChange")
      Prop("source") { view: ImageEditorView, value: String -> view.setSource(value) }
      Prop("edits") { view: ImageEditorView, value: String -> view.setEdits(value) }
      Prop("aspect") { view: ImageEditorView, value: String -> view.setAspect(value) }
      OnViewDestroys { view: ImageEditorView -> view.dispose() }
    }
    AsyncFunction("editImage") { options: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) { promise.reject("IMAGE_EDIT_UNAVAILABLE", "The app is not ready.", null); return@AsyncFunction }
      worker.execute {
        try { promise.resolve(ImageProcessing.export(context, org.json.JSONObject(options))) }
        catch (_: OutOfMemoryError) { promise.reject("IMAGE_EDIT_MEMORY", "This image is too large to edit on this device.", null) }
        catch (error: Throwable) { promise.reject("IMAGE_EDIT_FAILED", error.message ?: "Could not save the edited image.", error) }
      }
    }
    View(ZoomableImageView::class) {
      Events("onLoad", "onError", "onDismiss")
      Prop("source") { view: ZoomableImageView, value: String -> view.setSource(value) }
      OnViewDestroys { view: ZoomableImageView -> view.dispose() }
    }

    AsyncFunction("getPdfAccessAsync") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject("PDF_LIBRARY_UNAVAILABLE", "The app is not ready.", null)
      else promise.resolve(PdfDeviceLibrary.status(context))
    }
    AsyncFunction("requestPdfAccessAsync") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject("PDF_LIBRARY_UNAVAILABLE", "The app is not ready.", null)
      else if (Build.VERSION.SDK_INT >= 30) {
        try {
          val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          try { context.startActivity(intent) }
          catch (_: android.content.ActivityNotFoundException) { context.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
          promise.resolve(PdfDeviceLibrary.status(context))
        } catch (error: Exception) { promise.reject("PDF_ACCESS_FAILED", "Open system Settings and allow All files access for Versara.", error) }
      } else Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.READ_EXTERNAL_STORAGE)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("scanPdfFiles") { id: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject("PDF_LIBRARY_UNAVAILABLE", "The app is not ready.", null)
      else pdfs.scan(context, id, promise)
    }
    AsyncFunction("listPdfPage") { offset: Int, limit: Int, search: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject("PDF_LIBRARY_UNAVAILABLE", "The app is not ready.", null)
      else pdfs.page(context, offset, limit, search, promise)
    }
    Function("cancelPdfScan") { id: String -> pdfs.cancel(id) }
    AsyncFunction("listRecentPdfs") { limit: Int, search: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) { promise.reject("PDF_LIBRARY_UNAVAILABLE", "The app is not ready.", null); return@AsyncFunction }
      if (!PdfDeviceLibrary.allowed(context)) { promise.resolve(emptyList<Map<String, Any?>>()); return@AsyncFunction }
      worker.execute {
        try { promise.resolve(library.recentPdfs(context, limit.coerceIn(1, 60), search.trim())) }
        catch (error: Throwable) { promise.reject("PDF_LIST_FAILED", error.message ?: "Could not list recent PDFs.", error) }
      }
    }

    AsyncFunction("getFileAccessAsync") { promise: Promise ->
      access.get(appContext.permissions, promise)
    }

    AsyncFunction("requestFileAccessAsync") { promise: Promise ->
      access.request(appContext.permissions, promise)
    }

    AsyncFunction("listDeviceRecents") { kind: String, limit: Int, search: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("FILE_UNAVAILABLE", "The app is not ready.", null)
        return@AsyncFunction
      }
      if (!access.hasAccess(appContext.permissions, kind)) {
        promise.resolve(emptyList<Map<String, Any?>>())
        return@AsyncFunction
      }
      worker.execute {
        try {
          promise.resolve(library.list(context, kind, limit.coerceIn(1, 100), search.trim()))
        } catch (error: Throwable) {
          promise.reject("FILE_LIST_FAILED", error.message ?: "Could not list recent files.", error)
        }
      }
    }

    AsyncFunction("importDeviceFile") { uri: String, kind: String, destinationUri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("FILE_UNAVAILABLE", "The app is not ready.", null)
        return@AsyncFunction
      }
      worker.execute {
        try {
          promise.resolve(library.import(context, uri, kind, destinationUri))
        } catch (error: Throwable) {
          promise.reject("FILE_IMPORT_FAILED", error.message ?: "Could not import this file.", error)
        }
      }
    }

    Constant("nativeExplorerVersion") { 1 }
    AsyncFunction("getStorageRoots") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject("FILE_UNAVAILABLE", "The app is not ready.", null)
      else promise.resolve(FileExplorer.roots(context))
    }
    AsyncFunction("listDirectory") { path: String, showHidden: Boolean, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) { promise.reject("FILE_UNAVAILABLE", "The app is not ready.", null); return@AsyncFunction }
      explorer.execute {
        try { promise.resolve(FileExplorer.list(context, path, showHidden)) }
        catch (error: Throwable) { promise.reject("FOLDER_FAILED", error.message ?: "Could not open this folder.", error) }
      }
    }
    AsyncFunction("searchFiles") { query: String, limit: Int, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) { promise.reject("FILE_UNAVAILABLE", "The app is not ready.", null); return@AsyncFunction }
      explorer.execute {
        try { promise.resolve(FileExplorer.search(context, query, limit.coerceIn(1, 200))) }
        catch (error: Throwable) { promise.reject("SEARCH_FAILED", error.message ?: "Could not search your files.", error) }
      }
    }

    OnDestroy { worker.shutdown(); explorer.shutdown(); pdfs.destroy() }
    OnActivityEntersBackground { pdfs.cancelAll() }
  }
}

/** Runtime media/storage permission via Expo's activity-aware Permissions service. */
internal class FileAccess {
  fun permissionsFor(kind: String? = null): Array<String> {
    if (Build.VERSION.SDK_INT >= 33) {
      return when (kind) {
        "image" -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES)
        "video" -> arrayOf(Manifest.permission.READ_MEDIA_VIDEO)
        "audio" -> arrayOf(Manifest.permission.READ_MEDIA_AUDIO)
        "pdf" -> emptyArray() // PDFs use the system document picker; no broad storage grant.
        else -> arrayOf(
          Manifest.permission.READ_MEDIA_IMAGES,
          Manifest.permission.READ_MEDIA_VIDEO,
          Manifest.permission.READ_MEDIA_AUDIO,
        )
      }
    }
    return arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
  }

  fun hasAccess(permissions: Permissions?, kind: String? = null): Boolean {
    val required = permissionsFor(kind)
    if (required.isEmpty()) return true
    if (permissions == null) return false
    return permissions.hasGrantedPermissions(*required)
  }

  fun get(permissions: Permissions?, promise: Promise) {
    val required = permissionsFor(null)
    if (required.isEmpty()) {
      promise.resolve(mapOf("status" to "granted", "granted" to true, "canAskAgain" to false))
      return
    }
    Permissions.getPermissionsWithPermissionsManager(permissions, promise, *required)
  }

  fun request(permissions: Permissions?, promise: Promise) {
    val required = permissionsFor(null)
    if (required.isEmpty()) {
      promise.resolve(mapOf("status" to "granted", "granted" to true, "canAskAgain" to false))
      return
    }
    Permissions.askForPermissionsWithPermissionsManager(permissions, promise, *required)
  }
}

/** Bounded MediaStore queries. Returns metadata only — never file bytes on the JS bridge. */
internal class DeviceLibrary {
  fun list(context: Context, kind: String, limit: Int, search: String): List<Map<String, Any?>> {
    return when (kind) {
      "image" -> query(
        context,
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
        arrayOf(
          MediaStore.Images.Media._ID,
          MediaStore.Images.Media.DISPLAY_NAME,
          MediaStore.Images.Media.MIME_TYPE,
          MediaStore.Images.Media.SIZE,
          MediaStore.Images.Media.DATE_MODIFIED,
        ),
        MediaStore.Images.Media.DATE_MODIFIED,
        limit,
        search,
        "image",
      )
      "video" -> query(
        context,
        MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
        arrayOf(
          MediaStore.Video.Media._ID,
          MediaStore.Video.Media.DISPLAY_NAME,
          MediaStore.Video.Media.MIME_TYPE,
          MediaStore.Video.Media.SIZE,
          MediaStore.Video.Media.DATE_MODIFIED,
        ),
        MediaStore.Video.Media.DATE_MODIFIED,
        limit,
        search,
        "video",
      )
      "audio" -> query(
        context,
        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
        arrayOf(
          MediaStore.Audio.Media._ID,
          MediaStore.Audio.Media.DISPLAY_NAME,
          MediaStore.Audio.Media.MIME_TYPE,
          MediaStore.Audio.Media.SIZE,
          MediaStore.Audio.Media.DATE_MODIFIED,
        ),
        MediaStore.Audio.Media.DATE_MODIFIED,
        limit,
        search,
        "audio",
      )
      "pdf" -> queryPdf(context, limit, search)
      else -> emptyList()
    }
  }

  /** Newest PDFs from the system media index. SQL applies the name filter and row limit, so nothing is scanned. */
  fun recentPdfs(context: Context, limit: Int, search: String): List<Map<String, Any?>> {
    val collection = MediaStore.Files.getContentUri("external")
    val projection = arrayOf(
      MediaStore.Files.FileColumns._ID,
      MediaStore.Files.FileColumns.DISPLAY_NAME,
      MediaStore.Files.FileColumns.MIME_TYPE,
      MediaStore.Files.FileColumns.SIZE,
      MediaStore.Files.FileColumns.DATE_MODIFIED,
    )
    val filters = mutableListOf("(${MediaStore.Files.FileColumns.MIME_TYPE}=? OR ${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ?)", "${MediaStore.Files.FileColumns.SIZE}>0")
    val args = mutableListOf("application/pdf", "%.pdf")
    if (search.isNotEmpty()) {
      filters.add("${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ? ESCAPE '\\'")
      args.add("%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    }
    val selection = filters.joinToString(" AND ")
    val sort = "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC"
    val results = ArrayList<Map<String, Any?>>(limit)
    val cursor = if (Build.VERSION.SDK_INT >= 30) {
      val queryArgs = android.os.Bundle().apply {
        putString(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
        putStringArray(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args.toTypedArray())
        putString(android.content.ContentResolver.QUERY_ARG_SQL_SORT_ORDER, sort)
        putInt(android.content.ContentResolver.QUERY_ARG_LIMIT, limit)
      }
      context.contentResolver.query(collection, projection, queryArgs, null)
    } else context.contentResolver.query(collection, projection, selection, args.toTypedArray(), "$sort LIMIT $limit")
    cursor?.use {
      val idIndex = it.getColumnIndexOrThrow(projection[0])
      val nameIndex = it.getColumnIndexOrThrow(projection[1])
      val sizeIndex = it.getColumnIndexOrThrow(projection[3])
      val modifiedIndex = it.getColumnIndexOrThrow(projection[4])
      while (it.moveToNext() && results.size < limit) {
        val id = it.getLong(idIndex)
        results.add(mapOf(
          "id" to "device-pdf-$id",
          "uri" to ContentUris.withAppendedId(collection, id).toString(),
          "name" to (it.getString(nameIndex) ?: "Document.pdf"),
          "mimeType" to "application/pdf",
          "size" to it.getLong(sizeIndex).coerceAtLeast(0),
          "modified" to it.getLong(modifiedIndex) * 1000L,
          "kind" to "pdf",
          "source" to "device",
        ))
      }
    }
    return results
  }

  private fun queryPdf(context: Context, limit: Int, search: String): List<Map<String, Any?>> {
    if (Build.VERSION.SDK_INT >= 33) return emptyList()
    val collection = MediaStore.Files.getContentUri("external")
    val projection = arrayOf(
      MediaStore.Files.FileColumns._ID,
      MediaStore.Files.FileColumns.DISPLAY_NAME,
      MediaStore.Files.FileColumns.MIME_TYPE,
      MediaStore.Files.FileColumns.SIZE,
      MediaStore.Files.FileColumns.DATE_MODIFIED,
    )
    val selection = "${MediaStore.Files.FileColumns.MIME_TYPE}=?"
    val args = arrayOf("application/pdf")
    return query(context, collection, projection, MediaStore.Files.FileColumns.DATE_MODIFIED, limit, search, "pdf", selection, args)
  }

  private fun query(
    context: Context,
    collection: Uri,
    projection: Array<String>,
    sortColumn: String,
    limit: Int,
    search: String,
    kind: String,
    selection: String? = null,
    selectionArgs: Array<String>? = null,
  ): List<Map<String, Any?>> {
    val results = ArrayList<Map<String, Any?>>(limit)
    val sort = "$sortColumn DESC"
    context.contentResolver.query(collection, projection, selection, selectionArgs, sort)?.use { cursor ->
      val idIndex = cursor.getColumnIndexOrThrow(projection[0])
      val nameIndex = cursor.getColumnIndexOrThrow(projection[1])
      val mimeIndex = cursor.getColumnIndexOrThrow(projection[2])
      val sizeIndex = cursor.getColumnIndexOrThrow(projection[3])
      val modifiedIndex = cursor.getColumnIndexOrThrow(projection[4])
      val needle = search.lowercase()
      while (cursor.moveToNext() && results.size < limit) {
        val name = cursor.getString(nameIndex) ?: continue
        if (needle.isNotEmpty() && !name.lowercase().contains(needle)) continue
        val id = cursor.getLong(idIndex)
        val uri = ContentUris.withAppendedId(collection, id).toString()
        results.add(
          mapOf(
            "id" to "device-$kind-$id",
            "uri" to uri,
            "name" to name,
            "mimeType" to (cursor.getString(mimeIndex) ?: ""),
            "size" to cursor.getLong(sizeIndex).coerceAtLeast(0),
            "modified" to cursor.getLong(modifiedIndex) * 1000L,
            "kind" to kind,
            "source" to "device",
          ),
        )
      }
    }
    return results
  }

  fun import(context: Context, uri: String, kind: String, destinationUri: String): Map<String, Any?> {
    val source = Uri.parse(uri)
    val destination = Uri.parse(destinationUri)
    require(destination.scheme == "file") { "Destination must be an app file URI." }
    val target = File(requireNotNull(destination.path)).canonicalFile
    val filesRoot = context.filesDir.canonicalPath + "/"
    require(target.path.startsWith(filesRoot)) { "Destination must stay inside app documents." }
    require(!target.exists()) { "Destination already exists." }
    target.parentFile?.mkdirs()
    var name = target.name
    var mimeType = ""
    var size = 0L
    if (source.scheme == "file") name = File(requireNotNull(source.path)).name
    else context.contentResolver.query(source, null, null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val display = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
        val mime = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
        if (display >= 0) name = cursor.getString(display) ?: name
        if (mime >= 0) mimeType = cursor.getString(mime) ?: mimeType
      }
    }
    if (mimeType.isEmpty()) {
      mimeType = when (kind) {
        "pdf" -> "application/pdf"
        "image" -> "image/*"
        "video" -> "video/*"
        "audio" -> "audio/*"
        else -> "application/octet-stream"
      }
    }
    context.contentResolver.openInputStream(source)?.use { input ->
      target.outputStream().use { output ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val read = input.read(buffer)
          if (read <= 0) break
          output.write(buffer, 0, read)
          size += read
        }
      }
    } ?: error("Could not open this file.")
    require(target.exists() && target.length() > 0) { "Imported file is empty." }
    return mapOf(
      "uri" to destinationUri,
      "name" to name,
      "mimeType" to mimeType,
      "size" to size,
      "kind" to kind,
    )
  }
}

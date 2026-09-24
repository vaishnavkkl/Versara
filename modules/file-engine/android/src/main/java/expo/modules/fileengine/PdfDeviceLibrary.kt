package expo.modules.fileengine

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import expo.modules.kotlin.Promise
import java.io.File
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Disk-backed catalog: discovery, sort and paging never materialize all PDFs in JS/RAM. */
internal class PdfDeviceLibrary {
  private val worker = ThreadPoolExecutor(1, 1, 10, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(4)).apply { allowCoreThreadTimeOut(true) }
  // Paging reads the last committed index (WAL) while a scan rewrites it on the worker.
  private val reader = ThreadPoolExecutor(1, 1, 10, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(4)).apply { allowCoreThreadTimeOut(true) }
  private val scans = ConcurrentHashMap<String, AtomicBoolean>()
  @Volatile private var stopped = false

  companion object {
    fun allowed(context: Context): Boolean = if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
      else context.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
    fun status(context: Context) = mapOf("granted" to allowed(context), "status" to if (allowed(context)) "granted" else "denied", "canAskAgain" to true)
  }
  private fun submit(promise: Promise, executor: ThreadPoolExecutor = worker, work: () -> Any): Boolean {
    if (stopped) { promise.reject("PDF_LIBRARY_UNAVAILABLE", "The PDF library has closed.", null); return false }
    try { executor.execute {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
      try { promise.resolve(work()) }
      catch (error: Exception) { promise.reject("PDF_LIBRARY_FAILED", error.message ?: "Could not read device PDFs.", error) }
    }; return true } catch (_: java.util.concurrent.RejectedExecutionException) { promise.reject("PDF_LIBRARY_BUSY", "Another library request is finishing. Try again.", null); return false }
  }
  private fun database(context: Context): SQLiteDatabase = SQLiteDatabase.openDatabase(
    File(context.cacheDir, "device-pdfs.db").path, null,
    SQLiteDatabase.CREATE_IF_NECESSARY or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING,
  ).also {
    it.execSQL("CREATE TABLE IF NOT EXISTS pdfs(uri TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL, modified INTEGER NOT NULL)")
    it.execSQL("CREATE INDEX IF NOT EXISTS pdfs_recent ON pdfs(modified DESC, uri)")
  }
  fun scan(context: Context, id: String, promise: Promise) {
    if (scans.size >= 2 || stopped) { promise.reject("PDF_LIBRARY_BUSY", "A scan is finishing. Try again.", null); return }
    val cancelled = AtomicBoolean(false)
    if (scans.putIfAbsent(id, cancelled) != null) { promise.reject("PDF_LIBRARY_BUSY", "This scan is already running.", null); return }
    // Register cancellation before the queued task can start.
    if (worker.queue.remainingCapacity() == 0) { scans.remove(id); promise.reject("PDF_LIBRARY_BUSY", "A scan is finishing. Try again.", null); return }
    val accepted = submit(promise) {
      try {
        check(allowed(context)) { "Allow all-files access to find device PDFs." }
        database(context).use { db ->
          db.beginTransaction()
          try {
            db.execSQL("DELETE FROM pdfs")
            var count = 0
            fun checkCancelled() { check(!stopped && !cancelled.get()) { "PDF scan cancelled." } }
            db.compileStatement("INSERT OR REPLACE INTO pdfs(uri,name,size,modified) VALUES(?,?,?,?)").use { insert ->
              fun add(file: File) {
                checkCancelled()
                if (!file.name.endsWith(".pdf", true) || !file.isFile || !file.canRead()) return
                insert.clearBindings()
                insert.bindString(1, Uri.fromFile(file).toString()); insert.bindString(2, file.name)
                insert.bindLong(3, file.length()); insert.bindLong(4, file.lastModified())
                insert.executeInsert(); count++
              }
              val roots = mutableListOf(Environment.getExternalStorageDirectory())
              if (Build.VERSION.SDK_INT >= 30) (context.getSystemService(Context.STORAGE_SERVICE) as StorageManager).storageVolumes.mapNotNullTo(roots) { it.directory }
              else context.getExternalFilesDirs(null).filterNotNull().mapTo(roots) { File(it.absolutePath.substringBefore("/Android/")) }
              for (root in roots.distinctBy { it.absolutePath }.filter { it.exists() && it.canRead() }) {
                if (Build.VERSION.SDK_INT >= 26) {
                  Files.walkFileTree(root.toPath(), object : SimpleFileVisitor<Path>() {
                    override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult {
                      checkCancelled()
                      val file = dir.toFile()
                      return if (file.parentFile?.name == "Android" && file.name in setOf("data", "obb")) FileVisitResult.SKIP_SUBTREE else FileVisitResult.CONTINUE
                    }
                    override fun visitFile(path: Path, attrs: BasicFileAttributes): FileVisitResult {
                      if (attrs.isRegularFile) add(path.toFile())
                      checkCancelled(); return FileVisitResult.CONTINUE
                    }
                    override fun visitFileFailed(file: Path, error: java.io.IOException): FileVisitResult { checkCancelled(); return FileVisitResult.CONTINUE }
                  })
                } else {
                  root.walkTopDown().onEnter { checkCancelled(); it.canonicalPath == it.absolutePath && !(it.parentFile?.name == "Android" && it.name in setOf("data", "obb")) }
                    .forEach { add(it) }
                }
              }
            }
            checkCancelled()
            check(allowed(context)) { "Storage access was removed. Allow access and scan again." }
            db.setTransactionSuccessful()
            count
          } finally { db.endTransaction() }
        }
      } finally { scans.remove(id) }
    }
    if (!accepted) scans.remove(id)
  }
  fun page(context: Context, offset: Int, limit: Int, search: String, promise: Promise) = submit(promise, reader) {
    if (!allowed(context)) return@submit mapOf("items" to emptyList<Any>(), "total" to 0)
    database(context).use { db ->
      val args = arrayOf(search.trim())
      val filter = "instr(lower(name),lower(?)) > 0"
      val total = db.rawQuery("SELECT count(*) FROM pdfs WHERE $filter", args).use { it.moveToFirst(); it.getInt(0) }
      val result = mutableListOf<Map<String, Any>>()
      db.rawQuery("SELECT uri,name,size,modified FROM pdfs WHERE $filter ORDER BY modified DESC,uri LIMIT ${limit.coerceIn(1, 80)} OFFSET ${offset.coerceAtLeast(0)}", args).use { cursor ->
        while (cursor.moveToNext()) {
          val uri = cursor.getString(0)
          result.add(mapOf("id" to "device-pdf-$uri", "uri" to uri, "name" to cursor.getString(1), "size" to cursor.getLong(2), "modified" to cursor.getLong(3), "kind" to "pdf", "mimeType" to "application/pdf", "source" to "device"))
        }
      }
      mapOf("items" to result, "total" to total)
    }
  }
  fun cancel(id: String) { scans[id]?.set(true) }
  fun cancelAll() { scans.values.forEach { it.set(true) } }
  fun destroy() { stopped = true; scans.values.forEach { it.set(true) }; worker.shutdown(); reader.shutdown() }
}

package expo.modules.pdfengine

import expo.modules.kotlin.Promise
import java.util.concurrent.ExecutorService
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

/** Bounded queued work and cancellation bookkeeping, including cancel-before-start. */
internal class PdfJobRegistry {
  private val jobs = mutableMapOf<String, AtomicBoolean>()
  private val earlyCancellations = linkedSetOf<String>()
  private var closed = false

  @Synchronized fun cancel(id: String) {
    if (closed) return
    val flag = jobs[id]
    if (flag != null) flag.set(true)
    else {
      earlyCancellations.add(id)
      if (earlyCancellations.size > 64) earlyCancellations.remove(earlyCancellations.first())
    }
  }

  @Synchronized fun submit(worker: ExecutorService, id: String, promise: Promise, action: (AtomicBoolean) -> Unit) {
    if (closed) { promise.reject("PDF_CANCELLED", "This tool has closed.", null); return }
    if (jobs.size >= 4 || jobs.containsKey(id)) {
      promise.reject("PDF_BUSY", "Another PDF task is still finishing. Please try again shortly.", null); return
    }
    val flag = AtomicBoolean(earlyCancellations.remove(id))
    jobs[id] = flag
    try {
      worker.execute {
        try { action(flag) }
        finally { synchronized(this) { jobs.remove(id) } }
      }
    } catch (error: RejectedExecutionException) {
      jobs.remove(id)
      promise.reject("PDF_CANCELLED", "This tool has closed.", error)
    }
  }

  @Synchronized fun destroy(worker: ExecutorService) {
    closed = true
    jobs.values.forEach { it.set(true) }
    earlyCancellations.clear()
    // Let queued jobs reject their promises and release their inputs.
    worker.shutdown()
  }
}

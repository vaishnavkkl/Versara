package expo.modules.fileengine

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/** MediaPlayer on a TextureView with native controls; frames and timing never cross into JS. */
class NativeVideoView(context: Context, appContext: AppContext) : ExpoView(context, appContext), TextureView.SurfaceTextureListener {
  override val shouldUseAndroidLayout = true
  private val onLoad by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any>>()
  private val main = Handler(Looper.getMainLooper())
  private val density = resources.displayMetrics.density
  private val texture = TextureView(context)
  private val controls = LinearLayout(context)
  private val play = ImageButton(context)
  private val back = ImageButton(context)
  private val forward = ImageButton(context)
  private val seek = SeekBar(context)
  private val current = TextView(context)
  private val total = TextView(context)
  private var player: MediaPlayer? = null
  private var surface: Surface? = null
  private var source = ""
  private var prepared = false
  private var videoWidth = 0
  private var videoHeight = 0
  private var dragging = false
  private var disposed = false
  private val tick = object : Runnable {
    override fun run() {
      updateProgress()
      if (player?.isPlaying == true) main.postDelayed(this, 250)
    }
  }

  init {
    setBackgroundColor(Color.BLACK)
    texture.surfaceTextureListener = this
    texture.setOnClickListener { toggle() }
    texture.contentDescription = "Video. Tap to play or pause."
    addView(texture)

    controls.orientation = LinearLayout.HORIZONTAL
    controls.gravity = Gravity.CENTER_VERTICAL
    controls.setPadding(dp(8), 0, dp(12), 0)
    controls.background = GradientDrawable().apply { setColor(Color.argb(200, 12, 16, 60)) }
    configure(back, android.R.drawable.ic_media_rew, "Back 10 seconds") { seekBy(-10_000) }
    configure(play, android.R.drawable.ic_media_play, "Play") { toggle() }
    configure(forward, android.R.drawable.ic_media_ff, "Forward 10 seconds") { seekBy(10_000) }
    listOf(current, total).forEach {
      it.setTextColor(Color.WHITE)
      it.textSize = 12f
      it.text = "0:00"
      it.fontFeatureSettings = "tnum"
    }
    seek.max = 1000
    seek.isEnabled = false
    seek.contentDescription = "Playback position"
    seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
      override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {
        if (fromUser) current.text = format(position(progress))
      }
      override fun onStartTrackingTouch(bar: SeekBar) { dragging = true }
      override fun onStopTrackingTouch(bar: SeekBar) {
        dragging = false
        player?.takeIf { prepared }?.seekTo(position(bar.progress))
      }
    })
    controls.addView(back, LinearLayout.LayoutParams(dp(44), dp(44)))
    controls.addView(play, LinearLayout.LayoutParams(dp(48), dp(48)))
    controls.addView(forward, LinearLayout.LayoutParams(dp(44), dp(44)))
    controls.addView(current, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(4) })
    controls.addView(seek, LinearLayout.LayoutParams(0, dp(44), 1f))
    controls.addView(total)
    addView(controls)
    setAccent("#ADB8FF")
  }

  private fun dp(value: Int) = (value * density).toInt()

  private fun configure(button: ImageButton, icon: Int, label: String, action: () -> Unit) {
    button.setImageResource(icon)
    button.imageTintList = ColorStateList.valueOf(Color.WHITE)
    button.background = null
    button.contentDescription = label
    button.isEnabled = false
    button.alpha = 0.5f
    button.setOnClickListener { action() }
  }

  fun setPalette(json: String) {
    try { setAccent(JSONObject(json).optString("accent", "#ADB8FF")) } catch (_: Exception) { }
  }

  private fun setAccent(value: String) {
    val color = try { Color.parseColor(value) } catch (_: Exception) { Color.WHITE }
    seek.progressTintList = ColorStateList.valueOf(color)
    seek.thumbTintList = ColorStateList.valueOf(color)
  }

  fun setSource(value: String) {
    if (value == source) return
    source = value
    open()
  }

  private fun open() {
    release()
    if (disposed || source.isEmpty()) return
    val media = MediaPlayer()
    player = media
    try {
      media.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build())
      media.setDataSource(context, Uri.parse(source))
      surface?.let { media.setSurface(it) }
      media.setOnPreparedListener {
        if (player !== it) return@setOnPreparedListener
        prepared = true
        setControlsEnabled(true)
        total.text = format(it.duration)
        updateProgress()
        onLoad(mapOf("duration" to it.duration / 1000.0, "width" to it.videoWidth, "height" to it.videoHeight))
      }
      media.setOnVideoSizeChangedListener { _, width, height ->
        videoWidth = width
        videoHeight = height
        layoutChildren()
      }
      media.setOnCompletionListener {
        setPlayIcon(false)
        updateProgress()
      }
      media.setOnErrorListener { _, _, _ ->
        prepared = false
        setControlsEnabled(false)
        onError(mapOf("message" to "This video could not be played on your device."))
        true
      }
      media.prepareAsync()
    } catch (_: Exception) {
      release()
      onError(mapOf("message" to "This video could not be opened."))
    }
  }

  private fun setControlsEnabled(enabled: Boolean) {
    listOf(play, back, forward).forEach { it.isEnabled = enabled; it.alpha = if (enabled) 1f else 0.5f }
    seek.isEnabled = enabled
  }

  private fun setPlayIcon(playing: Boolean) {
    play.setImageResource(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
    play.contentDescription = if (playing) "Pause" else "Play"
  }

  private fun toggle() {
    val media = player?.takeIf { prepared } ?: return
    if (media.isPlaying) pause() else {
      if (media.currentPosition >= media.duration - 250) media.seekTo(0)
      media.start()
      setPlayIcon(true)
      main.removeCallbacks(tick)
      main.post(tick)
    }
  }

  private fun pause() {
    val media = player?.takeIf { prepared } ?: return
    if (media.isPlaying) media.pause()
    setPlayIcon(false)
    main.removeCallbacks(tick)
    updateProgress()
  }

  private fun seekBy(delta: Int) {
    val media = player?.takeIf { prepared } ?: return
    media.seekTo((media.currentPosition + delta).coerceIn(0, max(0, media.duration)))
    main.postDelayed({ updateProgress() }, 120)
  }

  private fun position(progress: Int): Int = ((player?.takeIf { prepared }?.duration ?: 0).toLong() * progress / 1000).toInt()

  private fun updateProgress() {
    val media = player?.takeIf { prepared } ?: return
    val duration = max(1, media.duration)
    if (!dragging) {
      seek.progress = (media.currentPosition.toLong() * 1000 / duration).toInt()
      current.text = format(media.currentPosition)
    }
  }

  private fun format(ms: Int): String {
    val seconds = max(0, ms / 1000)
    val hours = seconds / 3600
    return if (hours > 0) "%d:%02d:%02d".format(hours, (seconds % 3600) / 60, seconds % 60) else "%d:%02d".format(seconds / 60, seconds % 60)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    layoutChildren()
  }

  private fun layoutChildren() {
    val width = width
    val height = height
    if (width <= 0 || height <= 0) return
    val barHeight = dp(56)
    controls.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(barHeight, MeasureSpec.EXACTLY))
    controls.layout(0, height - barHeight, width, height)
    val area = height - barHeight
    var videoW = width
    var videoH = area
    if (videoWidth > 0 && videoHeight > 0) {
      val scale = min(width.toFloat() / videoWidth, area.toFloat() / videoHeight)
      videoW = (videoWidth * scale).toInt()
      videoH = (videoHeight * scale).toInt()
    }
    val x = (width - videoW) / 2
    val y = (area - videoH) / 2
    texture.measure(MeasureSpec.makeMeasureSpec(videoW, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(videoH, MeasureSpec.EXACTLY))
    texture.layout(x, y, x + videoW, y + videoH)
  }

  override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
    surface = Surface(texture).also { player?.setSurface(it) }
  }
  override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) { }
  override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
    try { player?.setSurface(null) } catch (_: Exception) { }
    surface?.release()
    surface = null
    return true
  }
  override fun onSurfaceTextureUpdated(texture: SurfaceTexture) { }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility != View.VISIBLE) pause()
  }

  override fun onDetachedFromWindow() {
    pause()
    super.onDetachedFromWindow()
  }

  private fun release() {
    main.removeCallbacks(tick)
    prepared = false
    videoWidth = 0
    videoHeight = 0
    setControlsEnabled(false)
    setPlayIcon(false)
    player?.let { media ->
      player = null
      try { media.reset() } catch (_: Exception) { }
      media.release()
    }
  }

  fun dispose() {
    if (disposed) return
    disposed = true
    release()
    surface?.release()
    surface = null
  }
}

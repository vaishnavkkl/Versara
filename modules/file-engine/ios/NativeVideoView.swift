import ExpoModulesCore
import UIKit
import AVFoundation

/// AVPlayer with native controls; frames and timing never cross into JS.
final class NativeVideoView: ExpoView {
  let onLoad = EventDispatcher()
  let onError = EventDispatcher()
  private let player = AVPlayer()
  private let playerLayer = AVPlayerLayer()
  private let canvas = UIView()
  private let controls = UIView()
  private let play = UIButton(type: .system)
  private let back = UIButton(type: .system)
  private let forward = UIButton(type: .system)
  private let slider = UISlider()
  private let current = UILabel()
  private let total = UILabel()
  private var source = ""
  private var timeObserver: Any?
  private var statusObserver: NSKeyValueObservation?
  private var endObserver: NSObjectProtocol?
  private var backgroundObserver: NSObjectProtocol?
  private var scrubbing = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true
    playerLayer.player = player
    playerLayer.videoGravity = .resizeAspect
    canvas.layer.addSublayer(playerLayer)
    canvas.isAccessibilityElement = true
    canvas.accessibilityLabel = "Video"
    canvas.accessibilityHint = "Tap to play or pause."
    canvas.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(toggle)))
    addSubview(canvas)

    controls.backgroundColor = UIColor(red: 12 / 255, green: 16 / 255, blue: 60 / 255, alpha: 0.8)
    configure(back, symbol: "gobackward.10", label: "Back 10 seconds", action: #selector(seekBack))
    configure(play, symbol: "play.fill", label: "Play", action: #selector(toggle))
    configure(forward, symbol: "goforward.10", label: "Forward 10 seconds", action: #selector(seekForward))
    for label in [current, total] {
      label.textColor = .white
      label.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
      label.text = "0:00"
      controls.addSubview(label)
    }
    slider.isEnabled = false
    slider.accessibilityLabel = "Playback position"
    slider.addTarget(self, action: #selector(scrubStart), for: .touchDown)
    slider.addTarget(self, action: #selector(scrubChange), for: .valueChanged)
    slider.addTarget(self, action: #selector(scrubEnd), for: [.touchUpInside, .touchUpOutside, .touchCancel])
    controls.addSubview(slider)
    addSubview(controls)

    timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4), queue: .main) { [weak self] _ in self?.updateProgress() }
    backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.pause() }
  }

  deinit {
    if let timeObserver { player.removeTimeObserver(timeObserver) }
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
    statusObserver?.invalidate()
    player.replaceCurrentItem(with: nil)
  }

  private func configure(_ button: UIButton, symbol: String, label: String, action: Selector) {
    button.setImage(UIImage(systemName: symbol), for: .normal)
    button.tintColor = .white
    button.accessibilityLabel = label
    button.isEnabled = false
    button.addTarget(self, action: action, for: .touchUpInside)
    controls.addSubview(button)
  }

  func setPalette(_ json: String) {
    guard let data = json.data(using: .utf8), let values = try? JSONSerialization.jsonObject(with: data) as? [String: String],
          let accent = values["accent"], let color = UIColor(hex: accent) else { return }
    slider.minimumTrackTintColor = color
    slider.thumbTintColor = color
  }

  func setSource(_ value: String) {
    guard value != source else { return }
    source = value
    pause()
    statusObserver?.invalidate()
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    setControlsEnabled(false)
    guard let url = URL(string: value) else { onError(["message": "This video could not be opened."]); return }
    let item = AVPlayerItem(url: url)
    statusObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
      DispatchQueue.main.async {
        guard let self, item === self.player.currentItem else { return }
        switch item.status {
        case .readyToPlay:
          self.setControlsEnabled(true)
          let duration = item.duration.seconds.isFinite ? item.duration.seconds : 0
          self.total.text = Self.format(duration)
          let size = item.presentationSize
          self.onLoad(["duration": duration, "width": size.width, "height": size.height])
        case .failed:
          self.onError(["message": "This video could not be played on your device."])
        default: break
        }
      }
    }
    endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in self?.setPlayIcon(false) }
    player.replaceCurrentItem(with: item)
  }

  private func setControlsEnabled(_ enabled: Bool) {
    for control in [play, back, forward, slider] as [UIControl] { control.isEnabled = enabled; control.alpha = enabled ? 1 : 0.5 }
  }

  private func setPlayIcon(_ playing: Bool) {
    play.setImage(UIImage(systemName: playing ? "pause.fill" : "play.fill"), for: .normal)
    play.accessibilityLabel = playing ? "Pause" : "Play"
  }

  @objc private func toggle() {
    guard let item = player.currentItem, item.status == .readyToPlay else { return }
    if player.timeControlStatus == .playing { pause(); return }
    if item.duration.isNumeric && item.currentTime() >= item.duration - CMTime(value: 1, timescale: 4) { player.seek(to: .zero) }
    player.play()
    setPlayIcon(true)
  }

  private func pause() {
    player.pause()
    setPlayIcon(false)
  }

  @objc private func seekBack() { seek(by: -10) }
  @objc private func seekForward() { seek(by: 10) }
  private func seek(by seconds: Double) {
    guard let item = player.currentItem, item.duration.isNumeric else { return }
    let target = min(max(0, item.currentTime().seconds + seconds), item.duration.seconds)
    player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
  }

  @objc private func scrubStart() { scrubbing = true }
  @objc private func scrubChange() {
    guard let item = player.currentItem, item.duration.isNumeric else { return }
    current.text = Self.format(Double(slider.value) * item.duration.seconds)
  }
  @objc private func scrubEnd() {
    scrubbing = false
    guard let item = player.currentItem, item.duration.isNumeric else { return }
    player.seek(to: CMTime(seconds: Double(slider.value) * item.duration.seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
  }

  private func updateProgress() {
    guard !scrubbing, let item = player.currentItem, item.duration.isNumeric, item.duration.seconds > 0 else { return }
    let time = item.currentTime().seconds
    slider.value = Float(time / item.duration.seconds)
    current.text = Self.format(time)
  }

  private static func format(_ seconds: Double) -> String {
    let value = max(0, Int(seconds.isFinite ? seconds : 0))
    return value >= 3600 ? String(format: "%d:%02d:%02d", value / 3600, (value % 3600) / 60, value % 60) : String(format: "%d:%02d", value / 60, value % 60)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let bar: CGFloat = 56
    let bottomInset = safeAreaInsets.bottom
    controls.frame = CGRect(x: 0, y: bounds.height - bar - bottomInset, width: bounds.width, height: bar + bottomInset)
    canvas.frame = CGRect(x: 0, y: 0, width: bounds.width, height: max(0, bounds.height - bar - bottomInset))
    CATransaction.begin(); CATransaction.setDisableActions(true)
    playerLayer.frame = canvas.bounds
    CATransaction.commit()
    back.frame = CGRect(x: 8, y: 6, width: 44, height: 44)
    play.frame = CGRect(x: 52, y: 4, width: 48, height: 48)
    forward.frame = CGRect(x: 100, y: 6, width: 44, height: 44)
    current.sizeToFit(); total.sizeToFit()
    current.frame.origin = CGPoint(x: 148, y: (bar - current.frame.height) / 2)
    total.frame.origin = CGPoint(x: bounds.width - 12 - total.frame.width, y: (bar - total.frame.height) / 2)
    let sliderX = current.frame.maxX + 8
    slider.frame = CGRect(x: sliderX, y: 6, width: max(0, total.frame.minX - 8 - sliderX), height: 44)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { pause() }
  }
}

private extension UIColor {
  convenience init?(hex: String) {
    var value = hex.trimmingCharacters(in: .whitespaces)
    if value.hasPrefix("#") { value.removeFirst() }
    guard value.count == 6, let number = UInt32(value, radix: 16) else { return nil }
    self.init(red: CGFloat((number >> 16) & 0xFF) / 255, green: CGFloat((number >> 8) & 0xFF) / 255, blue: CGFloat(number & 0xFF) / 255, alpha: 1)
  }
}

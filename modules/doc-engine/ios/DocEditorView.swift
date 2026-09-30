import ExpoModulesCore
import UIKit
import CoreText
import ImageIO

enum DocSession {
  static weak var active: DocEditorView?
  static func editor() throws -> DocEditorView {
    guard let active else { throw DocumentError("Open a document first.") }
    return active
  }
}
private struct DocumentError: Error, LocalizedError { let message: String; var errorDescription: String? { message }; init(_ message: String) { self.message = message } }

extension NSAttributedString.Key {
  /// The document's font name for a run, kept so saving writes the original name.
  static let docFont = NSAttributedString.Key("versaraDocFont")
  /// The run's size in half-points.
  static let docSize = NSAttributedString.Key("versaraDocSize")
  /// The paragraph starts on a new page.
  static let docBreak = NSAttributedString.Key("versaraDocBreak")
  static let docMarker = NSAttributedString.Key("versaraDocMarker")
  static let docGrid = NSAttributedString.Key("versaraDocGrid")
  static let docRow = NSAttributedString.Key("versaraDocRow")
  /// Tab stops with leaders (dots, hyphens or a line) for the paragraph.
  static let docLeaders = NSAttributedString.Key("versaraDocLeaders")
}

/// Tab stop positions (in points from the container's left edge) that draw a leader across the tab.
final class DocLeaders: NSObject {
  let stops: [(x: CGFloat, leader: String)]
  init(stops: [(x: CGFloat, leader: String)]) { self.stops = stops }
}

private let ink = UIColor.black

/// Metric-compatible open fonts (SIL OFL) stand in for Calibri and Cambria; iOS has the other Office fonts.
enum DocFonts {
  private static var registered = false
  private static var cache: [String: UIFont] = [:]
  private static var families: [String: String?] = [:]

  static func register() {
    guard !registered else { return }
    registered = true
    let bundles = [Bundle(for: DocEditorView.self), Bundle.main]
    for family in ["Carlito", "Caladea"] {
      for style in ["Regular", "Bold", "Italic", "BoldItalic"] {
        for bundle in bundles {
          if let url = bundle.url(forResource: "\(family)-\(style)", withExtension: "ttf") {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            break
          }
        }
      }
    }
  }

  static func family(_ name: String) -> String? {
    if let known = families[name] { return known }
    let key = name.trimmingCharacters(in: .whitespaces).lowercased()
    let value: String?
    switch key {
    case "calibri", "calibri light", "carlito", "candara", "corbel": value = "Carlito"
    case "cambria", "cambria math", "caladea": value = "Caladea"
    case "arial", "liberation sans", "arimo", "aptos", "aptos display", "aptos narrow", "segoe ui", "tahoma", "arial nova", "century gothic": value = "Arial"
    case "helvetica": value = "Helvetica"
    case "times new roman", "times", "liberation serif", "tinos", "garamond", "book antiqua", "palatino linotype", "century schoolbook": value = "Times New Roman"
    case "georgia": value = "Georgia"
    case "verdana": value = "Verdana"
    case "courier new", "courier", "consolas", "liberation mono", "lucida console", "cousine": value = "Courier New"
    default: value = UIFont.familyNames.contains(name) ? name : (key.contains("serif") && !key.contains("sans") ? "Times New Roman" : nil)
    }
    families[name] = value
    return value
  }

  static func font(_ name: String, size: CGFloat, bold: Bool, italic: Bool) -> UIFont {
    let key = "\(name)|\(size)|\(bold)|\(italic)"
    if let hit = cache[key] { return hit }
    var traits: UIFontDescriptor.SymbolicTraits = []
    if bold { traits.insert(.traitBold) }
    if italic { traits.insert(.traitItalic) }
    var font: UIFont
    if let family = family(name) {
      let base = UIFontDescriptor(fontAttributes: [.family: family])
      font = UIFont(descriptor: base.withSymbolicTraits(traits) ?? base, size: size)
    } else {
      font = UIFont.systemFont(ofSize: size)
      if let descriptor = font.fontDescriptor.withSymbolicTraits(traits) { font = UIFont(descriptor: descriptor, size: size) }
    }
    if cache.count > 600 { cache.removeAll() }
    cache[key] = font
    return font
  }
}

final class DocMarker: NSObject {
  let text: String, x: CGFloat, font: UIFont, color: UIColor
  init(text: String, x: CGFloat, font: UIFont, color: UIColor) { self.text = text; self.x = x; self.font = font; self.color = color }
}

/// Column edges and shading for an editable table row laid out with tab stops.
final class DocGrid: NSObject {
  let edges: [CGFloat], fills: [UIColor?], borders: Bool
  init(edges: [CGFloat], fills: [UIColor?], borders: Bool) { self.edges = edges; self.fills = fills; self.borders = borders }
}

final class DocRowCell {
  let x: CGFloat, width: CGFloat, text: NSAttributedString?, fill: UIColor?, valign: String, continued: Bool
  var openBelow = false
  init(x: CGFloat, width: CGFloat, text: NSAttributedString?, fill: UIColor?, valign: String, continued: Bool) {
    self.x = x; self.width = width; self.text = text; self.fill = fill; self.valign = valign; self.continued = continued
  }
}

/// One row of a read-only table, drawn as a single line so pages can break between rows.
final class DocRow: NSObject {
  let cells: [DocRowCell], height: CGFloat, padX: CGFloat, padY: CGFloat, borders: Bool, last: Bool
  init(cells: [DocRowCell], height: CGFloat, padX: CGFloat, padY: CGFloat, borders: Bool, last: Bool) {
    self.cells = cells; self.height = height; self.padX = padX; self.padY = padY; self.borders = borders; self.last = last
  }
  func draw(top: CGFloat, left: CGFloat, line: CGFloat) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    let bottom = top + height
    for cell in cells {
      let l = left + cell.x, r = l + cell.width
      if let fill = cell.fill, !cell.continued { fill.setFill(); context.fill(CGRect(x: l, y: top, width: cell.width, height: height)) }
      if let text = cell.text, !cell.continued {
        let width = max(1, cell.width - 2 * padX)
        let size = text.boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).size
        let room = height - 2 * padY - size.height
        let dy = cell.valign == "center" ? max(0, room / 2) : cell.valign == "bottom" ? max(0, room) : 0
        text.draw(with: CGRect(x: l + padX, y: top + padY + dy, width: width, height: max(size.height, height)), options: [.usesLineFragmentOrigin], context: nil)
      }
      if borders {
        context.setStrokeColor(ink.cgColor)
        context.setLineWidth(line)
        context.move(to: CGPoint(x: l, y: top)); context.addLine(to: CGPoint(x: l, y: bottom))
        context.move(to: CGPoint(x: r, y: top)); context.addLine(to: CGPoint(x: r, y: bottom))
        if !cell.continued { context.move(to: CGPoint(x: l, y: top)); context.addLine(to: CGPoint(x: r, y: top)) }
        if last || !cell.openBelow { context.move(to: CGPoint(x: l, y: bottom)); context.addLine(to: CGPoint(x: r, y: bottom)) }
        context.strokePath()
      }
    }
  }
}

/// Lays lines out page by page and draws list markers and table rows.
final class DocLayoutManager: NSLayoutManager, NSLayoutManagerDelegate {
  var pitch: CGFloat = 0
  var content: CGFloat = 1
  var hairline: CGFloat = 0.5

  override init() { super.init(); delegate = self }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  private func startsParagraph(_ index: Int) -> Bool {
    guard let storage = textStorage else { return false }
    return index == 0 || (storage.string as NSString).character(at: index - 1) == 10
  }

  /// Moves a line that would cross the bottom margin, or that must start a page, to the next page.
  func layoutManager(_ layoutManager: NSLayoutManager, shouldSetLineFragmentRect lineFragmentRect: UnsafeMutablePointer<CGRect>, lineFragmentUsedRect: UnsafeMutablePointer<CGRect>, baselineOffset: UnsafeMutablePointer<CGFloat>, in textContainer: NSTextContainer, forGlyphRange glyphRange: NSRange) -> Bool {
    guard pitch > 1 else { return false }
    var rect = lineFragmentRect.pointee
    var used = lineFragmentUsedRect.pointee
    let page = floor(rect.minY / pitch)
    let regionTop = page * pitch, regionBottom = regionTop + content
    var forced = false
    if rect.minY > regionTop + 0.5, let storage = textStorage {
      let index = characterIndexForGlyph(at: glyphRange.location)
      if index < storage.length, storage.attribute(.docBreak, at: index, effectiveRange: nil) != nil { forced = startsParagraph(index) }
    }
    let push = rect.minY >= regionBottom - 0.5 || forced || (rect.minY > regionTop + 0.5 && used.maxY > regionBottom + 0.5)
    guard push else { return false }
    let shift = (page + 1) * pitch - rect.minY
    rect.origin.y += shift
    used.origin.y += shift
    lineFragmentRect.pointee = rect
    lineFragmentUsedRect.pointee = used
    return true
  }

  override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
    super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
    guard let storage = textStorage, let context = UIGraphicsGetCurrentContext() else { return }
    enumerateLineFragments(forGlyphRange: glyphsToShow) { rect, _, _, glyphRange, _ in
      let index = self.characterIndexForGlyph(at: glyphRange.location)
      guard index < storage.length, let grid = storage.attribute(.docGrid, at: index, effectiveRange: nil) as? DocGrid, grid.edges.count > 1 else { return }
      let top = rect.minY + origin.y, bottom = rect.maxY + origin.y
      for i in 0..<(grid.edges.count - 1) {
        guard i < grid.fills.count, let fill = grid.fills[i] else { continue }
        fill.setFill()
        context.fill(CGRect(x: origin.x + grid.edges[i], y: top, width: grid.edges[i + 1] - grid.edges[i], height: bottom - top))
      }
      guard grid.borders else { return }
      context.setStrokeColor(ink.cgColor)
      context.setLineWidth(self.hairline)
      let left = origin.x + grid.edges[0], right = origin.x + grid.edges[grid.edges.count - 1]
      context.move(to: CGPoint(x: left, y: top)); context.addLine(to: CGPoint(x: right, y: top))
      context.move(to: CGPoint(x: left, y: bottom)); context.addLine(to: CGPoint(x: right, y: bottom))
      for x in grid.edges { context.move(to: CGPoint(x: origin.x + x, y: top)); context.addLine(to: CGPoint(x: origin.x + x, y: bottom)) }
      context.strokePath()
    }
  }

  override func drawGlyphs(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
    super.drawGlyphs(forGlyphRange: glyphsToShow, at: origin)
    guard let storage = textStorage else { return }
    enumerateLineFragments(forGlyphRange: glyphsToShow) { rect, _, _, glyphRange, _ in
      let index = self.characterIndexForGlyph(at: glyphRange.location)
      guard index < storage.length else { return }
      if let row = storage.attribute(.docRow, at: index, effectiveRange: nil) as? DocRow {
        row.draw(top: rect.minY + origin.y, left: origin.x, line: self.hairline)
        return
      }
      if let leaders = storage.attribute(.docLeaders, at: index, effectiveRange: nil) as? DocLeaders {
        self.drawLeaders(leaders, glyphRange: glyphRange, fragment: rect, origin: origin)
      }
      guard let marker = storage.attribute(.docMarker, at: index, effectiveRange: nil) as? DocMarker, self.startsParagraph(index) else { return }
      let baseline = rect.minY + origin.y + self.location(forGlyphAt: glyphRange.location).y
      (marker.text as NSString).draw(at: CGPoint(x: origin.x + marker.x, y: baseline - marker.font.ascender), withAttributes: [.font: marker.font, .foregroundColor: marker.color])
    }
  }

  /// Fills each tab on the line that lands on a leader stop with dots, hyphens or a rule.
  private func drawLeaders(_ leaders: DocLeaders, glyphRange: NSRange, fragment: CGRect, origin: CGPoint) {
    guard let storage = textStorage, let container = textContainers.first else { return }
    let characters = characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)
    let string = storage.string as NSString
    for index in characters.location..<NSMaxRange(characters) where index < string.length && string.character(at: index) == 9 {
      let glyph = glyphIndexForCharacter(at: index)
      let box = boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container)
      guard box.width > 2, let stop = leaders.stops.first(where: { $0.x > box.minX + 1 }) else { continue }
      let font = (storage.attribute(.font, at: index, effectiveRange: nil) as? UIFont) ?? UIFont.systemFont(ofSize: 12)
      let color = (storage.attribute(.foregroundColor, at: index, effectiveRange: nil) as? UIColor) ?? ink
      let baseline = fragment.minY + origin.y + location(forGlyphAt: glyph).y
      let gap = font.pointSize * 0.25
      let left = origin.x + box.minX + gap, right = origin.x + box.maxX - gap
      guard right > left else { continue }
      if stop.leader == "line" {
        color.setFill()
        UIRectFill(CGRect(x: left, y: baseline + font.pointSize * 0.08, width: right - left, height: max(hairline, font.pointSize / 16)))
        continue
      }
      let glyphText = (stop.leader == "hyphen" ? "-" : ".") as NSString
      let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
      let pitch = max(1, glyphText.size(withAttributes: attributes).width + font.pointSize * 0.18)
      var x = (left / pitch).rounded(.up) * pitch
      while x + pitch <= right {
        glyphText.draw(at: CGPoint(x: x, y: baseline - font.ascender), withAttributes: attributes)
        x += pitch
      }
    }
  }
}

/// Text view whose caret spans the glyphs on the line (ascender to descender at the baseline);
/// page-flow and paragraph spacing make some line fragments much taller than their text.
final class DocTextView: UITextView {
  var pagePitch: CGFloat = 0
  var bodyHeight: CGFloat = 0

  override func draw(_ rect: CGRect) {
    guard pagePitch > 1, bodyHeight > 1, let context = UIGraphicsGetCurrentContext() else { super.draw(rect); return }
    let visible = rect.intersection(context.boundingBoxOfClipPath)
    guard !visible.isNull, !visible.isEmpty else { return }
    let first = max(0, Int(floor(visible.minY / pagePitch)))
    let last = max(first, Int(floor(visible.maxY / pagePitch)))
    let path = UIBezierPath()
    for page in first...last {
      path.append(UIBezierPath(rect: CGRect(x: 0, y: CGFloat(page) * pagePitch, width: bounds.width, height: bodyHeight)))
    }
    context.saveGState()
    path.addClip()
    super.draw(rect)
    context.restoreGState()
  }

  override func caretRect(for position: UITextPosition) -> CGRect {
    var rect = super.caretRect(for: position)
    let storage = textStorage
    let offset = self.offset(from: beginningOfDocument, to: position)
    guard storage.length > 0, offset >= 0, offset < storage.length, rect.origin.y.isFinite else { return rect }
    let string = storage.string as NSString
    let probe = offset > 0 && string.character(at: offset - 1) != 10 ? offset - 1 : offset
    guard let font = storage.attribute(.font, at: probe, effectiveRange: nil) as? UIFont ?? self.font else { return rect }
    let glyph = layoutManager.glyphIndexForCharacter(at: offset)
    let fragment = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
    let baseline = fragment.minY + layoutManager.location(forGlyphAt: glyph).y + textContainerInset.top
    let height = font.ascender - font.descender
    guard height > 0, height < rect.height else { return rect }
    rect.origin.y = baseline - font.ascender
    rect.size.height = height
    return rect
  }
}

/// A sheet of paper with the page's header and footer.
private final class DocPageView: UIView {
  private var labels: [UILabel] = []
  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .white
    isUserInteractionEnabled = false
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.14
    layer.shadowRadius = 2
    layer.shadowOffset = CGSize(width: 0, height: 1)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
  func configure(bands: [(text: NSAttributedString, frame: CGRect)]) {
    layer.shadowPath = UIBezierPath(rect: bounds).cgPath
    while labels.count < bands.count { let label = UILabel(); label.numberOfLines = 0; addSubview(label); labels.append(label) }
    for (index, label) in labels.enumerated() {
      guard index < bands.count else { label.isHidden = true; continue }
      label.isHidden = false
      label.attributedText = bands[index].text
      label.frame = bands[index].frame
    }
  }
}

/// Holds the pages and the text. Header and footer areas take taps instead of the text.
private final class DocSheetView: UIView {
  var zone: ((CGPoint) -> String?)?
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    if let kind = zone?(point), kind == "header" || kind == "footer" { return self }
    return super.hitTest(point, with: event)
  }
}

final class DocEditorView: ExpoView, UITextViewDelegate, UIScrollViewDelegate {
  let onReady = EventDispatcher()
  let onDocChange = EventDispatcher()
  let onError = EventDispatcher()
  let onFormat = EventDispatcher()
  let onBand = EventDispatcher()
  var sourceProp = ""
  var formatProp = "docx"
  var blankProp = false
  var darkProp = false
  var rulerProp = false
  var pagesProp = false
  private let storage: NSTextStorage
  private let manager: DocLayoutManager
  private let container: NSTextContainer
  private let editor: UITextView
  private let pageScroll = UIScrollView()
  private let sheet = DocSheetView()
  private var pageViews: [DocPageView] = []
  private var sourcePath = ""
  private var format = "docx"
  private var blank = false
  private var sect = ""
  private var sections: [[String: Any]] = []
  private var sectionIndex = 0
  private var blocks: [[String: Any]] = []
  private var lines: [(block: Int, role: String, row: Int)] = []
  private var edited = false
  private var restored = false
  private var updating = false
  private var generation = 0
  private typealias Snapshot = (blocks: String, hf: [String: Any])
  private var undoStack: [Snapshot] = []
  private var redoStack: [Snapshot] = []
  private var lastPush: TimeInterval = 0
  private var beforeText = ""
  private var changeRange = NSRange(location: 0, length: 0)
  private var changeLength = 0
  private var changeOld = NSAttributedString()
  private var hf: [String: Any] = [:]
  private var defaults: [String: Any] = [:]
  private var lastFormat: NSDictionary?
  private let queue = DispatchQueue(label: "com.versara.doc", qos: .userInitiated)
  private var pageSetup: [String: Any] = [:]
  private let ruler = DocRulerView()
  private let strip = UIView()
  private let stripScroll = UIScrollView()
  private let prevButton = UIButton(type: .system)
  private let nextButton = UIButton(type: .system)
  private let stripLabel = UILabel()
  private var thumbButtons: [UIButton] = []
  private var thumbCache: [Int: UIImage] = [:]
  private let images = NSCache<NSString, UIImage>()
  private var pageCount = 1
  private var currentPage = 0
  private var currentIndent = 0
  private var currentFirst = 0
  private var pagesWork: DispatchWorkItem?
  private let stripHeight: CGFloat = 112
  private let rulerHeight: CGFloat = 28
  private let gutter: CGFloat = 10
  private let gap: CGFloat = 14
  // Zoom: 1 fits the page width to the screen; text is laid out again at each committed zoom.
  private var zoom: CGFloat = 1
  private var scale: CGFloat = 0
  private var pinchFactor: CGFloat = 1
  private var pinchFocus = CGPoint.zero
  private var pinchScreen = CGPoint.zero
  private var keyboardInset: CGFloat = 0

  required init(appContext: AppContext? = nil) {
    DocFonts.register()
    let storage = NSTextStorage()
    let manager = DocLayoutManager()
    let container = NSTextContainer(size: CGSize(width: 100, height: CGFloat.greatestFiniteMagnitude))
    container.lineFragmentPadding = 0
    container.widthTracksTextView = false
    storage.addLayoutManager(manager)
    manager.addTextContainer(container)
    self.storage = storage
    self.manager = manager
    self.container = container
    self.editor = DocTextView(frame: .zero, textContainer: container)
    super.init(appContext: appContext)
    images.totalCostLimit = 48 * 1024 * 1024
    manager.hairline = 1 / UIScreen.main.scale
    editor.delegate = self
    editor.isScrollEnabled = false
    editor.textContainerInset = .zero
    editor.backgroundColor = .clear
    editor.autocorrectionType = .yes
    editor.textColor = ink
    pageScroll.delegate = self
    pageScroll.alwaysBounceVertical = true
    pageScroll.keyboardDismissMode = .interactive
    pageScroll.addGestureRecognizer(UIPinchGestureRecognizer(target: self, action: #selector(pinch(_:))))
    sheet.zone = { [weak self] point in self?.zone(at: point) }
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapSheet(_:)))
    tap.cancelsTouchesInView = false
    sheet.addGestureRecognizer(tap)
    sheet.addSubview(editor)
    pageScroll.addSubview(sheet)
    addSubview(pageScroll)
    ruler.isHidden = true
    ruler.onIndent = { [weak self] indent, first in try? self?.command("paraIndent", value: "\(indent),\(first)") }
    ruler.onMargins = { [weak self] left, right in self?.marginsFromRuler(left: left, right: right) }
    addSubview(ruler)
    buildStrip()
    NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
    DocSession.active = self
  }

  deinit { NotificationCenter.default.removeObserver(self) }

  private func buildStrip() {
    strip.isHidden = true
    strip.layer.shadowOpacity = 0.12
    strip.layer.shadowRadius = 4
    strip.layer.shadowOffset = CGSize(width: 0, height: -1)
    let symbols = UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold)
    prevButton.setImage(UIImage(systemName: "chevron.left", withConfiguration: symbols), for: .normal)
    nextButton.setImage(UIImage(systemName: "chevron.right", withConfiguration: symbols), for: .normal)
    prevButton.accessibilityLabel = "Previous page"
    nextButton.accessibilityLabel = "Next page"
    prevButton.addTarget(self, action: #selector(previousPage), for: .touchUpInside)
    nextButton.addTarget(self, action: #selector(followingPage), for: .touchUpInside)
    stripLabel.font = .systemFont(ofSize: 12, weight: .medium)
    stripLabel.textAlignment = .center
    stripScroll.showsHorizontalScrollIndicator = false
    stripScroll.delegate = self
    for view in [prevButton, nextButton, stripLabel, stripScroll] as [UIView] { strip.addSubview(view) }
    addSubview(strip)
  }

  @objc private func previousPage() { goToPage(currentPage - 1) }
  @objc private func followingPage() { goToPage(currentPage + 1) }

  override func layoutSubviews() {
    super.layoutSubviews()
    let top: CGFloat = ruler.isHidden ? 0 : rulerHeight
    let bottom: CGFloat = strip.isHidden ? 0 : stripHeight
    ruler.frame = CGRect(x: 0, y: 0, width: bounds.width, height: rulerHeight)
    strip.frame = CGRect(x: 0, y: bounds.height - stripHeight, width: bounds.width, height: stripHeight)
    prevButton.frame = CGRect(x: 4, y: stripHeight / 2 - 2, width: 40, height: 44)
    nextButton.frame = CGRect(x: 44, y: stripHeight / 2 - 2, width: 40, height: 44)
    stripLabel.frame = CGRect(x: 4, y: stripHeight / 2 - 26, width: 80, height: 20)
    stripScroll.frame = CGRect(x: 88, y: 0, width: max(0, bounds.width - 88), height: stripHeight)
    let frame = CGRect(x: 0, y: top, width: bounds.width, height: max(0, bounds.height - top - bottom))
    if pageScroll.frame != frame { pageScroll.frame = frame }
    if updateScale() && !sections.isEmpty { commit(); render() }
    updateRuler()
    layoutThumbs()
  }

  // ---------- Page geometry ----------
  // Document values are in twips (1/20 pt); `scale` is screen points per printed point.
  private func pageValue(_ key: String, _ fallback: Int) -> Int { (pageSetup[key] as? NSNumber)?.intValue ?? fallback }
  private var pageWidth: Int { max(2880, pageValue("w", 12240)) }
  private var pageHeight: Int { max(2880, pageValue("h", 15840)) }
  private var marginTop: Int { pageValue("top", 1440) }
  private var marginBottom: Int { pageValue("bottom", 1440) }
  private var marginLeft: Int { pageValue("left", 1440) }
  private var marginRight: Int { pageValue("right", 1440) }
  private func px(_ twips: Int) -> CGFloat { CGFloat(twips) / 20 * scale }
  private func halfToPx(_ half: Int) -> CGFloat { CGFloat(half) / 2 * scale }
  private var pageW: CGFloat { px(pageWidth) }
  private var pageH: CGFloat { px(pageHeight) }
  private var mL: CGFloat { px(marginLeft) }
  private var headerReach: CGFloat = 0
  private var footerReach: CGFloat = 0
  private var mT: CGFloat { max(px(marginTop), headerReach) }
  private var mR: CGFloat { px(marginRight) }
  private var mB: CGFloat { max(px(marginBottom), footerReach) }
  private var contentW: CGFloat { max(40, pageW - mL - mR) }
  private var contentH: CGFloat { max(40, pageH - mT - mB) }
  private var pitch: CGFloat { pageH + gap }
  private var defaultFont: String { (defaults["font"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Calibri" }
  private var defaultHalf: Int { max(2, min((defaults["size"] as? NSNumber)?.intValue ?? 22, 3276)) }
  private func defaultNumber(_ key: String, _ fallback: Int) -> Int { (defaults[key] as? NSNumber)?.intValue ?? fallback }

  private func updateScale() -> Bool {
    let room = bounds.width - 2 * gutter
    guard room > 0 else { return false }
    let next = room / (CGFloat(pageWidth) / 20) * zoom
    guard abs(next - scale) > 0.001 else { return false }
    scale = next
    applyGeometry()
    return true
  }

  private func applyGeometry() {
    measureBands()
    manager.pitch = pitch
    manager.content = contentH
    editor.pagePitch = pitch
    editor.bodyHeight = contentH
    if container.size.width != contentW { container.size = CGSize(width: contentW, height: .greatestFiniteMagnitude) }
    editor.typingAttributes = baseAttributes()
  }

  private func baseAttributes() -> [NSAttributedString.Key: Any] {
    [.font: DocFonts.font(defaultFont, size: halfToPx(defaultHalf), bold: false, italic: false), .foregroundColor: ink, .docFont: defaultFont, .docSize: defaultHalf]
  }

  /// Sizes the text and page sheets to the laid-out text.
  private func layoutSheet() {
    guard scale > 0 else { return }
    manager.ensureLayout(for: container)
    let height = max(contentH, ceil(manager.usedRect(for: container).height))
    let pages = min(5000, max(1, Int((height - 1) / pitch) + 1))
    editor.frame = CGRect(x: gutter + mL, y: gutter + mT, width: contentW, height: height + 1)
    sheet.frame = CGRect(x: 0, y: 0, width: pageW + 2 * gutter, height: 2 * gutter + CGFloat(pages) * pitch - gap)
    pageScroll.contentSize = sheet.frame.size
    let changed = pages != pageCount
    pageCount = pages
    layoutPageViews()
    if changed { pagesChanged() }
  }

  private func bandRows(_ kind: String, number: Int) -> [(String, String)] {
    var rows: [(String, String)] = []
    if let text = hf[kind] as? String, !text.isEmpty { rows += text.components(separatedBy: "\n").map { ($0, hf["\(kind)Align"] as? String ?? "left") } }
    if hf["pagePos"] as? String == kind {
      let format = hf["pageFormat"] as? String
      rows.append((format == "page" ? "Page \(number)" : format == "pageOf" ? "Page \(number) of \(pageCount)" : "\(number)", hf["pageAlign"] as? String ?? "center"))
    }
    return rows
  }

  /// Header or footer text, each row with its own alignment, and its height wrapped to the text width.
  private func bandText(_ kind: String, number: Int) -> (text: NSAttributedString, height: CGFloat)? {
    let rows = bandRows(kind, number: number)
    guard !rows.isEmpty, scale > 0 else { return nil }
    let font = DocFonts.font(defaultFont, size: halfToPx(defaultHalf), bold: false, italic: false)
    let text = NSMutableAttributedString()
    for (index, row) in rows.enumerated() {
      let style = NSMutableParagraphStyle()
      style.alignment = row.1 == "center" ? .center : row.1 == "right" ? .right : .left
      text.append(NSAttributedString(string: (index > 0 ? "\n" : "") + row.0, attributes: [.font: font, .foregroundColor: ink, .paragraphStyle: style]))
    }
    let height = ceil(text.boundingRect(with: CGSize(width: contentW, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).height)
    return (text, height)
  }

  /// Word pushes the body away from a header or footer that reaches past the margin.
  private func measureBands() {
    headerReach = bandText("header", number: 1).map { px(max(0, pageValue("hd", 720))) + $0.height } ?? 0
    footerReach = bandText("footer", number: 1).map { px(max(0, pageValue("fd", 720))) + $0.height } ?? 0
  }

  /// Header and footer of one page with their frames in page coordinates.
  private func bands(_ index: Int) -> [(text: NSAttributedString, frame: CGRect)] {
    var out: [(text: NSAttributedString, frame: CGRect)] = []
    if let header = bandText("header", number: index + 1) {
      out.append((header.text, CGRect(x: mL, y: px(max(0, pageValue("hd", 720))), width: contentW, height: header.height)))
    }
    if let footer = bandText("footer", number: index + 1) {
      out.append((footer.text, CGRect(x: mL, y: pageH - px(max(0, pageValue("fd", 720))) - footer.height, width: contentW, height: footer.height)))
    }
    return out
  }

  private func layoutPageViews() {
    while pageViews.count > pageCount { pageViews.removeLast().removeFromSuperview() }
    while pageViews.count < pageCount { let view = DocPageView(); sheet.insertSubview(view, belowSubview: editor); pageViews.append(view) }
    for (index, view) in pageViews.enumerated() {
      view.frame = CGRect(x: gutter, y: gutter + CGFloat(index) * pitch, width: pageW, height: pageH)
      view.configure(bands: bands(index))
    }
  }

  private func drawBands(_ index: Int) {
    for band in bands(index) { band.text.draw(with: band.frame, options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil) }
  }

  /// One printed page with its top-left corner at the context origin, in screen points.
  private func drawPage(_ index: Int) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    drawBands(index)
    let top = CGFloat(index) * pitch
    let glyphs = manager.glyphRange(forBoundingRect: CGRect(x: 0, y: top, width: contentW, height: contentH), in: container)
    context.saveGState()
    context.clip(to: CGRect(x: mL, y: mT, width: contentW, height: contentH))
    let origin = CGPoint(x: mL, y: mT - top)
    manager.drawBackground(forGlyphRange: glyphs, at: origin)
    manager.drawGlyphs(forGlyphRange: glyphs, at: origin)
    context.restoreGState()
  }

  private func zone(at point: CGPoint) -> String? {
    guard scale > 0, point.x >= gutter, point.x <= gutter + pageW else { return nil }
    let offset = point.y - gutter
    guard offset >= 0 else { return nil }
    let index = Int(offset / pitch)
    guard index < pageCount else { return nil }
    let local = offset - CGFloat(index) * pitch
    if local > pageH { return nil }
    if local < mT { return "header" }
    if local > pageH - mB { return "footer" }
    return "body"
  }

  @objc private func tapSheet(_ recognizer: UITapGestureRecognizer) {
    let point = recognizer.location(in: sheet)
    guard let kind = zone(at: point), !sections.isEmpty else { return }
    if kind == "body" {
      guard !editor.frame.contains(point) else { return }
      editor.becomeFirstResponder()
      editor.selectedRange = NSRange(location: storage.length > 0 ? storage.length - 1 : 0, length: 0)
    } else {
      onBand(["kind": kind])
    }
  }

  @objc private func pinch(_ recognizer: UIPinchGestureRecognizer) {
    switch recognizer.state {
    case .began:
      pinchFactor = 1
      pinchFocus = recognizer.location(in: sheet)
      let inScroll = recognizer.location(in: pageScroll)
      pinchScreen = CGPoint(x: inScroll.x - pageScroll.contentOffset.x, y: inScroll.y - pageScroll.contentOffset.y)
    case .changed:
      pinchFactor = min(max(recognizer.scale, 1 / zoom), 4 / zoom)
      let dx = pinchFocus.x - sheet.bounds.midX, dy = pinchFocus.y - sheet.bounds.midY
      sheet.transform = CGAffineTransform(translationX: dx, y: dy).scaledBy(x: pinchFactor, y: pinchFactor).translatedBy(x: -dx, y: -dy)
    case .ended, .cancelled, .failed:
      sheet.transform = .identity
      finishZoom()
    default: break
    }
  }

  private func finishZoom() {
    let target = min(max(zoom * pinchFactor, 1), 4)
    guard abs(target - zoom) > 0.02, !sections.isEmpty else { return }
    let old = scale
    zoom = target
    commit()
    guard updateScale() else { return }
    render()
    let ratio = scale / old
    let maxX = max(0, pageScroll.contentSize.width - pageScroll.bounds.width)
    let maxY = max(0, pageScroll.contentSize.height - pageScroll.bounds.height + pageScroll.contentInset.bottom)
    pageScroll.contentOffset = CGPoint(x: min(max(0, pinchFocus.x * ratio - pinchScreen.x), maxX), y: min(max(0, pinchFocus.y * ratio - pinchScreen.y), maxY))
    updateRuler()
  }

  @objc private func keyboardChanged(_ note: Notification) {
    guard let window, let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
    let bottom = pageScroll.convert(pageScroll.bounds, to: window).maxY
    let overlap = note.name == UIResponder.keyboardWillHideNotification ? 0 : max(0, bottom - frame.minY)
    guard overlap != keyboardInset else { return }
    keyboardInset = overlap
    pageScroll.contentInset.bottom = overlap
    pageScroll.verticalScrollIndicatorInsets.bottom = overlap
    if overlap > 0 { DispatchQueue.main.async { self.revealCaret() } }
  }

  private func revealCaret() {
    guard editor.isFirstResponder, let position = editor.selectedTextRange?.end else { return }
    let caret = editor.caretRect(for: position)
    guard caret.origin.y.isFinite else { return }
    pageScroll.scrollRectToVisible(editor.convert(caret, to: pageScroll).insetBy(dx: -8, dy: -24), animated: false)
  }

  private func updateRuler() {
    guard scale > 0 else { return }
    ruler.configure(inset: gutter - pageScroll.contentOffset.x, cardWidth: pageW, pageWidth: CGFloat(pageWidth), left: CGFloat(marginLeft), right: CGFloat(marginRight), indent: CGFloat(currentIndent), first: CGFloat(currentFirst), dark: darkProp)
  }

  private func marginsFromRuler(left: Int?, right: Int?) {
    var next: [String: Any] = [:]
    if let left { next["left"] = left }
    if let right { next["right"] = right }
    try? setPage(stringify(next))
    let page: [String: Any] = ["w": pageWidth, "h": pageHeight, "top": marginTop, "right": marginRight, "bottom": marginBottom, "left": marginLeft]
    onDocChange(["dirty": edited, "characters": storage.length, "canUndo": !undoStack.isEmpty, "canRedo": !redoStack.isEmpty, "section": sectionIndex, "sections": sections.count, "page": stringify(page)])
  }

  private func theme() {
    backgroundColor = darkProp ? UIColor(white: 0.1, alpha: 1) : UIColor(red: 0.91, green: 0.918, blue: 0.929, alpha: 1)
    strip.backgroundColor = darkProp ? UIColor(white: 0.14, alpha: 1) : .white
    stripLabel.textColor = darkProp ? UIColor(white: 0.93, alpha: 1) : UIColor(red: 0.13, green: 0.13, blue: 0.14, alpha: 1)
    for button in [prevButton, nextButton] { button.tintColor = darkProp ? UIColor(white: 0.93, alpha: 1) : UIColor(red: 0.24, green: 0.25, blue: 0.26, alpha: 1) }
    updateRuler()
  }

  func setPage(_ value: String) throws {
    guard !sections.isEmpty, let next = try? json(value) else { return }
    for key in ["w", "h", "top", "right", "bottom", "left"] { if let number = next[key] as? NSNumber { pageSetup[key] = number.intValue } }
    pageSetup["dirty"] = true
    edited = true
    commit()
    scale = 0
    _ = updateScale()
    render(); updateRuler(); scheduleDraft(); emit()
  }

  private func setPagesVisible(_ visible: Bool) {
    guard strip.isHidden == visible else { return }
    strip.isHidden = !visible
    if !visible { thumbCache.removeAll(); thumbButtons.forEach { $0.setImage(nil, for: .normal) } }
    setNeedsLayout()
    if visible { rebuildThumbs() }
  }

  private func schedulePages() {
    pagesWork?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.thumbCache.removeAll()
      if !self.strip.isHidden { self.renderVisibleThumbs() }
    }
    pagesWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45, execute: work)
  }

  private func pagesChanged() {
    thumbCache.removeAll()
    if !strip.isHidden { rebuildThumbs() }
    updateCurrentPage(force: true)
  }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    if scrollView === pageScroll { updateCurrentPage(); if !ruler.isHidden { updateRuler() } }
    else if scrollView === stripScroll { renderVisibleThumbs() }
  }

  private func pageAtScroll() -> Int {
    let y = pageScroll.contentOffset.y + pageScroll.bounds.height / 3 - gutter
    return min(max(0, Int(max(0, y) / max(1, pitch))), max(0, pageCount - 1))
  }

  private func updateCurrentPage(force: Bool = false) {
    let next = pageAtScroll()
    let changed = next != currentPage
    currentPage = next
    stripLabel.text = "\(currentPage + 1) of \(pageCount)"
    prevButton.isEnabled = currentPage > 0
    nextButton.isEnabled = currentPage < pageCount - 1
    if (changed || force) && !strip.isHidden {
      highlightThumbs()
      if thumbButtons.indices.contains(currentPage) {
        let button = thumbButtons[currentPage]
        let x = min(max(0, button.frame.midX - stripScroll.bounds.width / 2), max(0, stripScroll.contentSize.width - stripScroll.bounds.width))
        stripScroll.setContentOffset(CGPoint(x: x, y: 0), animated: true)
      }
    }
  }

  private func goToPage(_ index: Int) {
    guard index >= 0, index < pageCount else { return }
    let maxY = max(0, pageScroll.contentSize.height - pageScroll.bounds.height + pageScroll.contentInset.bottom)
    pageScroll.setContentOffset(CGPoint(x: pageScroll.contentOffset.x, y: min(max(0, gutter + CGFloat(index) * pitch - 6), maxY)), animated: true)
    currentPage = index
    updateCurrentPage(force: true)
  }

  private var thumbSize: CGSize {
    let height: CGFloat = 72
    return CGSize(width: max(24, height * CGFloat(pageWidth) / CGFloat(pageHeight)), height: height)
  }

  private func rebuildThumbs() {
    while thumbButtons.count > pageCount { thumbButtons.removeLast().removeFromSuperview() }
    while thumbButtons.count < pageCount {
      let index = thumbButtons.count
      let button = UIButton(type: .custom)
      button.tag = index
      button.imageView?.contentMode = .scaleToFill
      button.backgroundColor = .white
      button.layer.borderWidth = 1
      button.addTarget(self, action: #selector(tapThumb(_:)), for: .touchUpInside)
      stripScroll.addSubview(button)
      thumbButtons.append(button)
    }
    for (index, button) in thumbButtons.enumerated() { button.accessibilityLabel = "Page \(index + 1)" }
    layoutThumbs()
    highlightThumbs()
    renderVisibleThumbs()
  }

  @objc private func tapThumb(_ sender: UIButton) { goToPage(sender.tag) }

  private func layoutThumbs() {
    guard !strip.isHidden else { return }
    let size = thumbSize
    for (index, button) in thumbButtons.enumerated() {
      button.frame = CGRect(x: 4 + CGFloat(index) * (size.width + 12), y: 12, width: size.width, height: size.height)
      let number = (button.viewWithTag(1000) as? UILabel) ?? {
        let label = UILabel()
        label.tag = 1000
        label.font = .systemFont(ofSize: 11)
        label.textAlignment = .center
        button.addSubview(label)
        return label
      }()
      number.text = "\(index + 1)"
      number.textColor = darkProp ? UIColor(white: 0.65, alpha: 1) : UIColor(red: 0.37, green: 0.39, blue: 0.41, alpha: 1)
      number.frame = CGRect(x: 0, y: size.height + 4, width: size.width, height: 14)
    }
    stripScroll.contentSize = CGSize(width: 16 + CGFloat(thumbButtons.count) * (size.width + 12), height: stripHeight)
  }

  private func highlightThumbs() {
    for (index, button) in thumbButtons.enumerated() {
      let selected = index == currentPage
      button.layer.borderWidth = selected ? 2 : 1
      button.layer.borderColor = (selected ? UIColor(red: 0.1, green: 0.45, blue: 0.91, alpha: 1) : (darkProp ? UIColor(white: 0.3, alpha: 1) : UIColor(white: 0.86, alpha: 1))).cgColor
    }
  }

  /// Only pages near the visible part of the strip keep an image.
  private func renderVisibleThumbs() {
    guard !strip.isHidden, !thumbButtons.isEmpty, scale > 0 else { return }
    let size = thumbSize
    let itemWidth = size.width + 12
    let first = max(0, Int(stripScroll.contentOffset.x / itemWidth) - 2)
    let last = min(thumbButtons.count - 1, Int((stripScroll.contentOffset.x + max(stripScroll.bounds.width, itemWidth)) / itemWidth) + 2)
    guard first <= last else { return }
    for key in thumbCache.keys where key < first || key > last {
      thumbCache.removeValue(forKey: key)
      if thumbButtons.indices.contains(key) { thumbButtons[key].setImage(nil, for: .normal) }
    }
    let factor = size.width / pageW
    for index in first...last {
      let image = thumbCache[index] ?? UIGraphicsImageRenderer(size: size).image { context in
        UIColor.white.setFill()
        context.fill(CGRect(origin: .zero, size: size))
        context.cgContext.scaleBy(x: factor, y: factor)
        drawPage(index)
      }
      thumbCache[index] = image
      thumbButtons[index].setImage(image, for: .normal)
    }
  }

  func setHeaderFooter(_ value: String) throws {
    guard !sections.isEmpty, var next = try? json(value) else { return }
    pushUndo()
    for key in ["headerLocked", "footerLocked"] where hf[key] as? Bool == true { next[key] = true }
    next["dirty"] = true
    hf = next
    edited = true
    let top = mT, bottom = mB
    measureBands()
    if mT != top || mB != bottom { commit(); render() }
    else { layoutPageViews(); thumbCache.removeAll(); renderVisibleThumbs() }
    scheduleDraft(); emit()
  }

  func dispose() {
    generation += 1
    pagesWork?.cancel()
    NSObject.cancelPreviousPerformRequests(withTarget: self)
    NotificationCenter.default.removeObserver(self)
    // Changes are kept only by Save; the draft exists to recover from a crash while editing.
    if !sections.isEmpty { try? FileManager.default.removeItem(at: draft()) }
    thumbCache.removeAll()
    images.removeAllObjects()
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    lineStartTyping()
    reportFormat(); revealCaret()
  }

  /// At the start of a line, type in that line's formatting; UIKit would take the newline's before it.
  private func lineStartTyping() {
    let range = editor.selectedRange
    guard !updating, range.length == 0, range.location < storage.length else { return }
    let string = storage.string as NSString
    guard range.location == 0 || string.character(at: range.location - 1) == 10, string.character(at: range.location) != 10 else { return }
    var attrs = storage.attributes(at: range.location, effectiveRange: nil)
    guard attrs[.attachment] == nil, attrs[.docRow] == nil else { return }
    attrs.removeValue(forKey: .docBreak)
    editor.typingAttributes = attrs
  }

  private func reportFormat() {
    guard !updating, !lines.isEmpty, storage.length > 0 else { return }
    let range = editor.selectedRange
    let probe = range.length > 0 ? range.location : max(0, min(range.location - 1, storage.length - 1))
    let attrs = storage.attributes(at: min(probe, storage.length - 1), effectiveRange: nil)
    let font = attrs[.font] as? UIFont
    let traits = font?.fontDescriptor.symbolicTraits ?? []
    let line = lineIndex(range.location)
    let block = line.flatMap { lines[$0].role == "para" ? blocks[safe: lines[$0].block] : nil }
    let number = { (key: String, fallback: Int) in (block?[key] as? NSNumber)?.intValue ?? fallback }
    let indent = max(0, number("indent", 0))
    let first = number("first", 0)
    if indent != currentIndent || first != currentFirst { currentIndent = indent; currentFirst = first; updateRuler() }
    let half = (attrs[.docSize] as? NSNumber)?.intValue ?? defaultHalf
    let state: NSDictionary = [
      "indent": indent, "first": first, "line": number("line", 0), "before": number("before", -1), "after": number("after", -1),
      "bold": traits.contains(.traitBold), "italic": traits.contains(.traitItalic),
      "underline": attrs[.underlineStyle] != nil, "strike": attrs[.strikethroughStyle] != nil,
      "align": (block?["align"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "left",
      "list": (block?["list"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "none",
      "size": half / 2,
      "image": line.map { lines[$0].role == "image" } ?? false,
    ]
    if state != lastFormat { lastFormat = state; onFormat(state as? [String: Any] ?? [:]) }
  }

  func applyProps() {
    let path = filePath(sourceProp)
    let changed = path != sourcePath || formatProp != format || blankProp != blank
    if ruler.isHidden == rulerProp { ruler.isHidden = !rulerProp; setNeedsLayout() }
    setPagesVisible(pagesProp)
    theme()
    if !changed && !sections.isEmpty { return }
    sourcePath = path; format = formatProp; blank = blankProp
    generation += 1
    let token = generation
    queue.async { [weak self] in
      guard let self else { return }
      do {
        let model = try self.loadModel()
        DispatchQueue.main.async { if token == self.generation { self.present(model) } }
      } catch {
        DispatchQueue.main.async { if token == self.generation { self.onError(["message": error.localizedDescription]) } }
      }
    }
  }

  // ---------- Commands ----------
  func command(_ name: String, value: String) throws {
    guard !sections.isEmpty else { return }
    if name == "undo" { restore(undoStack.popLast(), into: &redoStack); return }
    if name == "redo" { restore(redoStack.popLast(), into: &undoStack); return }
    if name == "blur" { editor.resignFirstResponder(); return }
    pushUndo()
    let range = editor.selectedRange
    storage.beginEditing()
    switch name {
    case "bold": toggle(range, bold: true)
    case "italic": toggle(range, bold: false)
    case "underline": toggleFlag(range, key: .underlineStyle)
    case "strike": toggleFlag(range, key: .strikethroughStyle)
    case "color": paint(range, value: value, background: false)
    case "highlight": paint(range, value: value, background: true)
    case "size": if let points = Int(value) { size(range, points: points) }
    case "align": paragraph(range, align: value)
    case "list": paragraph(range, list: value)
    case "style": heading(range, value: value)
    case "indent", "paraIndent", "line", "spaceBefore", "spaceAfter": spacing(range, name: name, value: value)
    case "clear": clearFormatting(range)
    case "table":
      storage.endEditing()
      insertTable(value)
      return
    case "deleteImage":
      storage.endEditing()
      guard let index = imageLine() else { return }
      commit()
      blocks.remove(at: lines[index].block)
      if blocks.isEmpty { blocks = [paragraphBlock("")] }
      sections[sectionIndex]["blocks"] = blocks
      edited = true
      render(); scheduleDraft(); emit()
      return
    default: break
    }
    storage.endEditing()
    markDirty(range)
    layoutSheet()
    scheduleDraft(); emit()
    lastFormat = nil
    reportFormat()
  }

  /// Paragraph lines touching `range`, with their text ranges (without the newline).
  private func paragraphsIn(_ range: NSRange) -> [(index: Int, range: NSRange)] {
    var out: [(index: Int, range: NSRange)] = []
    for (index, pair) in zip(lineRanges(), lines).enumerated() where pair.1.role == "para" && touches(range, pair.0) { out.append((index: index, range: pair.0)) }
    return out
  }

  private func fontAttributes(_ attrs: [NSAttributedString.Key: Any]) -> (name: String, half: Int, bold: Bool, italic: Bool) {
    let font = attrs[.font] as? UIFont
    let traits = font?.fontDescriptor.symbolicTraits ?? []
    return ((attrs[.docFont] as? String) ?? defaultFont, (attrs[.docSize] as? NSNumber)?.intValue ?? defaultHalf, traits.contains(.traitBold), traits.contains(.traitItalic))
  }

  /// Rewrites the font of every run in `range` through `change`.
  private func refont(_ range: NSRange, _ change: (inout (name: String, half: Int, bold: Bool, italic: Bool)) -> Void) {
    guard range.length > 0 else {
      var value = fontAttributes(editor.typingAttributes)
      change(&value)
      editor.typingAttributes[.font] = DocFonts.font(value.name, size: halfToPx(value.half), bold: value.bold, italic: value.italic)
      editor.typingAttributes[.docFont] = value.name
      editor.typingAttributes[.docSize] = value.half
      return
    }
    storage.enumerateAttributes(in: range) { attrs, slice, _ in
      guard attrs[.attachment] == nil else { return }
      var value = fontAttributes(attrs)
      change(&value)
      storage.addAttributes([.font: DocFonts.font(value.name, size: halfToPx(value.half), bold: value.bold, italic: value.italic), .docFont: value.name, .docSize: value.half], range: slice)
    }
  }

  private func heading(_ range: NSRange, value: String) {
    let points = value == "title" ? 26 : value == "subtitle" ? 15 : value == "h1" ? 20 : value == "h2" ? 16 : value == "h3" ? 14 : defaultHalf / 2
    let bold = value == "h1" || value == "h2" || value == "h3"
    let style = value == "title" ? "Title" : value == "subtitle" ? "Subtitle" : value == "h1" ? "Heading1" : value == "h2" ? "Heading2" : value == "h3" ? "Heading3" : ""
    for item in paragraphsIn(range) {
      let block = lines[item.index].block
      if style.isEmpty { blocks[block].removeValue(forKey: "style") } else { blocks[block]["style"] = style }
      let target = item.range.length > 0 ? item.range : NSRange(location: item.range.location, length: min(1, storage.length - item.range.location))
      refont(target) { $0.half = points * 2; $0.bold = bold }
      if value == "subtitle" && target.length > 0 { storage.addAttribute(.foregroundColor, value: UIColor(white: 0.35, alpha: 1), range: target) }
    }
  }

  private func spacing(_ range: NSRange, name: String, value: String) {
    for item in paragraphsIn(range) {
      let index = lines[item.index].block
      var block = blocks[index]
      let current = { (key: String) in (block[key] as? NSNumber)?.intValue ?? 0 }
      switch name {
      case "indent": block["indent"] = min(7200, max(0, max(0, current("indent")) + (value == "out" ? -720 : 720)))
      case "paraIndent":
        let parts = value.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        if parts.count == 2 {
          let indent = min(14400, max(0, parts[0]))
          block["indent"] = indent
          block["first"] = min(14400, max(-indent, parts[1]))
        }
      case "line": if let number = Double(value) { block["line"] = min(720, max(240, Int((number * 240).rounded()))); block["rule"] = "auto" }
      case "spaceBefore": if let points = Int(value) { block["before"] = min(1440, max(0, points * 20)); block.removeValue(forKey: "cb") }
      case "spaceAfter": if let points = Int(value) { block["after"] = min(1440, max(0, points * 20)); block.removeValue(forKey: "ca") }
      default: break
      }
      blocks[index] = block
      refreshLines(item.index, item.index)
    }
  }

  private func clearFormatting(_ range: NSRange) {
    guard range.length > 0 else { return }
    for key in [NSAttributedString.Key.underlineStyle, .strikethroughStyle, .backgroundColor] { storage.removeAttribute(key, range: range) }
    storage.addAttributes(baseAttributes(), range: range)
  }

  private func insertTable(_ value: String) {
    let parts = value.split(separator: "x").compactMap { Int($0) }
    let rows = max(1, min(parts.first ?? 2, 20)), columns = max(1, min(parts.count > 1 ? parts[1] : 2, 8))
    commit()
    let table: [String: Any] = ["kind": "table", "dirty": true, "borders": true, "rows": (0..<rows).map { _ in (0..<columns).map { _ in ["text": ""] } }]
    insertBlock(table)
  }

  private func insertBlock(_ block: [String: Any]) {
    let index = lineIndex(editor.selectedRange.location).map { lines[$0].block + 1 } ?? blocks.count
    blocks.insert(block, at: min(index, blocks.count))
    if index >= blocks.count - 1 { blocks.append(paragraphBlock("")) }
    sections[sectionIndex]["blocks"] = blocks
    edited = true
    render()
    if let after = lines.firstIndex(where: { $0.block > index }) {
      let ranges = lineRanges()
      if after < ranges.count {
        editor.becomeFirstResponder()
        editor.selectedRange = NSRange(location: min(ranges[after].location, storage.length), length: 0)
      }
    }
    scheduleDraft(); emit()
  }

  private func imageLine() -> Int? {
    guard let index = lineIndex(editor.selectedRange.location), lines[index].role == "image" else { return nil }
    return index
  }

  /// Camera photos carry their rotation as EXIF orientation, which Word ignores, and are often far
  /// larger than a page needs. Returns an upright copy at most 2400 px on its long side, or the file.
  private func uprightImage(_ path: String) throws -> (path: String, image: UIImage) {
    guard let image = UIImage(contentsOfFile: path) else { throw DocumentError("That image could not be read.") }
    let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
    let lower = path.lowercased()
    let native = lower.hasSuffix(".jpg") || lower.hasSuffix(".jpeg") || lower.hasSuffix(".png")
    let limit: CGFloat = 2400
    if native && image.imageOrientation == .up && max(pixels.width, pixels.height) <= limit { return (path, image) }
    let fit = min(1, limit / max(pixels.width, pixels.height))
    let size = CGSize(width: (pixels.width * fit).rounded(), height: (pixels.height * fit).rounded())
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let png = lower.hasSuffix(".png")
    format.opaque = !png
    let upright = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    guard let data = png ? upright.pngData() : upright.jpegData(compressionQuality: 0.9) else { return (path, image) }
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("doc-images", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    if let old = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) {
      let sorted = old.sorted { ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) < ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
      for url in sorted.dropLast(100) { try? FileManager.default.removeItem(at: url) }
    }
    let out = dir.appendingPathComponent("image-\(Int(Date().timeIntervalSince1970 * 1000)).\(png ? "png" : "jpg")")
    try data.write(to: out)
    return (out.path, upright)
  }

  func insertImage(_ path: String) throws {
    let (file, image) = try uprightImage(filePath(path))
    // Inserted at 96 dpi, then limited to the text width like Word does.
    var cx = Int(image.size.width * image.scale * 9525), cy = Int(image.size.height * image.scale * 9525)
    let maxCx = max(1440, pageWidth - marginLeft - marginRight) * 635
    if cx > maxCx { cy = cy * maxCx / max(cx, 1); cx = maxCx }
    let block: [String: Any] = ["kind": "image", "source": file, "cx": cx, "cy": cy, "align": "left", "dirty": true, "preview": file]
    pushUndo()
    commit()
    insertBlock(block)
  }

  func resizeImage(_ percent: Int) throws {
    guard let index = imageLine() else { throw DocumentError("Tap an image first.") }
    var block = blocks[lines[index].block]
    let cx = (block["cx"] as? NSNumber)?.intValue ?? 1
    let cy = (block["cy"] as? NSNumber)?.intValue ?? 1
    let next = max(152400, min(cx * max(10, min(percent, 400)) / 100, 5943600))
    pushUndo()
    commit()
    block["cx"] = next
    block["cy"] = max(1, cy * next / max(cx, 1))
    block["resized"] = true
    block["dirty"] = true
    block.removeValue(forKey: "raw")
    blocks[lines[index].block] = block
    edited = true
    render(); scheduleDraft(); emit()
  }

  func setSection(_ index: Int) throws {
    guard sections.indices.contains(index), index != sectionIndex else { return }
    commit(); sectionIndex = index; blocks = sections[index]["blocks"] as? [[String: Any]] ?? []; render(); pageScroll.contentOffset = .zero; emit()
  }

  func save(_ output: String) throws {
    commit()
    let path = filePath(output)
    if format == "txt" && !path.lowercased().hasSuffix(".docx") { try plain().write(toFile: path, atomically: true, encoding: .utf8) }
    else {
      var request: [String: Any] = ["action": "save", "output": path, "sect": sect, "hf": hf, "page": pageSetup, "defaults": defaults, "sections": sections]
      if !blank && format == "docx" && !sourcePath.isEmpty { request["source"] = sourcePath }
      let result = try json(DocxBridge.run(stringify(request)))
      if let message = result["message"] as? String, result["error"] != nil { throw DocumentError(message) }
    }
    try? FileManager.default.removeItem(at: draft())
    edited = false; emit()
  }

  func exportPdf(_ output: String) throws {
    commit()
    guard scale > 0 else { throw DocumentError("Could not lay out this document.") }
    layoutSheet()
    let page = CGRect(x: 0, y: 0, width: CGFloat(pageWidth) / 20, height: CGFloat(pageHeight) / 20)
    let shrink = 1 / scale
    let pages = pageCount
    let renderer = UIGraphicsPDFRenderer(bounds: page)
    try renderer.writePDF(to: URL(fileURLWithPath: filePath(output))) { context in
      for index in 0..<pages {
        context.beginPage()
        context.cgContext.saveGState()
        context.cgContext.scaleBy(x: shrink, y: shrink)
        drawPage(index)
        context.cgContext.restoreGState()
      }
    }
  }

  func exportText(_ output: String) throws { commit(); try plain().write(toFile: filePath(output), atomically: true, encoding: .utf8) }
  func discard() { try? FileManager.default.removeItem(at: draft()); edited = false; emit() }

  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    guard !updating else { return true }
    for (lineRange, line) in zip(lineRanges(), lines) where NSIntersectionRange(range, lineRange).length > 0 || (range.length == 0 && NSLocationInRange(range.location, lineRange)) || (range.length == 0 && range.location == NSMaxRange(lineRange)) {
      if line.role == "locked" || line.role == "tableStart" || line.role == "tableEnd" { return false }
      if line.role == "image" && !(text.isEmpty && range.location <= lineRange.location && NSMaxRange(range) >= NSMaxRange(lineRange)) { return false }
    }
    beforeText = textView.text ?? ""
    changeRange = range
    changeLength = (text as NSString).length
    changeOld = storage.attributedSubstring(from: range)
    let now = Date().timeIntervalSince1970
    if now - lastPush > 0.45 { pushUndo(); lastPush = now }
    return true
  }

  func textViewDidChange(_ textView: UITextView) {
    guard !updating else { return }
    accept(before: beforeText, after: textView.text ?? "")
    layoutSheet()
    revealCaret()
  }

  // ---------- Loading ----------
  private func loadModel() throws -> [String: Any] {
    let file = draft()
    if FileManager.default.fileExists(atPath: file.path), let data = try? Data(contentsOf: file), data.count < 8_000_000, let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      restored = true
      return prepareMedia(saved)
    }
    restored = false
    let result: [String: Any]
    if blank { result = try json(DocxBridge.run("{\"action\":\"blank\"}")) }
    else if format == "txt" { result = try textModel(String(contentsOfFile: sourcePath, encoding: .utf8)) }
    else {
      result = try json(DocxBridge.run(stringify(["action": "open", "path": sourcePath])))
      if let message = result["message"] as? String, result["error"] != nil { throw DocumentError(message) }
    }
    return prepareMedia(result)
  }

  private func prepareMedia(_ model: [String: Any]) -> [String: Any] {
    guard !blank, format != "txt", !sourcePath.isEmpty else { return model }
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("versara-doc-media", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let original = (try? FileManager.default.attributesOfItem(atPath: sourcePath)) ?? [:]
    let prefix = String(format: "%08x_%llx_%llx", UInt32(truncatingIfNeeded: sourcePath.hashValue), (original[.size] as? NSNumber)?.uint64Value ?? 0, UInt64((original[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0))
    let cached = ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])) ?? [])
      .map { url -> (URL, Int64, Date) in
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        return (url, Int64(values?.fileSize ?? 0), values?.contentModificationDate ?? .distantPast)
      }.sorted { $0.2 < $1.2 }
    var bytes = cached.reduce(Int64(0)) { $0 + $1.1 }
    for (url, size, _) in cached where bytes > 192 * 1024 * 1024 && !url.lastPathComponent.hasPrefix(prefix + "_") {
      do { try FileManager.default.removeItem(at: url); bytes -= size } catch { }
    }
    return withPreviews(model, folder: folder, prefix: prefix) as? [String: Any] ?? model
  }

  /// Extracts every picture the document shows, including ones inside tables and text runs.
  private func withPreviews(_ node: Any, folder: URL, prefix: String) -> Any {
    if var dict = node as? [String: Any] {
      if let media = dict["media"] as? String, !media.isEmpty {
        let mediaKey = String(format: "%08x", UInt32(truncatingIfNeeded: media.hashValue))
        let dest = folder.appendingPathComponent(prefix + "_" + mediaKey + "_" + (media as NSString).lastPathComponent)
        if ((try? dest.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) == 0 {
          _ = DocxBridge.run(stringify(["action": "media", "path": sourcePath, "name": media, "output": dest.path]))
        }
        if ((try? dest.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) > 0 { dict["preview"] = dest.path }
        else { dict.removeValue(forKey: "preview") }
      }
      for key in ["sections", "blocks", "runs", "table", "rows", "cells", "paras"] {
        if let child = dict[key] { dict[key] = withPreviews(child, folder: folder, prefix: prefix) }
      }
      return dict
    }
    if let list = node as? [Any] { return list.map { withPreviews($0, folder: folder, prefix: prefix) } }
    return node
  }

  private func present(_ model: [String: Any]) {
    sect = model["sect"] as? String ?? ""
    hf = model["hf"] as? [String: Any] ?? [:]
    pageSetup = model["page"] as? [String: Any] ?? [:]
    defaults = model["defaults"] as? [String: Any] ?? ["font": "Calibri", "size": 22, "before": 0, "after": format == "txt" ? 0 : 160, "line": format == "txt" ? 240 : 259, "rule": "auto"]
    sections = model["sections"] as? [[String: Any]] ?? []
    if sections.isEmpty { sections = [["blocks": [paragraphBlock("")]]] }
    sectionIndex = 0
    blocks = sections[0]["blocks"] as? [[String: Any]] ?? []
    undoStack.removeAll(); redoStack.removeAll(); edited = restored
    zoom = 1
    scale = 0
    _ = updateScale()
    render()
    let locked = sections.reduce(0) { total, section in total + ((section["blocks"] as? [[String: Any]])?.filter { $0["kind"] as? String == "locked" }.count ?? 0) }
    var bands = hf
    bands.removeValue(forKey: "dirty")
    let paper: [String: Any] = ["w": pageWidth, "h": pageHeight, "top": marginTop, "right": marginRight, "bottom": marginBottom, "left": marginLeft]
    setNeedsLayout()
    onReady(["characters": storage.length, "sections": sections.count, "section": 0, "locked": locked, "restored": restored, "hf": stringify(bands), "page": stringify(paper)])
    emit()
    reportFormat()
  }

  // ---------- Rendering ----------
  private func render() {
    guard !sections.isEmpty else { return }
    if scale <= 0 { _ = updateScale() }
    guard scale > 0 else { return }
    applyGeometry()
    if sectionIndex == sections.count - 1, let tail = blocks.last, let kind = tail["kind"] as? String, kind != "paragraph", !(kind == "locked" && tail["runs"] != nil) {
      blocks.append(paragraphBlock(""))
      sections[sectionIndex]["blocks"] = blocks
    }
    _ = renumber()
    let text = NSMutableAttributedString()
    var breakNext = false
    for block in blocks {
      let start = text.length
      let kind = block["kind"] as? String ?? "paragraph"
      let table = kind == "locked" ? block["table"] as? [String: Any] : nil
      if let table, let rows = table["rows"] as? [[String: Any]], !rows.isEmpty { appendLockedTable(text, table) }
      else if kind == "image" { appendImage(text, block) }
      else if kind == "table" { appendTable(text, block) }
      else if kind == "locked" && block["runs"] == nil { appendLabel(text, block) }
      else { appendParagraph(text, block, width: contentW) }
      if (breakNext || block["pbb"] as? Bool == true || block["brB"] as? Bool == true) && text.length > start {
        text.addAttribute(.docBreak, value: true, range: NSRange(location: start, length: 1))
      }
      breakNext = block["brA"] as? Bool == true
    }
    lines = structure()
    let selection = editor.selectedRange
    updating = true
    storage.setAttributedString(text)
    editor.selectedRange = NSRange(location: min(selection.location, max(0, text.length - 1)), length: 0)
    editor.typingAttributes = text.length > 0 ? text.attributes(at: min(editor.selectedRange.location, text.length - 1), effectiveRange: nil) : baseAttributes()
    updating = false
    thumbCache.removeAll()
    layoutSheet()
    schedulePages()
  }

  private func runAttributes(_ run: [String: Any]) -> [NSAttributedString.Key: Any] {
    let half = max(2, min((run["size"] as? NSNumber)?.intValue ?? defaultHalf, 3276))
    let name = (run["font"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? defaultFont
    var attrs: [NSAttributedString.Key: Any] = [
      .font: DocFonts.font(name, size: halfToPx(half), bold: run["bold"] as? Bool == true, italic: run["italic"] as? Bool == true),
      .foregroundColor: (run["color"] as? String).flatMap { UIColor(hex: $0) } ?? ink,
      .docFont: name, .docSize: half,
    ]
    if run["underline"] as? Bool == true { attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue }
    if run["strike"] as? Bool == true { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
    if let color = (run["highlight"] as? String).flatMap({ UIColor(hex: $0) }) { attrs[.backgroundColor] = color }
    return attrs
  }

  /// Appends a paragraph and its newline. Cells draw markers as text since their layout has no marker pass.
  private func appendParagraph(_ text: NSMutableAttributedString, _ block: [String: Any], width: CGFloat, inlineMarker: Bool = false) {
    let start = text.length
    let runs = block["runs"] as? [[String: Any]] ?? []
    var last: [NSAttributedString.Key: Any]?
    if inlineMarker, let marker = markerText(block) {
      var attrs = runAttributes(runs.first ?? [:])
      attrs[.font] = markerFont(block)
      text.append(NSAttributedString(string: marker + "\t", attributes: attrs))
    }
    for run in runs {
      let body = ((run["text"] as? String) ?? "").replacingOccurrences(of: "\n", with: "\u{2028}")
      if let media = run["media"] as? String, !media.isEmpty, !body.isEmpty {
        let room = imageRoom(block, width: width)
        text.append(imageString(cx: (run["cx"] as? NSNumber)?.doubleValue ?? 0, cy: (run["cy"] as? NSNumber)?.doubleValue ?? 0, path: run["preview"] as? String, maxWidth: room.width, maxHeight: room.height))
        continue
      }
      let attrs = runAttributes(run)
      last = attrs
      if !body.isEmpty { text.append(NSAttributedString(string: body, attributes: attrs)) }
    }
    text.append(NSAttributedString(string: "\n", attributes: last ?? baseAttributes()))
    applyParagraph(text, block, range: NSRange(location: start, length: text.length - start), width: width, drawMarker: !inlineMarker)
  }

  private func markerText(_ block: [String: Any]) -> String? {
    guard let marker = block["marker"] as? String, !marker.isEmpty, (block["list"] as? String ?? "none") != "none" else { return nil }
    return marker
  }

  private func markerFont(_ block: [String: Any]) -> UIFont {
    let run = (block["runs"] as? [[String: Any]])?.first
    let half = (block["ms"] as? NSNumber)?.intValue ?? (run?["size"] as? NSNumber)?.intValue ?? defaultHalf
    let name = (block["mf"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (run?["font"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? defaultFont
    return DocFonts.font(name, size: halfToPx(max(2, half)), bold: block["mb"] as? Bool == true, italic: false)
  }

  private func nextTab(_ x: CGFloat, _ block: [String: Any]) -> CGFloat {
    for tab in (block["tabs"] as? [[Any]]) ?? [] {
      if let pos = (tab.first as? NSNumber)?.intValue, px(pos) > x + 1 { return px(pos) }
    }
    let step = max(1, px(720))
    return (floor(x / step) + 1) * step
  }

  private func applyParagraph(_ text: NSMutableAttributedString, _ block: [String: Any], range: NSRange, width: CGFloat, drawMarker: Bool = true) {
    guard range.length > 0 else { return }
    let number = { (key: String, fallback: Int) in (block[key] as? NSNumber)?.intValue ?? fallback }
    let style = NSMutableParagraphStyle()
    switch block["align"] as? String {
    case "center": style.alignment = .center
    case "right": style.alignment = .right
    case "justify": style.alignment = .justified
    default: style.alignment = .left
    }
    let indent = max(0, number("indent", 0)), first = number("first", 0), right = number("right", 0)
    let rest = px(indent)
    let markerX = max(0, px(indent + first))
    var firstPx = markerX
    if let marker = markerText(block) {
      let font = markerFont(block)
      let markerEnd = markerX + (marker as NSString).size(withAttributes: [.font: font]).width
      if drawMarker {
        firstPx = first < 0 && markerEnd < rest ? rest : nextTab(markerEnd, block)
        let color = (block["mc"] as? String).flatMap { UIColor(hex: $0) } ?? ink
        text.addAttribute(.docMarker, value: DocMarker(text: marker, x: markerX, font: font, color: color), range: range)
      }
    }
    style.firstLineHeadIndent = firstPx
    style.headIndent = rest
    if right > 0 { style.tailIndent = -px(right) }
    let hasLine = block["line"] != nil
    let line = max(1, hasLine ? number("line", 240) : defaultNumber("line", 240))
    let rule = hasLine ? (block["rule"] as? String ?? "auto") : (defaults["rule"] as? String ?? "auto")
    switch rule {
    case "exact":
      var hasImage = false
      text.enumerateAttribute(.attachment, in: range) { value, _, stop in
        if value != nil { hasImage = true; stop.pointee = true }
      }
      style.minimumLineHeight = px(line)
      if !hasImage { style.maximumLineHeight = px(line) }
    case "atLeast": style.minimumLineHeight = px(line)
    default: if line != 240 { style.lineHeightMultiple = CGFloat(line) / 240 }
    }
    style.paragraphSpacingBefore = block["cb"] as? Bool == true ? 0 : px(max(0, number("before", defaultNumber("before", 0))))
    style.paragraphSpacing = block["ca"] as? Bool == true ? 0 : px(max(0, number("after", defaultNumber("after", 0))))
    var stops: [NSTextTab] = []
    var leaders: [(x: CGFloat, leader: String)] = []
    for tab in (block["tabs"] as? [[Any]]) ?? [] {
      guard let pos = (tab.first as? NSNumber)?.intValue else { continue }
      let kind = tab.count > 1 ? tab[1] as? String : nil
      if kind == "decimal" {
        stops.append(NSTextTab(textAlignment: .right, location: px(pos), options: [.columnTerminators: NSTextTab.columnTerminators(for: Locale(identifier: "en_US"))]))
      } else {
        stops.append(NSTextTab(textAlignment: kind == "right" ? .right : kind == "center" ? .center : .left, location: px(pos)))
      }
      if tab.count > 2, let leader = tab[2] as? String, !leader.isEmpty { leaders.append((x: px(pos), leader: leader)) }
    }
    style.tabStops = stops.sorted { $0.location < $1.location }
    if !leaders.isEmpty { text.addAttribute(.docLeaders, value: DocLeaders(stops: leaders.sorted { $0.x < $1.x }), range: range) }
    style.defaultTabInterval = max(1, px(720))
    text.addAttribute(.paragraphStyle, value: style, range: range)
  }

  private func appendLabel(_ text: NSMutableAttributedString, _ block: [String: Any]) {
    let start = text.length
    var attrs = baseAttributes()
    attrs[.font] = DocFonts.font(defaultFont, size: halfToPx(defaultHalf), bold: false, italic: true)
    attrs[.foregroundColor] = UIColor(red: 0.5, green: 0.53, blue: 0.55, alpha: 1)
    text.append(NSAttributedString(string: "[\(block["label"] as? String ?? "Locked content")]\n", attributes: attrs))
    applyParagraph(text, ["after": defaultNumber("after", 0), "line": 240], range: NSRange(location: start, length: text.length - start), width: contentW)
  }

  private func appendImage(_ text: NSMutableAttributedString, _ block: [String: Any]) {
    let start = text.length
    let path = (block["preview"] as? String) ?? (block["source"] as? String)
    let room = imageRoom(block, width: contentW)
    text.append(imageString(cx: (block["cx"] as? NSNumber)?.doubleValue ?? 0, cy: (block["cy"] as? NSNumber)?.doubleValue ?? 0, path: path, maxWidth: room.width, maxHeight: room.height))
    text.append(NSAttributedString(string: "\n", attributes: baseAttributes()))
    applyParagraph(text, ["align": block["align"] ?? "left", "before": block["before"] ?? 0, "after": block["after"] ?? 0, "line": 240], range: NSRange(location: start, length: text.length - start), width: contentW)
  }

  /** Keep the attachment, line spacing and paragraph spacing inside one page body. */
  private func imageRoom(_ block: [String: Any], width: CGFloat) -> CGSize {
    let number = { (key: String, fallback: Int) in (block[key] as? NSNumber)?.intValue ?? fallback }
    let indent = max(0, number("indent", 0))
    let left = max(px(indent), px(max(0, indent + number("first", 0))))
    let right = px(max(0, number("right", 0)))
    let before = block["cb"] as? Bool == true ? 0 : px(max(0, number("before", defaultNumber("before", 0))))
    let after = block["ca"] as? Bool == true ? 0 : px(max(0, number("after", defaultNumber("after", 0))))
    let line = max(1, number("line", defaultNumber("line", 240)))
    let rule = block["rule"] as? String ?? defaults["rule"] as? String ?? "auto"
    let multiple = rule == "auto" ? max(1, CGFloat(line) / 240) : 1
    let reserve = halfToPx(defaultHalf) + 2
    return CGSize(width: max(1, width - left - right), height: max(1, (contentH - before - after - reserve) / multiple))
  }

  private func imageString(cx: Double, cy: Double, path: String?, maxWidth: CGFloat, maxHeight: CGFloat) -> NSAttributedString {
    var width = CGFloat(cx) / 12700 * scale, height = CGFloat(cy) / 12700 * scale
    if width <= 0 || height <= 0 {
      if let path, let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
         let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as NSDictionary?,
         let pixelsW = properties[kCGImagePropertyPixelWidth] as? NSNumber,
         let pixelsH = properties[kCGImagePropertyPixelHeight] as? NSNumber {
        width = CGFloat(truncating: pixelsW) * scale
        height = CGFloat(truncating: pixelsH) * scale
      } else { width = 120; height = 90 }
    }
    if width > maxWidth { height *= maxWidth / width; width = maxWidth }
    if height > maxHeight { width *= maxHeight / height; height = maxHeight }
    let attachment = NSTextAttachment()
    attachment.image = path.flatMap { image(at: $0, maxPixels: max(width, height) * UIScreen.main.scale) } ?? UIImage.from(color: UIColor(white: 0.91, alpha: 1))
    attachment.bounds = CGRect(x: 0, y: 0, width: max(1, width), height: max(1, height))
    let result = NSMutableAttributedString(attachment: attachment)
    result.addAttributes(baseAttributes(), range: NSRange(location: 0, length: result.length))
    return result
  }

  /// Decodes a picture no larger than it's shown, reusing recent decodes.
  private func image(at path: String, maxPixels: CGFloat) -> UIImage? {
    let key = "\(path)@\(Int(maxPixels))" as NSString
    if let hit = images.object(forKey: key) { return hit }
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: max(16, Int(maxPixels))]
    guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    let image = UIImage(cgImage: cg)
    images.setObject(image, forKey: key, cost: cg.bytesPerRow * cg.height)
    return image
  }

  /// Column edges of a table in points, fitted to the text width when the grid is wider.
  private func tableEdges(_ cols: [Int], count: Int) -> [CGFloat] {
    let room = max(1440, pageWidth - marginLeft - marginRight)
    var widths = (0..<max(1, count)).map { $0 < cols.count ? cols[$0] : 0 }
    if widths.contains(where: { $0 <= 0 }) { widths = Array(repeating: room / widths.count, count: widths.count) }
    let total = CGFloat(widths.reduce(0, +))
    let fit = total > CGFloat(room) * 1.05 ? CGFloat(room) / total : 1
    var edges: [CGFloat] = [0]
    var sum: CGFloat = 0
    for width in widths { sum += CGFloat(width) * fit; edges.append(sum / 20 * scale) }
    return edges
  }

  private func tinyLine(_ text: NSMutableAttributedString) {
    let style = NSMutableParagraphStyle()
    style.minimumLineHeight = 2
    style.maximumLineHeight = 2
    text.append(NSAttributedString(string: "\u{2063}\n", attributes: [.font: UIFont.systemFont(ofSize: 1), .paragraphStyle: style, .foregroundColor: UIColor.clear]))
  }

  /// An editable table: one line per row with tab stops at the column edges and a drawn grid.
  private func appendTable(_ text: NSMutableAttributedString, _ block: [String: Any]) {
    let rows = block["rows"] as? [[[String: Any]]] ?? []
    let columns = max(1, rows.map(\.count).max() ?? 1)
    let edges = tableEdges((block["cols"] as? [NSNumber])?.map(\.intValue) ?? [], count: columns)
    let pad = px(108)
    let borders = block["borders"] as? Bool ?? true
    tinyLine(text)
    for cells in rows {
      let start = text.length
      var fills: [UIColor?] = Array(repeating: nil, count: columns)
      var last = baseAttributes()
      for (index, cell) in cells.enumerated() {
        if index > 0 { text.append(NSAttributedString(string: "\t", attributes: last)) }
        last = runAttributes(cell)
        text.append(NSAttributedString(string: cell["text"] as? String ?? "", attributes: last))
        if index < columns { fills[index] = (cell["fill"] as? String).flatMap { UIColor(hex: $0) } }
      }
      text.append(NSAttributedString(string: "\n", attributes: last))
      let range = NSRange(location: start, length: text.length - start)
      let style = NSMutableParagraphStyle()
      style.headIndent = pad
      style.firstLineHeadIndent = pad
      style.paragraphSpacingBefore = px(20)
      style.paragraphSpacing = px(20)
      style.tabStops = (1..<max(2, columns)).compactMap { $0 < edges.count - 1 ? NSTextTab(textAlignment: .left, location: edges[$0] + pad) : nil }
      text.addAttribute(.paragraphStyle, value: style, range: range)
      text.addAttribute(.docGrid, value: DocGrid(edges: edges, fills: fills, borders: borders), range: range)
    }
    tinyLine(text)
  }

  /// A read-only table drawn row by row with its real cell text, shading, merges and borders.
  private func appendLockedTable(_ text: NSMutableAttributedString, _ table: [String: Any]) {
    let rows = table["rows"] as? [[String: Any]] ?? []
    let cols = (table["cols"] as? [NSNumber])?.map(\.intValue) ?? []
    var columns = cols.count
    for row in rows {
      let cells = row["cells"] as? [[String: Any]] ?? []
      columns = max(columns, cells.reduce(0) { $0 + max(1, ($1["span"] as? NSNumber)?.intValue ?? 1) })
    }
    let edges = tableEdges(cols, count: columns)
    let padX = px(108), padY = max(1, px(10))
    let borders = table["borders"] as? Bool ?? true
    var built: [([DocRowCell], CGFloat)] = []
    for row in rows {
      var list: [DocRowCell] = []
      var column = 0
      var height: CGFloat = 0
      for cell in row["cells"] as? [[String: Any]] ?? [] {
        let span = max(1, (cell["span"] as? NSNumber)?.intValue ?? 1)
        let x = edges[min(column, columns)], right = edges[min(column + span, columns)]
        column += span
        let continued = (cell["vm"] as? NSNumber)?.intValue == 2
        var body: NSAttributedString?
        if !continued {
          let content = NSMutableAttributedString()
          for para in cell["paras"] as? [[String: Any]] ?? [] { appendParagraph(content, para, width: max(1, right - x - 2 * padX), inlineMarker: true) }
          if content.length > 0 && content.string.hasSuffix("\n") { content.deleteCharacters(in: NSRange(location: content.length - 1, length: 1)) }
          body = content
          let size = content.boundingRect(with: CGSize(width: max(1, right - x - 2 * padX), height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).size
          height = max(height, ceil(size.height) + 2 * padY)
        }
        list.append(DocRowCell(x: x, width: max(1, right - x), text: body, fill: (cell["fill"] as? String).flatMap { UIColor(hex: $0) }, valign: cell["va"] as? String ?? "", continued: continued))
      }
      let given = px((row["h"] as? NSNumber)?.intValue ?? 0)
      height = row["exact"] as? Bool == true && given > 0 ? given : max(height, given, 2 * padY)
      built.append((list, height))
    }
    for index in built.indices.dropLast() {
      for cell in built[index].0 { cell.openBelow = built[index + 1].0.contains { $0.continued && abs($0.x - cell.x) < 0.5 } }
    }
    let width = edges.last ?? contentW
    for (index, item) in built.enumerated() {
      let attachment = NSTextAttachment()
      attachment.image = UIImage.from(color: .clear)
      attachment.bounds = CGRect(x: 0, y: 0, width: width, height: item.1)
      let style = NSMutableParagraphStyle()
      style.minimumLineHeight = item.1
      style.maximumLineHeight = item.1
      let row = DocRow(cells: item.0, height: item.1, padX: padX, padY: padY, borders: borders, last: index == built.count - 1)
      let line = NSMutableAttributedString(attachment: attachment)
      line.append(NSAttributedString(string: "\n"))
      line.addAttributes([.font: UIFont.systemFont(ofSize: 1), .paragraphStyle: style, .docRow: row], range: NSRange(location: 0, length: line.length))
      text.append(line)
    }
  }

  /// Numbers list paragraphs again after items are added, removed or changed; returns changed blocks.
  private func renumber() -> Set<Int> {
    var changed = Set<Int>()
    var counters: [String: Int] = [:]
    var auto = 0
    let digits = try? NSRegularExpression(pattern: "(\\d+)(?!.*\\d)")
    for index in blocks.indices {
      let block = blocks[index]
      let kind = block["kind"] as? String ?? ""
      guard kind == "paragraph" || kind == "locked" else { auto = 0; continue }
      let list = block["list"] as? String ?? "none"
      let num = block["num"] as? String ?? ""
      let marker = block["marker"] as? String ?? ""
      if !num.isEmpty && list != "none" {
        let level = (block["ilvl"] as? NSNumber)?.intValue ?? 0
        for key in counters.keys where key.hasPrefix("\(num)/") && (Int(key.split(separator: "/").last ?? "") ?? 0) > level { counters.removeValue(forKey: key) }
        let key = "\(num)/\(level)"
        let ns = marker as NSString
        guard let match = digits?.firstMatch(in: marker, range: NSRange(location: 0, length: ns.length)), let found = Int(ns.substring(with: match.range)) else { continue }
        let value = counters[key].map { $0 + 1 } ?? found
        counters[key] = value
        if kind == "paragraph" && found != value {
          blocks[index]["marker"] = ns.replacingCharacters(in: match.range, with: String(value))
          changed.insert(index)
        }
        auto = 0
      } else if list == "decimal" && kind == "paragraph" {
        auto += 1
        if marker != "\(auto)." { blocks[index]["marker"] = "\(auto)."; changed.insert(index) }
      } else {
        if list == "bullet" && kind == "paragraph" && marker.isEmpty { blocks[index]["marker"] = "\u{2022}"; changed.insert(index) }
        auto = 0
      }
    }
    if !changed.isEmpty && sections.indices.contains(sectionIndex) { sections[sectionIndex]["blocks"] = blocks }
    return changed
  }

  // ---------- Editing ----------
  private func needsBreak(_ index: Int) -> Bool {
    guard blocks.indices.contains(index) else { return false }
    let block = blocks[index]
    return block["pbb"] as? Bool == true || block["brB"] as? Bool == true || (index > 0 && blocks[index - 1]["brA"] as? Bool == true)
  }

  /// Rebuilds the paragraph attributes of lines `from...to` from their blocks.
  private func refreshLines(_ from: Int, _ to: Int) {
    let ranges = lineRanges()
    guard !lines.isEmpty else { return }
    let low = max(0, from), high = min(to, lines.count - 1)
    guard low <= high else { return }
    storage.beginEditing()
    for index in low...high where lines[index].role == "para" && index < ranges.count {
      let range = ranges[index]
      let full = NSRange(location: range.location, length: min(range.length + 1, storage.length - range.location))
      guard full.length > 0 else { continue }
      storage.removeAttribute(.docMarker, range: full)
      storage.removeAttribute(.docBreak, range: full)
      applyParagraph(storage, blocks[lines[index].block], range: full, width: contentW)
      if needsBreak(lines[index].block) { storage.addAttribute(.docBreak, value: true, range: NSRange(location: full.location, length: 1)) }
    }
    storage.endEditing()
  }

  private func refreshBlocks(_ indexes: Set<Int>) {
    guard !indexes.isEmpty else { return }
    for (index, line) in lines.enumerated() where indexes.contains(line.block) { refreshLines(index, index) }
  }

  private func accept(before: String, after: String) {
    let old = linesOf(before)
    let neu = linesOf(after)
    guard old.count == lines.count else { revert(); return }
    var start = 0
    while start < old.count && start < neu.count && old[start] == neu[start] { start += 1 }
    var endOld = old.count - 1, endNew = neu.count - 1
    while endOld >= start && endNew >= start && old[endOld] == neu[endNew] { endOld -= 1; endNew -= 1 }
    if start > endOld && start > endNew { return }
    let removed = start <= endOld ? Array(lines[start...endOld]) : []
    let added = start <= endNew ? Array(neu[start...endNew]) : []
    if removed.contains(where: { ["locked", "tableStart", "tableEnd"].contains($0.role) }) { revert(); return }
    if removed.contains(where: { $0.role == "image" }) && !added.isEmpty { revert(); return }
    if !removed.isEmpty && removed.allSatisfy({ $0.role == "image" }) && added.isEmpty {
      let drop = Set(removed.map(\.block))
      blocks = blocks.enumerated().filter { !drop.contains($0.offset) }.map(\.element)
      if blocks.isEmpty { blocks = [paragraphBlock("")] }
      sections[sectionIndex]["blocks"] = blocks
      lines = structure()
      edited = true; scheduleDraft(); emit(); return
    }
    if !removed.isEmpty && removed.allSatisfy({ $0.role == "tableRow" }) && Set(removed.map(\.block)).count == 1 && added.count == removed.count {
      for (offset, line) in removed.enumerated() { updateRow(line, text: added[offset]) }
      edited = true; scheduleDraft(); emit(); return
    }
    if removed.contains(where: { $0.role != "para" }) { revert(); return }
    if removed.isEmpty && start > 0 && start < lines.count && lines[start - 1].block == lines[start].block { revert(); return }
    if removed.count == added.count {
      for line in removed { blocks[line.block]["dirty"] = true; blocks[line.block].removeValue(forKey: "raw") }
    } else {
      let at = removed.first?.block ?? (start < lines.count ? lines[start].block : blocks.count)
      let kept = removed.first.map { blocks[$0.block] }
      let neighbour = [start - 1, start].first { $0 >= 0 && $0 < lines.count && lines[$0].role == "para" }
      let template = kept ?? neighbour.map { blocks[lines[$0].block] }
      var replacement: [[String: Any]] = []
      for (offset, text) in added.enumerated() {
        if offset == 0, var first = kept {
          first["dirty"] = true
          first.removeValue(forKey: "raw")
          replacement.append(first)
          continue
        }
        var fresh = paragraphBlock(text.replacingOccurrences(of: "\u{2028}", with: "\n"))
        if let template {
          for key in ["align", "list", "style", "num", "numKind", "marker", "mf", "mc", "rule", "indent", "right", "first", "before", "after", "line", "ilvl", "ms", "mb", "cb", "ca", "tabs"] { if let value = template[key] { fresh[key] = value } }
          if let extras = template["px"] as? String {
            let cleaned = extras.replacingOccurrences(of: "<[A-Za-z]*:?pageBreakBefore[^>]*/>", with: "", options: .regularExpression)
            if !cleaned.isEmpty { fresh["px"] = cleaned }
          }
        }
        replacement.append(fresh)
      }
      let drop = Set(removed.map(\.block))
      var next: [[String: Any]] = []
      for (index, block) in blocks.enumerated() {
        if index == at { next += replacement }
        if !drop.contains(index) { next.append(block) }
      }
      if at >= blocks.count { next += replacement }
      blocks = next.isEmpty ? [paragraphBlock("")] : next
      sections[sectionIndex]["blocks"] = blocks
      lines = structure()
      if lines.count != neu.count { render(); edited = true; scheduleDraft(); emit(); return }
      let changed = renumber()
      refreshLines(start - 1, start + added.count)
      refreshBlocks(changed)
    }
    edited = true
    scheduleDraft(); emit()
  }

  private func linesFor(_ index: Int, _ block: [String: Any]) -> [(block: Int, role: String, row: Int)] {
    switch block["kind"] as? String {
    case "locked":
      let rows = ((block["table"] as? [String: Any])?["rows"] as? [Any])?.count ?? 0
      return rows > 0 ? (0..<rows).map { (index, "locked", $0) } : [(index, "locked", -1)]
    case "image": return [(index, "image", -1)]
    case "table":
      let rows = (block["rows"] as? [Any])?.count ?? 0
      return [(index, "tableStart", -1)] + (0..<rows).map { (index, "tableRow", $0) } + [(index, "tableEnd", -1)]
    default: return [(index, "para", -1)]
    }
  }

  private func structure() -> [(block: Int, role: String, row: Int)] {
    blocks.enumerated().flatMap { linesFor($0.offset, $0.element) }
  }

  private func commit() {
    guard sections.indices.contains(sectionIndex) else { return }
    let ranges = lineRanges()
    for (index, line) in lines.enumerated() where line.role == "para" && index < ranges.count {
      guard (blocks[line.block]["dirty"] as? Bool) == true else { continue }
      blocks[line.block]["runs"] = runs(ranges[index])
    }
    sections[sectionIndex]["blocks"] = blocks
  }

  private func runInfo(_ attrs: [NSAttributedString.Key: Any]) -> [String: Any] {
    var run: [String: Any] = [:]
    let font = fontAttributes(attrs)
    if font.bold { run["bold"] = true }
    if font.italic { run["italic"] = true }
    run["size"] = font.half
    run["font"] = font.name
    if attrs[.underlineStyle] != nil { run["underline"] = true }
    if attrs[.strikethroughStyle] != nil { run["strike"] = true }
    if let color = attrs[.foregroundColor] as? UIColor, let hex = color.hex, hex != "000000" { run["color"] = hex }
    if let color = attrs[.backgroundColor] as? UIColor, let hex = color.hex { run["highlight"] = hex }
    return run
  }

  private func runs(_ range: NSRange) -> [[String: Any]] {
    var values: [[String: Any]] = []
    guard range.location <= storage.length else { return [["text": ""]] }
    let safe = NSRange(location: range.location, length: min(range.length, storage.length - range.location))
    storage.enumerateAttributes(in: safe, options: []) { attrs, slice, _ in
      let body = storage.attributedSubstring(from: slice).string.replacingOccurrences(of: "\u{2028}", with: "\n")
      guard !body.isEmpty else { return }
      var run = runInfo(attrs)
      run["text"] = body
      values.append(run)
    }
    if values.isEmpty {
      var run = range.location < storage.length ? runInfo(storage.attributes(at: range.location, effectiveRange: nil)) : [:]
      run["text"] = ""
      values.append(run)
    }
    return values
  }

  private func touches(_ range: NSRange, _ lineRange: NSRange) -> Bool {
    NSIntersectionRange(range, lineRange).length > 0 || (range.location >= lineRange.location && range.location <= NSMaxRange(lineRange))
  }
  private func toggle(_ range: NSRange, bold: Bool) {
    let probe = range.length > 0 ? fontAttributes(storage.attributes(at: range.location, effectiveRange: nil)) : fontAttributes(editor.typingAttributes)
    let on = !(bold ? probe.bold : probe.italic)
    refont(range) { if bold { $0.bold = on } else { $0.italic = on } }
  }
  private func toggleFlag(_ range: NSRange, key: NSAttributedString.Key) {
    if range.length == 0 {
      if editor.typingAttributes[key] != nil { editor.typingAttributes.removeValue(forKey: key) }
      else { editor.typingAttributes[key] = NSUnderlineStyle.single.rawValue }
      return
    }
    let present = storage.attribute(key, at: range.location, effectiveRange: nil) != nil
    if present { storage.removeAttribute(key, range: range) }
    else { storage.addAttribute(key, value: NSUnderlineStyle.single.rawValue, range: range) }
  }
  private func paint(_ range: NSRange, value: String, background: Bool) {
    let key: NSAttributedString.Key = background ? .backgroundColor : .foregroundColor
    if range.length == 0 {
      if let color = value.isEmpty ? (background ? nil : ink) : UIColor(hex: value) { editor.typingAttributes[key] = color }
      else { editor.typingAttributes.removeValue(forKey: key) }
      return
    }
    if value.isEmpty {
      if background { storage.removeAttribute(key, range: range) } else { storage.addAttribute(key, value: ink, range: range) }
      return
    }
    if let color = UIColor(hex: value) { storage.addAttribute(key, value: color, range: range) }
  }
  private func size(_ range: NSRange, points: Int) {
    refont(range) { $0.half = max(1, min(points, 400)) * 2 }
  }
  private func paragraph(_ range: NSRange, align: String? = nil, list: String? = nil) {
    var touched: [Int] = []
    for item in paragraphsIn(range) {
      let index = lines[item.index].block
      if let align { blocks[index]["align"] = align }
      if let list {
        let was = blocks[index]["list"] as? String ?? "none"
        let listKeys = ["num", "ilvl", "numKind", "marker", "mf", "ms", "mc", "mb"]
        if list == "bullet" || list == "decimal" {
          if blocks[index]["numKind"] as? String != list { for key in listKeys { blocks[index].removeValue(forKey: key) } }
          if was == "none" || was.isEmpty {
            blocks[index]["indent"] = max(720, (blocks[index]["indent"] as? NSNumber)?.intValue ?? 0)
            blocks[index]["first"] = -360
          }
          blocks[index]["list"] = list
          if list == "bullet" && (blocks[index]["num"] as? String ?? "").isEmpty { blocks[index]["marker"] = "\u{2022}" }
        } else {
          blocks[index]["list"] = "none"
          blocks[index]["indent"] = 0
          blocks[index]["first"] = 0
          for key in listKeys { blocks[index].removeValue(forKey: key) }
        }
      }
      touched.append(item.index)
    }
    let changed = list != nil ? renumber() : []
    for index in touched { refreshLines(index, index) }
    refreshBlocks(changed)
  }
  private func markDirty(_ range: NSRange) {
    for item in paragraphsIn(range) {
      blocks[lines[item.index].block]["dirty"] = true
      blocks[lines[item.index].block].removeValue(forKey: "raw")
    }
    edited = true
  }
  private func paragraphBlock(_ text: String) -> [String: Any] {
    ["kind": "paragraph", "align": "left", "list": "none", "dirty": true, "runs": [["text": text]]]
  }
  private func paragraphText(_ block: [String: Any]) -> String {
    ((block["runs"] as? [[String: Any]]) ?? []).compactMap { $0["text"] as? String }.joined().replacingOccurrences(of: "\n", with: "\u{2028}")
  }
  private func linesOf(_ text: String) -> [String] {
    let body = text.hasSuffix("\n") ? String(text.dropLast()) : text
    return body.components(separatedBy: "\n")
  }
  private func lineRanges() -> [NSRange] {
    let ns = storage.string as NSString
    var ranges: [NSRange] = []
    var cursor = 0
    for _ in lines {
      let found = ns.range(of: "\n", options: [], range: NSRange(location: min(cursor, ns.length), length: max(0, ns.length - cursor)))
      let end = found.location == NSNotFound ? ns.length : found.location
      ranges.append(NSRange(location: min(cursor, ns.length), length: max(0, end - cursor)))
      cursor = end + 1
    }
    return ranges
  }
  private func lineIndex(_ offset: Int) -> Int? {
    let ranges = lineRanges()
    return ranges.firstIndex { NSLocationInRange(offset, $0) || offset == NSMaxRange($0) }
  }
  private func updateRow(_ line: (block: Int, role: String, row: Int), text: String) {
    guard var rows = blocks[line.block]["rows"] as? [[[String: Any]]], rows.indices.contains(line.row) else { return }
    let parts = text.components(separatedBy: "\t")
    for index in rows[line.row].indices { rows[line.row][index]["text"] = index < parts.count ? parts[index] : "" }
    blocks[line.block]["rows"] = rows
    blocks[line.block]["dirty"] = true
    sections[sectionIndex]["blocks"] = blocks
  }
  /// Puts back the text a rejected edit replaced, with its formatting.
  private func revert() {
    updating = true
    let length = min(changeLength, max(0, storage.length - changeRange.location))
    if changeRange.location <= storage.length { storage.replaceCharacters(in: NSRange(location: changeRange.location, length: length), with: changeOld) }
    updating = false
    if let index = lineIndex(changeRange.location) { refreshLines(index - 1, index + 1) }
  }
  private func pushUndo() {
    commit()
    undoStack.append((stringify(blocks), hf))
    if undoStack.count > 30 { undoStack.removeFirst() }
    redoStack.removeAll()
  }
  private func restore(_ snap: Snapshot?, into other: inout [Snapshot]) {
    guard let snap else { return }
    commit()
    other.append((stringify(blocks), hf))
    if let data = snap.blocks.data(using: .utf8), let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] { blocks = parsed }
    sections[sectionIndex]["blocks"] = blocks
    hf = snap.hf
    edited = true
    render()
    scheduleDraft(); emit()
    lastFormat = nil
    reportFormat()
  }
  private func plain() -> String {
    sections.flatMap { section -> [String] in
      ((section["blocks"] as? [[String: Any]]) ?? []).map { block in
        switch block["kind"] as? String {
        case "paragraph": return paragraphText(block).replacingOccurrences(of: "\u{2028}", with: "\n")
        case "table": return ((block["rows"] as? [[[String: Any]]]) ?? []).map { $0.compactMap { $0["text"] as? String }.joined(separator: "\t") }.joined(separator: "\n")
        case "locked":
          if let table = block["table"] as? [String: Any] {
            return ((table["rows"] as? [[String: Any]]) ?? []).map { row in
              ((row["cells"] as? [[String: Any]]) ?? []).map { cell in
                ((cell["paras"] as? [[String: Any]]) ?? []).map { self.paragraphText($0).replacingOccurrences(of: "\u{2028}", with: " ") }.joined(separator: " ")
              }.joined(separator: "\t")
            }.joined(separator: "\n")
          }
          if block["runs"] != nil { return paragraphText(block).replacingOccurrences(of: "\u{2028}", with: "\n").replacingOccurrences(of: "\u{FFFC}", with: "") }
          return "[\(block["label"] as? String ?? "Locked content")]"
        default: return ""
        }
      }
    }.joined(separator: "\n") + "\n"
  }
  private func textModel(_ text: String) throws -> [String: Any] {
    if text.count > 2_000_000 { throw DocumentError("This text file is too long to edit here.") }
    var sections: [[String: Any]] = []
    var blocks: [[String: Any]] = []
    var count = 0
    let lines = text.replacingOccurrences(of: "\r\n", with: "\n")
    for line in (lines.isEmpty ? [""] : lines.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)) {
      if count > 40_000 && !blocks.isEmpty { sections.append(["blocks": blocks]); blocks = []; count = 0 }
      blocks.append(["kind": "paragraph", "align": "left", "list": "none", "runs": [["text": line]]])
      count += line.count + 1
    }
    sections.append(["blocks": blocks])
    return ["sect": "", "sections": sections]
  }
  private func draft() -> URL {
    let key = String(format: "%08x", UInt32(truncatingIfNeeded: (blank ? "blank" : sourcePath).hashValue))
    return FileManager.default.temporaryDirectory.appendingPathComponent("versara-doc-draft-\(key).json")
  }
  private func scheduleDraft() {
    NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(writeDraft), object: nil)
    perform(#selector(writeDraft), with: nil, afterDelay: 1.2)
    schedulePages()
  }
  @objc private func writeDraft() {
    guard edited else { return }
    commit()
    if let data = try? JSONSerialization.data(withJSONObject: ["sect": sect, "hf": hf, "page": pageSetup, "defaults": defaults, "sections": sections]) { try? data.write(to: draft()) }
  }
  private func emit() {
    onDocChange(["dirty": edited, "characters": storage.length, "canUndo": !undoStack.isEmpty, "canRedo": !redoStack.isEmpty, "section": sectionIndex, "sections": sections.count])
  }
  private func json(_ text: String) throws -> [String: Any] {
    guard let data = text.data(using: .utf8), let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw DocumentError("Could not read this document.") }
    return object
  }
  private func stringify(_ object: Any) -> String {
    (try? JSONSerialization.data(withJSONObject: object)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
  }
  private func filePath(_ uri: String) -> String { uri.hasPrefix("file://") ? (URL(string: uri)?.path ?? uri) : uri }
}

/// Horizontal ruler above the page. Drag the top triangle for the first-line indent, the bottom one
/// for the left indent, and the edges of the white band for the page margins.
final class DocRulerView: UIView {
  private var inset: CGFloat = 10, cardWidth: CGFloat = 0, pageWidth: CGFloat = 12240, left: CGFloat = 1440, right: CGFloat = 1440, indent: CGFloat = 0, first: CGFloat = 0, dark = false
  private enum Handle { case first, indent, left, right }
  private var drag: Handle?
  private var dragTwips: CGFloat = 0
  /// New left indent and first-line indent in twips.
  var onIndent: ((Int, Int) -> Void)?
  /// New left or right page margin in twips.
  var onMargins: ((Int?, Int?) -> Void)?
  private var metric: Bool { Locale.current.measurementSystem != .us }
  private var factor: CGFloat { cardWidth / pageWidth }

  override init(frame: CGRect) { super.init(frame: frame); isOpaque = false }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func configure(inset: CGFloat, cardWidth: CGFloat, pageWidth: CGFloat, left: CGFloat, right: CGFloat, indent: CGFloat, first: CGFloat, dark: Bool) {
    self.inset = inset; self.cardWidth = cardWidth; self.pageWidth = max(1, pageWidth); self.left = left; self.right = right; self.indent = indent; self.first = first; self.dark = dark
    setNeedsDisplay()
  }

  private func value(_ handle: Handle) -> CGFloat {
    if drag == handle { return dragTwips }
    switch handle {
    case .first: return left + indent + first
    case .indent: return left + indent
    case .left: return left
    case .right: return pageWidth - right
    }
  }
  private func x(_ twips: CGFloat) -> CGFloat { inset + twips * factor }
  private func twips(at x: CGFloat) -> CGFloat {
    let snap: CGFloat = metric ? 142 : 90
    return (((x - inset) / factor) / snap).rounded() * snap
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard cardWidth > 0, let point = touches.first?.location(in: self) else { return }
    func near(_ handle: Handle) -> Bool { abs(point.x - x(value(handle))) <= 16 }
    let upper = point.y < bounds.height / 2
    if upper && near(.first) { drag = .first }
    else if !upper && near(.indent) { drag = .indent }
    else if near(.left) { drag = .left }
    else if near(.right) { drag = .right }
    else if near(.first) { drag = .first }
    else if near(.indent) { drag = .indent }
    else { drag = nil }
    if let drag { dragTwips = value(drag) }
    setNeedsDisplay()
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let drag, let point = touches.first?.location(in: self) else { return }
    let contentRight = pageWidth - right
    let at = twips(at: point.x)
    switch drag {
    case .first, .indent: dragTwips = min(max(at, left), contentRight - 720)
    case .left: dragTwips = min(max(at, 0), contentRight - 1440)
    case .right: dragTwips = min(max(at, left + 1440), pageWidth)
    }
    setNeedsDisplay()
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let handle = drag else { return }
    let at = dragTwips
    drag = nil
    setNeedsDisplay()
    switch handle {
    case .first: if at != left + indent + first { onIndent?(Int(indent), Int(at - left - indent)) }
    case .indent: if at != left + indent { onIndent?(Int(at - left), Int(first)) }
    case .left: if at != left { onMargins?(Int(at), nil) }
    case .right: if at != pageWidth - right { onMargins?(nil, Int(pageWidth - at)) }
    }
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { drag = nil; setNeedsDisplay() }

  override func draw(_ rect: CGRect) {
    (dark ? UIColor(white: 0.1, alpha: 1) : UIColor(red: 0.945, green: 0.953, blue: 0.957, alpha: 1)).setFill()
    UIRectFill(bounds)
    guard cardWidth > 0 else { return }
    let factor = self.factor
    let metric = self.metric
    let unit: CGFloat = metric ? 567 : 1440
    let steps = metric ? 2 : 8
    let top: CGFloat = 4, bottom = bounds.height - 4
    (dark ? UIColor(white: 0.23, alpha: 1) : UIColor(red: 0.855, green: 0.863, blue: 0.878, alpha: 1)).setFill()
    UIRectFill(CGRect(x: inset, y: top, width: cardWidth, height: bottom - top))
    let left = value(.left)
    let contentLeft = x(left), contentRight = x(value(.right))
    (dark ? UIColor(white: 0.17, alpha: 1) : .white).setFill()
    UIRectFill(CGRect(x: contentLeft, y: top, width: max(0, contentRight - contentLeft), height: bottom - top))
    let ink = dark ? UIColor(white: 0.62, alpha: 1) : UIColor(red: 0.37, green: 0.39, blue: 0.41, alpha: 1)
    ink.setStroke()
    let minor = unit / CGFloat(steps)
    var index = Int((-left / minor).rounded(.down))
    let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 9, weight: .medium), .foregroundColor: ink]
    while left + CGFloat(index) * minor <= pageWidth {
      let twips = left + CGFloat(index) * minor
      if twips >= 0 {
        let x = inset + twips * factor
        if index % steps == 0 {
          if index != 0 {
            let label = "\(abs(index / steps))" as NSString
            let size = label.size(withAttributes: attributes)
            label.draw(at: CGPoint(x: x - size.width / 2, y: (top + bottom) / 2 - size.height / 2), withAttributes: attributes)
          }
        } else {
          let length: CGFloat = steps == 8 && index % 4 == 0 ? 6 : 3
          let tick = UIBezierPath()
          tick.move(to: CGPoint(x: x, y: bottom - length)); tick.addLine(to: CGPoint(x: x, y: bottom))
          tick.lineWidth = 0.75
          tick.stroke()
        }
      }
      index += 1
    }
    let accent = UIColor(red: 0.1, green: 0.45, blue: 0.91, alpha: 1)
    accent.setFill()
    let firstX = x(value(.first))
    let down = UIBezierPath()
    down.move(to: CGPoint(x: firstX - 5, y: top)); down.addLine(to: CGPoint(x: firstX + 5, y: top)); down.addLine(to: CGPoint(x: firstX, y: top + 7))
    down.close()
    down.fill()
    for mark in [x(value(.indent)), contentRight] {
      let marker = UIBezierPath()
      marker.move(to: CGPoint(x: mark - 5, y: bottom - 7)); marker.addLine(to: CGPoint(x: mark + 5, y: bottom - 7)); marker.addLine(to: CGPoint(x: mark, y: bottom))
      marker.close()
      marker.fill()
    }
    if let drag {
      let at = x(dragTwips)
      accent.setStroke()
      let guide = UIBezierPath()
      guide.move(to: CGPoint(x: at, y: top)); guide.addLine(to: CGPoint(x: at, y: bottom))
      guide.lineWidth = 1
      guide.stroke()
      let shown: CGFloat
      switch drag {
      case .first, .indent: shown = dragTwips - left
      case .right: shown = pageWidth - dragTwips
      case .left: shown = dragTwips
      }
      let label = (metric ? String(format: "%.2f cm", shown / 567) : String(format: "%.2f\"", shown / 1440)) as NSString
      let labelAttributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 9, weight: .semibold), .foregroundColor: accent]
      let size = label.size(withAttributes: labelAttributes)
      label.draw(at: CGPoint(x: min(at + 6, bounds.width - size.width - 4), y: (top + bottom) / 2 - size.height / 2), withAttributes: labelAttributes)
    }
  }
}

private extension UIImage {
  static func from(color: UIColor) -> UIImage {
    UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1)).image { context in
      color.setFill()
      context.fill(CGRect(x: 0, y: 0, width: 1, height: 1))
    }
  }
}
private extension UIColor {
  convenience init?(hex: String) {
    let value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    guard value.count == 6, let number = Int(value, radix: 16) else { return nil }
    self.init(red: CGFloat((number >> 16) & 255) / 255, green: CGFloat((number >> 8) & 255) / 255, blue: CGFloat(number & 255) / 255, alpha: 1)
  }
  var hex: String? {
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    guard getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return nil }
    return String(format: "%02X%02X%02X", Int((red * 255).rounded()), Int((green * 255).rounded()), Int((blue * 255).rounded()))
  }
}
private extension Array {
  subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

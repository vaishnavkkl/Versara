p='modules/pdf-engine/ios/PdfEditCanvasView.swift'; s=open(p,encoding='utf8').read()
rep=[
("""  private struct TextBox: Equatable { var visible = false; var text = ""; var font = "Helvetica"; var size: CGFloat = 16; var color = 0x101020; var underline = false; var submitOnReturn = false; var fontFile = "" }""",
"""  /** `box` (normalised; height unused) opens the field over an existing paragraph at its width; `lineHeight` is in page points. */
  private struct TextBox: Equatable { var visible = false; var text = ""; var font = "Helvetica"; var size: CGFloat = 16; var color = 0x101020; var underline = false; var submitOnReturn = false; var fontFile = ""; var box: CGRect? = nil; var lineHeight: CGFloat = 0 }"""),
("""      next.submitOnReturn = item["submitOnReturn"] as? Bool ?? false
    }""",
"""      next.submitOnReturn = item["submitOnReturn"] as? Bool ?? false
      if let box = item["box"] as? [String: Any], let x = number(box["x"]), let y = number(box["y"]), let width = number(box["width"]),
         width > 0, (0...1).contains(x), (0...1).contains(y) { next.box = CGRect(x: x, y: y, width: width, height: 0) }
      next.lineHeight = min(1000, max(0, number(item["lineHeight"]) ?? 0))
    }"""),
("""    let restyle = opening || next.color != previous.color || next.underline != previous.underline || next.font != previous.font || next.fontFile != previous.fontFile || next.size != previous.size""",
"""    let restyle = opening || next.color != previous.color || next.underline != previous.underline || next.font != previous.font || next.fontFile != previous.fontFile || next.size != previous.size || next.lineHeight != previous.lineHeight"""),
("""    if opening || next.size != previous.size || next.font != previous.font || next.visible != previous.visible { layoutField() } else { updateHandle() }""",
"""    if opening || next.size != previous.size || next.font != previous.font || next.visible != previous.visible || next.box != previous.box || next.lineHeight != previous.lineHeight { layoutField() } else { updateHandle() }"""),
("""    lineHeight = fieldFont.pointSize * 1.2""",
"""    lineHeight = textBox.box != nil && textBox.lineHeight > 0 ? textBox.lineHeight * scale : fieldFont.pointSize * 1.2"""),
("""    let width = page.bounds.width, height = page.bounds.height
    guard let point = placement, textBox.visible, width > 0 else { updateHandle(); return }
    let scale = textScale()
    if abs(fieldFont.pointSize - max(1, textBox.size * scale)) > 0.01 {
      styleField()
      field.attributedText = NSAttributedString(string: field.text ?? "", attributes: field.typingAttributes)
    }
    let pad = max(1, 2 * scale)""",
"""    let width = page.bounds.width, height = page.bounds.height
    guard textBox.visible, width > 0, placement != nil || textBox.box != nil else { updateHandle(); return }
    let scale = textScale()
    if abs(fieldFont.pointSize - max(1, textBox.size * scale)) > 0.01 {
      styleField()
      field.attributedText = NSAttributedString(string: field.text ?? "", attributes: field.typingAttributes)
    }
    let pad = max(1, 2 * scale)
    if let box = textBox.box {
      // A paragraph wraps at its own width, like the saved PDF.
      field.textContainerInset = UIEdgeInsets(top: pad, left: pad, bottom: pad, right: pad * 3)
      field.textContainer.lineFragmentPadding = 0
      let frameWidth = box.width * width + pad * 4
      let fitted = field.sizeThatFits(CGSize(width: frameWidth, height: .greatestFiniteMagnitude)).height
      field.frame = CGRect(x: box.minX * width - pad, y: box.minY * height - pad, width: frameWidth, height: max(lineHeight + pad * 2, fitted))
      placeholder.frame = CGRect(x: pad, y: pad, width: frameWidth, height: fieldFont.lineHeight)
      field.layer.borderWidth = 1 / max(1, scroll.zoomScale)
      updateHandle()
      return
    }
    guard let point = placement else { updateHandle(); return }"""),
("""    guard textBox.visible, placement != nil, !disabled else { handle.isHidden = true; return }""",
"""    // A paragraph keeps its place on the page; only new text can be dragged.
    guard textBox.visible, placement != nil, textBox.box == nil, !disabled else { handle.isHidden = true; return }"""),
("""    return next.count <= 4000 && next.components(separatedBy: "\\n").count <= 50""",
"""    return next.count <= 4000 && next.components(separatedBy: "\\n").count <= 50"""),
]
for a,b in rep:
    assert s.count(a)==1,(a[:80], s.count(a)); s=s.replace(a,b)
open(p,'w',encoding='utf8').write(s)
print('ok')

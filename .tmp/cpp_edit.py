p='modules/pdf-engine/cpp/TextEditor.cpp'; s=open(p,encoding='utf8').read()
rep=[
("""using Verification = std::vector<std::pair<FPDF_PAGEOBJECT, std::string>>;
/**
 * Writes each line below the previous one at 1.2× line height. `first` (optional) is reused for
 * line 1; `create` makes objects for the others. `matrix` positions line 1's baseline.
 */
static void writeLines(FPDF_PAGE page, const std::vector<std::string>& lines, const FS_MATRIX& matrix, float fontSize,
                       FPDF_PAGEOBJECT first, const std::function<FPDF_PAGEOBJECT()>& create,
                       unsigned r, unsigned g, unsigned b, unsigned a, bool underlined, Verification& verification,
                       std::vector<FPDF_PAGEOBJECT>* created = nullptr) {
  for (size_t i = 0; i < lines.size(); ++i) {
    if (lines[i].empty()) continue;
    FPDF_PAGEOBJECT object = i == 0 && first ? first : create();
    if (object != first) FPDFPage_InsertObject(page, object);
    if (created) created->push_back(object);
    setText(object, lines[i]);
    FS_MATRIX line = matrix;
    const float step = float(i) * 1.2f * fontSize;
    line.e -= step * matrix.c; line.f -= step * matrix.d;""",
"""using Verification = std::vector<std::pair<FPDF_PAGEOBJECT, std::string>>;
/** How a paragraph reflows, in text-space units of the edited object: wrap widths, line advance and the later lines' offset. */
struct Flow { float first = 0, rest = 0, step = 0, hang = 0; };
/**
 * Writes each line below the previous one at 1.2× line height, or `flow.step`. `first` (optional) is reused for
 * line 1; `create` makes objects for the others. `matrix` positions line 1's baseline.
 */
static void writeLines(FPDF_PAGE page, const std::vector<std::string>& lines, const FS_MATRIX& matrix, float fontSize,
                       FPDF_PAGEOBJECT first, const std::function<FPDF_PAGEOBJECT()>& create,
                       unsigned r, unsigned g, unsigned b, unsigned a, bool underlined, Verification& verification,
                       std::vector<FPDF_PAGEOBJECT>* created = nullptr, const Flow& flow = Flow{}) {
  for (size_t i = 0; i < lines.size(); ++i) {
    if (lines[i].empty()) continue;
    FPDF_PAGEOBJECT object = i == 0 && first ? first : create();
    if (object != first) FPDFPage_InsertObject(page, object);
    if (created) created->push_back(object);
    setText(object, lines[i]);
    FS_MATRIX line = matrix;
    const float step = float(i) * (flow.step > 0 ? flow.step : 1.2f * fontSize);
    line.e -= step * matrix.c; line.f -= step * matrix.d;
    if (i > 0) { line.e += flow.hang * matrix.a; line.f += flow.hang * matrix.b; }"""),
("""static std::string lowercase(std::string value) {""",
"""/**
 * Greedy word wrap measured with `probe`, which carries the font and size the lines are written in.
 * Hard line breaks are kept; a word wider than the line stays whole on its own line.
 */
static std::vector<std::string> wrapLines(const std::vector<std::string>& lines, const Flow& flow, FPDF_PAGEOBJECT probe) {
  if (flow.rest <= 0) return lines;
  std::map<std::string, float> widths;
  auto width = [&](const std::string& value) {
    auto found = widths.find(value);
    if (found != widths.end()) return found->second;
    setText(probe, value);
    float l = 0, b = 0, r = 0, t = 0;
    return widths[value] = FPDFPageObj_GetBounds(probe, &l, &b, &r, &t) ? std::max(0.f, r - l) : 0.f;
  };
  const float space = std::max(0.f, width("n n") - width("nn"));
  std::vector<std::string> out;
  for (const auto& line : lines) {
    std::string current;
    float used = 0;
    size_t start = 0;
    while (start < line.size()) {
      auto end = line.find(' ', start);
      if (end == std::string::npos) end = line.size();
      const auto word = line.substr(start, end - start);
      start = end + 1;
      if (word.empty()) continue;
      const float w = width(word);
      const float room = out.empty() ? flow.first : flow.rest;
      if (!current.empty() && used + space + w > room) { out.push_back(current); current = word; used = w; }
      else { if (!current.empty()) { current += ' '; used += space; } current += word; used += w; }
    }
    out.push_back(current);
    require(out.size() <= 300, "Keep the paragraph under 300 lines.", "PDF_INVALID_TEXT");
  }
  return out;
}
static std::string lowercase(std::string value) {"""),
# replace path: read flow after indent/scale
("""      indentMatrix(matrix, indent);
      unsigned int r = 0, g = 0, b = 0, a = 255;
      FPDFPageObj_GetFillColor(object, &r, &g, &b, &a);""",
"""      indentMatrix(matrix, indent);
      // Paragraph edits reflow inside the paragraph's width; values arrive in visible page points.
      Flow flow;
      const double wrap = command.value("wrap", 0.0), leading = command.value("lineHeight", 0.0), hang = command.value("hang", 0.0);
      require(std::isfinite(wrap) && std::isfinite(leading) && std::isfinite(hang) && wrap >= 0 && wrap <= 5000 && leading >= 0 && leading <= 1000 && std::abs(hang) <= 2000,
              "This paragraph cannot be laid out. Try a smaller size.", "PDF_INVALID_TEXT");
      if (const float scale = matrixScale(matrix); wrap > 0 && scale > 0) {
        flow.rest = float(wrap) / scale;
        flow.hang = float(hang) / scale;
        flow.first = std::max(flow.rest * .2f, flow.rest - flow.hang);
        if (leading > 0) flow.step = float(leading) / scale;
      }
      auto reflow = [&](FPDF_PAGEOBJECT probe) {
        require(probe != nullptr, "Could not measure this text.", "PDF_FONT_UNSUPPORTED");
        std::unique_ptr<std::remove_pointer_t<FPDF_PAGEOBJECT>, decltype(&FPDFPageObj_Destroy)> owned(probe, FPDFPageObj_Destroy);
        return wrapLines(lines, flow, probe);
      };
      unsigned int r = 0, g = 0, b = 0, a = 255;
      FPDFPageObj_GetFillColor(object, &r, &g, &b, &a);"""),
("""        try {
          writeLines(page, lines, matrix, fontSize, object, [&] {
            auto extra = FPDFPageObj_CreateTextObj(doc, original, fontSize);
            require(extra != nullptr, "Could not add another line in this font.", "PDF_FONT_UNSUPPORTED");
            FPDFTextObj_SetTextRenderMode(extra, FPDFTextObj_GetTextRenderMode(object));
            return extra;
          }, r, g, b, a, underlined, verification, &created);""",
"""        try {
          const auto wrapped = flow.rest > 0 ? reflow(FPDFPageObj_CreateTextObj(doc, original, fontSize)) : lines;
          writeLines(page, wrapped, matrix, fontSize, object, [&] {
            auto extra = FPDFPageObj_CreateTextObj(doc, original, fontSize);
            require(extra != nullptr, "Could not add another line in this font.", "PDF_FONT_UNSUPPORTED");
            FPDFTextObj_SetTextRenderMode(extra, FPDFTextObj_GetTextRenderMode(object));
            return extra;
          }, r, g, b, a, underlined, verification, &created, flow);"""),
("""          writeLines(page, lines, matrix, fontSize, nullptr, [&] { return newText(doc, fallback, fontSize); }, r, g, b, a, underlined, verification);
          ++fallbacks;""",
"""          const auto wrapped = flow.rest > 0 ? reflow(newText(doc, fallback, fontSize)) : lines;
          writeLines(page, wrapped, matrix, fontSize, nullptr, [&] { return newText(doc, fallback, fontSize); }, r, g, b, a, underlined, verification, nullptr, flow);
          ++fallbacks;"""),
("""        writeLines(page, lines, matrix, fontSize, nullptr, [&] { return newText(doc, font, fontSize, fontFile, &fonts); }, r, g, b, a, underlined, verification);
        require(FPDFPage_RemoveObject(page, object), "Could not remove the selected text.");""",
"""        const auto wrapped = flow.rest > 0 ? reflow(newText(doc, font, fontSize, fontFile, &fonts)) : lines;
        writeLines(page, wrapped, matrix, fontSize, nullptr, [&] { return newText(doc, font, fontSize, fontFile, &fonts); }, r, g, b, a, underlined, verification, nullptr, flow);
        require(FPDFPage_RemoveObject(page, object), "Could not remove the selected text.");"""),
("""      temporary = image;
      require(stbi_write_png(""",
"""      temporary = image;
      // Live previews are short-lived cache files; fast encoding matters more than their size.
      stbi_write_png_compression_level = 1;
      require(stbi_write_png("""),
]
for a,b in rep:
    assert s.count(a)==1,(a[:80], s.count(a)); s=s.replace(a,b)
open(p,'w',encoding='utf8').write(s)
print('ok')

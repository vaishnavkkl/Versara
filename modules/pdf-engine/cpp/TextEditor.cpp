#include "TextEditor.hpp"
#include "third_party/json.hpp"
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "third_party/stb_image_write.h"
#include "fpdfview.h"
#include "fpdf_edit.h"
#include "fpdf_text.h"
#include "fpdf_save.h"
#include "fpdf_signature.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cmath>
#include <codecvt>
#include <cstdio>
#include <filesystem>
#include <functional>
#include <fstream>
#include <locale>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <stdexcept>
#include <type_traits>
#include <vector>

namespace versara {
using Json = nlohmann::json;
namespace fs = std::filesystem;
static std::mutex engineLock;
static std::once_flag initialized;
struct Failure : std::runtime_error {
  std::string code;
  Failure(const char* code, const char* message) : std::runtime_error(message), code(code) {}
};
static void require(bool ok, const char* message, const char* code = "PDF_EDIT_FAILED") {
  if (!ok) throw Failure(code, message);
}
struct Document {
  FPDF_DOCUMENT value;
  explicit Document(const std::string& path, const std::string& password = "") : value(FPDF_LoadDocument(path.c_str(), password.empty() ? nullptr : password.c_str())) {
    require(value != nullptr, "This PDF cannot be opened. Choose an unlocked, valid PDF.", "PDF_INVALID_DOCUMENT");
  }
  ~Document() { FPDF_CloseDocument(value); }
};
struct Page {
  FPDF_PAGE value;
  Page(FPDF_DOCUMENT doc, int number) : value(FPDF_LoadPage(doc, number)) {
    require(value != nullptr, "This page cannot be read.");
  }
  ~Page() { FPDF_ClosePage(value); }
};
struct TextPage {
  FPDF_TEXTPAGE value;
  explicit TextPage(FPDF_PAGE page) : value(FPDFText_LoadPage(page)) { require(value != nullptr, "This page's text cannot be read."); }
  ~TextPage() { FPDFText_ClosePage(value); }
};
static std::u16string utf16(const std::string& value) {
  return std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>{}.from_bytes(value);
}
static std::string textOf(FPDF_PAGEOBJECT object, FPDF_TEXTPAGE page) {
  const auto length = FPDFTextObj_GetText(object, page, nullptr, 0);
  if (length < 2 || length > 128000) return "";
  std::vector<FPDF_WCHAR> buffer(length / 2);
  FPDFTextObj_GetText(object, page, buffer.data(), length);
  std::u16string value(buffer.begin(), buffer.end() - 1);
  return std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>{}.to_bytes(value);
}
/** Text extraction drops trailing spaces and may rebuild spacing, so only visible characters must match. */
static bool sameText(const std::string& written, const std::string& expected) {
  auto visible = [](const std::string& value) {
    std::string out;
    for (size_t i = 0; i < value.size(); ++i) {
      const unsigned char c = value[i];
      if (c == ' ' || c == '\t' || c == '\r' || c == '\n') continue;
      if (c == 0xC2 && i + 1 < value.size() && static_cast<unsigned char>(value[i + 1]) == 0xA0) { ++i; continue; }
      out += char(c);
    }
    return out;
  };
  return visible(written) == visible(expected);
}
static fs::path childPath(const std::string& value, const fs::path& root, bool existing) {
  auto path = existing ? fs::canonical(value) : fs::canonical(fs::path(value).parent_path()) / fs::path(value).filename();
  auto relative = path.lexically_relative(fs::canonical(root));
  require(!relative.empty() && *relative.begin() != ".." && !relative.is_absolute(), "Invalid editor file location.", "PDF_INVALID_PATH");
  return path;
}
static bool editable(FPDF_PAGEOBJECT object) {
  const auto mode = FPDFTextObj_GetTextRenderMode(object);
  // Clipping text affects other page content; don't silently change its geometry.
  return mode >= FPDF_TEXTRENDERMODE_FILL && mode <= FPDF_TEXTRENDERMODE_INVISIBLE;
}
static Json bounds(FPDF_PAGE page, FPDF_PAGEOBJECT object, int width, int height) {
  float left, bottom, right, top;
  if (!FPDFPageObj_GetBounds(object, &left, &bottom, &right, &top)) return nullptr;
  int minX = width, maxX = 0, minY = height, maxY = 0;
  for (auto x : {left, right}) for (auto y : {bottom, top}) {
    int dx = 0, dy = 0;
    FPDF_PageToDevice(page, 0, 0, width, height, 0, x, y, &dx, &dy);
    minX = std::min(minX, dx); maxX = std::max(maxX, dx);
    minY = std::min(minY, dy); maxY = std::max(maxY, dy);
  }
  return Json{{"x", double(minX) / width}, {"y", double(minY) / height},
              {"width", double(maxX - minX) / width}, {"height", double(maxY - minY) / height}};
}
static void setText(FPDF_PAGEOBJECT object, const std::string& text) {
  require(!text.empty() && text.find_first_of("\r\n\t") == std::string::npos, "Enter some text.", "PDF_INVALID_TEXT");
  auto wide = utf16(text);
  require(wide.size() <= 4000, "Keep each text line under 4,000 characters.", "PDF_INVALID_TEXT");
  require(FPDFText_SetText(object, reinterpret_cast<FPDF_WIDESTRING>(wide.c_str())), "This font cannot encode the new text. Try Helvetica.", "PDF_FONT_UNSUPPORTED");
}
/** One text box may hold several lines; blank lines keep their spacing. */
static std::vector<std::string> linesOf(const std::string& text) {
  require(!text.empty() && text.size() <= 16000 && text.find('\0') == std::string::npos && text.find_first_of("\r\t") == std::string::npos,
          "Enter up to 4,000 characters. Use Delete to remove text.", "PDF_INVALID_TEXT");
  std::vector<std::string> lines;
  size_t start = 0;
  while (true) {
    const auto end = text.find('\n', start);
    lines.push_back(text.substr(start, end == std::string::npos ? std::string::npos : end - start));
    if (end == std::string::npos) break;
    start = end + 1;
  }
  require(lines.size() <= 50, "Use up to 50 lines in one text box.", "PDF_INVALID_TEXT");
  require(std::any_of(lines.begin(), lines.end(), [](const std::string& line) { return !line.empty(); }), "Enter some text.", "PDF_INVALID_TEXT");
  return lines;
}
// The standard 14 fonts every PDF reader has; Helvetica is metrically identical to Arial.
static const std::set<std::string> standardFonts = {
  "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
  "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
  "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
};
static FPDF_PAGEOBJECT newText(FPDF_DOCUMENT doc, const std::string& font, float size) {
  require(standardFonts.count(font) != 0, "Choose a supported font.");
  require(std::isfinite(size) && size >= 1 && size <= 400, "Choose a font size from 4 to 200.");
  auto object = FPDFPageObj_NewTextObj(doc, font.c_str(), size);
  require(object != nullptr, "Could not create this text.");
  return object;
}
static float matrixScale(const FS_MATRIX& m) { return std::sqrt(std::abs(m.a * m.d - m.b * m.c)); }
/** Draws an underline in the text's own coordinate space so it follows rotation and scale. */
static FPDF_PAGEOBJECT underline(FPDF_PAGE page, FPDF_PAGEOBJECT text, const FS_MATRIX& matrix, float fontSize, unsigned r, unsigned g, unsigned b) {
  FS_MATRIX identity{1, 0, 0, 1, 0, 0};
  float left = 0, bottom = 0, right = 0, top = 0;
  require(FPDFPageObj_SetMatrix(text, &identity), "Could not position the text.");
  const bool measured = FPDFPageObj_GetBounds(text, &left, &bottom, &right, &top);
  require(FPDFPageObj_SetMatrix(text, &matrix), "Could not position the text.");
  if (!measured || right <= left) return nullptr;
  const float y = -fontSize * 0.14f;
  auto path = FPDFPageObj_CreateNewPath(left, y);
  require(path != nullptr, "Could not underline this text.");
  FPDFPage_InsertObject(page, path);
  FPDFPath_LineTo(path, right, y);
  FPDFPageObj_SetStrokeColor(path, r, g, b, 255);
  FPDFPageObj_SetStrokeWidth(path, std::max(0.4f, fontSize * 0.06f));
  FPDFPath_SetDrawMode(path, FPDF_FILLMODE_NONE, 1);
  FPDFPageObj_SetMatrix(path, &matrix);
  return path;
}
using Verification = std::vector<std::pair<FPDF_PAGEOBJECT, std::string>>;
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
    line.e -= step * matrix.c; line.f -= step * matrix.d;
    require(FPDFPageObj_SetMatrix(object, &line), "Could not position the text.");
    FPDFPageObj_SetFillColor(object, r, g, b, a);
    verification.emplace_back(object, lines[i]);
    if (underlined) {
      auto path = underline(page, object, line, fontSize, r, g, b);
      if (path && created) created->push_back(path);
    }
  }
}
static std::string lowercase(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) { return char(std::tolower(c)); });
  return value;
}
static bool has(const std::string& text, std::initializer_list<const char*> words) {
  return std::any_of(words.begin(), words.end(), [&](const char* word) { return text.find(word) != std::string::npos; });
}
/** The standard font closest to an embedded one, keeping its family, weight and slant. */
static std::string similarFont(FPDF_FONT font) {
  char buffer[256] = {0};
  FPDFFont_GetBaseFontName(font, buffer, sizeof(buffer));
  const auto name = lowercase(buffer);
  const int flags = std::max(0, FPDFFont_GetFlags(font));
  int angle = 0;
  FPDFFont_GetItalicAngle(font, &angle);
  const bool mono = (flags & 1) || has(name, {"courier", "mono", "consol", "menlo"});
  const bool serif = !mono && !has(name, {"sans", "arial", "helvetica", "verdana", "calibri", "roboto"}) &&
                     ((flags & 2) || has(name, {"times", "serif", "roman", "georgia", "garamond", "cambria", "book"}));
  const bool bold = FPDFFont_GetWeight(font) >= 600 || has(name, {"bold", "black", "heavy", "semibold", "demi"});
  const bool italic = (flags & 64) || angle != 0 || has(name, {"italic", "oblique"});
  if (serif) return bold && italic ? "Times-BoldItalic" : bold ? "Times-Bold" : italic ? "Times-Italic" : "Times-Roman";
  return std::string(mono ? "Courier" : "Helvetica") + (bold && italic ? "-BoldOblique" : bold ? "-Bold" : italic ? "-Oblique" : "");
}
/** Moves the baseline start along the text direction by `indent` page points. */
static void indentMatrix(FS_MATRIX& m, double indent) {
  const double length = std::hypot(m.a, m.b);
  if (indent == 0 || length <= 0) return;
  m.e += float(indent * m.a / length); m.f += float(indent * m.b / length);
}
// IDs refer to the unmodified source page. Resolve all handles before removals.
/** Returns how many replacements switched to a standard font because the embedded one lacked characters. */
// The same vector marks are used on Android and iOS. Coordinates are in the
// visible, rotated crop box, so the saved PDF matches the native drawing canvas.
static void applyMark(FPDF_PAGE page, const Json& mark) {
  const auto points = mark.at("points");
  require(points.is_array() && points.size() >= 2 && points.size() <= 4096, "Invalid drawing.");
  auto point = [&](const Json& p) {
    const double x = p.at(0), y = p.at(1); double px, py;
    require(std::isfinite(x) && std::isfinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1, "Invalid drawing point.");
    FPDF_DeviceToPage(page, 0, 0, 100000, 100000, 0, int(x * 100000), int(y * 100000), &px, &py);
    return std::make_pair(float(px), float(py));
  };
  const auto shape = mark.value("shape", std::string("draw"));
  const bool closed = shape == "polygon" || shape == "highlight";
  const auto pattern = mark.value("pattern", std::string("solid"));
  const bool dotted = !closed && pattern == "dotted";
  const auto unit = float(std::clamp(mark.value("width", .005), .001, .08) * FPDF_GetPageWidthF(page));
  std::vector<std::pair<float, float>> vertices;
  for (const auto& p : points) vertices.push_back(point(p));
  const auto first = vertices.front();
  auto path = FPDFPageObj_CreateNewPath(first.first, first.second);
  require(path != nullptr, "Could not create shape.");
  std::unique_ptr<std::remove_pointer_t<FPDF_PAGEOBJECT>, decltype(&FPDFPageObj_Destroy)> owned(path, FPDFPageObj_Destroy);
  if (dotted) {
    // Filled circles work consistently across raster previews and PDF readers.
    const float radius = unit / 2, control = radius * .55228475f;
    auto dot = [&](float x, float y) {
      require(FPDFPath_MoveTo(path, x + radius, y)
        && FPDFPath_BezierTo(path, x + radius, y + control, x + control, y + radius, x, y + radius)
        && FPDFPath_BezierTo(path, x - control, y + radius, x - radius, y + control, x - radius, y)
        && FPDFPath_BezierTo(path, x - radius, y - control, x - control, y - radius, x, y - radius)
        && FPDFPath_BezierTo(path, x + control, y - radius, x + radius, y - control, x + radius, y)
        && FPDFPath_Close(path), "Could not draw dot.");
    };
    std::vector<float> lengths;
    float total = 0;
    for (size_t i = 1; i < vertices.size(); ++i) {
      const float length = std::hypot(vertices[i].first - vertices[i-1].first, vertices[i].second - vertices[i-1].second);
      lengths.push_back(length); total += length;
    }
    const float spacing = std::max({unit * 3, total / 2047, .001f});
    float next = spacing, travelled = 0; int dots = 1;
    dot(first.first, first.second);
    for (size_t i = 0; i < lengths.size(); ++i) {
      const auto length = lengths[i]; if (length <= 0) continue;
      const auto a = vertices[i], b = vertices[i+1];
      while (next <= travelled + length && dots < 2048) {
        const float t = std::clamp((next - travelled) / length, 0.f, 1.f);
        dot(a.first + (b.first - a.first) * t, a.second + (b.second - a.second) * t);
        next += spacing; ++dots;
      }
      travelled += length;
    }
  } else {
    for (size_t i = 1; i < vertices.size(); ++i) require(FPDFPath_LineTo(path, vertices[i].first, vertices[i].second), "Could not draw shape.");
    if (closed) FPDFPath_Close(path);
  }
  const bool highlight = shape == "highlight" || shape == "highlight-brush";
  auto rgb = [](const std::string& color) { require(color.size() == 7 && color[0] == '#', "Invalid colour."); return std::stoul(color.substr(1), nullptr, 16); };
  const auto color = rgb(mark.value("color", std::string("#1D4ED8")));
  const auto fill = mark.value("fillColor", std::string(""));
  const auto inside = dotted || fill.empty() ? color : rgb(fill);
  const auto brush = mark.value("brush", std::string("pen"));
  int alpha = highlight || brush == "highlighter" ? 77 : brush == "pencil" ? 170 : brush == "marker" ? 210 : 255;
  if (mark.contains("opacity")) {
    const auto opacity = mark.at("opacity").get<double>();
    require(std::isfinite(opacity), "Choose a valid ink opacity.");
    alpha = int(std::round(std::clamp(opacity, .01, 1.0) * 255));
  }
  FPDFPageObj_SetStrokeColor(path, (color >> 16) & 255, (color >> 8) & 255, color & 255, alpha);
  FPDFPageObj_SetFillColor(path, (inside >> 16) & 255, (inside >> 8) & 255, inside & 255, dotted || highlight || mark.contains("opacity") ? alpha : 255);
  FPDFPageObj_SetStrokeWidth(path, unit);
  FPDFPageObj_SetLineCap(path, FPDF_LINECAP_ROUND); FPDFPageObj_SetLineJoin(path, FPDF_LINEJOIN_ROUND);
  if (!closed && pattern == "dashed") {
    const float dash[] = { unit * 4, unit * 2 };
    require(FPDFPageObj_SetDashArray(path, dash, 2, 0), "Could not draw dashed stroke.");
  }
  FPDFPath_SetDrawMode(path, dotted || (closed && (highlight || !fill.empty())) ? FPDF_FILLMODE_WINDING : FPDF_FILLMODE_NONE, !dotted && shape != "highlight");
  FPDFPage_InsertObject(page, owned.release());
}
// OCR words use display-space boxes from a bounded native recognition bitmap.
// Add invisible text to the original page; images, links and forms stay intact.
static Verification addOcrWords(FPDF_DOCUMENT doc, FPDF_PAGE page, const Json& words,
                                const std::string& tag, const std::function<void()>& check) {
  require(words.is_array() && words.size() <= 2000, "A page has too many OCR words. Export fewer pages.");
  const int originalObjects = FPDFPage_CountObjects(page);
  require(originalObjects >= 0 && originalObjects + words.size() <= 25000, "This page is too complex for searchable PDF output. Export text instead.");
  const double pageWidth = FPDF_GetPageWidthF(page), pageHeight = FPDF_GetPageHeightF(page);
  require(std::isfinite(pageWidth) && std::isfinite(pageHeight) && pageWidth > 0 && pageHeight > 0, "This page has invalid dimensions.");
  Verification verification;
  for (const auto& word : words) {
    check();
    const std::string text = word.at("text");
    require(!text.empty() && utf16(text).size() <= 256, "An OCR word is too long to place safely.");
    const double x = word.at("x"), y = word.at("y"), w = word.at("width"), h = word.at("height");
    require(std::isfinite(x) && std::isfinite(y) && std::isfinite(w) && std::isfinite(h) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.00001 && y + h <= 1.00001, "Invalid OCR text position.");
    auto raw = newText(doc, "Helvetica", 12);
    std::unique_ptr<std::remove_pointer_t<FPDF_PAGEOBJECT>, decltype(&FPDFPageObj_Destroy)> object(raw, FPDFPageObj_Destroy);
    setText(raw, text);
    require(FPDFTextObj_SetTextRenderMode(raw, FPDF_TEXTRENDERMODE_INVISIBLE), "Could not create the searchable text layer.");
    float l, b, r, t;
    require(FPDFPageObj_GetBounds(raw, &l, &b, &r, &t) && std::isfinite(l) && std::isfinite(b) && std::isfinite(r) && std::isfinite(t) && r > l && t > b, "OCR found characters that cannot be placed. Export text instead.");
    auto point = [&](double nx, double ny) {
      double px, py;
      require(FPDF_DeviceToPage(page, 0, 0, 100000, 100000, 0, int(std::round(nx * 100000)), int(std::round(ny * 100000)), &px, &py), "Could not align OCR to this page.");
      require(std::isfinite(px) && std::isfinite(py), "This page has invalid OCR coordinates.");
      return std::pair<double, double>{px, py};
    };
    const auto origin = point(x, y + h), right = point(x + w, y + h), top = point(x, y);
    const double a = (right.first - origin.first) / (r - l), bb = (right.second - origin.second) / (r - l);
    const double c = (top.first - origin.first) / (t - b), d = (top.second - origin.second) / (t - b);
    FS_MATRIX matrix{float(a), float(bb), float(c), float(d), float(origin.first - a * l - c * b), float(origin.second - bb * l - d * b)};
    require(std::isfinite(matrix.a) && std::isfinite(matrix.b) && std::isfinite(matrix.c) && std::isfinite(matrix.d) && std::isfinite(matrix.e) && std::isfinite(matrix.f), "This page cannot safely position searchable text.");
    require(FPDFPageObj_SetMatrix(raw, &matrix), "Could not align the searchable text layer.");
    const auto mark = FPDFPageObj_AddMark(raw, tag.c_str());
    require(mark && FPDFPageObjMark_SetIntParam(doc, raw, mark, "word", int(verification.size())), "Could not identify the searchable text for verification.");
    FPDFPage_InsertObject(page, object.release());
    verification.push_back({raw, text});
  }
  if (!verification.empty()) {
    require(FPDFPage_GenerateContent(page), "Could not write the searchable page.");
    TextPage extracted(page);
    for (const auto& item : verification) { check(); require(sameText(textOf(item.first, extracted.value), item.second), "OCR contains characters this PDF font cannot preserve. Export text instead.", "PDF_FONT_UNSUPPORTED"); }
  }
  return verification;
}

// Verify the new layer after serialization, rather than accepting a page merely
// because it already contains some unrelated, pre-existing selectable text.
static int verifyOcrWords(FPDF_PAGE page, const Json& words, const std::string& tag,
                          const std::function<void()>& check) {
  const int count = FPDFPage_CountObjects(page);
  require(count >= 0 && count <= 25000, "The saved page is too complex to verify safely.");
  TextPage extracted(page);
  const int characters = FPDFText_CountChars(extracted.value);
  require(characters >= 0 && characters <= 1000000, "The saved page has too much text to verify safely.");
  const auto expectedTag = utf16(tag);
  std::set<int> verified;
  for (int i = 0; i < count; ++i) {
    check();
    const auto object = FPDFPage_GetObject(page, i);
    require(object != nullptr, "A saved page object could not be verified.");
    const int marks = FPDFPageObj_CountMarks(object);
    require(marks >= 0 && marks <= 128, "The saved page has too many content marks to verify safely.");
    for (int m = 0; m < marks; ++m) {
      check();
      const auto mark = FPDFPageObj_GetMark(object, m);
      std::array<FPDF_WCHAR, 128> name{};
      unsigned long bytes = 0;
      require(mark && FPDFPageObjMark_GetName(mark, name.data(), sizeof(name), &bytes), "A saved content mark could not be read.");
      if (bytes != (expectedTag.size() + 1) * sizeof(FPDF_WCHAR) || bytes > sizeof(name) || !std::equal(expectedTag.begin(), expectedTag.end(), name.begin()) || name[expectedTag.size()] != 0) continue;
      int index = -1;
      require(FPDFPageObjMark_GetParamIntValue(mark, "word", &index) && index >= 0 && size_t(index) < words.size() && verified.insert(index).second, "The saved OCR layer has missing or duplicate words.");
      const auto& expected = words.at(index);
      require(FPDFPageObj_GetType(object) == FPDF_PAGEOBJ_TEXT && FPDFTextObj_GetTextRenderMode(object) == FPDF_TEXTRENDERMODE_INVISIBLE, "The saved OCR layer is not invisible. No output was kept.");
      require(textOf(object, extracted.value) == expected.at("text").get<std::string>(), "The saved OCR text changed during export. Export text instead.", "PDF_FONT_UNSUPPORTED");
      float left, bottom, right, top;
      require(FPDFPageObj_GetBounds(object, &left, &bottom, &right, &top) && std::isfinite(left) && std::isfinite(bottom) && std::isfinite(right) && std::isfinite(top), "The saved OCR position could not be read.");
      int minX = 100000, minY = 100000, maxX = 0, maxY = 0;
      for (const auto px : {left, right}) for (const auto py : {bottom, top}) {
        int dx = 0, dy = 0;
        require(FPDF_PageToDevice(page, 0, 0, 100000, 100000, 0, px, py, &dx, &dy), "The saved OCR position could not be mapped.");
        minX = std::min(minX, dx); minY = std::min(minY, dy);
        maxX = std::max(maxX, dx); maxY = std::max(maxY, dy);
      }
      const double x = minX / 100000.0, y = minY / 100000.0, rightEdge = maxX / 100000.0, bottomEdge = maxY / 100000.0;
      const double ex = expected.at("x"), ey = expected.at("y"), ew = expected.at("width"), eh = expected.at("height");
      require(std::abs(x - ex) <= .001 && std::abs(y - ey) <= .001 && std::abs(rightEdge - ex - ew) <= .001 && std::abs(bottomEdge - ey - eh) <= .001, "The saved OCR text does not align with the scan. No output was kept.");
    }
  }
  require(verified.size() == words.size(), "The saved OCR layer is incomplete. No output was kept.");
  return int(verified.size());
}

static void applyImage(FPDF_DOCUMENT doc, FPDF_PAGE page, const Json& command) {
  const auto path = command.at("pixelPath").get<std::string>();
  std::ifstream input(path, std::ios::binary);
  require(bool(input), "The signature image is missing. Add it again.");
  auto dimension = [&]() { unsigned char bytes[4]; input.read(reinterpret_cast<char*>(bytes), 4); require(bool(input), "Invalid signature image."); return (uint32_t(bytes[0]) << 24) | (uint32_t(bytes[1]) << 16) | (uint32_t(bytes[2]) << 8) | bytes[3]; };
  const auto width = dimension(), height = dimension();
  require(width > 0 && height > 0 && width <= 1024 && height <= 1024 && fs::file_size(path) == 8 + uint64_t(width)*height*4, "Invalid signature image size.");
  std::vector<unsigned char> pixels(size_t(width)*height*4);
  input.read(reinterpret_cast<char*>(pixels.data()), std::streamsize(pixels.size()));
  require(bool(input), "Incomplete signature image.");
  auto bitmap = FPDFBitmap_CreateEx(int(width), int(height), FPDFBitmap_BGRA, pixels.data(), int(width)*4);
  require(bitmap != nullptr, "Could not prepare signature pixels.");
  std::unique_ptr<std::remove_pointer_t<FPDF_BITMAP>, decltype(&FPDFBitmap_Destroy)> ownedBitmap(bitmap, FPDFBitmap_Destroy);
  auto object = FPDFPageObj_NewImageObj(doc);
  require(object != nullptr, "Could not add the signature.");
  std::unique_ptr<std::remove_pointer_t<FPDF_PAGEOBJECT>, decltype(&FPDFPageObj_Destroy)> owned(object, FPDFPageObj_Destroy);
  require(FPDFImageObj_SetBitmap(nullptr, 0, object, bitmap), "Could not embed the signature image.");
  const auto points = command.at("points");
  require(points.is_array() && points.size() == 2, "Invalid signature placement.");
  double left=1, top=1, right=0, bottom=0;
  for (const auto& p : points) { const double x=p.at(0), y=p.at(1); require(std::isfinite(x) && std::isfinite(y) && x>=0 && x<=1 && y>=0 && y<=1, "Keep the signature inside the page."); left=std::min(left,x); top=std::min(top,y); right=std::max(right,x); bottom=std::max(bottom,y); }
  require(right>left && bottom>top, "Make the signature larger.");
  auto position = [&](double x,double y) { double px,py; FPDF_DeviceToPage(page,0,0,100000,100000,0,int(x*100000),int(y*100000),&px,&py); return std::make_pair(px,py); };
  const auto bl=position(left,bottom), br=position(right,bottom), tl=position(left,top);
  require(FPDFImageObj_SetMatrix(object,br.first-bl.first,br.second-bl.second,tl.first-bl.first,tl.second-bl.second,bl.first,bl.second), "Could not position the signature.");
  FPDFPage_InsertObject(page,object); owned.release();
}

static int apply(FPDF_DOCUMENT doc, FPDF_PAGE page, int pageNumber, const Json& commands,
                  const std::function<void()>& check) {
  if (std::none_of(commands.begin(), commands.end(), [pageNumber](const auto& command) { return command.at("page").template get<int>() == pageNumber; })) return 0;
  int fallbacks = 0;
  std::map<int, FPDF_PAGEOBJECT> objects;
  for (int i = 0; i < FPDFPage_CountObjects(page); ++i) objects[i] = FPDFPage_GetObject(page, i);
  std::map<int, std::string> originalText;
  { TextPage original(page);
    for (const auto& command : commands) {
      if (command.at("page").get<int>() != pageNumber || command.at("kind") == "add" || command.at("kind") == "mark" || command.at("kind") == "image" || command.at("kind") == "number") continue;
      const int id = command.at("objectId");
      require(objects.count(id) != 0, "The selected text changed. Reopen this page.", "PDF_STALE_TEXT");
      originalText[id] = textOf(objects.at(id), original.value);
    }
  }
  Verification verification;
  std::set<int> touched;
  bool changed = false;
  for (auto command : commands) {
    check();
    if (command.at("page").get<int>() != pageNumber) continue;
    if (command.at("kind") == "image") { applyImage(doc, page, command); changed = true; continue; }
    if (command.at("kind") == "mark") { applyMark(page, command); changed = true; continue; }
    if (command.at("kind") == "number") {
      const float size = command.value("size", 11.0f), margin = command.value("margin", 24.0f);
      require(std::isfinite(size) && size >= 4 && size <= 72 && std::isfinite(margin) && margin >= 0 && margin <= 144, "Choose a valid size and margin.");
      const auto text = command.at("text").get<std::string>();
      auto object = newText(doc, command.value("font", std::string("Helvetica")), size);
      std::unique_ptr<std::remove_pointer_t<FPDF_PAGEOBJECT>, decltype(&FPDFPageObj_Destroy)> owned(object, FPDFPageObj_Destroy);
      setText(object, text);
      float l = 0, b = 0, r = 0, t = 0; FPDFPageObj_GetBounds(object, &l, &b, &r, &t);
      const auto position = command.value("position", std::string("bottom-center"));
      const float w = FPDF_GetPageWidthF(page), h = FPDF_GetPageHeightF(page), tw = r - l;
      require(tw + margin * 2 < w && (t - b) + margin * 2 < h, "The number label does not fit this page. Reduce its size or margins.");
      const float px = (position.find("left") != std::string::npos ? margin : position.find("right") != std::string::npos ? w - margin - tw : (w - tw) / 2) - l;
      const float py = position.find("top") != std::string::npos ? margin + t : position.find("middle") != std::string::npos ? (h + t + b) / 2 : h - margin + b;
      command["kind"] = "add"; command["x"] = px / w; command["y"] = py / h;
    }
    const auto kind = command.at("kind").get<std::string>();
    require(kind == "add" || kind == "replace" || kind == "delete", "Unknown text operation.");
    const bool underlined = command.value("underline", false);
    const double indent = command.value("indent", 0.0);
    require(std::isfinite(indent) && std::abs(indent) <= 2000, "Choose a smaller indent.");
    if (kind == "add") {
      const double x = command.at("x"), y = command.at("y");
      require(std::isfinite(x) && std::isfinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1, "Tap a position inside the page.");
      const auto lines = linesOf(command.at("text"));
      const auto font = command.value("font", std::string("Helvetica"));
      const float size = command.value("size", 16.0f);
      require(std::isfinite(size) && size >= 4 && size <= 200, "Choose a font size from 4 to 200.");
      // Map display coordinates (including page rotation/crop) to PDF space.
      double px, py, ux, uy;
      FPDF_DeviceToPage(page, 0, 0, 10000, 10000, 0, int(x * 10000), int(y * 10000), &px, &py);
      FPDF_DeviceToPage(page, 0, 0, 10000, 10000, 0, int(x * 10000) + 100, int(y * 10000), &ux, &uy);
      const double angle = std::atan2(uy - py, ux - px);
      FS_MATRIX matrix{float(std::cos(angle)), float(std::sin(angle)), float(-std::sin(angle)), float(std::cos(angle)), float(px), float(py)};
      indentMatrix(matrix, indent);
      const auto color = command.value("color", 0x101020u);
      writeLines(page, lines, matrix, size, nullptr, [&] { return newText(doc, font, size); },
                 (color >> 16) & 255, (color >> 8) & 255, color & 255, unsigned(std::clamp(command.value("opacity", 1.0), .05, 1.0) * 255), underlined, verification);
    } else {
      const int id = command.at("objectId");
      require(objects.count(id) && touched.insert(id).second, "The selected text changed. Reopen this page.", "PDF_STALE_TEXT");
      auto object = objects.at(id);
      require(FPDFPageObj_GetType(object) == FPDF_PAGEOBJ_TEXT && editable(object), "This text uses an unsupported PDF structure.", "PDF_UNSUPPORTED_TEXT");
      require(originalText.at(id) == command.at("original").get<std::string>(), "The source text changed. Choose the PDF again.", "PDF_STALE_TEXT");
      if (kind == "delete") {
        require(FPDFPage_RemoveObject(page, object), "Could not remove the selected text.");
        FPDFPageObj_Destroy(object);
        changed = true;
        continue;
      }
      const auto lines = linesOf(command.at("text"));
      float fontSize = 12;
      FPDFTextObj_GetFontSize(object, &fontSize);
      FS_MATRIX matrix;
      require(FPDFPageObj_GetMatrix(object, &matrix), "This text cannot be positioned safely.");
      // `size` is the visible size in points; scale the matrix so spacing and position stay anchored.
      if (command.contains("size")) {
        const float target = command.at("size").get<float>();
        const float current = fontSize * matrixScale(matrix);
        require(std::isfinite(target) && target >= 4 && target <= 200, "Choose a font size from 4 to 200.");
        if (current > 0 && std::abs(target - current) > 0.01f) {
          const float k = target / current;
          matrix.a *= k; matrix.b *= k; matrix.c *= k; matrix.d *= k;
        }
      }
      indentMatrix(matrix, indent);
      unsigned int r = 0, g = 0, b = 0, a = 255;
      FPDFPageObj_GetFillColor(object, &r, &g, &b, &a);
      if (command.contains("color")) {
        const auto color = command.at("color").get<unsigned int>();
        r = (color >> 16) & 255; g = (color >> 8) & 255; b = color & 255; a = 255;
      }
      const auto font = command.value("font", std::string("original"));
      if (font == "original") {
        require(!lines.front().empty(), "Start the text on the first line.", "PDF_INVALID_TEXT");
        auto original = FPDFTextObj_GetFont(object);
        require(original != nullptr, "This text uses an unsupported font.", "PDF_UNSUPPORTED_TEXT");
        const auto fallback = similarFont(original);
        const auto mark = verification.size();
        std::vector<FPDF_PAGEOBJECT> created;
        bool usable = true;
        try {
          writeLines(page, lines, matrix, fontSize, object, [&] {
            auto extra = FPDFPageObj_CreateTextObj(doc, original, fontSize);
            require(extra != nullptr, "Could not add another line in this font.", "PDF_FONT_UNSUPPORTED");
            FPDFTextObj_SetTextRenderMode(extra, FPDFTextObj_GetTextRenderMode(object));
            return extra;
          }, r, g, b, a, underlined, verification, &created);
          // Embedded fonts are usually subsets; confirm every new character exists before keeping them.
          require(FPDFPage_GenerateContent(page), "Could not rebuild the edited page.");
          TextPage readback(page);
          for (auto i = mark; i < verification.size(); ++i) usable = usable && sameText(textOf(verification[i].first, readback.value), verification[i].second);
        } catch (const Failure& failure) {
          if (std::string(failure.code) != "PDF_FONT_UNSUPPORTED") throw;
          usable = false;
        }
        if (!usable) {
          verification.resize(mark);
          if (std::find(created.begin(), created.end(), object) == created.end()) created.push_back(object);
          for (auto item : created) { if (FPDFPage_RemoveObject(page, item)) FPDFPageObj_Destroy(item); }
          writeLines(page, lines, matrix, fontSize, nullptr, [&] { return newText(doc, fallback, fontSize); }, r, g, b, a, underlined, verification);
          ++fallbacks;
        }
      } else {
        writeLines(page, lines, matrix, fontSize, nullptr, [&] { return newText(doc, font, fontSize); }, r, g, b, a, underlined, verification);
        require(FPDFPage_RemoveObject(page, object), "Could not remove the selected text.");
        FPDFPageObj_Destroy(object);
      }
    }
    changed = true;
  }
  if (changed) require(FPDFPage_GenerateContent(page), "Could not rebuild the edited page.");
  if (!verification.empty()) {
    TextPage readback(page);
    for (const auto& item : verification) {
      check();
      // Subset fonts often lack new glyphs. Never silently save missing characters.
      require(sameText(textOf(item.first, readback.value), item.second),
              "Some characters cannot be written with the standard PDF fonts (Arial, Times New Roman, Courier New support Latin letters), or the text is outside the page. Remove those characters or move the text onto the page.", "PDF_FONT_UNSUPPORTED");
    }
  }
  return fallbacks;
}
struct Writer : FPDF_FILEWRITE {
  FILE* file;
  std::function<bool()> cancelled;
  Writer(const fs::path& path, std::function<bool()> cancel) : file(std::fopen(path.string().c_str(), "wb")), cancelled(std::move(cancel)) {
    version = 1;
    WriteBlock = [](FPDF_FILEWRITE* base, const void* data, unsigned long size) -> int {
      auto self = static_cast<Writer*>(base);
      return !self->cancelled() && std::fwrite(data, 1, size, self->file) == size;
    };
    require(file != nullptr, "Could not write the PDF. Check free storage.");
  }
  ~Writer() { if (file) std::fclose(file); }
  bool finish() { const bool ok = std::fclose(file) == 0; file = nullptr; return ok; }
};
std::string runEditor(const std::string& request, const std::string& cacheRoot,
                      const std::string& documentRoot, const std::function<bool()>& cancelled,
                      const std::function<void(int, int)>& progress) {
  std::lock_guard<std::mutex> guard(engineLock);
  fs::path temporary;
  try {
    auto check = [&]() { require(!cancelled(), "Operation cancelled.", "PDF_CANCELLED"); };
    check();
    std::call_once(initialized, [] { FPDF_InitLibrary(); });
    const auto options = Json::parse(request);
    const auto input = [&]() {
      try { return childPath(options.at("path"), cacheRoot, true); }
      catch (const Failure& failure) {
        // Reader search is read-only and may target an app-owned saved document.
        // Mutating tools still require their isolated cache copy.
        if (options.at("action") != "search" || failure.code != "PDF_INVALID_PATH") throw;
        return childPath(options.at("path"), documentRoot, true);
      }
    }();
    if (options.at("action") == "search") require(fs::file_size(input) <= 512ULL * 1024 * 1024, "Search a PDF smaller than 512 MB on this device.", "PDF_INPUT_LIMIT");
    Document document(input.string(), options.value("inputPassword", std::string("")));
    const bool annotationJob = options.value("nativeEditor", false);
    const auto doc = document.value;
    const auto securityRevision = FPDF_GetSecurityHandlerRevision(doc);
    const auto permissions = FPDF_GetDocPermissions(doc);
    if (options.at("action") == "inspect") {
      check();
      return Json{{"pageCount", FPDF_GetPageCount(doc)}, {"signatureCount", FPDF_GetSignatureCount(doc)},
                  {"securityRevision", securityRevision}, {"permissions", permissions}}.dump();
    }
    if (options.at("action") == "ocr_save") {
      require((permissions & 0x418) == 0x418, "This PDF restricts editing or extraction.", "PDF_PROTECTED");
      require(FPDF_GetSignatureCount(doc) == 0, "Use an unsigned copy to preserve this PDF's digital signatures.", "PDF_SIGNED");
      const int count = FPDF_GetPageCount(doc);
      require(count > 0 && count <= 2000, "Choose a PDF with 1 to 2,000 pages.");
      const auto& pages = options.at("ocrPages");
      require(pages.is_array() && !pages.empty() && pages.size() <= 100, "Recognize up to 100 selected pages at a time.");
      const auto output = childPath(options.at("outputPath"), fs::path(documentRoot) / "Versara PDFs", false);
      require(output.extension() == ".partial" && output.stem().extension() == ".pdf" && !fs::exists(output), "Choose a new searchable PDF name.");
      temporary = output.string() + ".partial";
      require(!fs::exists(temporary), "This searchable PDF is already being saved.");
      std::set<int> visited;
      static unsigned long long ocrSequence = 0; // runEditor holds engineLock.
      const std::string ocrTag = "VersaraOCR-" + std::to_string(std::chrono::system_clock::now().time_since_epoch().count()) + "-" + std::to_string(++ocrSequence);
      int words = 0, recognized = 0, skipped = 0, empty = 0;
      for (const auto& entry : pages) {
        check(); const int number = entry.at("page");
        require(number >= 0 && number < count && visited.insert(number).second, "Choose valid, unique OCR pages.");
        Page page(doc, number);
        const auto& items = entry.at("words");
        require(items.is_array() && items.size() <= 2000 && words + int(items.size()) <= 20000, "OCR output is too large. Choose fewer pages.");
        if (entry.value("skipped", false)) { require(items.empty(), "A skipped OCR page cannot contain new words."); ++skipped; continue; }
        if (items.empty()) { ++empty; continue; }
        words += int(addOcrWords(doc, page.value, items, ocrTag, check).size()); ++recognized;
      }
      require(words > 0 || skipped > 0, "No readable text was recognized. Try clearer, upright scans or export text.");
      check();
      { Writer writer(temporary, cancelled); const bool saved = FPDF_SaveAsCopy(doc, &writer, FPDF_NO_INCREMENTAL); check(); require(saved && writer.finish(), "Could not save the searchable PDF. Check free storage."); }
      check();
      { Document verify(temporary.string(), options.value("inputPassword", std::string("")));
        require(FPDF_GetPageCount(verify.value) == count && FPDF_GetSecurityHandlerRevision(verify.value) == securityRevision && FPDF_GetDocPermissions(verify.value) == permissions, "The searchable PDF did not preserve its structure or security.");
        int verifiedWords = 0;
        for (const auto& entry : pages) { if (entry.at("words").empty()) continue; check(); Page page(verify.value, entry.at("page")); verifiedWords += verifyOcrWords(page.value, entry.at("words"), ocrTag, check); }
        require(verifiedWords == words, "The saved OCR layer is incomplete. No output was kept.");
      }
      check(); fs::rename(temporary, output); temporary.clear();
      return Json{{"wordCount", words}, {"pagesAdded", recognized}, {"skippedPages", skipped}, {"emptyPages", empty}}.dump();
    }
    auto commands = options.value("edits", Json::array());
    if (options.at("action") == "search") {
      require((permissions & 16) != 0, "Text search is restricted for this PDF.", "PDF_PROTECTED");
      const auto query = utf16(options.value("query", std::string("")));
      require(!query.empty() && query.size() <= 128 && query.find(u'\0') == std::u16string::npos, "Search for 1 to 128 visible characters.");
      const int pages = FPDF_GetPageCount(doc);
      require(pages > 0 && pages <= 2000, "Search a PDF with 1 to 2,000 pages.");
      Json matches = Json::array();
      bool truncated = false;
      for (int number = 0; number < pages && !truncated; ++number) {
        check(); Page page(doc, number); TextPage text(page.value);
        const int characters = FPDFText_CountChars(text.value);
        require(characters <= 500000, "A page is too complex for text search on this device.");
        if (characters <= 0) continue;
        auto handle = FPDFText_FindStart(text.value, reinterpret_cast<FPDF_WIDESTRING>(query.c_str()), 0, 0);
        require(handle != nullptr, "Could not search this page.");
        std::unique_ptr<std::remove_pointer_t<FPDF_SCHHANDLE>, decltype(&FPDFText_FindClose)> search(handle, FPDFText_FindClose);
        while (FPDFText_FindNext(handle)) {
          check();
          if (matches.size() >= 500) { truncated = true; break; }
          const int start = FPDFText_GetSchResultIndex(handle), length = FPDFText_GetSchCount(handle);
          const int rectangles = FPDFText_CountRects(text.value, start, length);
          Json rects = Json::array(), pdfRects = Json::array();
          for (int i = 0; i < std::min(rectangles, 32); ++i) {
            double l, t, r, b;
            if (!FPDFText_GetRect(text.value, i, &l, &t, &r, &b)) continue;
            int x1, y1, x2, y2;
            FPDF_PageToDevice(page.value, 0, 0, 100000, 100000, 0, l, t, &x1, &y1);
            FPDF_PageToDevice(page.value, 0, 0, 100000, 100000, 0, r, b, &x2, &y2);
            rects.push_back({std::min(x1, x2) / 100000.0, std::min(y1, y2) / 100000.0, std::max(x1, x2) / 100000.0, std::max(y1, y2) / 100000.0});
            pdfRects.push_back({l, b, r, t});
          }
          matches.push_back({{"page", number}, {"rects", rects}, {"pdfRects", pdfRects}});
        }
        if (number % 10 == 0 || number + 1 == pages) progress(number + 1, pages);
      }
      check();
      return Json{{"matches", matches}, {"truncated", truncated}}.dump();
    }
    if (options.at("action") == "selection") {
      require((FPDF_GetDocPermissions(doc) & 16) != 0, "Copying is restricted for this PDF.");
      const int number = options.at("page");
      require(number >= 0 && number < FPDF_GetPageCount(doc), "Choose an existing page.");
      Page page(doc, number); TextPage text(page.value); Json glyphs = Json::array();
      const int count = FPDFText_CountChars(text.value);
      require(count <= 20000, "This page contains too much text to select on this device.");
      for (int i = 0; i < count; ++i) {
        check(); const auto code = FPDFText_GetUnicode(text.value, i);
        if (code == 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) continue;
        const std::string value = std::wstring_convert<std::codecvt_utf8<char32_t>, char32_t>{}.to_bytes(char32_t(code));
        double l, r, b, t;
        if (!FPDFText_GetCharBox(text.value, i, &l, &r, &b, &t)) continue;
        int x1, y1, x2, y2;
        FPDF_PageToDevice(page.value, 0, 0, 100000, 100000, 0, l, t, &x1, &y1);
        FPDF_PageToDevice(page.value, 0, 0, 100000, 100000, 0, r, b, &x2, &y2);
        glyphs.push_back({{"text", value}, {"left", std::min(x1, x2) / 100000.0}, {"top", std::min(y1, y2) / 100000.0}, {"right", std::max(x1, x2) / 100000.0}, {"bottom", std::max(y1, y2) / 100000.0}});
      }
      return Json{{"glyphs", glyphs}}.dump();
    }
    const bool readOnlyPreview = options.at("action") == "preview" && !options.value("includeObjects", true) && commands.is_array() && commands.empty();
    if (!readOnlyPreview) {
      if (annotationJob) require((FPDF_GetDocPermissions(doc) & 0x418) == 0x418, "This PDF restricts editing or extraction. Use an unrestricted copy.", "PDF_PROTECTED");
      else require(FPDF_GetSecurityHandlerRevision(doc) == -1, "Choose an unrestricted PDF to edit.", "PDF_PROTECTED");
      require(FPDF_GetSignatureCount(doc) == 0, "This PDF is digitally signed. Editing would invalidate its signature. Choose an unsigned copy.", "PDF_SIGNED");
    }
    const int count = FPDF_GetPageCount(doc);
    require(count >= 1 && count <= 2000, "Choose a PDF with 1 to 2,000 pages.");
    require(commands.is_array() && commands.size() <= 2000, "Save up to 2,000 changes at a time.");
    int images = 0;
    for (auto& command : commands) if (command.value("kind", std::string()) == "image") {
      require(++images <= 32, "Use up to 32 image signatures per save.");
      const auto value = command.at("pixelPath").get<std::string>();
      fs::path safe;
      try { safe = childPath(value, cacheRoot, true); }
      catch (...) { safe = childPath(value, fs::path(documentRoot) / "Versara Signature Drafts", true); }
      command["pixelPath"] = safe.string();
    }
    for (const auto& command : commands) require(command.at("page").get<int>() >= 0 && command.at("page").get<int>() < count, "Invalid page number.");
    if (options.at("action") == "preview") {
      const int number = options.at("page");
      require(number >= 0 && number < count, "Choose an existing page.");
      Page page(doc, number);
      const double pageWidth = FPDF_GetPageWidthF(page.value), pageHeight = FPDF_GetPageHeightF(page.value);
      require(std::isfinite(pageWidth) && std::isfinite(pageHeight) && pageWidth > 0 && pageHeight > 0, "This page has invalid dimensions.");
      const double scale = std::min(1440.0 / std::max(pageWidth, pageHeight), std::sqrt(1600000.0 / (pageWidth * pageHeight)));
      const int width = std::max(1, int(pageWidth * scale)), height = std::max(1, int(pageHeight * scale));
      Json objects = Json::array();
      int nested = 0;
      if (options.value("includeObjects", true)) { TextPage text(page.value);
        const int objectCount = FPDFPage_CountObjects(page.value);
        require(objectCount <= 20000, "This page is too complex for text editing.");
        for (int i = 0; i < objectCount; ++i) {
          check();
          auto object = FPDFPage_GetObject(page.value, i);
          if (FPDFPageObj_GetType(object) == FPDF_PAGEOBJ_FORM) { ++nested; continue; }
          if (FPDFPageObj_GetType(object) != FPDF_PAGEOBJ_TEXT) continue;
          auto value = textOf(object, text.value);
          if (value.empty()) continue;
          float size = 12; FPDFTextObj_GetFontSize(object, &size);
          FS_MATRIX matrix;
          if (FPDFPageObj_GetMatrix(object, &matrix) && matrixScale(matrix) > 0) size *= matrixScale(matrix);
          unsigned r = 16, g = 16, b = 32, a = 255; FPDFPageObj_GetFillColor(object, &r, &g, &b, &a);
          objects.push_back({{"font", similarFont(FPDFTextObj_GetFont(object))}, {"color", (r << 16) | (g << 8) | b}, {"id", i}, {"text", value}, {"size", size}, {"editable", editable(object)}, {"bounds", bounds(page.value, object, width, height)}});
          require(objects.size() <= 2000, "This page contains too many text fragments to edit on a phone.");
        }
      }
      const int fallbacks = apply(doc, page.value, number, commands, check);
      check();
      auto bitmap = FPDFBitmap_Create(width, height, 0);
      require(bitmap != nullptr, "Not enough memory for this page.");
      std::unique_ptr<std::remove_pointer_t<FPDF_BITMAP>, decltype(&FPDFBitmap_Destroy)> owned(bitmap, FPDFBitmap_Destroy);
      FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
      FPDF_RenderPageBitmap(bitmap, page.value, 0, 0, width, height, 0, FPDF_ANNOT);
      check();
      auto bytes = static_cast<unsigned char*>(FPDFBitmap_GetBuffer(bitmap));
      const int stride = FPDFBitmap_GetStride(bitmap);
      for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x) { auto p = bytes + y * stride + x * 4; std::swap(p[0], p[2]); p[3] = 255; }
      const auto image = childPath(options.at("imagePath"), cacheRoot, false);
      require(!fs::exists(image), "Preview file already exists.");
      temporary = image;
      require(stbi_write_png(image.string().c_str(), width, height, 4, bytes, stride) != 0, "Could not create a page preview. Check free storage.");
      check(); temporary.clear();
      return Json{{"pageCount", count}, {"width", width}, {"height", height}, {"pointWidth", pageWidth}, {"objects", objects}, {"nestedForms", nested}, {"fontFallbacks", fallbacks}}.dump();
    }
    require(options.at("action") == "save" && !commands.empty(), "Make a text change before saving.");
    fs::create_directories(fs::path(documentRoot) / "Versara PDFs");
    const auto output = childPath(options.at("outputPath"), fs::path(documentRoot) / "Versara PDFs", false);
    require(output.extension() == ".pdf" && !fs::exists(output), "Choose a new PDF name.");
    const fs::path staged = output.string() + ".partial";
    require(!fs::exists(staged), "This PDF is already being saved.");
    temporary = staged;
    std::set<int> changed;
    for (const auto& command : commands) changed.insert(command.at("page").get<int>());
    int completed = 0;
    for (int number : changed) { check(); Page page(doc, number); apply(doc, page.value, number, commands, check); progress(++completed, int(changed.size()) + 1); }
    check();
    { Writer writer(temporary, cancelled);
      // Keep the original encryption dictionary and credentials. Modifying a
      // document is not permission to silently remove its opening password.
      const bool saved = FPDF_SaveAsCopy(doc, &writer, FPDF_NO_INCREMENTAL);
      check(); require(saved && writer.finish(), "Could not save the PDF. Check free storage.");
    }
    { Document verify(temporary.string(), options.value("inputPassword", std::string("")));
      require(FPDF_GetPageCount(verify.value) == count, "The saved PDF did not pass verification.");
      require(FPDF_GetSecurityHandlerRevision(verify.value) == securityRevision && FPDF_GetDocPermissions(verify.value) == permissions,
              "The saved PDF did not preserve its password or permissions. No output was kept.", "PDF_SECURITY_CHANGED");
    }
    check();
    fs::rename(temporary, output); temporary.clear();
    progress(int(changed.size()) + 1, int(changed.size()) + 1);
    return Json{{"pageCount", count}, {"size", fs::file_size(output)}}.dump();
  } catch (const Failure& error) {
    if (!temporary.empty()) { std::error_code ignored; fs::remove(temporary, ignored); }
    return Json{{"code", error.code}, {"error", error.what()}}.dump();
  } catch (const std::exception&) {
    if (!temporary.empty()) { std::error_code ignored; fs::remove(temporary, ignored); }
    return Json{{"code", "PDF_EDIT_FAILED"}, {"error", "Could not edit this PDF. Check the file and available storage."}}.dump();
  }
}
}

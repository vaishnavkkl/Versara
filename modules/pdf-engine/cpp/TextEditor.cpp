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
#include <cctype>
#include <cmath>
#include <codecvt>
#include <cstdio>
#include <filesystem>
#include <functional>
#include <locale>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <stdexcept>
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
  explicit Document(const std::string& path) : value(FPDF_LoadDocument(path.c_str(), nullptr)) {
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
static int apply(FPDF_DOCUMENT doc, FPDF_PAGE page, int pageNumber, const Json& commands,
                  const std::function<void()>& check) {
  if (std::none_of(commands.begin(), commands.end(), [pageNumber](const auto& command) { return command.at("page").template get<int>() == pageNumber; })) return 0;
  int fallbacks = 0;
  std::map<int, FPDF_PAGEOBJECT> objects;
  for (int i = 0; i < FPDFPage_CountObjects(page); ++i) objects[i] = FPDFPage_GetObject(page, i);
  std::map<int, std::string> originalText;
  { TextPage original(page);
    for (const auto& command : commands) {
      if (command.at("page").get<int>() != pageNumber || command.at("kind") == "add") continue;
      const int id = command.at("objectId");
      require(objects.count(id) != 0, "The selected text changed. Reopen this page.", "PDF_STALE_TEXT");
      originalText[id] = textOf(objects.at(id), original.value);
    }
  }
  Verification verification;
  std::set<int> touched;
  bool changed = false;
  for (const auto& command : commands) {
    check();
    if (command.at("page").get<int>() != pageNumber) continue;
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
                 (color >> 16) & 255, (color >> 8) & 255, color & 255, 255, underlined, verification);
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
    const auto input = childPath(options.at("path"), cacheRoot, true);
    Document document(input.string());
    const auto doc = document.value;
    require(FPDF_GetSecurityHandlerRevision(doc) == -1, "Choose an unrestricted PDF to edit.", "PDF_PROTECTED");
    require(FPDF_GetSignatureCount(doc) == 0, "This PDF is digitally signed. Editing would invalidate its signature. Choose an unsigned copy.", "PDF_SIGNED");
    const int count = FPDF_GetPageCount(doc);
    require(count >= 1 && count <= 2000, "Choose a PDF with 1 to 2,000 pages.");
    const auto commands = options.value("edits", Json::array());
    require(commands.is_array() && commands.size() <= 500, "Save up to 500 text changes at a time.");
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
      { TextPage text(page.value);
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
          objects.push_back({{"id", i}, {"text", value}, {"size", size}, {"editable", editable(object)}, {"bounds", bounds(page.value, object, width, height)}});
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
      const bool saved = FPDF_SaveAsCopy(doc, &writer, FPDF_NO_INCREMENTAL);
      check(); require(saved && writer.finish(), "Could not save the PDF. Check free storage.");
    }
    { Document verify(temporary.string()); require(FPDF_GetPageCount(verify.value) == count, "The saved PDF did not pass verification."); }
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

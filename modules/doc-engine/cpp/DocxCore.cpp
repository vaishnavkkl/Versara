#include "DocxCore.hpp"

#include "miniz.h"
#include "pugixml.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <functional>
#include <map>
#include <set>
#include <sstream>
#include <vector>

namespace versara {
namespace {

constexpr int kSectionChars = 400000;
constexpr int kMaxChars = 2000000;
constexpr size_t kMaxXml = 20 * 1024 * 1024;
constexpr size_t kMaxZip = 40 * 1024 * 1024;
constexpr int kUnset = INT_MIN;
constexpr int kMaxTableRows = 1000;

struct Json {
  enum Type { NUL, BOOL, NUM, STR, ARR, OBJ } type = NUL;
  bool b = false;
  double n = 0;
  std::string s;
  std::vector<Json> a;
  std::vector<std::pair<std::string, Json>> o;
  const Json* find(const std::string& key) const {
    if (type != OBJ) return nullptr;
    for (auto& item : o) if (item.first == key) return &item.second;
    return nullptr;
  }
  std::string str(const std::string& key) const { auto* v = find(key); return v && v->type == STR ? v->s : ""; }
  bool flag(const std::string& key) const { auto* v = find(key); return v && v->type == BOOL && v->b; }
  long long num(const std::string& key) const { auto* v = find(key); return v && v->type == NUM ? static_cast<long long>(v->n) : 0; }
  int integer(const std::string& key, int fallback) const { auto* v = find(key); return v && v->type == NUM ? static_cast<int>(std::max(-31680.0, std::min(v->n, 31680.0))) : fallback; }
};

struct Tab { int pos = 0; std::string align = "left"; std::string leader; bool clear = false; };
struct Run {
  std::string text, color, highlight, font, media, preview;
  bool bold = false, italic = false, underline = false, strike = false;
  int size = 0;
  long long cx = 0, cy = 0;
};
struct Cell { std::string text, font, color, fill, align = "left"; bool bold = false, italic = false, underline = false, strike = false; int size = 0; };
struct Block {
  std::string kind, raw, align = "left", list = "none", label, media, source;
  // Resolved paragraph style: the style id, numbering and the list marker shown for it.
  std::string style, num, numKind, marker, markerFont, markerColor, lineRule = "auto", extras, table;
  long long cx = 0, cy = 0;
  bool resized = false, dirty = false, isTable = false, markerBold = false, borders = false;
  bool pageBefore = false, breakBefore = false, breakAfter = false, ctxBefore = false, ctxAfter = false, contextual = false;
  // Twips (line in 240ths of a line when lineRule is auto); -1 or kUnset keeps the style's value.
  int indent = -1, before = -1, after = -1, line = -1, right = kUnset, first = kUnset, ilvl = 0, markerSize = 0;
  std::vector<Tab> tabs;
  std::vector<int> cols;
  std::vector<Run> runs;
  std::vector<std::vector<Cell>> rows;
};
struct Band { std::string text, align = "left"; bool locked = false, page = false; std::string pageAlign = "center", pageFormat = "plain"; };
struct HeaderFooter { Band header, footer; std::string pagePos = "none", pageAlign = "center", pageFormat = "plain"; bool dirty = false; };
struct Page { int w = 12240, h = 15840, top = 1440, right = 1440, bottom = 1440, left = 1440, header = 720, footer = 720; bool dirty = false; };
struct Defaults { std::string font = "Calibri"; int size = 22, before = 0, after = 160, line = 259; std::string rule = "auto"; };
struct Model { std::vector<std::vector<Block>> sections; int characters = 0; int locked = 0; std::string prefix = "w:"; std::string sect; HeaderFooter hf; Page page; Defaults defaults; };
constexpr const char* kRelNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
constexpr const char* kDefaultSect = "<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\"/></w:sectPr>";

std::string localName(const char* name) {
  if (!name) return "";
  const char* colon = std::strrchr(name, ':');
  return colon ? colon + 1 : name;
}
pugi::xml_node childLocal(pugi::xml_node node, const char* name) {
  for (auto child : node.children()) if (localName(child.name()) == name) return child;
  return {};
}
std::string attrLocal(pugi::xml_node node, const char* name) {
  for (auto attribute : node.attributes()) if (localName(attribute.name()) == name) return attribute.value();
  return "";
}
std::string upper(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
  return value;
}
std::string jsonEscape(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (unsigned char c : value) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) { char buf[8]; std::snprintf(buf, sizeof(buf), "\\u%04x", c); out += buf; }
        else out.push_back(static_cast<char>(c));
    }
  }
  return out;
}
void appendUtf8(std::string& out, unsigned code) {
  if (code < 0x80) out.push_back(static_cast<char>(code));
  else if (code < 0x800) { out.push_back(static_cast<char>(0xC0 | (code >> 6))); out.push_back(static_cast<char>(0x80 | (code & 0x3F))); }
  else if (code < 0x10000) { out.push_back(static_cast<char>(0xE0 | (code >> 12))); out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F))); out.push_back(static_cast<char>(0x80 | (code & 0x3F))); }
  else { out.push_back(static_cast<char>(0xF0 | (code >> 18))); out.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F))); out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F))); out.push_back(static_cast<char>(0x80 | (code & 0x3F))); }
}
std::vector<unsigned> decodeUtf8(const std::string& text) {
  std::vector<unsigned> out;
  for (size_t i = 0; i < text.size();) {
    unsigned char c = static_cast<unsigned char>(text[i]);
    int extra = c < 0x80 ? 0 : (c >> 5) == 6 ? 1 : (c >> 4) == 14 ? 2 : (c >> 3) == 30 ? 3 : -1;
    if (extra < 0 || i + static_cast<size_t>(extra) >= text.size()) { i++; continue; }
    unsigned code = extra == 0 ? c : extra == 1 ? (c & 0x1F) : extra == 2 ? (c & 0x0F) : (c & 0x07);
    for (int k = 1; k <= extra && i + k < text.size(); ++k) code = (code << 6) | (static_cast<unsigned char>(text[i + k]) & 0x3F);
    out.push_back(code);
    i += extra + 1;
  }
  return out;
}
int toInt(const std::string& value, int fallback = kUnset) {
  if (value.empty()) return fallback;
  return static_cast<int>(std::max(-100000L, std::min(std::strtol(value.c_str(), nullptr, 10), 100000L)));
}
bool hexColor(const std::string& value) {
  if (value.size() != 6) return false;
  return std::all_of(value.begin(), value.end(), [](char c) { return std::isxdigit(static_cast<unsigned char>(c)); });
}

// ---------- Resolved formatting: document defaults, styles, theme fonts and numbering ----------

struct RProps {
  int b = -1, i = -1, u = -1, strike = -1, vanish = -1, sz = 0;
  bool colorSet = false, highlightSet = false;
  std::string color, highlight, font;
  void merge(const RProps& o) {
    if (o.b >= 0) b = o.b;
    if (o.i >= 0) i = o.i;
    if (o.u >= 0) u = o.u;
    if (o.strike >= 0) strike = o.strike;
    if (o.vanish >= 0) vanish = o.vanish;
    if (o.sz) sz = o.sz;
    if (o.colorSet) { color = o.color; colorSet = true; }
    if (o.highlightSet) { highlight = o.highlight; highlightSet = true; }
    if (!o.font.empty()) font = o.font;
  }
};
struct PProps {
  std::string jc, lineRule, numId;
  int left = kUnset, right = kUnset, first = kUnset, before = kUnset, after = kUnset, line = kUnset, ilvl = -1, pageBreak = -1, contextual = -1;
  std::vector<Tab> tabs;
  void merge(const PProps& o) {
    if (!o.jc.empty()) jc = o.jc;
    if (o.left != kUnset) left = o.left;
    if (o.right != kUnset) right = o.right;
    if (o.first != kUnset) first = o.first;
    if (o.before != kUnset) before = o.before;
    if (o.after != kUnset) after = o.after;
    if (o.line != kUnset) { line = o.line; lineRule = o.lineRule; }
    if (!o.numId.empty()) numId = o.numId;
    if (o.ilvl >= 0) ilvl = o.ilvl;
    if (o.pageBreak >= 0) pageBreak = o.pageBreak;
    if (o.contextual >= 0) contextual = o.contextual;
    for (auto& tab : o.tabs) {
      tabs.erase(std::remove_if(tabs.begin(), tabs.end(), [&](const Tab& t) { return std::abs(t.pos - tab.pos) < 10; }), tabs.end());
      if (!tab.clear) tabs.push_back(tab);
    }
    std::sort(tabs.begin(), tabs.end(), [](const Tab& a, const Tab& b) { return a.pos < b.pos; });
  }
};
struct Theme { std::string minor = "Calibri", major = "Calibri Light"; };

int onOff(pugi::xml_node node) {
  if (!node) return -1;
  auto v = attrLocal(node, "val");
  return v == "0" || v == "false" || v == "off" || v == "none" ? 0 : 1;
}
std::string highlightHex(const std::string& name) {
  static const std::map<std::string, std::string> colors = {
    {"yellow", "FFFF00"}, {"green", "00FF00"}, {"cyan", "00FFFF"}, {"magenta", "FF00FF"}, {"blue", "0000FF"}, {"red", "FF0000"},
    {"darkBlue", "000080"}, {"darkCyan", "008080"}, {"darkGreen", "008000"}, {"darkMagenta", "800080"}, {"darkRed", "800000"},
    {"darkYellow", "808000"}, {"darkGray", "808080"}, {"lightGray", "C0C0C0"}, {"black", "000000"}, {"white", "FFFFFF"}};
  auto found = colors.find(name);
  return found == colors.end() ? "" : found->second;
}
RProps parseRPr(pugi::xml_node pr, const Theme& theme) {
  RProps r;
  if (!pr) return r;
  r.b = onOff(childLocal(pr, "b"));
  r.i = onOff(childLocal(pr, "i"));
  if (auto u = childLocal(pr, "u")) { auto v = attrLocal(u, "val"); r.u = v == "none" || v == "0" ? 0 : 1; }
  auto strike = childLocal(pr, "strike");
  r.strike = strike ? onOff(strike) : onOff(childLocal(pr, "dstrike"));
  r.vanish = onOff(childLocal(pr, "vanish"));
  auto size = attrLocal(childLocal(pr, "sz"), "val");
  if (!size.empty()) r.sz = std::max(2, std::min(toInt(size, 22), 3276));
  if (auto color = childLocal(pr, "color")) {
    auto v = attrLocal(color, "val");
    if (v == "auto") { r.colorSet = true; r.color.clear(); }
    else if (hexColor(v)) { r.colorSet = true; r.color = upper(v); }
  }
  if (auto highlight = childLocal(pr, "highlight")) { r.highlightSet = true; r.highlight = highlightHex(attrLocal(highlight, "val")); }
  else if (auto shd = childLocal(pr, "shd")) {
    auto fill = attrLocal(shd, "fill");
    if (hexColor(fill)) { r.highlightSet = true; r.highlight = upper(fill); }
    else if (fill == "auto") { r.highlightSet = true; r.highlight.clear(); }
  }
  if (auto fonts = childLocal(pr, "rFonts")) {
    auto name = attrLocal(fonts, "ascii");
    if (name.empty()) name = attrLocal(fonts, "hAnsi");
    if (name.empty()) {
      auto theme_ = attrLocal(fonts, "asciiTheme");
      if (theme_.empty()) theme_ = attrLocal(fonts, "hAnsiTheme");
      if (!theme_.empty()) name = theme_.rfind("major", 0) == 0 ? theme.major : theme.minor;
    }
    r.font = name;
  }
  return r;
}
PProps parsePPr(pugi::xml_node pr) {
  PProps p;
  if (!pr) return p;
  auto jc = attrLocal(childLocal(pr, "jc"), "val");
  if (!jc.empty()) p.jc = jc == "center" ? "center" : jc == "right" || jc == "end" ? "right" : jc == "both" || jc == "distribute" || jc.find("Kashida") != std::string::npos || jc == "thaiDistribute" ? "justify" : "left";
  if (auto ind = childLocal(pr, "ind")) {
    auto left = attrLocal(ind, "left");
    if (left.empty()) left = attrLocal(ind, "start");
    p.left = toInt(left);
    auto right = attrLocal(ind, "right");
    if (right.empty()) right = attrLocal(ind, "end");
    p.right = toInt(right);
    auto hanging = attrLocal(ind, "hanging"), firstLine = attrLocal(ind, "firstLine");
    if (!hanging.empty()) p.first = -toInt(hanging, 0);
    else if (!firstLine.empty()) p.first = toInt(firstLine, 0);
  }
  if (auto spacing = childLocal(pr, "spacing")) {
    auto automatic = [&](const char* name) { auto v = attrLocal(spacing, name); return v == "1" || v == "true" || v == "on"; };
    p.before = automatic("beforeAutospacing") ? 280 : toInt(attrLocal(spacing, "before"));
    p.after = automatic("afterAutospacing") ? 280 : toInt(attrLocal(spacing, "after"));
    auto line = attrLocal(spacing, "line");
    if (!line.empty()) {
      p.line = std::max(1, toInt(line, 240));
      auto rule = attrLocal(spacing, "lineRule");
      p.lineRule = rule == "exact" ? "exact" : rule == "atLeast" ? "atLeast" : "auto";
    }
  }
  if (auto num = childLocal(pr, "numPr")) {
    auto id = attrLocal(childLocal(num, "numId"), "val");
    if (!id.empty()) p.numId = id;
    auto level = attrLocal(childLocal(num, "ilvl"), "val");
    if (!level.empty()) p.ilvl = std::max(0, std::min(toInt(level, 0), 8));
  }
  p.pageBreak = onOff(childLocal(pr, "pageBreakBefore"));
  p.contextual = onOff(childLocal(pr, "contextualSpacing"));
  if (auto tabs = childLocal(pr, "tabs")) for (auto node : tabs.children()) {
    if (localName(node.name()) != "tab") continue;
    Tab tab;
    tab.pos = toInt(attrLocal(node, "pos"), 0);
    auto v = attrLocal(node, "val");
    tab.clear = v == "clear";
    tab.align = v == "right" || v == "end" ? "right" : v == "center" ? "center" : v == "decimal" ? "decimal" : "left";
    auto leader = attrLocal(node, "leader");
    tab.leader = leader == "dot" || leader == "middleDot" ? "dot" : leader == "hyphen" ? "hyphen" : leader == "underscore" || leader == "heavy" ? "line" : "";
    p.tabs.push_back(tab);
  }
  return p;
}
int bordersOf(pugi::xml_node tblPr) {
  auto borders = childLocal(tblPr, "tblBorders");
  if (!borders) return -1;
  for (auto edge : borders.children()) { auto v = attrLocal(edge, "val"); if (!v.empty() && v != "nil" && v != "none") return 1; }
  return 0;
}

class Styles {
 public:
  Theme theme;
  RProps rDefault;
  PProps pDefault;
  std::string defaultPara, defaultTable;
  struct Style { std::string type, basedOn; PProps p; RProps r; int borders = -1; };
  std::map<std::string, Style> styles;

  void load(const std::string& xml, const std::string& themeXml) {
    if (!themeXml.empty()) {
      pugi::xml_document doc;
      if (doc.load_buffer(themeXml.data(), themeXml.size())) {
        std::function<void(pugi::xml_node)> visit = [&](pugi::xml_node node) {
          auto name = localName(node.name());
          if (name == "minorFont" || name == "majorFont") {
            auto face = attrLocal(childLocal(node, "latin"), "typeface");
            if (!face.empty()) (name == "minorFont" ? theme.minor : theme.major) = face;
            return;
          }
          for (auto child : node.children()) visit(child);
        };
        visit(doc.first_child());
      }
    }
    pugi::xml_document doc;
    if (xml.empty() || !doc.load_buffer(xml.data(), xml.size())) return;
    for (auto node : doc.first_child().children()) {
      auto name = localName(node.name());
      if (name == "docDefaults") {
        rDefault = parseRPr(childLocal(childLocal(node, "rPrDefault"), "rPr"), theme);
        pDefault = parsePPr(childLocal(childLocal(node, "pPrDefault"), "pPr"));
      } else if (name == "style") {
        Style style;
        style.type = attrLocal(node, "type");
        style.basedOn = attrLocal(childLocal(node, "basedOn"), "val");
        style.p = parsePPr(childLocal(node, "pPr"));
        style.r = parseRPr(childLocal(node, "rPr"), theme);
        style.borders = bordersOf(childLocal(node, "tblPr"));
        auto id = attrLocal(node, "styleId");
        auto isDefault = attrLocal(node, "default");
        if (isDefault == "1" || isDefault == "true") {
          if (style.type == "paragraph") defaultPara = id;
          else if (style.type == "table") defaultTable = id;
        }
        styles[id] = std::move(style);
      }
    }
  }
  std::vector<const Style*> chain(const std::string& id) const {
    std::vector<const Style*> out;
    auto current = id;
    for (int depth = 0; depth < 16 && !current.empty(); ++depth) {
      auto found = styles.find(current);
      if (found == styles.end()) break;
      out.push_back(&found->second);
      current = found->second.basedOn;
    }
    std::reverse(out.begin(), out.end());
    return out;
  }
  void paragraph(const std::string& id, PProps& p, RProps& r, const std::string& table = "") const {
    p = pDefault;
    r = rDefault;
    if (!table.empty()) for (auto* style : chain(table)) { p.merge(style->p); r.merge(style->r); }
    auto use = id.empty() || !styles.count(id) ? defaultPara : id;
    for (auto* style : chain(use)) { p.merge(style->p); r.merge(style->r); }
  }
  RProps character(const std::string& id) const {
    RProps r;
    for (auto* style : chain(id)) r.merge(style->r);
    return r;
  }
  bool tableBorders(const std::string& id) const {
    auto list = chain(id);
    for (auto it = list.rbegin(); it != list.rend(); ++it) if ((*it)->borders >= 0) return (*it)->borders == 1;
    return false;
  }
};

std::string romanOf(int value, bool upperCase) {
  static const std::pair<int, const char*> table[] = {{1000, "m"}, {900, "cm"}, {500, "d"}, {400, "cd"}, {100, "c"}, {90, "xc"}, {50, "l"}, {40, "xl"}, {10, "x"}, {9, "ix"}, {5, "v"}, {4, "iv"}, {1, "i"}};
  std::string out;
  value = std::max(1, std::min(value, 3999));
  for (auto& item : table) while (value >= item.first) { out += item.second; value -= item.first; }
  return upperCase ? upper(out) : out;
}
std::string formatNumber(int value, const std::string& format) {
  if (format == "lowerLetter" || format == "upperLetter") {
    int n = std::max(1, value);
    std::string out(static_cast<size_t>((n - 1) / 26 + 1), static_cast<char>('a' + (n - 1) % 26));
    return format == "upperLetter" ? upper(out) : out;
  }
  if (format == "lowerRoman") return romanOf(value, false);
  if (format == "upperRoman") return romanOf(value, true);
  if (format == "decimalZero") return (value < 10 ? "0" : "") + std::to_string(value);
  if (format == "ordinal") {
    auto tail = value % 100 >= 11 && value % 100 <= 13 ? "th" : value % 10 == 1 ? "st" : value % 10 == 2 ? "nd" : value % 10 == 3 ? "rd" : "th";
    return std::to_string(value) + tail;
  }
  return std::to_string(value);
}
/** Symbol and Wingdings bullets live in the private-use area; show their Unicode look-alikes. */
unsigned symbolCode(unsigned code) {
  switch (code) {
    case 0xF0B7: case 0xF095: return 0x2022;
    case 0xF0A7: return 0x25AA;
    case 0xF06E: return 0x25A0;
    case 0xF071: case 0xF072: return 0x2751;
    case 0xF0D8: return 0x27A2;
    case 0xF0E0: case 0xF0E8: return 0x2794;
    case 0xF076: return 0x2756;
    case 0xF0FC: return 0x2713;
    case 0xF0FB: return 0x2717;
    case 0xF0A8: return 0x25C6;
    case 0xF02D: return 0x2013;
    default: return code >= 0xF000 && code <= 0xF0FF ? 0x2022 : code;
  }
}
std::string bulletText(const std::string& text) {
  if (text == "o") return "\xE2\x97\xA6";
  std::string out;
  for (auto code : decodeUtf8(text)) appendUtf8(out, symbolCode(code));
  return out;
}

class Numbering {
 public:
  struct Level { std::string format = "decimal", text = "%1."; int start = 1; PProps p; RProps r; };
  struct Num { std::string abstractId; std::map<int, int> starts; };
  std::map<std::string, std::array<Level, 9>> abstracts;
  std::map<std::string, Num> nums;
  std::map<std::string, std::array<int, 9>> counters;

  void load(const std::string& xml, const Theme& theme) {
    pugi::xml_document doc;
    if (xml.empty() || !doc.load_buffer(xml.data(), xml.size())) return;
    for (auto node : doc.first_child().children()) {
      auto name = localName(node.name());
      if (name == "abstractNum") {
        std::array<Level, 9> levels;
        for (auto lvl : node.children()) {
          if (localName(lvl.name()) != "lvl") continue;
          int index = std::max(0, std::min(toInt(attrLocal(lvl, "ilvl"), 0), 8));
          Level level;
          auto format = attrLocal(childLocal(lvl, "numFmt"), "val");
          if (!format.empty()) level.format = format;
          level.text = attrLocal(childLocal(lvl, "lvlText"), "val");
          level.start = toInt(attrLocal(childLocal(lvl, "start"), "val"), 1);
          level.p = parsePPr(childLocal(lvl, "pPr"));
          level.r = parseRPr(childLocal(lvl, "rPr"), theme);
          levels[static_cast<size_t>(index)] = level;
        }
        abstracts[attrLocal(node, "abstractNumId")] = levels;
      } else if (name == "num") {
        Num num;
        num.abstractId = attrLocal(childLocal(node, "abstractNumId"), "val");
        for (auto override_ : node.children()) {
          if (localName(override_.name()) != "lvlOverride") continue;
          auto start = attrLocal(childLocal(override_, "startOverride"), "val");
          if (!start.empty()) num.starts[std::max(0, std::min(toInt(attrLocal(override_, "ilvl"), 0), 8))] = toInt(start, 1);
        }
        nums[attrLocal(node, "numId")] = num;
      }
    }
  }
  const Level* level(const std::string& numId, int ilvl) const {
    auto num = nums.find(numId);
    if (num == nums.end()) return nullptr;
    auto abstract = abstracts.find(num->second.abstractId);
    if (abstract == abstracts.end()) return nullptr;
    return &abstract->second[static_cast<size_t>(std::max(0, std::min(ilvl, 8)))];
  }
  std::string kind(const std::string& numId, int ilvl) const {
    auto* lvl = level(numId, ilvl);
    if (!lvl || lvl->format == "none") return "none";
    return lvl->format == "bullet" ? "bullet" : "decimal";
  }
  std::string next(const std::string& numId, int ilvl) {
    auto* lvl = level(numId, ilvl);
    if (!lvl) return "";
    auto& num = nums[numId];
    auto key = num.starts.empty() ? "a" + num.abstractId : "n" + numId;
    auto found = counters.find(key);
    if (found == counters.end()) found = counters.emplace(key, std::array<int, 9>{}).first;
    auto& counts = found->second;
    auto startOf = [&](int index) { auto s = num.starts.find(index); auto* l = level(numId, index); return s != num.starts.end() ? s->second : l ? l->start : 1; };
    for (int deeper = ilvl + 1; deeper < 9; ++deeper) counts[static_cast<size_t>(deeper)] = 0;
    auto& count = counts[static_cast<size_t>(ilvl)];
    count = count == 0 ? startOf(ilvl) : count + 1;
    if (lvl->format == "bullet") return bulletText(lvl->text);
    if (lvl->format == "none") return "";
    std::string out;
    for (size_t i = 0; i < lvl->text.size(); ++i) {
      char c = lvl->text[i];
      if (c == '%' && i + 1 < lvl->text.size() && lvl->text[i + 1] >= '1' && lvl->text[i + 1] <= '9') {
        int index = lvl->text[i + 1] - '1';
        auto* ref = level(numId, index);
        int value = counts[static_cast<size_t>(index)] ? counts[static_cast<size_t>(index)] : startOf(index);
        out += formatNumber(value, ref ? ref->format : "decimal");
        i++;
      } else out.push_back(c);
    }
    return out;
  }
};

// ---------- JSON output ----------

void appendBool(std::string& out, const char* key, bool value) {
  if (!value) return;
  out += ",\""; out += key; out += "\":true";
}
std::string runJson(const Run& run) {
  std::string out = "{\"text\":\"" + jsonEscape(run.text) + "\"";
  appendBool(out, "bold", run.bold);
  appendBool(out, "italic", run.italic);
  appendBool(out, "underline", run.underline);
  appendBool(out, "strike", run.strike);
  if (!run.color.empty()) out += ",\"color\":\"" + jsonEscape(run.color) + "\"";
  if (!run.highlight.empty()) out += ",\"highlight\":\"" + jsonEscape(run.highlight) + "\"";
  if (run.size) out += ",\"size\":" + std::to_string(run.size);
  if (!run.font.empty()) out += ",\"font\":\"" + jsonEscape(run.font) + "\"";
  if (!run.media.empty()) out += ",\"media\":\"" + jsonEscape(run.media) + "\",\"cx\":" + std::to_string(run.cx) + ",\"cy\":" + std::to_string(run.cy);
  out += '}';
  return out;
}
void paragraphFields(std::string& out, const Block& block) {
  out += ",\"align\":\"" + block.align + "\",\"list\":\"" + block.list + "\"";
  if (block.indent >= 0) out += ",\"indent\":" + std::to_string(block.indent);
  if (block.right != kUnset && block.right != 0) out += ",\"right\":" + std::to_string(block.right);
  if (block.first != kUnset && block.first != 0) out += ",\"first\":" + std::to_string(block.first);
  if (block.before >= 0) out += ",\"before\":" + std::to_string(block.before);
  if (block.after >= 0) out += ",\"after\":" + std::to_string(block.after);
  if (block.line >= 0) out += ",\"line\":" + std::to_string(block.line);
  if (block.lineRule != "auto") out += ",\"rule\":\"" + block.lineRule + "\"";
  if (!block.style.empty()) out += ",\"style\":\"" + jsonEscape(block.style) + "\"";
  if (!block.num.empty()) out += ",\"num\":\"" + jsonEscape(block.num) + "\",\"ilvl\":" + std::to_string(block.ilvl) + ",\"numKind\":\"" + block.numKind + "\"";
  if (!block.marker.empty()) {
    out += ",\"marker\":\"" + jsonEscape(block.marker) + "\"";
    if (!block.markerFont.empty()) out += ",\"mf\":\"" + jsonEscape(block.markerFont) + "\"";
    if (block.markerSize) out += ",\"ms\":" + std::to_string(block.markerSize);
    if (!block.markerColor.empty()) out += ",\"mc\":\"" + block.markerColor + "\"";
    appendBool(out, "mb", block.markerBold);
  }
  if (!block.tabs.empty()) {
    out += ",\"tabs\":[";
    for (size_t i = 0; i < block.tabs.size(); ++i) {
      if (i) out += ',';
      out += "[" + std::to_string(block.tabs[i].pos) + ",\"" + block.tabs[i].align + "\"";
      if (!block.tabs[i].leader.empty()) out += ",\"" + block.tabs[i].leader + "\"";
      out += "]";
    }
    out += ']';
  }
  appendBool(out, "pbb", block.pageBefore);
  appendBool(out, "brB", block.breakBefore);
  appendBool(out, "brA", block.breakAfter);
  appendBool(out, "cb", block.ctxBefore);
  appendBool(out, "ca", block.ctxAfter);
  if (!block.extras.empty()) out += ",\"px\":\"" + jsonEscape(block.extras) + "\"";
  out += ",\"runs\":[";
  for (size_t i = 0; i < block.runs.size(); ++i) { if (i) out += ','; out += runJson(block.runs[i]); }
  out += ']';
}
std::string blockJson(const Block& block) {
  std::string out = "{\"kind\":\"" + block.kind + "\"";
  if (!block.raw.empty()) out += ",\"raw\":\"" + jsonEscape(block.raw) + "\"";
  if (!block.label.empty()) out += ",\"label\":\"" + jsonEscape(block.label) + "\"";
  if (block.kind == "paragraph") paragraphFields(out, block);
  else if (block.kind == "locked") {
    if (!block.table.empty()) out += ",\"table\":" + block.table;
    else if (!block.runs.empty()) paragraphFields(out, block);
  } else if (block.kind == "image") {
    out += ",\"cx\":" + std::to_string(block.cx) + ",\"cy\":" + std::to_string(block.cy) + ",\"align\":\"" + block.align + "\"";
    if (block.before >= 0) out += ",\"before\":" + std::to_string(block.before);
    if (block.after >= 0) out += ",\"after\":" + std::to_string(block.after);
    if (!block.media.empty()) out += ",\"media\":\"" + jsonEscape(block.media) + "\"";
    if (!block.source.empty()) out += ",\"source\":\"" + jsonEscape(block.source) + "\"";
    if (block.resized) out += ",\"resized\":true";
    appendBool(out, "pbb", block.pageBefore);
  } else if (block.kind == "table") {
    out += ",\"borders\":" + std::string(block.borders ? "true" : "false");
    if (!block.cols.empty()) {
      out += ",\"cols\":[";
      for (size_t i = 0; i < block.cols.size(); ++i) { if (i) out += ','; out += std::to_string(block.cols[i]); }
      out += ']';
    }
    out += ",\"rows\":[";
    for (size_t r = 0; r < block.rows.size(); ++r) {
      if (r) out += ',';
      out += '[';
      for (size_t c = 0; c < block.rows[r].size(); ++c) {
        if (c) out += ',';
        const auto& cell = block.rows[r][c];
        out += "{\"text\":\"" + jsonEscape(cell.text) + "\"";
        appendBool(out, "bold", cell.bold);
        appendBool(out, "italic", cell.italic);
        appendBool(out, "underline", cell.underline);
        appendBool(out, "strike", cell.strike);
        if (cell.size) out += ",\"size\":" + std::to_string(cell.size);
        if (!cell.font.empty()) out += ",\"font\":\"" + jsonEscape(cell.font) + "\"";
        if (!cell.color.empty()) out += ",\"color\":\"" + cell.color + "\"";
        if (!cell.fill.empty()) out += ",\"fill\":\"" + cell.fill + "\"";
        if (cell.align != "left") out += ",\"align\":\"" + cell.align + "\"";
        out += '}';
      }
      out += ']';
    }
    out += ']';
    appendBool(out, "dirty", block.dirty);
  }
  out += '}';
  return out;
}
std::string hfJson(const HeaderFooter& hf) {
  auto band = [](const char* key, const Band& value) {
    std::string out = std::string("\"") + key + "\":\"" + jsonEscape(value.text) + "\",\"" + key + "Align\":\"" + value.align + "\"";
    if (value.locked) out += std::string(",\"") + key + "Locked\":true";
    return out;
  };
  return "{" + band("header", hf.header) + "," + band("footer", hf.footer) + ",\"pagePos\":\"" + hf.pagePos + "\",\"pageAlign\":\"" + hf.pageAlign + "\",\"pageFormat\":\"" + hf.pageFormat + "\"}";
}
std::string pageJson(const Page& page) {
  return "{\"w\":" + std::to_string(page.w) + ",\"h\":" + std::to_string(page.h) + ",\"top\":" + std::to_string(page.top) + ",\"right\":" + std::to_string(page.right) +
    ",\"bottom\":" + std::to_string(page.bottom) + ",\"left\":" + std::to_string(page.left) + ",\"hd\":" + std::to_string(page.header) + ",\"fd\":" + std::to_string(page.footer) + "}";
}
std::string defaultsJson(const Defaults& d) {
  return "{\"font\":\"" + jsonEscape(d.font) + "\",\"size\":" + std::to_string(d.size) + ",\"before\":" + std::to_string(d.before) + ",\"after\":" + std::to_string(d.after) +
    ",\"line\":" + std::to_string(d.line) + ",\"rule\":\"" + d.rule + "\"}";
}
std::string modelJson(const Model& model) {
  std::string out = "{\"characters\":" + std::to_string(model.characters) + ",\"locked\":" + std::to_string(model.locked) + ",\"sect\":\"" + jsonEscape(model.sect) +
    "\",\"hf\":" + hfJson(model.hf) + ",\"page\":" + pageJson(model.page) + ",\"defaults\":" + defaultsJson(model.defaults) + ",\"sections\":[";
  for (size_t s = 0; s < model.sections.size(); ++s) {
    if (s) out += ',';
    out += "{\"blocks\":[";
    for (size_t b = 0; b < model.sections[s].size(); ++b) { if (b) out += ','; out += blockJson(model.sections[s][b]); }
    out += "]}";
  }
  out += "]}";
  return out;
}
std::string fail(const std::string& code, const std::string& message) {
  return "{\"error\":\"" + code + "\",\"message\":\"" + jsonEscape(message) + "\"}";
}

class Parser {
 public:
  explicit Parser(const std::string& text) : text_(text) {}
  Json parse() { auto value = read(); skip(); if (index_ != text_.size()) throw std::runtime_error("Unexpected trailing JSON."); return value; }
 private:
  const std::string& text_;
  size_t index_ = 0;
  int depth_ = 0;
  void skip() { while (index_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[index_]))) index_++; }
  char peek() { skip(); return index_ < text_.size() ? text_[index_] : 0; }
  char get() { if (index_ >= text_.size()) throw std::runtime_error("Incomplete JSON."); return text_[index_++]; }
  Json read() {
    if (++depth_ > 64) throw std::runtime_error("JSON is nested too deeply.");
    char c = peek();
    Json value;
    if (c == '{') value = readObject();
    else if (c == '[') value = readArray();
    else if (c == '"') { value.type = Json::STR; value.s = readString(); }
    else if (c == 't' || c == 'f') value = readBool();
    else if (c == 'n') { get(); if (get() != 'u' || get() != 'l' || get() != 'l') throw std::runtime_error("Invalid JSON null."); }
    else if (c == '-' || std::isdigit(static_cast<unsigned char>(c))) value = readNumber();
    else throw std::runtime_error("Invalid JSON value.");
    depth_--;
    return value;
  }
  Json readObject() {
    Json v; v.type = Json::OBJ; get();
    if (peek() == '}') { get(); return v; }
    while (true) {
      if (peek() != '"') throw std::runtime_error("Expected a JSON key.");
      auto key = readString();
      if (peek() != ':') throw std::runtime_error("Expected a colon.");
      get();
      v.o.emplace_back(key, read());
      char next = peek(); get();
      if (next == '}') break;
      if (next != ',') throw std::runtime_error("Expected a comma.");
    }
    return v;
  }
  Json readArray() {
    Json v; v.type = Json::ARR; get();
    if (peek() == ']') { get(); return v; }
    while (true) {
      v.a.push_back(read());
      char next = peek(); get();
      if (next == ']') break;
      if (next != ',') throw std::runtime_error("Expected a comma.");
    }
    return v;
  }
  Json readBool() {
    Json v; v.type = Json::BOOL;
    if (text_.compare(index_, 4, "true") == 0) { index_ += 4; v.b = true; return v; }
    if (text_.compare(index_, 5, "false") == 0) { index_ += 5; return v; }
    throw std::runtime_error("Invalid JSON boolean.");
  }
  Json readNumber() {
    Json v; v.type = Json::NUM; size_t start = index_;
    if (peek() == '-') get();
    while (index_ < text_.size() && (std::isdigit(static_cast<unsigned char>(text_[index_])) || text_[index_] == '.' || text_[index_] == 'e' || text_[index_] == 'E' || text_[index_] == '+' || text_[index_] == '-')) index_++;
    v.n = std::strtod(text_.c_str() + start, nullptr);
    return v;
  }
  std::string readString() {
    if (get() != '"') throw std::runtime_error("Expected a string.");
    std::string out;
    while (index_ < text_.size()) {
      char c = get();
      if (c == '"') return out;
      if (c != '\\') { out.push_back(c); continue; }
      char e = get();
      if (e == 'n') out.push_back('\n');
      else if (e == 'r') out.push_back('\r');
      else if (e == 't') out.push_back('\t');
      else if (e == 'b') out.push_back('\b');
      else if (e == 'f') out.push_back('\f');
      else if (e == 'u') {
        auto hex = [&] {
          unsigned code = 0;
          for (int i = 0; i < 4; ++i) {
            char h = get();
            code <<= 4;
            if (h >= '0' && h <= '9') code += static_cast<unsigned>(h - '0');
            else if (h >= 'a' && h <= 'f') code += static_cast<unsigned>(h - 'a' + 10);
            else if (h >= 'A' && h <= 'F') code += static_cast<unsigned>(h - 'A' + 10);
            else throw std::runtime_error("Invalid JSON escape.");
          }
          return code;
        };
        unsigned code = hex();
        if (code >= 0xD800 && code <= 0xDBFF && index_ + 1 < text_.size() && text_[index_] == '\\' && text_[index_ + 1] == 'u') {
          index_ += 2;
          unsigned low = hex();
          code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
        }
        appendUtf8(out, code);
      } else out.push_back(e);
    }
    throw std::runtime_error("Unterminated string.");
  }
};

std::string xmlEscape(const std::string& value) {
  std::string out;
  for (unsigned char c : value) {
    if (c == '&') out += "&amp;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '"') out += "&quot;";
    else if (c < 0x20 && c != '\t' && c != '\n' && c != '\r') continue;
    else out.push_back(static_cast<char>(c));
  }
  return out;
}
std::string sliceOf(const std::string& xml, pugi::xml_node node, size_t fallbackEnd) {
  auto start = node.offset_debug();
  if (start < 0) return "";
  size_t from = static_cast<size_t>(start);
  pugi::xml_node next = node.next_sibling();
  size_t to = next && next.offset_debug() > start ? static_cast<size_t>(next.offset_debug()) : fallbackEnd;
  // pugixml's offset_debug points at the node name, one character after '<'.
  auto atTag = [&](size_t index) { return index > 0 && index < xml.size() && xml[index] != '<' && xml[index - 1] == '<'; };
  if (atTag(from)) from--;
  if (next && atTag(to)) to--;
  if (to < from || to > xml.size()) return "";
  return xml.substr(from, to - from);
}
void walk(pugi::xml_node node, const std::function<void(pugi::xml_node)>& visit) {
  visit(node);
  for (auto child : node.children()) walk(child, visit);
}
std::string nodeXml(pugi::xml_node node) {
  std::ostringstream out;
  node.print(out, "", pugi::format_raw);
  return out.str();
}
bool runSupported(pugi::xml_node run) {
  for (auto child : run.children()) {
    auto name = localName(child.name());
    if (name != "rPr" && name != "t" && name != "tab" && name != "br" && name != "cr" && name != "lastRenderedPageBreak" && name != "noBreakHyphen" && name != "softHyphen") return false;
  }
  return true;
}
bool paragraphSupported(pugi::xml_node paragraph) {
  for (auto child : paragraph.children()) {
    auto name = localName(child.name());
    if (name == "r") { if (!runSupported(child)) return false; }
    else if (name != "pPr" && name != "bookmarkStart" && name != "bookmarkEnd" && name != "proofErr") return false;
  }
  auto props = childLocal(paragraph, "pPr");
  return !(props && (childLocal(props, "sectPr") || childLocal(props, "pPrChange")));
}
std::string lockedLabel(pugi::xml_node node) {
  auto name = localName(node.name());
  if (name == "tbl") return "Table";
  if (name == "sdt") return "Content control";
  if (name != "p") return "Locked content";
  std::string label = "Locked paragraph";
  walk(node, [&](pugi::xml_node child) {
    auto childName = localName(child.name());
    if (childName == "drawing" || childName == "pict") label = "Image with text";
    else if (childName == "fldChar" || childName == "instrText" || childName == "fldSimple") label = "Field";
    else if (childName == "hyperlink") label = "Link";
    else if (childName == "txbxContent") label = "Text box";
    else if (childName == "oMath" || childName == "oMathPara") label = "Equation";
    else if (childName == "ins" || childName == "del") label = "Tracked change";
    else if (childName == "commentRangeStart") label = "Comment";
  });
  return label;
}
int blockChars(const Block& block) {
  int count = 0;
  for (auto& run : block.runs) count += static_cast<int>(run.text.size());
  for (auto& row : block.rows) for (auto& cell : row) count += static_cast<int>(cell.text.size());
  return count;
}
std::map<std::string, std::string> relationships(const std::string& xml) {
  std::map<std::string, std::string> map;
  pugi::xml_document doc;
  if (xml.empty() || !doc.load_string(xml.c_str())) return map;
  for (auto node : doc.first_child().children()) if (localName(node.name()) == "Relationship") map[attrLocal(node, "Id")] = attrLocal(node, "Target");
  return map;
}
std::string mediaPath(const std::map<std::string, std::string>* rels, const std::string& embed) {
  if (!rels || embed.empty()) return "";
  auto found = rels->find(embed);
  if (found == rels->end()) return "";
  auto path = found->second;
  if (path.find("..") != std::string::npos || path.find("://") != std::string::npos) return "";
  if (!path.empty() && path[0] == '/') return path.substr(1);
  return path.rfind("word/", 0) == 0 ? path : "word/" + path;
}

// ---------- Reading the body ----------

struct Context {
  const Styles* styles = nullptr;
  Numbering* numbering = nullptr;
  const std::map<std::string, std::string>* rels = nullptr;
  std::string tableStyle;
};

Run runOf(const RProps& props) {
  Run run;
  run.bold = props.b == 1;
  run.italic = props.i == 1;
  run.underline = props.u == 1;
  run.strike = props.strike == 1;
  run.size = props.sz ? props.sz : 20;
  run.color = props.colorSet ? props.color : "";
  run.highlight = props.highlightSet ? props.highlight : "";
  run.font = props.font.empty() ? "Times New Roman" : props.font;
  return run;
}
bool sameFormat(const Run& a, const Run& b) {
  return a.bold == b.bold && a.italic == b.italic && a.underline == b.underline && a.strike == b.strike && a.size == b.size && a.color == b.color && a.highlight == b.highlight && a.font == b.font && a.media.empty() && b.media.empty();
}

/** Collects the visible text of a paragraph with its resolved formatting, following links, fields and content controls. */
struct Collector {
  const Context& ctx;
  RProps base;
  std::vector<Run> runs;
  std::vector<int> fields;
  bool hidden = false, text = false, breakBefore = false, breakAfter = false;

  void add(Run run) {
    if (!runs.empty() && sameFormat(runs.back(), run)) runs.back().text += run.text;
    else runs.push_back(std::move(run));
  }
  bool instruction() const { return std::any_of(fields.begin(), fields.end(), [](int f) { return f == 1; }); }
  void walkNode(pugi::xml_node node) {
    for (auto child : node.children()) {
      auto name = localName(child.name());
      if (name == "r") run(child);
      else if (name == "hyperlink" || name == "smartTag" || name == "customXml" || name == "ins" || name == "moveTo" || name == "fldSimple" || name == "dir" || name == "bdo") walkNode(child);
      else if (name == "sdt") walkNode(childLocal(child, "sdtContent"));
    }
  }
  /** VML sizes such as "width:120pt;height:3.5in" in EMU. */
  static long long vmlLength(const std::string& style, const char* key) {
    auto at = style.find(std::string(key) + ":");
    if (at == std::string::npos) return 0;
    auto value = style.substr(at + std::strlen(key) + 1);
    double number = std::atof(value.c_str());
    auto unit = value.find_first_not_of("0123456789.- ");
    auto suffix = unit == std::string::npos ? std::string("pt") : value.substr(unit, 2);
    double emu = suffix == "in" ? number * 914400 : suffix == "cm" ? number * 360000 : suffix == "mm" ? number * 36000 : suffix == "px" ? number * 9525 : number * 12700;
    return static_cast<long long>(emu);
  }
  /** Adds a picture or the text of a text box; returns whether anything was shown. */
  bool drawing(pugi::xml_node node, const Run& style) {
    long long cx = 0, cy = 0;
    std::string embed;
    bool textBox = false;
    walk(node, [&](pugi::xml_node part) {
      auto name = localName(part.name());
      if ((name == "extent" || (name == "ext" && !cx)) && !attrLocal(part, "cx").empty()) { cx = std::atoll(attrLocal(part, "cx").c_str()); cy = std::atoll(attrLocal(part, "cy").c_str()); }
      if (name == "blip" && embed.empty()) embed = attrLocal(part, "embed");
      if (name == "imagedata" && embed.empty()) embed = attrLocal(part, "id");
      if ((name == "shape" || name == "rect") && !cx) {
        auto css = attrLocal(part, "style");
        cx = vmlLength(css, "width"); cy = vmlLength(css, "height");
      }
      if (name == "txbxContent") textBox = true;
    });
    auto path = mediaPath(ctx.rels, embed);
    if (!path.empty() && cx > 0 && cy > 0) {
      Run image = style;
      image.text = "\xEF\xBF\xBC";
      image.media = path; image.cx = cx; image.cy = cy;
      runs.push_back(image);
      text = true;
      return true;
    }
    if (textBox) {
      pugi::xml_node box;
      walk(node, [&](pugi::xml_node part) { if (!box && localName(part.name()) == "txbxContent") box = part; });
      for (auto paragraph : box.children()) if (localName(paragraph.name()) == "p") { walkNode(paragraph); Run gap = style; gap.text = "\n"; add(gap); }
      return true;
    }
    return false;
  }
  void run(pugi::xml_node node) {
    auto pr = childLocal(node, "rPr");
    RProps props = base;
    auto rStyle = attrLocal(childLocal(pr, "rStyle"), "val");
    if (!rStyle.empty()) props.merge(ctx.styles->character(rStyle));
    props.merge(parseRPr(pr, ctx.styles->theme));
    Run value = runOf(props);
    std::string chunk;
    auto flush = [&] {
      if (chunk.empty()) return;
      if (props.vanish == 1) { hidden = true; chunk.clear(); return; }
      Run piece = value;
      piece.text = chunk;
      chunk.clear();
      text = true;
      add(piece);
    };
    for (auto part : node.children()) {
      auto name = localName(part.name());
      if (name == "fldChar") {
        flush();
        auto type = attrLocal(part, "fldCharType");
        if (type == "begin") fields.push_back(1);
        else if (type == "separate" && !fields.empty()) fields.back() = 0;
        else if (type == "end" && !fields.empty()) fields.pop_back();
        continue;
      }
      if (instruction()) continue;
      if (name == "t") chunk += part.text().get();
      else if (name == "tab" || name == "ptab") chunk.push_back('\t');
      else if (name == "br" || name == "cr") {
        if (attrLocal(part, "type") == "page") { flush(); (text ? breakAfter : breakBefore) = true; }
        else chunk.push_back('\n');
      } else if (name == "noBreakHyphen") chunk += "\xE2\x80\x91";
      else if (name == "sym") appendUtf8(chunk, symbolCode(static_cast<unsigned>(std::strtoul(attrLocal(part, "char").c_str(), nullptr, 16))));
      else if (name == "drawing" || name == "pict" || name == "object") { flush(); drawing(part, value); }
      else if (name == "AlternateContent") {
        // Word writes a modern shape as the choice and a VML picture as the fallback.
        flush();
        if (!drawing(childLocal(part, "Choice"), value)) drawing(childLocal(part, "Fallback"), value);
      }
    }
    flush();
  }
};

void fillParagraph(Block& block, pugi::xml_node paragraph, Context& ctx, Collector& collector) {
  auto pPr = childLocal(paragraph, "pPr");
  PProps direct = parsePPr(pPr);
  block.style = attrLocal(childLocal(pPr, "pStyle"), "val");
  PProps p; RProps base;
  ctx.styles->paragraph(block.style, p, base, ctx.tableStyle);
  auto numId = !direct.numId.empty() ? direct.numId : p.numId;
  int ilvl = direct.ilvl >= 0 ? direct.ilvl : p.ilvl >= 0 ? p.ilvl : 0;
  const Numbering::Level* level = numId.empty() || numId == "0" ? nullptr : ctx.numbering->level(numId, ilvl);
  if (level) p.merge(level->p);
  p.merge(direct);
  block.align = p.jc.empty() ? "left" : p.jc;
  block.indent = p.left == kUnset ? 0 : std::max(0, std::min(p.left, 31680));
  block.right = p.right == kUnset ? 0 : std::max(-31680, std::min(p.right, 31680));
  block.first = p.first == kUnset ? 0 : std::max(-31680, std::min(p.first, 31680));
  block.before = p.before == kUnset ? 0 : std::max(0, std::min(p.before, 31680));
  block.after = p.after == kUnset ? 0 : std::max(0, std::min(p.after, 31680));
  block.line = p.line == kUnset ? 240 : std::max(1, std::min(p.line, 31680));
  block.lineRule = p.lineRule.empty() ? "auto" : p.lineRule;
  block.tabs = p.tabs;
  block.pageBefore = p.pageBreak == 1;
  block.contextual = p.contextual == 1;
  if (level) {
    block.num = numId;
    block.ilvl = ilvl;
    block.numKind = ctx.numbering->kind(numId, ilvl);
    block.list = block.numKind;
    block.marker = ctx.numbering->next(numId, ilvl);
    RProps mark = base;
    mark.merge(parseRPr(childLocal(pPr, "rPr"), ctx.styles->theme));
    mark.merge(level->r);
    auto run = runOf(mark);
    block.markerFont = run.font; block.markerSize = run.size; block.markerBold = run.bold; block.markerColor = run.color;
  }
  collector.base = base;
  collector.walkNode(paragraph);
  block.runs = collector.runs;
  block.breakBefore = collector.breakBefore;
  block.breakAfter = collector.breakAfter;
  // A section break other than "continuous" starts the next section on a new page.
  if (auto sect = childLocal(pPr, "sectPr")) {
    auto type = attrLocal(childLocal(sect, "type"), "val");
    if (type != "continuous") block.breakAfter = true;
  }
  if (block.runs.empty()) { Run empty = runOf(base); empty.text.clear(); block.runs.push_back(empty); }
}
/** pPr children this editor doesn't manage, kept so rewritten paragraphs keep them. */
std::string pprExtras(pugi::xml_node paragraph) {
  std::string out;
  static const std::set<std::string> managed = {"pStyle", "numPr", "spacing", "ind", "jc", "sectPr", "pPrChange"};
  for (auto child : childLocal(paragraph, "pPr").children()) if (!managed.count(localName(child.name()))) out += nodeXml(child);
  return out;
}
bool imageParagraph(pugi::xml_node paragraph, long long& cx, long long& cy, std::string& embed) {
  int drawings = 0;
  pugi::xml_node drawing;
  for (auto child : paragraph.children()) {
    auto name = localName(child.name());
    if (name == "pPr" || name == "bookmarkStart" || name == "bookmarkEnd") continue;
    if (name != "r") return false;
    for (auto part : child.children()) {
      auto partName = localName(part.name());
      if (partName == "rPr" || partName == "lastRenderedPageBreak") continue;
      if (partName == "t" && std::string(part.text().get()).find_first_not_of(" \t\r\n") != std::string::npos) return false;
      if (partName == "t") continue;
      if (partName != "drawing" && partName != "pict") return false;
      drawings++; drawing = part;
    }
  }
  if (drawings != 1) return false;
  walk(drawing, [&](pugi::xml_node node) {
    auto name = localName(node.name());
    if (name == "extent" || name == "ext") {
      auto x = attrLocal(node, "cx"), y = attrLocal(node, "cy");
      if (!x.empty()) cx = std::atoll(x.c_str());
      if (!y.empty()) cy = std::atoll(y.c_str());
    }
    if (name == "blip") embed = attrLocal(node, "embed");
  });
  return cx > 0 && cy > 0;
}
Block paragraphFrom(pugi::xml_node node, const std::string& raw, Context& ctx) {
  long long cx = 0, cy = 0;
  std::string embed;
  if (imageParagraph(node, cx, cy, embed)) {
    Block block; block.kind = "image"; block.raw = raw; block.cx = cx; block.cy = cy;
    block.media = mediaPath(ctx.rels, embed);
    PProps p; RProps base;
    ctx.styles->paragraph(attrLocal(childLocal(childLocal(node, "pPr"), "pStyle"), "val"), p, base, ctx.tableStyle);
    p.merge(parsePPr(childLocal(node, "pPr")));
    block.align = p.jc.empty() ? "left" : p.jc;
    block.before = p.before == kUnset ? 0 : std::max(0, p.before);
    block.after = p.after == kUnset ? 0 : std::max(0, p.after);
    block.pageBefore = p.pageBreak == 1;
    return block;
  }
  Block block; block.kind = "paragraph"; block.raw = raw;
  Collector collector{ctx, {}, {}, {}};
  fillParagraph(block, node, ctx, collector);
  if (!paragraphSupported(node) || collector.hidden) { block.kind = "locked"; block.label = lockedLabel(node); }
  else block.extras = pprExtras(node);
  return block;
}
std::string paragraphDisplay(pugi::xml_node node, Context& ctx) {
  Block block; block.kind = "paragraph";
  Collector collector{ctx, {}, {}, {}};
  fillParagraph(block, node, ctx, collector);
  return blockJson(block);
}

/** Reads a table. Simple ones stay editable cell by cell; the rest are drawn as they appear in Word. */
Block tableFrom(pugi::xml_node table, const std::string& raw, Context& ctx, bool display = false) {
  Block block; block.raw = raw; block.isTable = true;
  auto tblPr = childLocal(table, "tblPr");
  auto styleId = attrLocal(childLocal(tblPr, "tblStyle"), "val");
  if (styleId.empty()) styleId = ctx.styles->defaultTable;
  int borders = bordersOf(tblPr);
  block.borders = borders >= 0 ? borders == 1 : ctx.styles->tableBorders(styleId);
  for (auto col : childLocal(table, "tblGrid").children()) if (localName(col.name()) == "gridCol") block.cols.push_back(std::max(0, toInt(attrLocal(col, "w"), 0)));
  Context inner = ctx;
  inner.tableStyle = styleId;
  bool editable = true;
  int rowCount = 0;
  std::string rows;
  for (auto row : table.children()) {
    auto name = localName(row.name());
    if (name == "tblPr" || name == "tblGrid" || name == "bookmarkStart" || name == "bookmarkEnd") continue;
    if (name != "tr") { editable = false; continue; }
    if (++rowCount > kMaxTableRows) break;
    auto trPr = childLocal(row, "trPr");
    std::string rowJson = "{\"cells\":[";
    std::vector<Cell> cells;
    size_t column = 0;
    bool firstCell = true;
    for (auto cellNode : row.children()) {
      if (localName(cellNode.name()) != "tc") { if (localName(cellNode.name()) != "trPr" && localName(cellNode.name()) != "tblPrEx") editable = false; continue; }
      auto tcPr = childLocal(cellNode, "tcPr");
      int span = std::max(1, toInt(attrLocal(childLocal(tcPr, "gridSpan"), "val"), 1));
      auto merge = childLocal(tcPr, "vMerge");
      int vm = merge ? (attrLocal(merge, "val") == "restart" ? 1 : 2) : 0;
      auto fill = attrLocal(childLocal(tcPr, "shd"), "fill");
      auto valign = attrLocal(childLocal(tcPr, "vAlign"), "val");
      if (span > 1 || vm) editable = false;
      Cell cell;
      if (hexColor(fill)) cell.fill = upper(fill);
      std::string paras;
      int paragraphs = 0;
      for (auto inner_ : cellNode.children()) {
        auto innerName = localName(inner_.name());
        if (innerName == "tcPr") continue;
        if (innerName == "p") {
          paragraphs++;
          if (!paragraphSupported(inner_)) editable = false;
          if (!paras.empty()) paras += ',';
          paras += paragraphDisplay(inner_, inner);
          if (paragraphs == 1) {
            Block probe; probe.kind = "paragraph";
            Collector collector{inner, {}, {}, {}};
            fillParagraph(probe, inner_, inner, collector);
            if (collector.hidden) editable = false;
            for (auto& run : probe.runs) cell.text += run.text;
            auto& first = probe.runs.front();
            cell.bold = first.bold; cell.italic = first.italic; cell.underline = first.underline; cell.strike = first.strike;
            cell.size = first.size; cell.font = first.font; cell.color = first.color; cell.align = probe.align;
            if (cell.text.find('\n') != std::string::npos || cell.text.find('\t') != std::string::npos) editable = false;
          }
        } else if (innerName == "tbl") {
          editable = false;
          if (!paras.empty()) paras += ',';
          paras += "{\"kind\":\"paragraph\",\"align\":\"left\",\"list\":\"none\",\"runs\":[{\"text\":\"[Table]\",\"italic\":true,\"size\":18}]}";
        } else if (innerName != "bookmarkStart" && innerName != "bookmarkEnd") editable = false;
      }
      if (paragraphs != 1) editable = false;
      int width = 0;
      for (int k = 0; k < span && column + static_cast<size_t>(k) < block.cols.size(); ++k) width += block.cols[column + static_cast<size_t>(k)];
      if (width <= 0) width = 9360 / std::max<size_t>(1, block.cols.size());
      if (editable && static_cast<int>(decodeUtf8(cell.text).size()) * std::max(cell.size, 16) * 5 > width - 216) editable = false;
      column += static_cast<size_t>(span);
      if (!firstCell) rowJson += ',';
      firstCell = false;
      rowJson += "{\"span\":" + std::to_string(span) + ",\"vm\":" + std::to_string(vm);
      if (!cell.fill.empty()) rowJson += ",\"fill\":\"" + cell.fill + "\"";
      if (valign == "center" || valign == "bottom") rowJson += ",\"va\":\"" + valign + "\"";
      rowJson += ",\"paras\":[" + paras + "]}";
      cells.push_back(std::move(cell));
    }
    rowJson += "]";
    auto height = childLocal(trPr, "trHeight");
    if (height) rowJson += ",\"h\":" + std::to_string(std::max(0, toInt(attrLocal(height, "val"), 0))) + (attrLocal(height, "hRule") == "exact" ? ",\"exact\":true" : "");
    rowJson += "}";
    if (!rows.empty()) rows += ',';
    rows += rowJson;
    block.rows.push_back(std::move(cells));
  }
  if (block.rows.empty()) editable = false;
  if (editable && !display) { block.kind = "table"; return block; }
  block.kind = "locked";
  block.label = "Table";
  std::string cols;
  for (size_t i = 0; i < block.cols.size(); ++i) { if (i) cols += ','; cols += std::to_string(block.cols[i]); }
  block.table = "{\"cols\":[" + cols + "],\"borders\":" + (block.borders ? "true" : "false") + ",\"rows\":[" + rows + "]}";
  return block;
}

std::vector<Block> readBody(const std::string& xml, Context& ctx, std::string& prefix, std::string& sectPr, std::string& error) {
  pugi::xml_document doc;
  auto result = doc.load_buffer(xml.data(), xml.size(), pugi::parse_default | pugi::parse_ws_pcdata);
  if (!result) { error = "This document's XML could not be read."; return {}; }
  pugi::xml_node body;
  for (auto child : doc.first_child().children()) if (localName(child.name()) == "body") body = child;
  if (!body) { error = "This document has no body."; return {}; }
  auto full = std::string(body.name());
  auto colon = full.rfind(':');
  prefix = colon == std::string::npos ? "" : full.substr(0, colon + 1);
  size_t close = xml.rfind("</" + prefix + "body>");
  if (close == std::string::npos) { error = "This document body is incomplete."; return {}; }
  std::vector<Block> blocks;
  for (auto child : body.children()) {
    auto name = localName(child.name());
    if (name == "sectPr") { sectPr = sliceOf(xml, child, close); continue; }
    if (child.type() != pugi::node_element) continue;
    auto raw = sliceOf(xml, child, close);
    if (raw.empty()) { error = "A part of this document could not be preserved."; return {}; }
    if (name == "p") blocks.push_back(paragraphFrom(child, raw, ctx));
    else if (name == "tbl") blocks.push_back(tableFrom(child, raw, ctx));
    else if (name == "sdt") {
      // A content control such as a table of contents: shown as its paragraphs, saved as one piece.
      auto label = lockedLabel(child);
      bool first = true;
      for (auto inner : childLocal(child, "sdtContent").children()) {
        auto innerName = localName(inner.name());
        if (innerName != "p" && innerName != "tbl") continue;
        Block part = innerName == "p" ? paragraphFrom(inner, "", ctx) : tableFrom(inner, "", ctx, true);
        if (part.kind == "image") {
          Run image; image.text = "\xEF\xBF\xBC"; image.media = part.media; image.cx = part.cx; image.cy = part.cy;
          part.runs = {image};
        }
        part.kind = "locked";
        part.label = label;
        part.raw = first ? raw : "";
        part.extras.clear();
        first = false;
        blocks.push_back(std::move(part));
      }
      if (first) { Block block; block.kind = "locked"; block.raw = raw; block.label = label; blocks.push_back(std::move(block)); }
    } else {
      Block block; block.kind = "locked"; block.raw = raw; block.label = lockedLabel(child);
      blocks.push_back(std::move(block));
    }
  }
  for (size_t i = 0; i < blocks.size(); ++i) {
    auto& block = blocks[i];
    if (!block.contextual || block.runs.empty() || !block.table.empty()) continue;
    auto same = [&](size_t j) { return j < blocks.size() && !blocks[j].runs.empty() && blocks[j].table.empty() && blocks[j].style == block.style && (blocks[j].kind == "paragraph" || blocks[j].kind == "locked"); };
    if (i > 0 && same(i - 1)) block.ctxBefore = true;
    if (same(i + 1)) block.ctxAfter = true;
  }
  return blocks;
}

// ---------- Writing ----------

struct WriteContext {
  const Styles* styles = nullptr;
  const Numbering* numbering = nullptr;
};

std::string renderRuns(const std::string& prefix, const std::vector<Run>& runs, const RProps& base) {
  std::string out;
  auto baseRun = runOf(base);
  auto tag = [&](const std::string& name, const std::string& attrs = "") { return "<" + prefix + name + attrs + "/>"; };
  auto val = [&](const std::string& value) { return " " + prefix + "val=\"" + value + "\""; };
  for (auto& run : runs) {
    std::string props;
    if (!run.font.empty() && run.font != baseRun.font) {
      auto f = xmlEscape(run.font);
      props += tag("rFonts", " " + prefix + "ascii=\"" + f + "\" " + prefix + "hAnsi=\"" + f + "\" " + prefix + "cs=\"" + f + "\"");
    }
    if (run.bold != baseRun.bold) props += run.bold ? tag("b") : tag("b", val("0"));
    if (run.italic != baseRun.italic) props += run.italic ? tag("i") : tag("i", val("0"));
    if (run.strike != baseRun.strike) props += run.strike ? tag("strike") : tag("strike", val("0"));
    if (run.color != baseRun.color) props += tag("color", val(hexColor(run.color) ? upper(run.color) : "auto"));
    if (run.size >= 2 && run.size <= 3276 && run.size != baseRun.size) props += tag("sz", val(std::to_string(run.size))) + tag("szCs", val(std::to_string(run.size)));
    if (run.underline != baseRun.underline) props += tag("u", val(run.underline ? "single" : "none"));
    if (run.highlight != baseRun.highlight) props += tag("shd", val("clear") + " " + prefix + "color=\"auto\" " + prefix + "fill=\"" + (hexColor(run.highlight) ? upper(run.highlight) : "auto") + "\"");
    out += "<" + prefix + "r>";
    if (!props.empty()) out += "<" + prefix + "rPr>" + props + "</" + prefix + "rPr>";
    std::string text;
    auto flush = [&] {
      if (!text.empty()) { out += "<" + prefix + "t xml:space=\"preserve\">" + xmlEscape(text) + "</" + prefix + "t>"; text.clear(); }
    };
    for (char c : run.text) {
      if (c == '\t') { flush(); out += "<" + prefix + "tab/>"; }
      else if (c == '\n') { flush(); out += "<" + prefix + "br/>"; }
      else if (c != '\r') text.push_back(c);
    }
    flush();
    out += "</" + prefix + "r>";
  }
  return out;
}
std::string renderParagraph(const std::string& prefix, const Block& block, const WriteContext& wc) {
  PProps base; RProps baseRun;
  if (wc.styles) wc.styles->paragraph(block.style, base, baseRun);
  std::string numId;
  int ilvl = 0;
  if (!block.num.empty() && block.list == block.numKind) { numId = block.num; ilvl = block.ilvl; }
  else if (block.list == "bullet") numId = "101";
  else if (block.list == "decimal") numId = "102";
  else if (!base.numId.empty() && base.numId != "0") numId = "0";
  if (!numId.empty() && numId != "0" && wc.numbering) if (auto* level = wc.numbering->level(numId, ilvl)) base.merge(level->p);
  std::map<std::string, std::string> extras;
  if (!block.extras.empty()) {
    pugi::xml_document doc;
    auto wrapped = "<x>" + block.extras + "</x>";
    if (doc.load_buffer(wrapped.data(), wrapped.size(), pugi::parse_default | pugi::parse_ws_pcdata))
      for (auto child : doc.first_child().children()) extras[localName(child.name())] += nodeXml(child);
  }
  auto attr = [&](const char* name, int value) { return " " + prefix + name + "=\"" + std::to_string(value) + "\""; };
  static const char* order[] = {"pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs",
    "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind",
    "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr"};
  std::string props;
  for (auto name : order) {
    std::string key = name;
    if (key == "pStyle") { if (!block.style.empty()) props += "<" + prefix + "pStyle " + prefix + "val=\"" + xmlEscape(block.style) + "\"/>"; }
    else if (key == "numPr") {
      if (!numId.empty()) props += "<" + prefix + "numPr><" + prefix + "ilvl " + prefix + "val=\"" + std::to_string(ilvl) + "\"/><" + prefix + "numId " + prefix + "val=\"" + xmlEscape(numId) + "\"/></" + prefix + "numPr>";
    } else if (key == "spacing") {
      std::string attrs;
      int baseBefore = base.before == kUnset ? 0 : base.before, baseAfter = base.after == kUnset ? 0 : base.after;
      int baseLine = base.line == kUnset ? 240 : base.line;
      auto baseRule = base.lineRule.empty() ? std::string("auto") : base.lineRule;
      if (block.before >= 0 && block.before != baseBefore) attrs += attr("before", block.before);
      if (block.after >= 0 && block.after != baseAfter) attrs += attr("after", block.after);
      if (block.line > 0 && (block.line != baseLine || block.lineRule != baseRule)) attrs += attr("line", block.line) + " " + prefix + "lineRule=\"" + block.lineRule + "\"";
      if (!attrs.empty()) props += "<" + prefix + "spacing" + attrs + "/>";
    } else if (key == "ind") {
      std::string attrs;
      int baseLeft = base.left == kUnset ? 0 : base.left, baseRight = base.right == kUnset ? 0 : base.right, baseFirst = base.first == kUnset ? 0 : base.first;
      bool firstChanged = block.first != kUnset && block.first != baseFirst;
      if (block.indent >= 0 && (block.indent != baseLeft || firstChanged)) attrs += attr("left", block.indent);
      if (block.right != kUnset && block.right != baseRight) attrs += attr("right", block.right);
      if (firstChanged) attrs += block.first < 0 ? attr("hanging", -block.first) : attr("firstLine", block.first);
      if (!attrs.empty()) props += "<" + prefix + "ind" + attrs + "/>";
    } else if (key == "jc") {
      auto baseAlign = base.jc.empty() ? std::string("left") : base.jc;
      if (block.align != baseAlign) props += "<" + prefix + "jc " + prefix + "val=\"" + (block.align == "justify" ? "both" : block.align == "center" || block.align == "right" ? block.align : "left") + "\"/>";
    } else if (extras.count(key)) props += extras[key];
  }
  std::string out = "<" + prefix + "p>";
  if (!props.empty()) out += "<" + prefix + "pPr>" + props + "</" + prefix + "pPr>";
  auto pageBreak = "<" + prefix + "r><" + prefix + "br " + prefix + "type=\"page\"/></" + prefix + "r>";
  if (block.breakBefore) out += pageBreak;
  out += renderRuns(prefix, block.runs.empty() ? std::vector<Run>{Run{}} : block.runs, baseRun);
  if (block.breakAfter) out += pageBreak;
  out += "</" + prefix + "p>";
  return out;
}
std::string renderTable(const std::string& prefix, const Block& block, const WriteContext& wc) {
  size_t columns = 1;
  for (auto& row : block.rows) columns = std::max(columns, row.size());
  std::string out = "<" + prefix + "tbl><" + prefix + "tblPr><" + prefix + "tblW " + prefix + "w=\"5000\" " + prefix + "type=\"pct\"/><" + prefix + "tblBorders>";
  for (const char* edge : {"top", "left", "bottom", "right", "insideH", "insideV"})
    out += "<" + prefix + std::string(edge) + " " + prefix + "val=\"single\" " + prefix + "sz=\"4\" " + prefix + "space=\"0\" " + prefix + "color=\"auto\"/>";
  out += "</" + prefix + "tblBorders></" + prefix + "tblPr><" + prefix + "tblGrid>";
  for (size_t i = 0; i < columns; ++i) out += "<" + prefix + "gridCol " + prefix + "w=\"" + std::to_string(9360 / columns) + "\"/>";
  out += "</" + prefix + "tblGrid>";
  for (auto& row : block.rows) {
    out += "<" + prefix + "tr>";
    for (size_t i = 0; i < columns; ++i) {
      Cell cell = i < row.size() ? row[i] : Cell{};
      Block paragraph;
      Run run;
      run.text = cell.text; run.bold = cell.bold; run.italic = cell.italic; run.underline = cell.underline; run.strike = cell.strike;
      paragraph.runs.push_back(run);
      out += "<" + prefix + "tc>" + renderParagraph(prefix, paragraph, wc) + "</" + prefix + "tc>";
    }
    out += "</" + prefix + "tr>";
  }
  if (block.rows.empty()) out += "<" + prefix + "tr><" + prefix + "tc>" + renderParagraph(prefix, {}, wc) + "</" + prefix + "tc></" + prefix + "tr>";
  out += "</" + prefix + "tbl>";
  return out;
}
/** Replaces only the cell text of an existing table so its widths, borders and shading stay as they were. */
std::string patchTable(const std::string& raw, const Block& block) {
  pugi::xml_document doc;
  if (!doc.load_buffer(raw.data(), raw.size(), pugi::parse_default | pugi::parse_ws_pcdata)) return {};
  auto table = doc.first_child();
  std::string name = table.name();
  auto colon = name.rfind(':');
  auto prefix = colon == std::string::npos ? std::string() : name.substr(0, colon + 1);
  size_t r = 0;
  for (auto row : table.children()) {
    if (localName(row.name()) != "tr") continue;
    size_t c = 0;
    for (auto cell : row.children()) {
      if (localName(cell.name()) != "tc") continue;
      auto paragraph = childLocal(cell, "p");
      if (paragraph && r < block.rows.size() && c < block.rows[r].size()) {
        pugi::xml_node style;
        std::vector<pugi::xml_node> runs;
        for (auto child : paragraph.children()) if (localName(child.name()) == "r") { if (!style) style = childLocal(child, "rPr"); runs.push_back(child); }
        auto run = paragraph.append_child((prefix + "r").c_str());
        if (style) run.append_copy(style);
        auto text = run.append_child((prefix + "t").c_str());
        text.append_attribute("xml:space") = "preserve";
        text.text().set(block.rows[r][c].text.c_str());
        for (auto old : runs) paragraph.remove_child(old);
      }
      c++;
    }
    r++;
  }
  return nodeXml(table);
}
std::string drawingXml(const std::string& prefix, const std::string& rel, long long cx, long long cy, int id) {
  std::ostringstream out;
  out << "<" << prefix << "p><" << prefix << "r><" << prefix << "drawing>"
      << "<wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\">"
      << "<wp:extent cx=\"" << cx << "\" cy=\"" << cy << "\"/><wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/>"
      << "<wp:docPr id=\"" << id << "\" name=\"Picture " << id << "\"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" noChangeAspect=\"1\"/></wp:cNvGraphicFramePr>"
      << "<a:graphic xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">"
      << "<pic:pic xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:nvPicPr><pic:cNvPr id=\"0\" name=\"image\"/><pic:cNvPicPr/></pic:nvPicPr>"
      << "<pic:blipFill><a:blip xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" r:embed=\"" << xmlEscape(rel) << "\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>"
      << "<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"" << cx << "\" cy=\"" << cy << "\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr>"
      << "</pic:pic></a:graphicData></a:graphic></wp:inline></" << prefix << "drawing></" << prefix << "r></" << prefix << "p>";
  return out.str();
}
std::string resizeDrawing(const std::string& raw, long long cx, long long cy) {
  pugi::xml_document doc;
  if (!doc.load_string(raw.c_str())) return raw;
  walk(doc.first_child(), [&](pugi::xml_node node) {
    auto name = localName(node.name());
    if (name != "extent" && name != "ext") return;
    for (auto attribute : node.attributes()) {
      auto attr = localName(attribute.name());
      if (attr == "cx") attribute.set_value(std::to_string(cx).c_str());
      if (attr == "cy") attribute.set_value(std::to_string(cy).c_str());
    }
  });
  return nodeXml(doc.first_child());
}
std::string renderBlock(const std::string& prefix, const Block& block, int& imageId, std::vector<std::pair<std::string, std::string>>& images, const WriteContext& wc) {
  if (block.kind == "locked") return block.raw;
  if (block.kind == "table") {
    if (!block.raw.empty() && !block.dirty) return block.raw;
    if (!block.raw.empty()) { auto patched = patchTable(block.raw, block); if (!patched.empty()) return patched; }
    return renderTable(prefix, block, wc);
  }
  if (block.kind == "image") {
    if (!block.source.empty()) {
      auto id = "rIdVersara" + std::to_string(imageId);
      images.push_back({id, block.source});
      return drawingXml(prefix, id, std::max<long long>(block.cx, 9525), std::max<long long>(block.cy, 9525), imageId++);
    }
    if (block.resized && !block.raw.empty()) return resizeDrawing(block.raw, block.cx, block.cy);
    return block.raw;
  }
  if (!block.raw.empty()) return block.raw;
  return renderParagraph(prefix, block, wc);
}
bool needsList(const Model& model) {
  for (auto& section : model.sections) for (auto& block : section)
    if (block.raw.empty() && (block.list == "bullet" || block.list == "decimal") && (block.num.empty() || block.list != block.numKind)) return true;
  return false;
}
std::string ensureNumbering(std::string xml) {
  const char* bullet = "<w:abstractNum w:abstractNumId=\"101\"><w:lvl w:ilvl=\"0\"><w:start w:val=\"1\"/><w:numFmt w:val=\"bullet\"/><w:lvlText w:val=\"•\"/><w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"720\" w:hanging=\"360\"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId=\"101\"><w:abstractNumId w:val=\"101\"/></w:num>";
  const char* decimal = "<w:abstractNum w:abstractNumId=\"102\"><w:lvl w:ilvl=\"0\"><w:start w:val=\"1\"/><w:numFmt w:val=\"decimal\"/><w:lvlText w:val=\"%1.\"/><w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"720\" w:hanging=\"360\"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId=\"102\"><w:abstractNumId w:val=\"102\"/></w:num>";
  if (xml.empty()) return std::string("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:numbering xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">") + bullet + decimal + "</w:numbering>";
  auto end = xml.rfind("</w:numbering>");
  if (end == std::string::npos) return xml;
  // abstractNum elements come before num elements in CT_Numbering.
  auto firstNum = xml.find("<w:num ");
  auto insertAt = firstNum == std::string::npos ? end : firstNum;
  bool hasBullet = xml.find("w:abstractNumId=\"101\"") != std::string::npos;
  bool hasDecimal = xml.find("w:abstractNumId=\"102\"") != std::string::npos;
  std::string abstracts, nums;
  auto split = [](const std::string& both, std::string& a, std::string& n) { auto at = both.find("<w:num "); a += both.substr(0, at); n += both.substr(at); };
  if (!hasBullet) split(bullet, abstracts, nums);
  if (!hasDecimal) split(decimal, abstracts, nums);
  if (abstracts.empty()) return xml;
  xml.insert(end, nums);
  xml.insert(insertAt, abstracts);
  return xml;
}
std::string shellDocument(const std::string& body, const std::string& sect) {
  return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
    "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
    "<w:body>" + body + (sect.empty() ? std::string(kDefaultSect) : sect) + "</w:body></w:document>";
}
const char* kStyles = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
  "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:eastAsia=\"Calibri\" w:cs=\"Calibri\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr></w:rPrDefault>"
  "<w:pPrDefault><w:pPr><w:spacing w:after=\"160\" w:line=\"259\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>"
  "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style></w:styles>";
const char* kContentTypes = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/></Types>";
const char* kRootRels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>";
const char* kDocRels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>";

std::string readFile(const std::string& path, std::string& error) {
  std::ifstream input(path, std::ios::binary);
  if (!input) { error = "The file could not be opened."; return {}; }
  std::ostringstream data; data << input.rdbuf();
  auto bytes = data.str();
  if (bytes.size() >= 2 && static_cast<unsigned char>(bytes[0]) == 0xFF && static_cast<unsigned char>(bytes[1]) == 0xFE) {
    std::string utf8;
    for (size_t i = 2; i + 1 < bytes.size(); i += 2) appendUtf8(utf8, static_cast<unsigned char>(bytes[i]) | (static_cast<unsigned char>(bytes[i + 1]) << 8));
    return utf8;
  }
  return bytes;
}
std::string entryXml(mz_zip_archive& zip, const char* name, std::string& error) {
  int index = mz_zip_reader_locate_file(&zip, name, nullptr, 0);
  if (index < 0) return {};
  mz_zip_archive_file_stat stat = {};
  if (!mz_zip_reader_file_stat(&zip, static_cast<mz_uint>(index), &stat) || stat.m_uncomp_size > kMaxXml) { error = "A document part is too large."; return {}; }
  std::string data(static_cast<size_t>(stat.m_uncomp_size), '\0');
  if (!data.empty() && !mz_zip_reader_extract_to_mem(&zip, static_cast<mz_uint>(index), data.data(), data.size(), 0)) { error = "A document part could not be read."; return {}; }
  return data;
}
std::string sectReference(const std::string& sect, const char* kind) {
  if (sect.empty()) return {};
  pugi::xml_document doc;
  if (!doc.load_buffer(sect.data(), sect.size())) return {};
  for (auto child : doc.first_child().children()) {
    if (localName(child.name()) != kind) continue;
    auto type = attrLocal(child, "type");
    if (type.empty() || type == "default") return attrLocal(child, "id");
  }
  return {};
}
std::string partPath(const std::string& target) {
  if (target.empty() || target.find("..") != std::string::npos) return {};
  if (target[0] == '/') return target.substr(1);
  return "word/" + target;
}
std::string alignOf(pugi::xml_node paragraph) {
  auto value = attrLocal(childLocal(childLocal(paragraph, "pPr"), "jc"), "val");
  if (value == "center" || value == "right") return value;
  if (value == "end") return "right";
  if (value == "both" || value == "distribute") return "justify";
  return "left";
}
/** Plain text, alignment and PAGE / NUMPAGES fields are editable. Anything else keeps the band locked. */
Band readBand(const std::string& xml) {
  Band band;
  if (xml.empty()) return band;
  pugi::xml_document doc;
  if (!doc.load_buffer(xml.data(), xml.size(), pugi::parse_default | pugi::parse_ws_pcdata)) { band.locked = true; return band; }
  std::vector<std::string> lines;
  bool alignSet = false;
  for (auto paragraph : doc.first_child().children()) {
    if (paragraph.type() != pugi::node_element) continue;
    if (localName(paragraph.name()) != "p") { band.locked = true; return band; }
    std::string text, instr;
    bool page = false, pages = false, inResult = false, classified = false;
    auto classify = [&] {
      if (classified) return true;
      classified = true;
      auto value = upper(instr);
      if (value.find("NUMPAGES") != std::string::npos) pages = true;
      else if (value.find("PAGE") != std::string::npos) page = true;
      else return false;
      return true;
    };
    for (auto child : paragraph.children()) {
      auto name = localName(child.name());
      if (name == "pPr" || name == "bookmarkStart" || name == "bookmarkEnd" || name == "proofErr") continue;
      if (name == "fldSimple") {
        instr = attrLocal(child, "instr"); classified = false;
        if (!classify()) { band.locked = true; return band; }
        continue;
      }
      if (name != "r") { band.locked = true; return band; }
      for (auto part : child.children()) {
        auto partName = localName(part.name());
        if (partName == "rPr" || partName == "lastRenderedPageBreak") continue;
        if (partName == "fldChar") {
          auto type = attrLocal(part, "fldCharType");
          if (type == "begin") { instr.clear(); classified = false; }
          else if (type == "separate") { inResult = true; if (!classify()) { band.locked = true; return band; } }
          else if (type == "end") { inResult = false; if (!classify()) { band.locked = true; return band; } }
          continue;
        }
        if (partName == "instrText") { instr += part.text().get(); continue; }
        if (inResult) continue;
        if (partName == "t") text += part.text().get();
        else if (partName == "tab") text.push_back('\t');
        else if (partName == "br" || partName == "cr") text.push_back('\n');
        else { band.locked = true; return band; }
      }
    }
    if (page || pages) {
      std::string rest = text;
      for (const char* word : {"Page", "page", "of"}) for (auto at = rest.find(word); at != std::string::npos; at = rest.find(word)) rest.erase(at, std::strlen(word));
      if (rest.find_first_not_of(" \t\n") != std::string::npos || band.page) { band.locked = true; return band; }
      band.page = true;
      band.pageAlign = alignOf(paragraph) == "justify" ? "left" : alignOf(paragraph);
      band.pageFormat = pages ? "pageOf" : text.find("Page") != std::string::npos || text.find("page") != std::string::npos ? "page" : "plain";
      continue;
    }
    if (!alignSet) { auto align = alignOf(paragraph); band.align = align == "justify" ? "left" : align; alignSet = true; }
    lines.push_back(text);
  }
  bool empty = std::all_of(lines.begin(), lines.end(), [](const std::string& line) { return line.empty(); });
  if (!empty) for (size_t i = 0; i < lines.size(); ++i) { if (i) band.text.push_back('\n'); band.text += lines[i]; }
  return band;
}
std::string bandXml(bool header, const Band& band, bool page, const std::string& pageAlign, const std::string& pageFormat) {
  auto jc = [](const std::string& align) { return align == "center" || align == "right" ? "<w:pPr><w:jc w:val=\"" + align + "\"/></w:pPr>" : std::string(); };
  auto runs = [](const std::string& text) {
    std::string out = "<w:r>", chunk;
    auto flush = [&] { if (!chunk.empty()) { out += "<w:t xml:space=\"preserve\">" + xmlEscape(chunk) + "</w:t>"; chunk.clear(); } };
    for (char c : text) { if (c == '\t') { flush(); out += "<w:tab/>"; } else if (c != '\r') chunk.push_back(c); }
    flush();
    return out + "</w:r>";
  };
  const char* root = header ? "w:hdr" : "w:ftr";
  std::string out = std::string("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><") + root +
    " xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"" + kRelNs + "\">";
  if (!band.text.empty()) {
    size_t start = 0;
    while (true) {
      auto end = band.text.find('\n', start);
      auto line = band.text.substr(start, end == std::string::npos ? std::string::npos : end - start);
      out += "<w:p>" + jc(band.align) + (line.empty() ? std::string() : runs(line)) + "</w:p>";
      if (end == std::string::npos) break;
      start = end + 1;
    }
  }
  if (page) {
    auto field = [](const char* instr) { return std::string("<w:fldSimple w:instr=\" ") + instr + " \"><w:r><w:t>1</w:t></w:r></w:fldSimple>"; };
    out += "<w:p>" + jc(pageAlign);
    if (pageFormat != "plain") out += runs("Page ");
    out += field("PAGE");
    if (pageFormat == "pageOf") out += runs(" of ") + field("NUMPAGES");
    out += "</w:p>";
  }
  return out + "</" + root + ">";
}
std::string patchSect(const std::string& sect, bool touchHeader, bool addHeader, bool touchFooter, bool addFooter) {
  auto base = sect.empty() ? std::string(kDefaultSect) : sect;
  pugi::xml_document doc;
  if (!doc.load_buffer(base.data(), base.size(), pugi::parse_default | pugi::parse_ws_pcdata)) return base;
  auto root = doc.first_child();
  std::string name = root.name();
  auto colon = name.rfind(':');
  auto prefix = colon == std::string::npos ? std::string() : name.substr(0, colon + 1);
  std::vector<pugi::xml_node> drop;
  for (auto child : root.children()) {
    auto kind = localName(child.name());
    auto type = attrLocal(child, "type");
    if (!(type.empty() || type == "default")) continue;
    if ((kind == "headerReference" && touchHeader) || (kind == "footerReference" && touchFooter)) drop.push_back(child);
  }
  for (auto node : drop) root.remove_child(node);
  auto add = [&](const char* kind, const char* id) {
    auto node = root.prepend_child((prefix + kind).c_str());
    node.append_attribute("xmlns:r") = kRelNs;
    node.append_attribute((prefix + "type").c_str()) = "default";
    node.append_attribute("r:id") = id;
  };
  if (addFooter) add("footerReference", "rIdVersaraFooter");
  if (addHeader) add("headerReference", "rIdVersaraHeader");
  return nodeXml(root);
}
Page readPage(const std::string& sect) {
  Page page;
  auto base = sect.empty() ? std::string(kDefaultSect) : sect;
  pugi::xml_document doc;
  if (!doc.load_buffer(base.data(), base.size())) return page;
  auto root = doc.first_child();
  auto value = [](pugi::xml_node node, const char* name, int fallback, int low, int high) {
    auto text = attrLocal(node, name);
    return text.empty() ? fallback : std::max(low, std::min(std::atoi(text.c_str()), high));
  };
  if (auto size = childLocal(root, "pgSz")) { page.w = value(size, "w", page.w, 2880, 31680); page.h = value(size, "h", page.h, 2880, 31680); }
  if (auto margin = childLocal(root, "pgMar")) {
    page.top = value(margin, "top", page.top, 0, 15840); page.bottom = value(margin, "bottom", page.bottom, 0, 15840);
    page.left = value(margin, "left", page.left, 0, 15840); page.right = value(margin, "right", page.right, 0, 15840);
    page.header = value(margin, "header", page.header, 0, 15840); page.footer = value(margin, "footer", page.footer, 0, 15840);
  }
  return page;
}
std::string patchPage(const std::string& sect, const Page& page) {
  auto base = sect.empty() ? std::string(kDefaultSect) : sect;
  pugi::xml_document doc;
  if (!doc.load_buffer(base.data(), base.size(), pugi::parse_default | pugi::parse_ws_pcdata)) return base;
  auto root = doc.first_child();
  std::string name = root.name();
  auto colon = name.rfind(':');
  auto prefix = colon == std::string::npos ? std::string() : name.substr(0, colon + 1);
  auto set = [&](pugi::xml_node node, const char* key, int number) {
    auto qualified = prefix + key;
    auto attribute = node.attribute(qualified.c_str());
    if (!attribute) attribute = node.append_attribute(qualified.c_str());
    attribute.set_value(std::to_string(number).c_str());
  };
  // CT_SectPr puts pgSz after the references, footnotePr, endnotePr and type, then pgMar.
  pugi::xml_node after;
  for (auto child : root.children()) {
    auto kind = localName(child.name());
    if (kind == "headerReference" || kind == "footerReference" || kind == "footnotePr" || kind == "endnotePr" || kind == "type") after = child;
  }
  auto size = childLocal(root, "pgSz");
  if (!size) size = after ? root.insert_child_after((prefix + "pgSz").c_str(), after) : root.prepend_child((prefix + "pgSz").c_str());
  set(size, "w", page.w); set(size, "h", page.h);
  auto margin = childLocal(root, "pgMar");
  if (!margin) {
    margin = root.insert_child_after((prefix + "pgMar").c_str(), size);
    set(margin, "header", 720); set(margin, "footer", 720); set(margin, "gutter", 0);
  }
  set(margin, "top", page.top); set(margin, "right", page.right); set(margin, "bottom", page.bottom); set(margin, "left", page.left);
  return nodeXml(root);
}
Defaults defaultsOf(const Styles& styles) {
  PProps p; RProps r;
  styles.paragraph("", p, r);
  Defaults d;
  auto run = runOf(r);
  d.font = run.font; d.size = run.size;
  d.before = p.before == kUnset ? 0 : std::max(0, p.before);
  d.after = p.after == kUnset ? 0 : std::max(0, p.after);
  d.line = p.line == kUnset ? 240 : std::max(1, p.line);
  d.rule = p.lineRule.empty() ? "auto" : p.lineRule;
  return d;
}
Block blankParagraph(const Styles& styles) {
  Numbering numbering;
  Context ctx; ctx.styles = &styles; ctx.numbering = &numbering;
  Block block; block.kind = "paragraph";
  Collector collector{ctx, {}, {}, {}};
  fillParagraph(block, pugi::xml_node(), ctx, collector);
  return block;
}
struct Package { Styles styles; Numbering numbering; std::string numberingXml; };
void loadStyles(mz_zip_archive* zip, Package& package, std::string& error) {
  std::string styles, theme;
  if (zip) {
    styles = entryXml(*zip, "word/styles.xml", error);
    theme = entryXml(*zip, "word/theme/theme1.xml", error);
    package.numberingXml = entryXml(*zip, "word/numbering.xml", error);
  } else styles = kStyles;
  package.styles.load(styles, theme);
  package.numbering.load(package.numberingXml, package.styles.theme);
}
Model openPackage(const std::string& path, std::string& error) {
  auto lower = path;
  std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  std::ifstream input(path, std::ios::binary);
  char magic[2] = {};
  input.read(magic, 2);
  if (magic[0] != 'P' || magic[1] != 'K') {
    error = lower.size() >= 4 && lower.rfind(".doc") == lower.size() - 4 ? "LEGACY" : "This is not a DOCX file.";
    return {};
  }
  input.seekg(0, std::ios::end);
  if (input.tellg() > static_cast<std::streamoff>(kMaxZip)) { error = "This document is too large to open here."; return {}; }
  mz_zip_archive zip = {};
  if (!mz_zip_reader_init_file(&zip, path.c_str(), 0)) { error = "This document could not be opened."; return {}; }
  auto document = entryXml(zip, "word/document.xml", error);
  auto rels = entryXml(zip, "word/_rels/document.xml.rels", error);
  Package package;
  loadStyles(&zip, package, error);
  if (!error.empty() || document.empty()) { mz_zip_reader_end(&zip); if (error.empty()) error = "This document has no word/document.xml."; return {}; }
  if (document.size() > kMaxXml) { mz_zip_reader_end(&zip); error = "This document is too large to open here."; return {}; }
  std::string prefix, sect, readError;
  auto relMap = relationships(rels);
  Context ctx; ctx.styles = &package.styles; ctx.numbering = &package.numbering; ctx.rels = &relMap;
  auto blocks = readBody(document, ctx, prefix, sect, readError);
  if (!readError.empty()) { mz_zip_reader_end(&zip); error = readError; return {}; }
  Model model; model.prefix = prefix.empty() ? "w:" : prefix;
  model.defaults = defaultsOf(package.styles);
  auto band = [&](const char* kind) {
    auto id = sectReference(sect, kind);
    if (id.empty()) return Band{};
    auto found = relMap.find(id);
    auto name = found == relMap.end() ? std::string() : partPath(found->second);
    if (name.empty()) { Band locked; locked.locked = true; return locked; }
    std::string partError;
    auto xml = entryXml(zip, name.c_str(), partError);
    if (!partError.empty()) { Band locked; locked.locked = true; return locked; }
    return readBand(xml);
  };
  model.hf.header = band("headerReference");
  model.hf.footer = band("footerReference");
  mz_zip_reader_end(&zip);
  if (model.hf.footer.page && !model.hf.footer.locked) { model.hf.pagePos = "footer"; model.hf.pageAlign = model.hf.footer.pageAlign; model.hf.pageFormat = model.hf.footer.pageFormat; }
  else if (model.hf.header.page && !model.hf.header.locked) { model.hf.pagePos = "header"; model.hf.pageAlign = model.hf.header.pageAlign; model.hf.pageFormat = model.hf.header.pageFormat; }
  if (model.hf.header.page && model.hf.pagePos != "header") model.hf.header.locked = true;
  if (model.hf.footer.page && model.hf.pagePos != "footer") model.hf.footer.locked = true;
  std::vector<Block> section;
  int chars = 0;
  for (auto& block : blocks) {
    model.characters += blockChars(block);
    if (block.kind == "locked" && !block.raw.empty()) model.locked++;
    if (model.characters > kMaxChars) { error = "This document is too long to edit here. Split it into smaller documents."; return {}; }
    auto count = blockChars(block);
    if (!section.empty() && chars + count > kSectionChars && !block.raw.empty()) { model.sections.push_back(std::move(section)); section.clear(); chars = 0; }
    chars += count;
    section.push_back(std::move(block));
  }
  model.sect = sect;
  model.page = readPage(sect);
  if (!section.empty()) model.sections.push_back(std::move(section));
  if (model.sections.empty()) model.sections.push_back({blankParagraph(package.styles)});
  return model;
}
Run runFrom(const Json& json) {
  Run run; run.text = json.str("text"); run.bold = json.flag("bold"); run.italic = json.flag("italic"); run.underline = json.flag("underline"); run.strike = json.flag("strike");
  run.color = upper(json.str("color")); run.highlight = upper(json.str("highlight")); run.size = static_cast<int>(json.num("size")); run.font = json.str("font");
  if (run.color.size() && run.color[0] == '#') run.color.erase(run.color.begin());
  if (run.highlight.size() && run.highlight[0] == '#') run.highlight.erase(run.highlight.begin());
  return run;
}
Block blockFrom(const Json& json) {
  Block block; block.kind = json.str("kind"); block.raw = json.str("raw"); block.align = json.str("align").empty() ? "left" : json.str("align"); block.list = json.str("list").empty() ? "none" : json.str("list");
  block.label = json.str("label"); block.media = json.str("media"); block.source = json.str("source"); block.cx = json.num("cx"); block.cy = json.num("cy"); block.resized = json.flag("resized");
  block.dirty = json.flag("dirty");
  auto twips = [&](const char* key) {
    auto* value = json.find(key);
    return value && value->type == Json::NUM && value->n >= 0 ? static_cast<int>(std::min(value->n, 31680.0)) : -1;
  };
  block.indent = twips("indent"); block.before = twips("before"); block.after = twips("after"); block.line = twips("line");
  block.right = json.integer("right", json.find("indent") ? 0 : kUnset);
  block.first = json.integer("first", json.find("indent") ? 0 : kUnset);
  auto rule = json.str("rule");
  block.lineRule = rule == "exact" || rule == "atLeast" ? rule : "auto";
  block.style = json.str("style"); block.num = json.str("num"); block.numKind = json.str("numKind"); block.ilvl = std::max(0, std::min(json.integer("ilvl", 0), 8));
  block.extras = json.str("px");
  block.breakBefore = json.flag("brB"); block.breakAfter = json.flag("brA");
  if (auto* runs = json.find("runs"); runs && runs->type == Json::ARR) for (auto& run : runs->a) block.runs.push_back(runFrom(run));
  if (auto* rows = json.find("rows"); rows && rows->type == Json::ARR) for (auto& row : rows->a) {
    std::vector<Cell> cells;
    if (row.type == Json::ARR) for (auto& cellJson : row.a) {
      Cell cell; cell.text = cellJson.str("text"); cell.bold = cellJson.flag("bold"); cell.italic = cellJson.flag("italic"); cell.underline = cellJson.flag("underline"); cell.strike = cellJson.flag("strike");
      cells.push_back(std::move(cell));
    }
    block.rows.push_back(std::move(cells));
  }
  block.isTable = block.kind == "table";
  return block;
}
std::string oneOf(const std::string& value, std::initializer_list<const char*> allowed, const char* fallback) {
  for (auto item : allowed) if (value == item) return value;
  return fallback;
}
Model modelFrom(const Json& json) {
  Model model;
  model.sect = json.str("sect");
  if (auto* hf = json.find("hf"); hf && hf->type == Json::OBJ) {
    model.hf.dirty = hf->flag("dirty");
    model.hf.header.text = hf->str("header");
    model.hf.header.align = oneOf(hf->str("headerAlign"), {"left", "center", "right"}, "left");
    model.hf.header.locked = hf->flag("headerLocked");
    model.hf.footer.text = hf->str("footer");
    model.hf.footer.align = oneOf(hf->str("footerAlign"), {"left", "center", "right"}, "left");
    model.hf.footer.locked = hf->flag("footerLocked");
    model.hf.pagePos = oneOf(hf->str("pagePos"), {"none", "header", "footer"}, "none");
    model.hf.pageAlign = oneOf(hf->str("pageAlign"), {"left", "center", "right"}, "center");
    model.hf.pageFormat = oneOf(hf->str("pageFormat"), {"plain", "page", "pageOf"}, "plain");
  }
  model.page = readPage(model.sect);
  if (auto* page = json.find("page"); page && page->type == Json::OBJ && page->flag("dirty")) {
    auto clamp = [&](const char* key, int fallback, int low, int high) {
      auto* value = page->find(key);
      return value && value->type == Json::NUM ? std::max(low, std::min(static_cast<int>(value->n), high)) : fallback;
    };
    model.page.dirty = true;
    model.page.w = clamp("w", model.page.w, 2880, 31680);
    model.page.h = clamp("h", model.page.h, 2880, 31680);
    model.page.top = clamp("top", model.page.top, 0, model.page.h / 3);
    model.page.bottom = clamp("bottom", model.page.bottom, 0, model.page.h / 3);
    model.page.left = clamp("left", model.page.left, 0, model.page.w / 3);
    model.page.right = clamp("right", model.page.right, 0, model.page.w / 3);
  }
  auto* sections = json.find("sections");
  if (!sections || sections->type != Json::ARR) return model;
  for (auto& section : sections->a) {
    std::vector<Block> blocks;
    if (auto* list = section.find("blocks"); list && list->type == Json::ARR) for (auto& block : list->a) {
      blocks.push_back(blockFrom(block));
      model.characters += blockChars(blocks.back());
    }
    model.sections.push_back(std::move(blocks));
  }
  return model;
}
std::string rebuildDocument(const std::string& original, const Model& model, std::vector<std::pair<std::string, std::string>>& images, std::string& error, const WriteContext& wc) {
  std::string prefix = "w:";
  const std::string& sect = model.sect;
  size_t bodyStart = std::string::npos, bodyEnd = std::string::npos;
  if (!original.empty()) {
    pugi::xml_document doc;
    if (!doc.load_buffer(original.data(), original.size())) { error = "The original document could not be read."; return {}; }
    for (auto child : doc.first_child().children()) if (localName(child.name()) == "body") {
      auto name = std::string(child.name());
      auto colon = name.rfind(':');
      prefix = colon == std::string::npos ? "" : name.substr(0, colon + 1);
      auto open = child.offset_debug();
      bodyEnd = original.rfind("</" + prefix + "body>");
      if (open >= 0 && bodyEnd != std::string::npos) bodyStart = original.find('>', static_cast<size_t>(open));
    }
    if (bodyStart == std::string::npos || bodyEnd == std::string::npos || bodyStart > bodyEnd) { error = "The original document body could not be rebuilt."; return {}; }
  }
  int imageId = 1;
  std::string inner;
  for (auto& section : model.sections) for (auto& block : section) inner += renderBlock(prefix, block, imageId, images, wc);
  if (original.empty()) return shellDocument(inner, sect);
  return original.substr(0, bodyStart + 1) + inner + sect + original.substr(bodyEnd);
}
/** Runs with the same look are merged so both sides of a save compare the same way. */
std::vector<Run> visibleRuns(const std::vector<Run>& runs) {
  std::vector<Run> out;
  for (auto& run : runs) {
    if (run.text.empty()) continue;
    if (!out.empty() && out.back().bold == run.bold && out.back().italic == run.italic && out.back().underline == run.underline && out.back().strike == run.strike &&
        out.back().color == run.color && out.back().size == run.size && out.back().font == run.font && out.back().highlight == run.highlight) out.back().text += run.text;
    else out.push_back(run);
  }
  if (out.empty()) out.push_back({});
  return out;
}
bool sameBand(const Band& left, const Band& right) {
  if (left.locked) return true;
  return left.text == right.text && (left.text.empty() || left.align == right.align);
}
bool sameText(const Model& left, const Model& right) {
  if (!left.sect.empty() && left.sect != right.sect) return false;
  if (left.hf.dirty) {
    if (!sameBand(left.hf.header, right.hf.header) || !sameBand(left.hf.footer, right.hf.footer)) return false;
    auto& band = left.hf.pagePos == "header" ? left.hf.header : left.hf.footer;
    if (!band.locked && left.hf.pagePos != right.hf.pagePos) return false;
    if (!band.locked && left.hf.pagePos != "none" && (left.hf.pageAlign != right.hf.pageAlign || left.hf.pageFormat != right.hf.pageFormat)) return false;
  }
  std::vector<const Block*> a, b;
  for (auto& section : left.sections) for (auto& block : section) a.push_back(&block);
  for (auto& section : right.sections) for (auto& block : section) b.push_back(&block);
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) {
    auto& x = *a[i];
    auto& y = *b[i];
    if (x.kind == "table") {
      if (!y.isTable || x.rows.size() != y.rows.size()) return false;
      for (size_t r = 0; r < x.rows.size(); ++r) {
        if (x.rows[r].size() != y.rows[r].size()) return false;
        for (size_t c = 0; c < x.rows[r].size(); ++c) if (x.rows[r][c].text != y.rows[r][c].text) return false;
      }
      continue;
    }
    if (x.kind != y.kind) return false;
    if (x.kind == "locked") { if (x.raw != y.raw) return false; continue; }
    if (x.kind == "image") {
      if (!x.raw.empty() && !x.resized && x.source.empty()) { if (x.raw != y.raw) return false; continue; }
      if (x.cx != y.cx || x.cy != y.cy) return false;
      continue;
    }
    if (!x.raw.empty()) { if (x.raw != y.raw) return false; continue; }
    auto xr = visibleRuns(x.runs), yr = visibleRuns(y.runs);
    if (x.align != y.align || x.list != y.list || xr.size() != yr.size()) return false;
    if ((x.indent >= 0 && x.indent != y.indent) || (x.before >= 0 && x.before != y.before) || (x.after >= 0 && x.after != y.after) || (x.line > 0 && x.line != y.line)) return false;
    if ((x.right != kUnset && x.right != y.right) || (x.first != kUnset && x.first != y.first)) return false;
    for (size_t r = 0; r < xr.size(); ++r) {
      auto& p = xr[r];
      auto& q = yr[r];
      if (p.text != q.text || p.bold != q.bold || p.italic != q.italic || p.underline != q.underline || p.strike != q.strike || p.color != q.color) return false;
      if ((p.size && p.size != q.size) || (!p.font.empty() && p.font != q.font)) return false;
    }
  }
  return true;
}
std::string savePackage(const std::string& source, const std::string& output, const Model& model, std::string& error) {
  if (model.characters > kMaxChars) { error = "This document is too long to save here."; return {}; }
  std::vector<std::pair<std::string, std::string>> images;
  std::string original, rels, types;
  Package package;
  std::map<std::string, mz_uint32> crcs;
  std::set<std::string> replaced = {"word/document.xml"};
  if (!source.empty()) {
    mz_zip_archive zip = {};
    if (!mz_zip_reader_init_file(&zip, source.c_str(), 0)) { error = "The original document could not be opened."; return {}; }
    original = entryXml(zip, "word/document.xml", error);
    rels = entryXml(zip, "word/_rels/document.xml.rels", error);
    types = entryXml(zip, "[Content_Types].xml", error);
    loadStyles(&zip, package, error);
    auto count = mz_zip_reader_get_num_files(&zip);
    for (mz_uint i = 0; i < count; ++i) {
      mz_zip_archive_file_stat stat = {};
      if (!mz_zip_reader_file_stat(&zip, i, &stat) || stat.m_is_directory) continue;
      crcs[stat.m_filename] = stat.m_crc32;
    }
    mz_zip_reader_end(&zip);
    if (!error.empty()) return {};
  } else loadStyles(nullptr, package, error);
  auto numbering = package.numberingXml;
  if (needsList(model)) {
    numbering = ensureNumbering(numbering);
    replaced.insert("word/numbering.xml");
    package.numbering = Numbering();
    package.numbering.load(numbering, package.styles.theme);
  }
  WriteContext wc; wc.styles = &package.styles; wc.numbering = &package.numbering;
  Model working = model;
  if (model.page.dirty) working.sect = patchPage(model.sect, model.page);
  std::vector<std::pair<std::string, std::string>> bandParts;
  if (model.hf.dirty) {
    const auto& hf = model.hf;
    bool touchHeader = !hf.header.locked, touchFooter = !hf.footer.locked;
    bool addHeader = touchHeader && (!hf.header.text.empty() || hf.pagePos == "header");
    bool addFooter = touchFooter && (!hf.footer.text.empty() || hf.pagePos == "footer");
    working.sect = patchSect(working.sect, touchHeader, addHeader, touchFooter, addFooter);
    if (addHeader) bandParts.push_back({"header", bandXml(true, hf.header, hf.pagePos == "header", hf.pageAlign, hf.pageFormat)});
    if (addFooter) bandParts.push_back({"footer", bandXml(false, hf.footer, hf.pagePos == "footer", hf.pageAlign, hf.pageFormat)});
    for (auto& part : bandParts) {
      auto kind = part.first;
      auto target = "versara-" + kind + ".xml";
      auto id = std::string(kind == "header" ? "rIdVersaraHeader" : "rIdVersaraFooter");
      if (rels.empty()) rels = kDocRels;
      if (rels.find("Id=\"" + id + "\"") == std::string::npos) {
        auto end = rels.rfind("</Relationships>");
        if (end == std::string::npos) { error = "The document relationships could not be updated."; return {}; }
        rels.insert(end, "<Relationship Id=\"" + id + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/" + kind + "\" Target=\"" + target + "\"/>");
        replaced.insert("word/_rels/document.xml.rels");
      }
      if (types.empty()) types = kContentTypes;
      if (types.find("/word/" + target) == std::string::npos) {
        auto end = types.rfind("</Types>");
        if (end == std::string::npos) { error = "The document types could not be updated."; return {}; }
        types.insert(end, "<Override PartName=\"/word/" + target + "\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml." + kind + "+xml\"/>");
        replaced.insert("[Content_Types].xml");
      }
      part.first = "word/" + target;
      replaced.insert(part.first);
    }
  }
  auto document = rebuildDocument(original, working, images, error, wc);
  if (!error.empty()) return {};
  std::vector<std::pair<std::string, std::string>> media;
  if (!images.empty()) {
    if (rels.empty()) rels = kDocRels;
    auto end = rels.rfind("</Relationships>");
    if (end == std::string::npos) { error = "The document relationships could not be updated."; return {}; }
    if (types.empty()) types = kContentTypes;
    auto typesEnd = types.rfind("</Types>");
    if (typesEnd == std::string::npos) { error = "The document types could not be updated."; return {}; }
    for (auto& image : images) {
      std::string bytes, readError;
      bytes = readFile(image.second, readError);
      if (!readError.empty() || bytes.empty() || bytes.size() > 15 * 1024 * 1024) { error = "An image could not be added."; return {}; }
      auto dot = image.second.find_last_of('.');
      auto ext = dot == std::string::npos ? "png" : image.second.substr(dot + 1);
      std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
      if (ext == "jpg") ext = "jpeg";
      if (ext != "png" && ext != "jpeg" && ext != "gif") { error = "Use a PNG, JPEG or GIF image."; return {}; }
      auto stored = ext == "jpeg" ? "jpg" : ext;
      auto name = "word/media/versara-" + image.first + "." + stored;
      media.push_back({name, bytes});
      rels.insert(end, "<Relationship Id=\"" + image.first + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/" + name.substr(std::string("word/").size()) + "\"/>");
      end = rels.rfind("</Relationships>");
      if (types.find("Extension=\"" + ext + "\"") == std::string::npos) {
        auto content = ext == "png" ? "image/png" : ext == "gif" ? "image/gif" : "image/jpeg";
        types.insert(typesEnd, "<Default Extension=\"" + ext + "\" ContentType=\"" + content + "\"/>");
        typesEnd = types.rfind("</Types>");
      }
    }
    replaced.insert("word/_rels/document.xml.rels");
    replaced.insert("[Content_Types].xml");
  }
  if (replaced.count("word/numbering.xml")) {
    if (types.empty()) types = kContentTypes;
    if (types.find("/word/numbering.xml") == std::string::npos) {
      auto typesEnd = types.rfind("</Types>");
      if (typesEnd != std::string::npos) types.insert(typesEnd, "<Override PartName=\"/word/numbering.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml\"/>");
      replaced.insert("[Content_Types].xml");
    }
    if (rels.empty()) rels = kDocRels;
    if (rels.find("relationships/numbering") == std::string::npos) {
      auto end = rels.rfind("</Relationships>");
      if (end != std::string::npos) rels.insert(end, "<Relationship Id=\"rIdVersaraNumbering\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering\" Target=\"numbering.xml\"/>");
      replaced.insert("word/_rels/document.xml.rels");
    }
  }
  mz_zip_archive writer = {};
  if (!mz_zip_writer_init_file(&writer, output.c_str(), 0)) { error = "Could not create the document."; return {}; }
  auto add = [&](const std::string& name, const std::string& bytes) {
    return mz_zip_writer_add_mem(&writer, name.c_str(), bytes.data(), bytes.size(), MZ_BEST_COMPRESSION);
  };
  bool ok = true;
  if (!source.empty()) {
    mz_zip_archive reader = {};
    ok = mz_zip_reader_init_file(&reader, source.c_str(), 0);
    auto count = ok ? mz_zip_reader_get_num_files(&reader) : 0;
    for (mz_uint i = 0; ok && i < count; ++i) {
      mz_zip_archive_file_stat stat = {};
      if (!mz_zip_reader_file_stat(&reader, i, &stat)) { ok = false; break; }
      if (stat.m_is_directory || replaced.count(stat.m_filename)) continue;
      ok = mz_zip_writer_add_from_zip_reader(&writer, &reader, i);
    }
    mz_zip_reader_end(&reader);
  } else {
    ok = add("[Content_Types].xml", types.empty() ? kContentTypes : types) && add("_rels/.rels", kRootRels) && add("word/styles.xml", kStyles) && add("word/_rels/document.xml.rels", rels.empty() ? kDocRels : rels);
  }
  ok = ok && add("word/document.xml", document);
  if (replaced.count("word/numbering.xml")) ok = ok && add("word/numbering.xml", numbering);
  if (replaced.count("word/_rels/document.xml.rels") && !source.empty()) ok = ok && add("word/_rels/document.xml.rels", rels);
  if (replaced.count("[Content_Types].xml") && !source.empty()) ok = ok && add("[Content_Types].xml", types);
  for (auto& file : media) ok = ok && add(file.first, file.second);
  for (auto& file : bandParts) ok = ok && add(file.first, file.second);
  if (!ok || !mz_zip_writer_finalize_archive(&writer)) { mz_zip_writer_end(&writer); std::remove(output.c_str()); error = "Could not write the document."; return {}; }
  mz_zip_writer_end(&writer);
  if (!source.empty()) {
    mz_zip_archive check = {};
    if (!mz_zip_reader_init_file(&check, output.c_str(), 0)) { std::remove(output.c_str()); error = "The saved document could not be checked."; return {}; }
    for (auto& crc : crcs) {
      if (replaced.count(crc.first) || crc.first.rfind("word/media/versara-", 0) == 0) continue;
      int index = mz_zip_reader_locate_file(&check, crc.first.c_str(), nullptr, 0);
      mz_zip_archive_file_stat stat = {};
      if (index < 0 || !mz_zip_reader_file_stat(&check, static_cast<mz_uint>(index), &stat) || stat.m_crc32 != crc.second) {
        mz_zip_reader_end(&check); std::remove(output.c_str()); error = "Saving would have changed an untouched part, so nothing was written."; return {};
      }
    }
    mz_zip_reader_end(&check);
  }
  auto opened = openPackage(output, error);
  if (!error.empty()) { std::remove(output.c_str()); return {}; }
  if (!sameText(working, opened)) { std::remove(output.c_str()); error = "The saved document did not match what was edited, so nothing was written."; return {}; }
  return modelJson(opened);
}

std::string handle(const Json& request) {
  auto action = request.str("action");
  std::string error;
  if (action == "blank") {
    Package package;
    loadStyles(nullptr, package, error);
    Model model;
    model.defaults = defaultsOf(package.styles);
    model.sections.push_back({blankParagraph(package.styles)});
    return modelJson(model);
  }
  if (action == "open") {
    auto model = openPackage(request.str("path"), error);
    if (!error.empty()) return error == "LEGACY" ? fail("DOC_LEGACY", "Word 97 .doc files aren't supported. Save the file as DOCX and open that.") : fail("DOC_OPEN", error);
    return modelJson(model);
  }
  if (action == "media") {
    mz_zip_archive zip = {};
    if (!mz_zip_reader_init_file(&zip, request.str("path").c_str(), 0)) return fail("DOC_OPEN", "The image could not be read.");
    int index = mz_zip_reader_locate_file(&zip, request.str("name").c_str(), nullptr, 0);
    mz_zip_archive_file_stat stat = {};
    bool ok = index >= 0 && mz_zip_reader_file_stat(&zip, static_cast<mz_uint>(index), &stat) && stat.m_uncomp_size <= 15 * 1024 * 1024;
    std::string bytes(ok ? static_cast<size_t>(stat.m_uncomp_size) : 0, '\0');
    ok = ok && (bytes.empty() || mz_zip_reader_extract_to_mem(&zip, static_cast<mz_uint>(index), bytes.data(), bytes.size(), 0));
    mz_zip_reader_end(&zip);
    if (!ok) return fail("DOC_OPEN", "The image could not be read.");
    std::ofstream output(request.str("output"), std::ios::binary);
    output.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    if (!output) return fail("DOC_OPEN", "The image could not be stored.");
    return "{\"ok\":true}";
  }
  if (action == "save") {
    auto saved = savePackage(request.str("source"), request.str("output"), modelFrom(request), error);
    if (!error.empty()) return fail("DOC_SAVE", error);
    return saved.empty() ? fail("DOC_SAVE", "Could not save this document.") : std::string("{\"ok\":true}");
  }
  return fail("DOC_ACTION", "This document action is unavailable.");
}

}  // namespace

std::string runDoc(const std::string& request) {
  try {
    if (request.size() > 48 * 1024 * 1024) return fail("DOC_OPEN", "This document is too large to edit here.");
    return handle(Parser(request).parse());
  } catch (const std::exception& exception) {
    return fail("DOC_OPEN", exception.what());
  }
}

}  // namespace versara

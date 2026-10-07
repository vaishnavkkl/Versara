#pragma once
#include <functional>
#include <string>

namespace versara {
// All PDFium calls are serialized inside runEditor. Call only from a worker queue.
std::string runEditor(const std::string& request, const std::string& cacheRoot,
                      const std::string& documentRoot, const std::function<bool()>& cancelled,
                      const std::function<void(int, int)>& progress);

// Reader rendering shares the same lock. `error` is FPDF_GetLastError() when opening fails.
void* readerOpen(const std::string& path, const std::string& password, int& error);
void readerClose(void* doc);
int readerPageCount(void* doc);
bool readerPageSize(void* doc, int index, double& width, double& height);
/** Draws over the existing pixels; `clip` is left, top, right, bottom in bitmap pixels. */
bool readerRender(void* doc, int index, void* pixels, int width, int height, int stride,
                  float scale, float left, float top, const float clip[4]);
}

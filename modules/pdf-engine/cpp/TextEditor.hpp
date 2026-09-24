#pragma once
#include <functional>
#include <string>

namespace versara {
// All PDFium calls are serialized inside runEditor. Call only from a worker queue.
std::string runEditor(const std::string& request, const std::string& cacheRoot,
                      const std::string& documentRoot, const std::function<bool()>& cancelled,
                      const std::function<void(int, int)>& progress);
}

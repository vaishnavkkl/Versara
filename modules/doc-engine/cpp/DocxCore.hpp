#pragma once
#include <string>

namespace versara {
/** Open, create and save DOCX packages. The request and result are JSON. */
std::string runDoc(const std::string& request);
}

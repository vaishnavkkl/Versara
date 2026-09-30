#include "CokitSession.h"

#include <algorithm>
#include <cstring>
#include <deque>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

#ifdef VERSARA_WITH_COKIT
#include "COKitInit.h"

namespace {
constexpr size_t kMaxEvents = 128;
constexpr size_t kMaxEventBytes = 64 * 1024;
constexpr int kMaxTileSide = 2048;

struct EventQueue {
  std::mutex mutex;
  std::deque<std::pair<int, std::string>> events;
};

std::mutex engine_mutex;
COKit* engine = nullptr; // COKit is intentionally initialized once per process.
std::mutex callback_mutex;
std::unordered_map<uintptr_t, std::weak_ptr<EventQueue>> callbacks;
uintptr_t next_callback_id = 1;

void copy_error(char* out, size_t capacity, const std::string& message) {
  if (!out || !capacity) return;
  const size_t count = std::min(capacity - 1, message.size());
  std::memcpy(out, message.data(), count);
  out[count] = '\0';
}

void on_callback(COKitCallbackType type, const char* payload, void* data) {
  const auto id = reinterpret_cast<uintptr_t>(data);
  std::shared_ptr<EventQueue> queue;
  {
    std::lock_guard<std::mutex> lock(callback_mutex);
    const auto it = callbacks.find(id);
    if (it != callbacks.end()) queue = it->second.lock();
  }
  if (!queue) return;
  const std::string value = payload ? std::string(payload, strnlen(payload, kMaxEventBytes)) : "";
  std::lock_guard<std::mutex> lock(queue->mutex);
  if (queue->events.size() == kMaxEvents) queue->events.pop_front();
  queue->events.emplace_back(static_cast<int>(type), value);
}

bool valid_url(const char* value) {
  return value && std::strncmp(value, "file://", 7) == 0 && std::strlen(value) < 8192;
}
} // namespace

struct VersaraCokitSession {
  COKitDocument* document = nullptr;
  std::shared_ptr<EventQueue> events = std::make_shared<EventQueue>();
  uintptr_t callback_id = 0;
};

extern "C" int versara_cokit_available(void) { return 1; }

extern "C" VersaraCokitSession* versara_cokit_open(const char* install_path,
    const char* profile_url, const char* input_url, char* error, size_t error_capacity) {
  copy_error(error, error_capacity, "");
  if (!install_path || !*install_path || !valid_url(profile_url) || !valid_url(input_url)) {
    copy_error(error, error_capacity, "COKIT_INVALID_PATH");
    return nullptr;
  }
  std::lock_guard<std::mutex> lock(engine_mutex);
  if (!engine) engine = kit::kit_cpp_init(install_path, profile_url);
  if (!engine) {
    copy_error(error, error_capacity, "COKIT_INIT_FAILED");
    return nullptr;
  }
  COKitDocument* document = engine->documentLoadWithOptions(input_url, "");
  if (!document) {
    copy_error(error, error_capacity, "COKIT_OPEN_FAILED: " + engine->getError());
    return nullptr;
  }
  if (document->getDocumentType() != COKitDocumentType::TEXT) {
    delete document;
    copy_error(error, error_capacity, "COKIT_NOT_TEXT_DOCUMENT");
    return nullptr;
  }
  auto session = std::make_unique<VersaraCokitSession>();
  session->document = document;
  {
    std::lock_guard<std::mutex> callback_lock(callback_mutex);
    session->callback_id = next_callback_id++;
    callbacks[session->callback_id] = session->events;
  }
  document->registerCallback(on_callback, reinterpret_cast<void*>(session->callback_id));
  document->initializeForRendering("{}");
  return session.release();
}

extern "C" void versara_cokit_close(VersaraCokitSession* session) {
  if (!session) return;
  std::lock_guard<std::mutex> lock(engine_mutex);
  if (session->document) {
    session->document->registerCallback(nullptr, nullptr);
    delete session->document;
  }
  {
    std::lock_guard<std::mutex> callback_lock(callback_mutex);
    callbacks.erase(session->callback_id);
  }
  delete session;
}

extern "C" int versara_cokit_size(VersaraCokitSession* session, int* width, int* height) {
  if (!session || !width || !height) return 0;
  std::lock_guard<std::mutex> lock(engine_mutex);
  const auto size = session->document->getDocumentSize();
  if (size.nWidth > std::numeric_limits<int>::max() ||
      size.nHeight > std::numeric_limits<int>::max()) return 0;
  *width = size.nWidth;
  *height = size.nHeight;
  return *width > 0 && *height > 0;
}

extern "C" size_t versara_cokit_page_rectangles(VersaraCokitSession* session,
    char* out, size_t capacity) {
  if (!session) return 0;
  std::lock_guard<std::mutex> lock(engine_mutex);
  const std::string value = session->document->getWriterPageRectangles();
  const size_t needed = value.size() + 1;
  if (out && capacity >= needed) std::memcpy(out, value.c_str(), needed);
  return needed;
}

extern "C" int versara_cokit_paint(VersaraCokitSession* session,
    int x, int y, int width, int height, int pixel_width, int pixel_height,
    uint8_t* pixels, size_t capacity, int* tile_mode) {
  if (!session || !pixels || !tile_mode || x < 0 || y < 0 || width <= 0 || height <= 0 ||
      pixel_width < 1 || pixel_height < 1 || pixel_width > kMaxTileSide ||
      pixel_height > kMaxTileSide) return 0;
  const size_t needed = static_cast<size_t>(pixel_width) * pixel_height * 4;
  if (capacity < needed) return 0;
  std::lock_guard<std::mutex> lock(engine_mutex);
  session->document->paintTile(std::span<unsigned char>(pixels, needed), pixel_width,
                                pixel_height, x, y, width, height);
  *tile_mode = static_cast<int>(session->document->getTileMode());
  return 1;
}

extern "C" int versara_cokit_uno(VersaraCokitSession* session,
    const char* command, const char* arguments) {
  if (!session || !command || std::strncmp(command, ".uno:", 5) != 0 ||
      std::strlen(command) > 128 || (arguments && std::strlen(arguments) > 16384)) return 0;
  std::lock_guard<std::mutex> lock(engine_mutex);
  session->document->postUnoCommand(command, arguments ? arguments : "{}", false);
  return 1;
}

extern "C" int versara_cokit_key(VersaraCokitSession* session,
    int type, int character, int key_code) {
  if (!session || type < 0 || type > 1) return 0;
  std::lock_guard<std::mutex> lock(engine_mutex);
  session->document->postKeyEvent(static_cast<COKitKeyEventType>(type), character, key_code);
  return 1;
}

extern "C" int versara_cokit_mouse(VersaraCokitSession* session,
    int type, int x, int y, int clicks, int buttons, int modifiers) {
  if (!session || type < 0 || type > 2 || x < 0 || y < 0 || clicks < 0 || clicks > 3) return 0;
  std::lock_guard<std::mutex> lock(engine_mutex);
  session->document->postMouseEvent(static_cast<COKitMouseEventType>(type), x, y,
                                     clicks, buttons, modifiers);
  return 1;
}

extern "C" int versara_cokit_save(VersaraCokitSession* session,
    const char* output_url, const char* format) {
  if (!session || !valid_url(output_url) || !format ||
      (std::strcmp(format, "docx") != 0 && std::strcmp(format, "pdf") != 0)) return 0;
  std::lock_guard<std::mutex> lock(engine_mutex);
  return session->document->saveAs(output_url, format, nullptr) ? 1 : 0;
}

extern "C" size_t versara_cokit_next_event(VersaraCokitSession* session,
    int* type, char* payload, size_t capacity) {
  if (!session || !type) return 0;
  std::lock_guard<std::mutex> lock(session->events->mutex);
  if (session->events->events.empty()) return 0;
  const auto& front = session->events->events.front();
  const size_t needed = front.second.size() + 1;
  if (payload && capacity >= needed) {
    *type = front.first;
    std::memcpy(payload, front.second.c_str(), needed);
    session->events->events.pop_front();
  }
  return needed;
}

#else

extern "C" int versara_cokit_available(void) { return 0; }
extern "C" VersaraCokitSession* versara_cokit_open(const char*, const char*, const char*,
    char* error, size_t capacity) {
  if (error && capacity) {
    const char* message = "COKIT_ENGINE_NOT_BUNDLED";
    const size_t size = std::min(capacity - 1, std::strlen(message));
    std::memcpy(error, message, size);
    error[size] = '\0';
  }
  return nullptr;
}
extern "C" void versara_cokit_close(VersaraCokitSession*) {}
extern "C" int versara_cokit_size(VersaraCokitSession*, int*, int*) { return 0; }
extern "C" size_t versara_cokit_page_rectangles(VersaraCokitSession*, char*, size_t) { return 0; }
extern "C" int versara_cokit_paint(VersaraCokitSession*, int, int, int, int, int, int,
    uint8_t*, size_t, int*) { return 0; }
extern "C" int versara_cokit_uno(VersaraCokitSession*, const char*, const char*) { return 0; }
extern "C" int versara_cokit_key(VersaraCokitSession*, int, int, int) { return 0; }
extern "C" int versara_cokit_mouse(VersaraCokitSession*, int, int, int, int, int, int) { return 0; }
extern "C" int versara_cokit_save(VersaraCokitSession*, const char*, const char*) { return 0; }
extern "C" size_t versara_cokit_next_event(VersaraCokitSession*, int*, char*, size_t) { return 0; }

#endif

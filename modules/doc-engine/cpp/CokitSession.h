#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct VersaraCokitSession VersaraCokitSession;

// The engine is process-wide. Calls on a session are serialized by this bridge.
// Input and output paths are local file URLs; tile pixels never cross to JavaScript.
int versara_cokit_available(void);
VersaraCokitSession* versara_cokit_open(const char* install_path,
                                       const char* profile_url,
                                       const char* input_url,
                                       char* error,
                                       size_t error_capacity);
void versara_cokit_close(VersaraCokitSession* session);
int versara_cokit_size(VersaraCokitSession* session, int* width_twips, int* height_twips);
// Returns the required byte count including NUL. The caller can retry with that capacity.
size_t versara_cokit_page_rectangles(VersaraCokitSession* session, char* out, size_t capacity);
// Bounds: 1..2048 pixels per side, at most 16 MiB RGBA/BGRA output.
int versara_cokit_paint(VersaraCokitSession* session,
                        int x_twips, int y_twips, int width_twips, int height_twips,
                        int pixel_width, int pixel_height,
                        uint8_t* pixels, size_t pixel_capacity,
                        int* tile_mode);
int versara_cokit_uno(VersaraCokitSession* session, const char* command, const char* arguments);
int versara_cokit_key(VersaraCokitSession* session, int type, int character, int key_code);
int versara_cokit_mouse(VersaraCokitSession* session, int type, int x_twips, int y_twips,
                        int clicks, int buttons, int modifiers);
int versara_cokit_save(VersaraCokitSession* session, const char* output_url, const char* format);
// Returns 0 when no event is waiting, or required payload bytes including NUL.
// If capacity is too small, the event remains queued. Events are bounded in count and size.
size_t versara_cokit_next_event(VersaraCokitSession* session, int* type,
                                char* payload, size_t capacity);

#ifdef __cplusplus
}
#endif

#include <jni.h>
#include <android/bitmap.h>
#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>
#include "CokitSession.h"

#ifdef VERSARA_WITH_COKIT
extern "C" jboolean cokit_initialize(JNIEnv*, jstring, jstring, jstring, jobject);
#endif

namespace {
std::string utf(JNIEnv* env, jstring value) {
  if (!value) return {};
  const char* chars = env->GetStringUTFChars(value, nullptr);
  if (!chars) return {};
  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

void fail(JNIEnv* env, const char* message) {
  jclass type = env->FindClass("java/lang/IllegalStateException");
  if (type) env->ThrowNew(type, message);
}

VersaraCokitSession* session(jlong handle) {
  return reinterpret_cast<VersaraCokitSession*>(static_cast<uintptr_t>(handle));
}
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_docengine_NativeCokit_available(JNIEnv*, jclass) {
  return versara_cokit_available() ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_docengine_NativeCokit_prepare(JNIEnv* env, jclass,
    jstring data_dir, jstring cache_dir, jstring apk_file, jobject assets) {
#ifdef VERSARA_WITH_COKIT
  return cokit_initialize(env, data_dir, cache_dir, apk_file, assets);
#else
  (void)env; (void)data_dir; (void)cache_dir; (void)apk_file; (void)assets;
  return JNI_FALSE;
#endif
}

extern "C" JNIEXPORT jlong JNICALL
Java_expo_modules_docengine_NativeCokit_open(JNIEnv* env, jclass,
    jstring install_path, jstring profile_url, jstring input_url) {
  const auto install = utf(env, install_path);
  const auto profile = utf(env, profile_url);
  const auto input = utf(env, input_url);
  char error[1024] = {};
  auto* opened = versara_cokit_open(install.c_str(), profile.c_str(), input.c_str(), error, sizeof(error));
  if (!opened) {
    fail(env, error[0] ? error : "COKIT_OPEN_FAILED");
    return 0;
  }
  return static_cast<jlong>(reinterpret_cast<uintptr_t>(opened));
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_docengine_NativeCokit_close(JNIEnv*, jclass, jlong handle) {
  versara_cokit_close(session(handle));
}

extern "C" JNIEXPORT jintArray JNICALL
Java_expo_modules_docengine_NativeCokit_size(JNIEnv* env, jclass, jlong handle) {
  int width = 0, height = 0;
  if (!versara_cokit_size(session(handle), &width, &height)) {
    fail(env, "COKIT_SIZE_FAILED");
    return nullptr;
  }
  jint values[2] = {width, height};
  jintArray result = env->NewIntArray(2);
  if (result) env->SetIntArrayRegion(result, 0, 2, values);
  return result;
}

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_docengine_NativeCokit_pageRectangles(JNIEnv* env, jclass, jlong handle) {
  const size_t needed = versara_cokit_page_rectangles(session(handle), nullptr, 0);
  if (needed == 0 || needed > 1024 * 1024) {
    fail(env, "COKIT_PAGES_FAILED");
    return nullptr;
  }
  std::vector<char> value(needed);
  if (versara_cokit_page_rectangles(session(handle), value.data(), value.size()) > value.size()) {
    fail(env, "COKIT_PAGES_CHANGED");
    return nullptr;
  }
  return env->NewStringUTF(value.data());
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_docengine_NativeCokit_paint(JNIEnv* env, jclass, jlong handle,
    jint x, jint y, jint width, jint height, jobject bitmap) {
  AndroidBitmapInfo info = {};
  if (!bitmap || AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS ||
      info.format != ANDROID_BITMAP_FORMAT_RGBA_8888 || info.width > 2048 || info.height > 2048 ||
      info.width == 0 || info.height == 0) return JNI_FALSE;
  std::vector<uint8_t> tile(static_cast<size_t>(info.width) * info.height * 4);
  int mode = 0;
  if (!versara_cokit_paint(session(handle), x, y, width, height,
                           static_cast<int>(info.width), static_cast<int>(info.height),
                           tile.data(), tile.size(), &mode)) return JNI_FALSE;
  void* pixels = nullptr;
  if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS) return JNI_FALSE;
  for (uint32_t row = 0; row < info.height; ++row) {
    auto* output = static_cast<uint8_t*>(pixels) + static_cast<size_t>(row) * info.stride;
    const auto* source = tile.data() + static_cast<size_t>(row) * info.width * 4;
    if (mode == 0) std::copy_n(source, static_cast<size_t>(info.width) * 4, output);
    else for (uint32_t col = 0; col < info.width; ++col) {
      const size_t at = static_cast<size_t>(col) * 4;
      output[at] = source[at + 2]; output[at + 1] = source[at + 1];
      output[at + 2] = source[at]; output[at + 3] = source[at + 3];
    }
  }
  AndroidBitmap_unlockPixels(env, bitmap);
  return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_docengine_NativeCokit_uno(JNIEnv* env, jclass, jlong handle,
    jstring command, jstring arguments) {
  const auto cmd = utf(env, command), args = utf(env, arguments);
  return versara_cokit_uno(session(handle), cmd.c_str(), args.c_str()) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_docengine_NativeCokit_key(JNIEnv*, jclass, jlong handle,
    jint type, jint character, jint key_code) {
  return versara_cokit_key(session(handle), type, character, key_code) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_docengine_NativeCokit_mouse(JNIEnv*, jclass, jlong handle,
    jint type, jint x, jint y, jint clicks, jint buttons, jint modifiers) {
  return versara_cokit_mouse(session(handle), type, x, y, clicks, buttons, modifiers) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_docengine_NativeCokit_save(JNIEnv* env, jclass, jlong handle,
    jstring output_url, jstring format) {
  const auto url = utf(env, output_url), extension = utf(env, format);
  return versara_cokit_save(session(handle), url.c_str(), extension.c_str()) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jobjectArray JNICALL
Java_expo_modules_docengine_NativeCokit_nextEvent(JNIEnv* env, jclass, jlong handle) {
  int type = 0;
  const size_t needed = versara_cokit_next_event(session(handle), &type, nullptr, 0);
  if (!needed || needed > 64 * 1024 + 1) return nullptr;
  std::vector<char> payload(needed);
  if (versara_cokit_next_event(session(handle), &type, payload.data(), payload.size()) > payload.size()) return nullptr;
  jclass string_class = env->FindClass("java/lang/String");
  if (!string_class) return nullptr;
  jobjectArray result = env->NewObjectArray(2, string_class, nullptr);
  if (!result) return nullptr;
  jstring type_string = env->NewStringUTF(std::to_string(type).c_str());
  jstring data_string = env->NewStringUTF(payload.data());
  env->SetObjectArrayElement(result, 0, type_string);
  env->SetObjectArrayElement(result, 1, data_string);
  env->DeleteLocalRef(type_string);
  env->DeleteLocalRef(data_string);
  return result;
}

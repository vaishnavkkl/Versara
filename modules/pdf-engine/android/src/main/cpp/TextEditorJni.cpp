#include <jni.h>
#include "TextEditor.hpp"
#include <codecvt>
#include <locale>

static std::string string(JNIEnv* env, jstring value) {
  auto chars = env->GetStringChars(value, nullptr);
  std::u16string wide(reinterpret_cast<const char16_t*>(chars), env->GetStringLength(value));
  env->ReleaseStringChars(value, chars);
  return std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>{}.to_bytes(wide);
}
extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_pdfengine_NativeTextEditor_run(JNIEnv* env, jobject self, jstring request, jstring cache, jstring documents) {
  auto cls = env->GetObjectClass(self);
  auto cancel = env->GetMethodID(cls, "isCancelled", "()Z");
  auto progress = env->GetMethodID(cls, "progress", "(II)V");
  const auto result = versara::runEditor(string(env, request), string(env, cache), string(env, documents),
    [&] { return bool(env->CallBooleanMethod(self, cancel)); },
    [&](int completed, int total) { env->CallVoidMethod(self, progress, completed, total); });
  auto wide = std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>{}.from_bytes(result);
  return env->NewString(reinterpret_cast<const jchar*>(wide.data()), static_cast<jsize>(wide.size()));
}

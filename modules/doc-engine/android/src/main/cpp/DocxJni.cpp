#include <jni.h>
#include "DocxCore.hpp"
#include <codecvt>
#include <locale>

static std::string string(JNIEnv* env, jstring value) {
  auto chars = env->GetStringChars(value, nullptr);
  std::u16string wide(reinterpret_cast<const char16_t*>(chars), env->GetStringLength(value));
  env->ReleaseStringChars(value, chars);
  return std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>{}.to_bytes(wide);
}
static jstring result(JNIEnv* env, const std::string& value) {
  auto wide = std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>{}.from_bytes(value);
  return env->NewString(reinterpret_cast<const jchar*>(wide.data()), static_cast<jsize>(wide.size()));
}
extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_docengine_NativeDoc_run(JNIEnv* env, jclass, jstring request) {
  return result(env, versara::runDoc(string(env, request)));
}

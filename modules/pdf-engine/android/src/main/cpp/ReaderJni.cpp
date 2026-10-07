#include <jni.h>
#include <android/bitmap.h>
#include <string>
#include "TextEditor.hpp"

static std::string utf8(JNIEnv* env, jstring value) {
  const char* chars = env->GetStringUTFChars(value, nullptr);
  std::string result(chars ? chars : "");
  if (chars) env->ReleaseStringUTFChars(value, chars);
  return result;
}

extern "C" JNIEXPORT jlong JNICALL
Java_expo_modules_pdfengine_PdfiumReaderNative_open(JNIEnv* env, jobject, jstring path, jstring password, jintArray error) {
  int code = 0;
  void* doc = versara::readerOpen(utf8(env, path), utf8(env, password), code);
  const jint value = code;
  env->SetIntArrayRegion(error, 0, 1, &value);
  return reinterpret_cast<jlong>(doc);
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_pdfengine_PdfiumReaderNative_close(JNIEnv*, jobject, jlong doc) {
  versara::readerClose(reinterpret_cast<void*>(doc));
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_pdfengine_PdfiumReaderNative_pageCount(JNIEnv*, jobject, jlong doc) {
  return versara::readerPageCount(reinterpret_cast<void*>(doc));
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_pdfengine_PdfiumReaderNative_pageSize(JNIEnv* env, jobject, jlong doc, jint index, jdoubleArray size) {
  double width = 0, height = 0;
  if (!versara::readerPageSize(reinterpret_cast<void*>(doc), index, width, height)) return JNI_FALSE;
  const jdouble values[2] = {width, height};
  env->SetDoubleArrayRegion(size, 0, 2, values);
  return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_pdfengine_PdfiumReaderNative_render(JNIEnv* env, jobject, jlong doc, jint index, jobject bitmap,
                                                      jfloat scale, jfloat left, jfloat top, jfloatArray clip) {
  AndroidBitmapInfo info;
  if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS || info.format != ANDROID_BITMAP_FORMAT_RGBA_8888) return JNI_FALSE;
  float area[4];
  env->GetFloatArrayRegion(clip, 0, 4, area);
  void* pixels = nullptr;
  if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS || !pixels) return JNI_FALSE;
  const bool ok = versara::readerRender(reinterpret_cast<void*>(doc), index, pixels, int(info.width), int(info.height), int(info.stride), scale, left, top, area);
  AndroidBitmap_unlockPixels(env, bitmap);
  return ok ? JNI_TRUE : JNI_FALSE;
}

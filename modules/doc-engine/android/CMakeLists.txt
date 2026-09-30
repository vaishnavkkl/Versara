cmake_minimum_required(VERSION 3.22.1)
project(versara_doc LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_library(versara_doc SHARED
  ../cpp/DocxCore.cpp
  ../cpp/third_party/pugixml.cpp
  ../cpp/third_party/miniz.c
  ../cpp/third_party/miniz_tdef.c
  ../cpp/third_party/miniz_tinfl.c
  ../cpp/third_party/miniz_zip.c
  src/main/cpp/DocxJni.cpp
  src/main/cpp/CokitJni.cpp)
target_include_directories(versara_doc PRIVATE ../cpp ../cpp/third_party)
target_link_options(versara_doc PRIVATE "-Wl,-z,max-page-size=16384")
target_link_libraries(versara_doc jnigraphics)

set(COKIT_LIBRARY "${CMAKE_CURRENT_SOURCE_DIR}/../vendor/cokit/android/${ANDROID_ABI}/liblo-native-code.so")
if(EXISTS "${COKIT_LIBRARY}")
  add_library(cokit SHARED IMPORTED)
  set_target_properties(cokit PROPERTIES IMPORTED_LOCATION "${COKIT_LIBRARY}")
  target_compile_definitions(versara_doc PRIVATE VERSARA_WITH_COKIT=1 ANDROID=1)
  target_link_libraries(versara_doc cokit)
else()
  # The fallback is linked only when the engine is absent. For a real build the
  # bridge lives inside liblo-native-code.so, with the engine's C++ runtime.
  target_sources(versara_doc PRIVATE ../cpp/CokitSession.cpp)
endif()

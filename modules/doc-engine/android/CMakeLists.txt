cmake_minimum_required(VERSION 3.22.1)
project(versara_doc LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_library(versara_doc SHARED
  ../cpp/DocxCore.cpp
  ../cpp/third_party/pugixml.cpp
  ../cpp/third_party/miniz.c
  ../cpp/third_party/miniz_tdef.c
  ../cpp/third_party/miniz_tinfl.c
  ../cpp/third_party/miniz_zip.c
  src/main/cpp/DocxJni.cpp)
target_include_directories(versara_doc PRIVATE ../cpp ../cpp/third_party)
target_link_options(versara_doc PRIVATE "-Wl,-z,max-page-size=16384")

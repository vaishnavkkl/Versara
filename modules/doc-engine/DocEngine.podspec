Pod::Spec.new do |s|
  s.name = 'DocEngine'
  s.version = '1.0.0'
  s.summary = 'Versara native DOCX editor'
  s.description = 'Offline native Word document editing with a shared C++ core.'
  s.author = 'Versara'
  s.homepage = 'https://docs.expo.dev/modules/'
  s.platforms = { :ios => '17.0' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit', 'CoreText', 'ImageIO'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'HEADER_SEARCH_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/cpp" "${PODS_TARGET_SRCROOT}/cpp/third_party"',
  }
  s.source_files = 'ios/**/*.{h,m,mm,swift}', 'cpp/**/*.{hpp,cpp,c,h}'
  s.private_header_files = 'cpp/**/*.{hpp,h}'
  s.resources = 'fonts/docfonts/Carlito-*.ttf', 'fonts/docfonts/Caladea-*.ttf', 'fonts/docfonts/OFL-Carlito.txt', 'fonts/docfonts/OFL-Caladea.txt'
  s.libraries = 'c++'
end

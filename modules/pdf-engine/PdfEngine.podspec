Pod::Spec.new do |s|
  # Local development pods do not execute prepare_command. Prepare before CocoaPods
  # resolves the vendored framework; verified archives are reused on later installs.
  script = File.expand_path('../../scripts/prepare-pdfium.mjs', __dir__)
  unless File.exist?(File.expand_path('vendor/PDFium.xcframework/Info.plist', __dir__))
    raise 'PDFium preparation failed' unless system('node', script, '--ios')
  end
  s.name = 'PdfEngine'
  s.version = '1.0.0'
  s.summary = 'Versara native PDF tools'
  s.description = 'Offline native PDF viewing, organization, conversion and text editing.'
  s.author = 'Versara'
  s.homepage = 'https://docs.expo.dev/modules/'
  s.platforms = { :ios => '17.0' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'PDFKit', 'CoreGraphics', 'ImageIO', 'AVFoundation'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'HEADER_SEARCH_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/vendor/ios-device-arm64/include"',
  }
  s.source_files = 'ios/*.{h,m,mm,swift}', 'cpp/*.{hpp,cpp}', 'cpp/third_party/*.{hpp,h}'
  s.private_header_files = 'cpp/**/*.hpp', 'cpp/**/*.h'
  s.vendored_frameworks = 'vendor/PDFium.xcframework'
  s.resource_bundles = { 'PdfEngineLicenses' => ['vendor/ios-device-arm64/LICENSE', 'vendor/ios-device-arm64/licenses/*', 'cpp/third_party/*-LICENSE'] }
  s.libraries = 'c++'
end

Pod::Spec.new do |s|
  s.name = 'FileEngine'
  s.version = '1.0.0'
  s.summary = 'Versara native file access and device recents'
  s.description = 'Offline native media/storage permissions and bounded device file listing.'
  s.author = 'Versara'
  s.homepage = 'https://docs.expo.dev/modules/'
  s.platforms = { :ios => '17.0' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Photos', 'UniformTypeIdentifiers', 'AVFoundation', 'PDFKit', 'Vision'
  s.libraries = 'sqlite3'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = 'ios/**/*.{h,m,mm,swift}'
end

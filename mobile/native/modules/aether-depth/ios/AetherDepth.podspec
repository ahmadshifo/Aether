Pod::Spec.new do |s|
  s.name = 'AetherDepth'
  s.version = '0.1.0'
  s.summary = 'ARKit scene depth and color frames for the Aether camera'
  s.author = 'Aether team'
  s.homepage = 'https://github.com/ahmadshifo/Aether'
  s.license = { :type => 'UNLICENSED' }
  s.source = { :git => 'https://github.com/ahmadshifo/Aether.git' }
  s.platform = :ios, '16.4'
  s.static_framework = true
  s.source_files = '*.{h,hpp,mm}'
  s.private_header_files = '*.hpp'
  s.frameworks = 'ARKit', 'AVFoundation', 'CoreImage', 'CoreVideo', 'ImageIO', 'QuartzCore', 'UIKit'
  s.libraries = 'c++'
  s.dependency 'React-Core'
  s.dependency 'react-native-webrtc'
  s.pod_target_xcconfig = { 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17' }
end

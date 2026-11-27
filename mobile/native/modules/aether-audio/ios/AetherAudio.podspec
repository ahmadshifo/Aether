Pod::Spec.new do |s|
  s.name = 'AetherAudio'
  s.version = '1.0.0'
  s.summary = 'In-memory microphone and WAV playback for Aether local voice'
  s.author = 'Aether team'
  s.homepage = 'https://github.com/ahmadshifo/Aether'
  s.license = { :type => 'UNLICENSED' }
  s.source = { git: '' }
  s.platforms = { :ios => '16.4' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation'
  s.source_files = '**/*.swift'
end

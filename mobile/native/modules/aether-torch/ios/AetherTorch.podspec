Pod::Spec.new do |s|
  s.name           = 'AetherTorch'
  s.version        = '0.1.0'
  s.summary        = "Aether's SOS flashlight"
  s.description    = 'Switches the iPhone torch on and off without a camera session, so it stays on during a call.'
  s.author         = 'Aether team'
  s.homepage       = 'https://github.com/ahmadshifo/Aether'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,swift}'
end

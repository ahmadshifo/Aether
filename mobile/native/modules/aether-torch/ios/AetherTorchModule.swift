import AVFoundation
import ExpoModulesCore

// SOS flashlight on iPhone. The torch is switched through AVCaptureDevice without starting a camera session, so
// it keeps shining while the call screen is in front. It fails when another camera session holds the camera,
// which is why the app releases its streaming camera before switching the torch on.
public class AetherTorchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AetherTorch")

    // Returns true when the torch changed, false when this phone has no flash or it is busy.
    Function("setTorch") { (on: Bool) -> Bool in
      guard let device = AVCaptureDevice.default(for: .video), device.hasTorch, device.isTorchAvailable else {
        return false
      }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        if on {
          try device.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
        } else {
          device.torchMode = .off
        }
        return true
      } catch {
        return false
      }
    }
  }
}

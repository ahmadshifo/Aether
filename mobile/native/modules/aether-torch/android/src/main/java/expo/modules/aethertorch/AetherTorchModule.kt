package expo.modules.aethertorch

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// SOS flashlight. CameraManager.setTorchMode lights the flash without opening a camera, so it keeps shining
// while the call screen is in front. It needs no permission. It fails only if a camera is in use, which is why
// the app releases its streaming camera before switching the torch on.
class AetherTorchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AetherTorch")

    // Returns true when the torch changed, false when this phone has no flash or it is busy.
    Function("setTorch") { on: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      val manager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return@Function false
      val cameraId = manager.cameraIdList.firstOrNull { id ->
        manager.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
      } ?: return@Function false
      try {
        manager.setTorchMode(cameraId, on)
        true
      } catch (error: Exception) {
        false
      }
    }
  }
}

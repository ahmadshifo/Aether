// Aether's SOS flashlight (Android and iPhone). Uses the system torch directly, not a camera, so it keeps shining
// while the phone call screen is open. On an app built before this module existed, it does nothing.
import { requireOptionalNativeModule } from 'expo';

const native = requireOptionalNativeModule<{ setTorch(on: boolean): boolean }>('AetherTorch');

/** Turns the flashlight on or off. Resolves true when it worked. */
export async function setTorch(on: boolean): Promise<boolean> {
  try { return native ? native.setTorch(on) : false; } catch { return false; }
}

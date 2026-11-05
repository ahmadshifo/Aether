import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// Existing development clients do not contain this module until they are rebuilt.
// Keep the literal require behind the binary check so those installs still open.
export function loadGlassView() {
  if (Platform.OS !== 'ios' || !requireOptionalNativeModule('ExpoGlassEffect')) return null;
  try {
    const glass = require('expo-glass-effect') as typeof import('expo-glass-effect');
    return glass.isGlassEffectAPIAvailable() && glass.isLiquidGlassAvailable() ? glass.GlassView : null;
  } catch {
    return null;
  }
}

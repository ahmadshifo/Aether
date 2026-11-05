import * as Haptics from 'expo-haptics';

export async function sessionHaptics(enabled: boolean) {
  if (!enabled) return;
  // Run before camera/dictation acquisition: iOS can suppress haptics while either is active.
  try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch { /* Feedback must not prevent a session. */ }
}

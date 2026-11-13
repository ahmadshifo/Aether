// SOS helpers for the phone: the flashlight during the call, the direct call itself, and choosing the
// emergency contact from the phone's contacts.
//
// The native modules are loaded only when needed: an app built before they were added keeps working,
// without the flashlight and with the phone's dialer instead of a direct call.
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { setTorch } from '../../modules/aether-torch';

function optional<T>(load: () => T): T | undefined {
  try { return load(); } catch { return undefined; }
}

/** Flashlight on or off. It uses the system torch (not a camera), so it keeps shining during the call. */
export const torch = (on: boolean) => setTorch(on);

/**
 * Asks once (when a session starts) for permission to place calls, so an SOS can call without a popup.
 * Resolves true when direct calls are allowed.
 */
export async function prepareEmergencyCall(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const permission = PermissionsAndroid.PERMISSIONS.CALL_PHONE;
    if (await PermissionsAndroid.check(permission)) return true;
    return (await PermissionsAndroid.request(permission, {
      title: 'Emergency calls',
      message: 'Allow Aether to call your emergency contact by itself when you say "I need help".',
      buttonPositive: 'Allow',
    })) === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

/** Calls the number directly when allowed (Android), otherwise opens the dialer with the number filled in. */
export async function callEmergencyNumber(number: string): Promise<void> {
  const launcher = optional(() => require('expo-intent-launcher') as typeof import('expo-intent-launcher'));
  if (Platform.OS === 'android' && launcher) {
    try {
      if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CALL_PHONE)) {
        await launcher.startActivityAsync('android.intent.action.CALL', { data: `tel:${number}` });
        return;
      }
    } catch { /* Fall back to the dialer below. */ }
  }
  await Linking.openURL(`tel:${number}`);
}

export type PickedContact = { name: string; number: string };

// How people usually mark their emergency contact in the phone's contacts: "ICE Mom" (In Case of Emergency),
// "Emergency - Ahmad", or the Arabic/French words. iPhone and Android don't let apps read the system's own
// emergency-contact setting, so this naming habit is what Aether can find.
const EMERGENCY_NAME = /^ice\b|\bice$|emergency|urgence|طوارئ/i;

/** Asks once (at session start) to read contacts, so an SOS can find the contact to call without a popup. */
export async function prepareContacts(): Promise<boolean> {
  const contacts = optional(() => require('expo-contacts') as typeof import('expo-contacts'));
  if (!contacts) return false;
  try { return (await contacts.requestPermissionsAsync()).granted; } catch { return false; }
}

function bestNumber(contact: { phoneNumbers?: { number?: string; label?: string }[] }) {
  const phones = (contact.phoneNumbers ?? []).filter(phone => phone.number?.trim());
  return (phones.find(phone => /mobile|cell/i.test(phone.label ?? '')) ?? phones[0])?.number ?? null;
}

/**
 * Finds who to call in the phone's own contacts: the person with this name ("Mom", "أحمد"), or with name null
 * the user's emergency contact ("ICE ..." / "Emergency ..."). Null when there is no match or no permission.
 */
export async function findPhoneContact(name: string | null): Promise<PickedContact | null> {
  const contacts = optional(() => require('expo-contacts') as typeof import('expo-contacts'));
  if (!contacts) return null;
  try {
    if (!(await contacts.getPermissionsAsync()).granted) return null;
    const { data } = await contacts.getContactsAsync({ fields: [contacts.Fields.PhoneNumbers], ...(name ? { name } : {}) });
    const wanted = name?.toLocaleLowerCase().trim();
    // A named person: exact name first, then a name that starts with it ("Mom" -> "Mom Home"), then any match.
    const ranked = name
      ? [...data].sort((a, b) => score(b.name, wanted!) - score(a.name, wanted!))
      : data.filter(contact => EMERGENCY_NAME.test(contact.name ?? ''));
    for (const contact of ranked) {
      const number = bestNumber(contact);
      if (number) return { name: contact.name || number, number };
    }
  } catch { /* No contacts access: fall back to the saved number. */ }
  return null;
}

function score(contactName: string | undefined, wanted: string) {
  const value = (contactName ?? '').toLocaleLowerCase().trim();
  return value === wanted ? 3 : value.startsWith(wanted) ? 2 : value.includes(wanted) ? 1 : 0;
}

/**
 * Opens the phone's own contact list. Resolves with the chosen person's name and phone number (a mobile number
 * when there is one), null when nothing was chosen, or 'no_number' when the contact has no phone number.
 */
export async function pickEmergencyContact(): Promise<PickedContact | null | 'no_number'> {
  const contacts = optional(() => require('expo-contacts') as typeof import('expo-contacts'));
  if (!contacts) return null;
  const contact = await contacts.presentContactPickerAsync();
  if (!contact) return null;
  const phones = (contact.phoneNumbers ?? []).filter(phone => phone.number?.trim());
  const best = phones.find(phone => /mobile|cell/i.test(phone.label ?? '')) ?? phones[0];
  if (!best?.number) return 'no_number';
  return { name: contact.name || best.number, number: best.number };
}

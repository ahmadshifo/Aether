// SOS helpers for the phone: the flashlight during the call, the direct call itself, and choosing the
// emergency contact from the phone's contacts.
//
// The native modules are loaded only when needed: an app built before they were added keeps working,
// without the flashlight and with the phone's dialer instead of a direct call.
import { requireOptionalNativeModule } from 'expo';
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { setTorch } from '../../modules/aether-torch';

// Loads a package only when its native parts are in this build. The check must come first: in development, Metro
// reports a failed package load as a crash even inside try/catch.
function optional<T>(nativeNames: string[], load: () => T): T | undefined {
  if (!nativeNames.every(name => requireOptionalNativeModule(name))) return undefined;
  try { return load(); } catch { return undefined; }
}
const CONTACTS = ['ExpoContacts', 'ExpoContactsNext'];

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
  const launcher = optional(['ExpoIntentLauncher'], () => require('expo-intent-launcher') as typeof import('expo-intent-launcher'));
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

// The phone's own emergency contact. Samsung keeps the contacts chosen in Settings > Safety and emergency in a
// contacts group ("ICE - emergency contacts"); iPhone and other phones can't share theirs with apps, so people
// usually save them as "ICE Mom" (In Case of Emergency), "Emergency - Ahmad", or the Arabic/French words.
// Aether looks for that group first, then for such a name.
const EMERGENCY_NAME = /^ice\b|\bice$|\bice\b.*emergenc|emergenc|urgence|طوارئ/i;

type Phone = { number?: string; label?: string };
type Contacts = typeof import('expo-contacts');

/** Asks once (at session start) to read contacts, so an SOS can find the contact to call without a popup. */
export async function prepareContacts(): Promise<boolean> {
  const contacts = optional(CONTACTS, () => require('expo-contacts') as Contacts);
  if (!contacts) return false;
  try { return (await contacts.requestPermissionsAsync()).granted; } catch { return false; }
}

function bestNumber(phones: Phone[] | undefined) {
  const usable = (phones ?? []).filter(phone => phone.number?.trim());
  return (usable.find(phone => /mobile|cell|portable|جوال|خليوي/i.test(phone.label ?? '')) ?? usable[0])?.number ?? null;
}

async function withNumber(contact: { getFullName(): Promise<string>; getPhones(): Promise<Phone[]> }): Promise<PickedContact | null> {
  const [name, phones] = await Promise.all([contact.getFullName().catch(() => ''), contact.getPhones().catch(() => [])]);
  const number = bestNumber(phones);
  return number ? { name: name || number, number } : null;
}

/** The phone's emergency contact: someone in an "ICE"/"Emergency" contacts group, else a contact named so. */
async function emergencyContact(contacts: Contacts): Promise<PickedContact | null> {
  try {
    for (const group of await contacts.Group.getAll()) {
      const groupName = (await group.getName().catch(() => null)) ?? '';
      if (!EMERGENCY_NAME.test(groupName)) continue;
      for (const member of await group.getContacts().catch(() => [])) {
        const found = await withNumber(member);
        if (found) return found;
      }
    }
  } catch { /* Groups aren't available on this phone: look by name below. */ }
  const everyone = await contacts.Contact.getAllDetails([contacts.ContactField.FULL_NAME, contacts.ContactField.PHONES]);
  for (const details of everyone) {
    if (!EMERGENCY_NAME.test(details.fullName ?? '')) continue;
    const number = bestNumber(details.phones as Phone[] | undefined);
    if (number) return { name: details.fullName || number, number };
  }
  return null;
}

/**
 * Finds who to call in the phone's own contacts: the person with this name ("Mom", "أحمد"), or with name null
 * the user's emergency contact (see emergencyContact). Null when there is no match or no permission.
 */
export async function findPhoneContact(name: string | null): Promise<PickedContact | null> {
  const contacts = optional(CONTACTS, () => require('expo-contacts') as Contacts);
  if (!contacts) return null;
  try {
    if (!(await contacts.getPermissionsAsync()).granted) return null;
    if (!name) return await emergencyContact(contacts);
    const wanted = name.toLocaleLowerCase().trim();
    const matches = await contacts.Contact.getAllDetails([contacts.ContactField.FULL_NAME, contacts.ContactField.PHONES], { name });
    // Exact name first, then a name that starts with it ("Mom" -> "Mom Home"), then any match.
    const ranked = [...matches].sort((a, b) => score(b.fullName ?? '', wanted) - score(a.fullName ?? '', wanted));
    for (const details of ranked) {
      const number = bestNumber(details.phones as Phone[] | undefined);
      if (number) return { name: details.fullName || number, number };
    }
  } catch { /* No contacts access: fall back to the dashboard's number. */ }
  return null;
}

function score(contactName: string, wanted: string) {
  const value = contactName.toLocaleLowerCase().trim();
  return value === wanted ? 3 : value.startsWith(wanted) ? 2 : value.includes(wanted) ? 1 : 0;
}

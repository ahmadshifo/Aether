import { requireOptionalNativeModule } from 'expo';
import * as Contacts from 'expo-contacts';
import { findPhoneContact } from '../src/platform/sosAlarm';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn(() => ({})) }));
jest.mock('../modules/aether-torch', () => ({ setTorch: jest.fn(async () => true) }));
jest.mock('expo-contacts', () => ({
  getPermissionsAsync: jest.fn(),
  Contact: { getAllDetails: jest.fn() },
  ContactField: { FULL_NAME: 'fullName', PHONES: 'phones' },
}));

const permission = jest.mocked(Contacts.getPermissionsAsync);
const query = jest.mocked(Contacts.Contact.getAllDetails);
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireOptionalNativeModule).mockReturnValue({} as never);
  permission.mockResolvedValue({ granted: true, accessPrivileges: 'all' } as never);
  query.mockResolvedValue([]);
});

test('denied permission never reads contacts and is distinct from an unknown name', async () => {
  permission.mockResolvedValue({ granted: false, accessPrivileges: 'none' } as never);
  await expect(findPhoneContact('Cole')).rejects.toMatchObject({ reason: 'permission' });
  expect(query).not.toHaveBeenCalled();
});

test('missing native modules report that a new app build is needed', async () => {
  jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
  await expect(findPhoneContact('Cole')).rejects.toMatchObject({ reason: 'unavailable' });
  expect(permission).not.toHaveBeenCalled();
});

test('limited access can find an allowed contact and explains an inaccessible name', async () => {
  permission.mockResolvedValue({ granted: true, accessPrivileges: 'limited' } as never);
  query.mockResolvedValueOnce([{ fullName: 'Cole', phones: [{ number: '+15555550101', label: 'mobile' }] }] as never);
  await expect(findPhoneContact('Cole')).resolves.toEqual({ name: 'Cole', number: '+15555550101' });
  expect(query).toHaveBeenCalledWith(['fullName', 'phones'], { name: 'Cole' });
  await expect(findPhoneContact('Camila')).rejects.toMatchObject({ reason: 'limited' });
});

test('a name absent from the fully accessible library remains a genuine no-match', async () => {
  await expect(findPhoneContact('Nobody')).resolves.toBeNull();
});

test('a matching contact without a number is distinguished from a missing contact', async () => {
  query.mockResolvedValue([{ fullName: 'Cole', phones: [] }] as never);
  await expect(findPhoneContact('Cole')).rejects.toMatchObject({ reason: 'noNumber' });
});

test('query failures do not expose native error details or pretend the person is absent', async () => {
  query.mockRejectedValueOnce(Error('private native details'));
  await expect(findPhoneContact('Cole')).rejects.toMatchObject({ reason: 'readFailed', message: 'contacts_readFailed' });
});

test('an exact name takes priority over a prefix match', async () => {
  query.mockResolvedValue([
    { fullName: 'Cole Work', phones: [{ number: '+15555550102' }] },
    { fullName: 'Cole', phones: [{ number: '+15555550101' }] },
  ] as never);
  await expect(findPhoneContact('Cole')).resolves.toEqual({ name: 'Cole', number: '+15555550101' });
});

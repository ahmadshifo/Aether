import { fetch as expoFetch } from 'expo/fetch';
// SDK 58 native sources explicitly implement redirect:error and credentials:omit.
// Android uses ForwardingCookieHandler; iOS uses HTTPCookieStorage.shared.
// Device persistence/revocation still needs physical verification.
export const nativeFetch = expoFetch as unknown as typeof fetch;

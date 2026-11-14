// "Am I connected?": checks the internet and the Aether server at the moment the user asks. Each check gets a
// few seconds; any answer from the server (even "please log in") means it is reachable. No user data is sent.
import { boundedFetch } from './config';
import { nativeFetch } from './network';

const INTERNET_PROBE = 'https://clients3.google.com/generate_204';
const TIMEOUT_MS = 3000;

async function reachable(url: string): Promise<boolean> {
  try { await boundedFetch(url, { method: 'GET' }, TIMEOUT_MS, nativeFetch); return true; } catch { return false; }
}

export async function checkConnectivity(backend: string): Promise<{ internet: boolean; server: boolean }> {
  const [internet, server] = await Promise.all([reachable(INTERNET_PROBE), reachable(`${backend}/api/v1/status`)]);
  return { internet, server };
}

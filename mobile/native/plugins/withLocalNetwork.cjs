const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');
function validHost(host) {
  if (/^[a-z\d-]+\.local$/i.test(host) || host === 'localhost') return true;
  const p = host.split('.').map(Number);
  return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && (p[0] === 10 || p[0] === 127 || p[0] === 192 && p[1] === 168 || p[0] === 172 && p[1] >= 16 && p[1] <= 31);
}
module.exports = (config, { host = '' } = {}) => {
  if (host && host !== 'any' && !validHost(host)) throw Error('AETHER_LAN_HOST must be any, one private IPv4 or a .local hostname');
  config = withAndroidManifest(config, result => {
    const app = result.modResults.manifest.application[0];
    app.$['android:usesCleartextTraffic'] = 'false';
    app.$['android:networkSecurityConfig'] = '@xml/aether_network_security';
    return result;
  });
  return withDangerousMod(config, ['android', async result => {
    const folder = path.join(result.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'aether_network_security.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<network-security-config><base-config cleartextTrafficPermitted="${host === 'any'}"/>${host && host !== 'any' ? `<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">${host}</domain><domain includeSubdomains="false">localhost</domain></domain-config>` : ''}</network-security-config>\n`);
    // Expo's template also sets a broad debug manifest flag; keep all variants narrow.
    for (const variant of ['debug', 'debugOptimized']) {
      const manifest = path.join(result.modRequest.platformProjectRoot, `app/src/${variant}/AndroidManifest.xml`);
      try { const xml = await fs.readFile(manifest, 'utf8'); await fs.writeFile(manifest, xml.replace(/android:usesCleartextTraffic="true"/g, 'android:usesCleartextTraffic="false"')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return result;
  }]);
};

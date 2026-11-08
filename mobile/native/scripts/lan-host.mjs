import net from 'node:net';
export function selectLanHost(interfaces, override) {
  const candidates = Object.entries(interfaces).flatMap(([name, entries]) => (entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.') && net.isIP(entry.address) === 4)
    .map(entry => ({ name, address: entry.address })));
  if (override) {
    const match = candidates.find(entry => entry.address === override);
    if (!match) throw Error('AETHER_LAN_HOST must be an IPv4 address assigned to this laptop.');
    return match;
  }
  const physical = candidates.filter(entry => !/vmware|vethernet|hyper-v|virtual|wsl|loopback|bluetooth|docker|vpn|tailscale|wireguard|tap-|tun\b/i.test(entry.name));
  physical.sort((a, b) => Number(/wi-?fi|wlan/i.test(b.name)) - Number(/wi-?fi|wlan/i.test(a.name)));
  if (!physical.length) throw Error('No usable LAN IPv4 address. Connect Wi-Fi or set AETHER_LAN_HOST to this laptop’s reachable address.');
  return physical[0];
}
export function mediaLanEnvironment(host) {
  if (net.isIP(host) !== 4) throw Error('Expected a LAN IPv4 address');
  return {
    MTX_WEBRTCADDITIONALHOSTS: host,
    MTX_WEBRTCIPSFROMINTERFACES: 'no',
    MTX_WEBRTCIPSFROMINTERFACESLIST: '',
    // Bind the ICE socket itself, avoiding virtual-adapter candidates on Windows.
    MTX_WEBRTCLOCALUDPADDRESS: `${host}:8189`,
    MTX_API: 'yes', MTX_APIADDRESS: '127.0.0.1:9997',
  };
}

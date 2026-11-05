#!/usr/bin/env bash
# Run on a Mac after npm ci. The resulting device IPA must be signed on installation.
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'This script needs macOS and Xcode (the GitHub workflow supplies them).' >&2
  exit 1
fi
cd "$(dirname "$0")/.."
root="$PWD"
out="$root/.runtime/ios-sideload"
mkdir -p "$out"
if [[ -e "$out/Payload" || -e "$out/Aether-development-unsigned.ipa" ]]; then
  echo 'Build output already exists. Use a fresh checkout/output directory.' >&2
  exit 1
fi

xcodebuild -version
node --version
pod --version
node scripts/expo.mjs prebuild --platform ios --no-install

# These overrides belong only to this development binary. The regular app config
# stays HTTPS-first. Camera's microphonePermission:false removes the microphone
# usage key during prebuild even though speech recognition needs it.
python3 - <<'PY'
from pathlib import Path
import plistlib

info = Path('ios/Aether/Info.plist')
with info.open('rb') as stream:
    data = plistlib.load(stream)
data['NSMicrophoneUsageDescription'] = 'Aether listens to spoken questions and, if enabled, for Hey Aether while the app is open.'
data['NSSpeechRecognitionUsageDescription'] = 'Aether uses system speech recognition to transcribe your questions.'
data['NSLocalNetworkUsageDescription'] = 'Connect to Metro, the Aether test server, and camera streaming on your laptop.'
# IP-based Metro and the private-LAN HTTP server need this in the dev binary.
# App endpoint validation still restricts user-configured HTTP origins to private hosts.
data['NSAppTransportSecurity'] = {'NSAllowsArbitraryLoads': True}
with info.open('wb') as stream:
    plistlib.dump(data, stream)
PY

(cd ios && pod install)
# Debug includes expo-dev-client and connects to Metro on the Windows laptop.
# Build for iphoneos/arm64, never the simulator; Sideloadly signs the app/frameworks.
xcodebuild \
  -workspace ios/Aether.xcworkspace \
  -scheme Aether \
  -configuration Debug \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$out/DerivedData" \
  -jobs 2 \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= \
  DEVELOPMENT_TEAM= \
  ARCHS=arm64 \
  ONLY_ACTIVE_ARCH=YES \
  COMPILER_INDEX_STORE_ENABLE=NO \
  build 2>&1 | tee "$out/xcodebuild.log"

app="$out/DerivedData/Build/Products/Debug-iphoneos/Aether.app"
test -d "$app"
python3 - "$app" <<'PY'
import plistlib
import subprocess
import sys
from pathlib import Path

app = Path(sys.argv[1])
with (app / 'Info.plist').open('rb') as stream:
    info = plistlib.load(stream)
assert 'iPhoneOS' in info['CFBundleSupportedPlatforms'], 'Not a physical-device build'
assert info.get('NSMicrophoneUsageDescription'), 'Microphone permission text missing'
assert info.get('NSSpeechRecognitionUsageDescription'), 'Speech permission text missing'
arch = subprocess.check_output(['lipo', '-archs', str(app / info['CFBundleExecutable'])], text=True)
assert 'arm64' in arch.split(), f'Wrong device architecture: {arch}'
print(f"Device app: {info['CFBundleIdentifier']}; architecture: {arch.strip()}")
PY
mkdir "$out/Payload"
ditto "$app" "$out/Payload/Aether.app"
ditto -c -k --keepParent "$out/Payload" "$out/Aether-development-unsigned.ipa"
(cd "$out" && shasum -a 256 Aether-development-unsigned.ipa > SHA256SUMS)
cat > "$out/INSTALL.txt" <<'TXT'
Aether iPhone development build (UNSIGNED)

1. Extract the artifact ZIP. Install Sideloadly from https://sideloadly.io/ on Windows.
2. Connect the unlocked iPhone by USB and approve Trust This Computer on the phone.
3. Open the IPA in Sideloadly. Sign in with your own Apple ID there and install.
   Apple credentials belong in Sideloadly/Apple prompts, never GitHub or chat.
4. Trust the developer under iPhone Settings > General > VPN & Device Management.
   Enable Developer Mode under Settings > Privacy & Security if requested; restart.
5. In mobile/native on the laptop run: npm run start:dev
   Stop an older Metro using port 8083 first; keep the laptop and phone on the same Wi-Fi.
6. Open Aether and connect to the development server shown by Metro.
   The app's Connection screen still needs the laptop's server/media addresses.
   The isolated test fixture uses port 18063; the shared backend uses port 8002.
   Only select a backend that you intentionally started; accounts are separate.

A free Apple ID normally needs re-signing every 7 days and allows 3 sideloaded apps.
This is a Debug development client, not a standalone production or App Store build.
Compilation does not verify installation, speech recognition, or camera streaming.
This binary permits local HTTP for development; app endpoint validation still applies.
TXT
echo "Unsigned IPA ready: $out/Aether-development-unsigned.ipa"

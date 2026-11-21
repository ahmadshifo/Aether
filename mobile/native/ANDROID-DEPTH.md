# Enable distance warnings on a Galaxy A53 5G

The new camera module needs a fresh Android development build. Install or update **Google Play Services for AR** from Google Play on the phone. Allow Aether to use the camera, microphone and speech recognition when prompted.

## Build and install once

On your own computer, install Node.js 22, JDK 17 and Android Studio with its Android SDK. Enable Developer options and USB debugging on the A53, connect it by USB, unlock it and accept the computer's debugging prompt.

From the Aether repository in PowerShell, run these commands after saving any local changes.

```powershell
git pull --ff-only origin main
cd mobile/native
npm.cmd ci
$env:AETHER_LAN_HOST = 'any'
node scripts/expo.mjs run:android --device --port 8083
```

Select the A53 when prompted. The first build downloads Android dependencies and can take time. Keep the terminal open. Future JavaScript changes usually only need `npm.cmd run start:dev` from `mobile/native`. Native module changes require another build.

## Connect to the team services

Use the team's running backend and MediaMTX. On a computer already configured with the team's MySQL/RustFS setup, `npm.cmd --prefix mobile/native run services:team` starts those services. See [TEAM-SETUP.md](TEAM-SETUP.md) for local setup.

Put the phone and computers on the same reachable network. Open the development server at `http://<Metro-computer-IP>:8083`. In Aether's Connection screen, use `http://<backend-computer-IP>:8002` and `http://<media-computer-IP>:8889`, enable **Allow private LAN HTTP**, and save. Use the actual IP addresses printed by the launchers. The backend must also run this revision for named-object distance questions.

## Try the feature

1. Start a session in a well-lit room. Move the phone gently sideways, then hold it steady toward a large matte object.
2. Nearby obstacle warnings are enabled by default in Settings. A sustained reading below two meters triggers a spoken warning. Vibration follows the existing Vibrate setting. Warnings check the area ahead of the phone and may miss low, thin or reflective objects.
3. Ask **“How far ahead?”** for an on-device reading. Center a closed door and ask **“How far is the door?”** to have the configured backend vision provider confirm the target and save the answer in MySQL History. English, Arabic and French are supported.
4. Check against a tape-measured distance, then test camera off, camera on and Stop session. Keep using your cane or guide dog for mobility.

The Galaxy A53 5G is listed as supporting the Depth API. The app also checks support at runtime and displays unavailable when the installed hardware/service cannot supply a reading. Physical A53 accuracy and installation still need testing. [Google's supported devices](https://developers.google.com/ar/devices)

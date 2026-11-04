// Keep Expo settings and compiler/cache scratch files inside this experiment.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = path.join(root, '.runtime/tmp');
const settings = path.join(root, '.runtime/expo-home');
mkdirSync(temporary, { recursive: true }); mkdirSync(settings, { recursive: true });
const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary,
    __UNSAFE_EXPO_HOME_DIRECTORY: settings, EXPO_NO_TELEMETRY: '1', EXPO_NO_GIT_STATUS: '1' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });

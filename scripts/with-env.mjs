// Run one service command with the same private root settings as npm start.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const [directory, executable, ...args] = process.argv.slice(2);
if (!directory || !executable) { console.error('Usage: node scripts/with-env.mjs SERVICE_DIR EXECUTABLE [ARGS]'); process.exit(1); }
process.loadEnvFile(path.join(root, '.env'));
const cwd = path.resolve(root, directory);
const command = executable.includes('/') || executable.includes('\\') ? path.resolve(cwd, executable) : executable;
const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env, windowsHide: true });
child.once('error', () => { console.error('Service executable could not start. Check installed dependencies.'); process.exit(1); });
child.once('exit', code => process.exit(code ?? 1));

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, '.env');
if (!fs.existsSync(target)) {
  const random = () => crypto.randomBytes(32).toString('hex');
  const values = { MYSQL_ROOT_PASSWORD: random(), MYSQL_PASSWORD: random(), JWT_SECRET: random(),
    S3_ACCESS_KEY_ID: random().slice(0, 20), S3_SECRET_ACCESS_KEY: random() };
  values.DATABASE_URL = `mysql+pymysql://aether:${values.MYSQL_PASSWORD}@127.0.0.1:3307/aether_multimedia?charset=utf8mb4`;
  const template = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  fs.writeFileSync(target, template.replace(/^(\w+)=(.*)$/gm, (line, key) => key in values ? `${key}=${values[key]}` : line), { mode: 0o600 });
  console.log('Created private root .env with random credentials. Existing native databases were not changed.');
} else console.log('Kept existing root .env.');
for (const dir of ['web/ai-backend', 'web/dashboard', 'multimedia/api', 'mobile/voice-service']) {
  const dest = path.join(root, dir, '.env');
  if (!fs.existsSync(dest)) fs.copyFileSync(path.join(root, dir, '.env.example'), dest);
}
console.log('Service .env files ready. Add vision credentials privately in the backend and multimedia files.');

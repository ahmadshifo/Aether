import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../../..');
const local = path.join(root, 'mobile/native');
const git = (...args) => execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8' }).trim();
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = {};
const skipped = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache', '.npm-cache', '.expo', 'bin', 'obj']);
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (absolute === local || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { if (!skipped.has(entry.name)) walk(absolute); }
    else {
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      const stat = fs.statSync(absolute);
      files[relative] = { size: stat.size, sha256: hash(absolute) };
    }
  }
}
walk(root);
const current = { branch: git('branch', '--show-current'), head: git('rev-parse', 'HEAD'),
  staged: git('diff', '--cached', '--name-status'), index: hash(path.join(root, '.git/index')),
  status: git('status', '--short', '--untracked-files=all').split('\n').filter(x => !x.includes('mobile/native/')), files };
const target = path.join(local, 'validation/artifacts');
fs.mkdirSync(target, { recursive: true });
const initial = path.join(target, 'baseline.json');
if (process.argv.includes('--record')) {
  if (fs.existsSync(initial)) throw Error('Baseline already exists');
  fs.writeFileSync(initial, JSON.stringify(current, null, 2));
  console.log(JSON.stringify({ branch: current.branch, head: current.head, protectedFiles: Object.keys(files).length }));
} else {
  const baseline = JSON.parse(fs.readFileSync(initial));
  const changes = [...new Set([...Object.keys(baseline.files), ...Object.keys(files)])]
    .filter(key => JSON.stringify(baseline.files[key]) !== JSON.stringify(files[key]));
  const gitUnchanged = ['branch', 'head', 'staged', 'index', 'status'].every(k => JSON.stringify(current[k]) === JSON.stringify(baseline[k]));
  const result = { checkedAt: new Date().toISOString(), gitUnchanged, protectedFiles: Object.keys(files).length, changes };
  fs.writeFileSync(path.join(target, 'final-boundaries.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!gitUnchanged || changes.length) process.exitCode = 1;
}

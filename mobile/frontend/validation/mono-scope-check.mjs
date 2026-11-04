// Read-only comparison with the pre-edit inventory. Does not modify Git or fixtures.
import assert from 'node:assert/strict'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'

const evidence = process.argv[2]
assert.ok(evidence, 'Pass the exact temporary preflight evidence directory')
const root = resolve('../..')
const baseline = JSON.parse((await readFile(join(evidence, 'baseline.json'), 'utf8')).replace(/^\uFEFF/, ''))
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex').toUpperCase()
const existingAllowed = new Set([
  'mobile/frontend/index.html', 'mobile/frontend/src/App.tsx', 'mobile/frontend/src/AuthScreen.tsx',
  'mobile/frontend/src/authCopy.ts', 'mobile/frontend/src/HistoryPage.tsx', 'mobile/frontend/src/EchoIcon.tsx',
  'mobile/frontend/src/index.css', 'mobile/frontend/src/uiCopy.ts',
  'mobile/frontend/validation/auth-browser-check.mjs', 'mobile/frontend/validation/browser-check.mjs',
])
const newAllowed = new Set([
  'mobile/frontend/src/components/ui/Brand.tsx', 'mobile/frontend/src/components/ui/Buttons.tsx',
  'mobile/frontend/src/components/ui/MonoShell.tsx', 'mobile/frontend/src/components/ui/monoCopy.ts',
  'mobile/frontend/src/styles/tokens.css', 'mobile/frontend/src/styles/base.css',
  'mobile/frontend/src/styles/screens.css', 'mobile/frontend/src/styles/responsive.css',
  'mobile/frontend/validation/mono-browser-check.mjs', 'mobile/frontend/validation/mono-scope-check.mjs',
  'mobile/frontend/UI-MONO-IMPLEMENTATION-NOTES.md',
])
const changed = [], unchanged = []
for (const entry of baseline.files) {
  const current = await hash(join(root, entry.path))
  if (current !== entry.hash) { assert.ok(existingAllowed.has(entry.path), `Protected path changed: ${entry.path}`); changed.push(entry.path) }
  else unchanged.push(entry.path)
}
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
assert.equal(git(['branch', '--show-current']), baseline.branch)
assert.equal(git(['rev-parse', 'HEAD']), baseline.head)
assert.equal(git(['diff', '--cached', '--name-only']), '')
assert.equal(await hash(join(root, '.git/index')), baseline.indexHash)
const beforePaths = new Set(baseline.files.map(entry => entry.path))
const added = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(path => path && !beforePaths.has(path))
added.forEach(path => assert.ok(newAllowed.has(path), `Unexpected new path: ${path}`))

function functionBodies(source, names) {
  const lines = source.replaceAll('\r\n','\n').split('\n')
  const found = {}
  for (const name of names) {
    const index = lines.findIndex(line => new RegExp(`^\\s*(?:async )?function ${name}\\(`).test(line))
    assert.ok(index >= 0, `Missing protected function ${name}`)
    const indent = lines[index].match(/^\s*/)[0]
    let end = index
    if (!lines[index].endsWith('}')) {
      end = lines.findIndex((line,i) => i > index && line === `${indent}}`)
      assert.ok(end > index)
    }
    found[name] = lines.slice(index,end+1).join('\n')
  }
  return found
}
const beforeApp = await readFile(join(evidence, 'App.before.tsx'), 'utf8')
const app = await readFile(join(root, 'mobile/frontend/src/App.tsx'), 'utf8')
const functions = ['captureFrame','stopCamera','startCamera','startSession','stopSession','changeLanguage','openHistory','closeHistory','updateStarting']
assert.deepEqual(functionBodies(app, functions), functionBodies(beforeApp, functions), 'Media/language/history function implementations changed')
function effects(source) {
  source=source.replaceAll('\r\n','\n')
  const first=source.slice(source.indexOf('  useEffect(() => {'),source.indexOf('  function stopCamera'))
  const ownership=source.slice(source.indexOf('  useEffect(() => {\n    const snapshots'),source.indexOf('  async function startSession'))
  assert.ok(first.includes('[language]') && ownership.includes('[repository, auth, session.owner]') && ownership.includes('[authorized, language]'))
  return [first,ownership]
}
assert.deepEqual(effects(app), effects(beforeApp), 'Lifecycle effect implementation or ordering changed')
function submission(source) {
  source=source.replaceAll('\r\n','\n')
  const start=source.indexOf('onSubmit={event => {')
  assert.ok(start>=0)
  return source.slice(start,source.indexOf('}}>',start)+3)
}
assert.equal(submission(await readFile(join(root,'mobile/frontend/src/AuthScreen.tsx'),'utf8')), submission(await readFile(join(evidence,'AuthScreen.before.tsx'),'utf8')))
const privateEnv = await stat(join(root,'mobile/frontend/.env.local'))
const report = { branch: baseline.branch, head: baseline.head, changed, added, unchangedCount: unchanged.length,
  protectedCount: baseline.files.filter(entry => !existingAllowed.has(entry.path)).length,
  mediaFunctionsUnchanged: functions, lifecycleEffectsUnchanged: 4, authSubmissionUnchanged: true,
  gitIndexUnchanged: true, stagedPaths: [], envLocalLastWriteUtc: privateEnv.mtime.toISOString(),
  preExistingArtifactsPreserved: unchanged.filter(path => path.startsWith('mobile/frontend/validation/')).length }
await writeFile(join(evidence,'final-audit.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))

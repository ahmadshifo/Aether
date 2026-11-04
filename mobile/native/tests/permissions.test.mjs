import test from 'node:test';
import assert from 'node:assert/strict';
import { duringPermission, permissionPending } from '../src/platform/permissions.ts';
test('native permission prompts serialize; Stop cancels a queued prompt before OS acquisition', async () => {
  let release, acquired = false;
  const first = duringPermission(() => new Promise(resolve => { release = resolve; }));
  const controller = new AbortController();
  const second = duringPermission(async () => { acquired = true; }, controller.signal);
  const rejected = assert.rejects(second, /cancelled/);
  await Promise.resolve(); await Promise.resolve(); assert.equal(permissionPending(), true);
  controller.abort(); release('granted'); assert.equal(await first, 'granted'); await rejected;
  assert.equal(acquired, false); assert.equal(permissionPending(), false);
});

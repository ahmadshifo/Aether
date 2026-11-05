import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantLayout } from '../src/screens/assistantLayout.ts';

test('portrait camera takes 80–85% of the screen, including notched iPhones and Android', () => {
  for (const [height, bottom] of [[667, 0], [812, 34], [852, 34], [874, 34], [932, 34], [800, 24]]) {
    const layout = assistantLayout(height, bottom, 1);
    assert.ok(layout.camera / height >= .8 && layout.camera / height <= .85);
    assert.equal(layout.camera + layout.controls, height);
    assert.ok(layout.controls - bottom >= 64);
  }
});
test('large text and landscape reserve accessible controls instead of forcing the camera ratio', () => {
  for (const [height, bottom, scale] of [[375, 21, 1], [667, 34, 2], [402, 21, 3]]) {
    const layout = assistantLayout(height, bottom, scale);
    assert.ok(layout.controls >= 56 * scale + bottom + 16);
    assert.ok(layout.camera >= 0);
    assert.equal(layout.camera + layout.controls, height);
  }
});

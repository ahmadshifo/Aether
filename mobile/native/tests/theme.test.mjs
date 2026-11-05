import test from 'node:test';
import assert from 'node:assert/strict';
import { dark, light, parseThemeMode, resolveScheme } from '../src/theme/tokens.ts';

const luminance = hex => {
  const channels = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the chosen mode wins over the phone, and Phone follows it', () => {
  assert.equal(resolveScheme('dark', 'light'), 'dark');
  assert.equal(resolveScheme('light', 'dark'), 'light');
  assert.equal(resolveScheme('system', 'dark'), 'dark');
  assert.equal(resolveScheme('system', 'light'), 'light');
  assert.equal(resolveScheme('system', null), 'light');
});

test('a missing or unknown saved mode follows the phone', () => {
  assert.equal(parseThemeMode('dark'), 'dark');
  assert.equal(parseThemeMode(null), 'system');
  assert.equal(parseThemeMode('sepia'), 'system');
});

for (const [name, colors] of [['light', light], ['dark', dark]]) {
  test(`${name}: text reaches 4.5:1 on every surface it sits on`, () => {
    for (const surface of ['bg', 'card', 'inset']) {
      assert.ok(contrast(colors.ink, colors[surface]) >= 4.5, `ink on ${surface}`);
      assert.ok(contrast(colors.muted, colors[surface]) >= 4.5, `muted on ${surface}`);
    }
    assert.ok(contrast(colors.onTactile, colors.tactile) >= 4.5, 'primary button label');
    assert.ok(contrast(colors.danger, colors.dangerBg) >= 4.5, 'danger text');
    assert.ok(contrast(colors.warn, colors.warnBg) >= 4.5, 'notice text');
  });

  test(`${name}: the Aether mark and primary buttons stand out from the page`, () => {
    for (const surface of ['bg', 'card', 'inset']) {
      assert.ok(contrast(colors.ink, colors[surface]) >= 3, `mark on ${surface}`);
      assert.ok(contrast(colors.tactile, colors[surface]) >= 3, `primary button on ${surface}`);
    }
    assert.ok(contrast(colors.bg, colors.ink) >= 3, 'mark bars');
  });
}

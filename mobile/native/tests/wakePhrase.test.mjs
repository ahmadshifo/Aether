import test from 'node:test';
import assert from 'node:assert/strict';
import { heardWakeWord } from '../src/voice/wakePhrase.ts';
test('wake phrase matches its common spellings, not ordinary speech', () => {
  for (const heard of ['Hey Aether', 'hey ether', 'Hey Ether open', 'Hay Either', 'hi aether', 'Hey Ethan', 'Hey Acer', 'Hey sir', ' Hey eater', 'Hey, Aether', 'Heather']) assert.equal(heardWakeWord(heard), true, heard);
  for (const heard of ['Hi', 'Hey', 'I like either one', 'hello there', 'hey there', 'hey other', 'aether', 'sir', 'Acer laptop', 'We can see how low localization']) assert.equal(heardWakeWord(heard), false, heard);
});
test('wake phrase matches across two results, only when they join up', () => {
  assert.equal(heardWakeWord('Ether', 'Hey'), true);
  assert.equal(heardWakeWord('Hey Eth', 'Hey'), false);
  assert.equal(heardWakeWord('We', 'Hey'), false);
});

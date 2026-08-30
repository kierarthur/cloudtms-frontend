import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve('js/main.js'), 'utf8');

test('all weekly schedule renderers accept canonical start_time and end_time aliases', () => {
  const definitions = [...source.matchAll(/const normHHMM = \(seg, keyHH, keyIso\) => \{([\s\S]*?)\n\s*\};/g)];
  assert.equal(definitions.length, 3);

  for (const [, body] of definitions) {
    assert.match(body, /seg\?\.\[`\$\{keyHH\}_time`\]/);
    assert.match(body, /seg\?\.\[`\$\{keyHH\}_local`\]/);
  }
});

test('an electronic schedule row without duplicate start/end fields remains visible', () => {
  const normalise = (seg, keyHH) => String(
    seg?.[keyHH] ||
    seg?.[`${keyHH}_time`] ||
    seg?.[`${keyHH}_local`] ||
    ''
  ).trim();

  const stored = {
    date: '2026-07-28',
    start_time: '09:00',
    end_time: '17:00',
    break_start: '13:00',
    break_end: '14:00',
    break_minutes: 60
  };

  assert.equal(normalise(stored, 'start'), '09:00');
  assert.equal(normalise(stored, 'end'), '17:00');
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const main = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

test('production modal and API diagnostics are opt-in', () => {
  assert.match(main, /window\.__LOG_MODAL\s*=\s*false;/);
  assert.match(main, /const __LOG_API\s*=\s*false;/);
  assert.doesNotMatch(main, /window\.__LOG_MODAL\s*=\s*true;/);
  assert.doesNotMatch(main, /const __LOG_API\s*=\s*true;/);
});

test('authFetch reads response bodies for diagnostics only when API logging is enabled', () => {
  const start = main.indexOf('async function authFetch(input, init = {})');
  const end = main.indexOf('\nfunction ', start + 1);
  const source = main.slice(start, end > start ? end : start + 24000);

  assert.ok(start >= 0, 'authFetch must exist');
  assert.match(source, /const APILOG\s*=/);
  assert.match(source, /if \(APILOG\) \{/);
  assert.match(source, /res\.clone\(\)\.text\(\)/);
  assert.ok(
    source.indexOf('if (APILOG) {') < source.indexOf('res.clone().text()'),
    'response cloning must remain behind the disabled-by-default APILOG fence'
  );
});

test('diagnostic flags remain explicitly opt-in at runtime', () => {
  assert.match(main, /typeof window !== 'undefined' && !!window\.__LOG_API/);
  assert.match(main, /window\.__LOG_MODAL === true/);
});

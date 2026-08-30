const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
const oracle = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/banking-pay-legacy-display-oracle.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8').replaceAll('\r\n', '\n');
for (const snippet of oracle.snippets) test(`frozen legacy oracle remains exact: ${snippet.name}`, () => {
  assert.equal(createHash('sha256').update(snippet.source).digest('hex'), snippet.sha256);
  assert.ok(source.includes(snippet.source), `Legacy ${snippet.name} changed: assess and deliberately recapture the oracle, never silently weaken parity.`);
});

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

test('every Contract delete path uses the branded confirmation modal', () => {
  const legacyPrompt = "window.confirm('Do you want to permanently delete this contract?')";
  assert.equal(source.includes(legacyPrompt), false, 'native Contract deletion confirmation must not remain');

  const confirmationCalls = source.match(/title:\s*'Delete Contract\?'/g) || [];
  assert.equal(confirmationCalls.length, 2, 'both Contract delete entry points must use the branded confirmation');
  assert.equal((source.match(/kind:\s*'contract-delete-confirm'/g) || []).length, 2);
  assert.equal((source.match(/cancel_label:\s*'Keep Contract'/g) || []).length, 2);
  assert.equal((source.match(/message:\s*'Permanently delete this Contract\? This cannot be undone\.'/g) || []).length, 2);
});

test('Contract deletion remains gated on an explicit confirmed result', () => {
  const confirmations = source.match(/if \(!\(confirmation && confirmation\.confirmed === true\)\) return;/g) || [];
  assert.ok(confirmations.length >= 2, 'deletion must not continue on close, cancel or an indeterminate result');
});

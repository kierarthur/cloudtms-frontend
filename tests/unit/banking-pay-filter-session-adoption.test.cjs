const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

test('Banking Pay filter save fails closed unless the new session context is adopted', () => {
  const start = source.indexOf('async function openBankingPayFiltersModal');
  const end = source.indexOf('\nasync function openBankingPay', start);
  assert.ok(start >= 0 && end > start, 'Banking Pay filters modal function must be present');
  const body = source.slice(start, end);

  assert.match(body, /const resetOutcome = await resetPayPreviewAndDecisions/);
  assert.match(body, /resetOutcome\?\.ok === false/);
  assert.match(body, /!adoptedSessionId/);
  assert.match(body, /previousSessionId && adoptedSessionId === previousSessionId/);
  assert.match(body, /BANKING_PAY_FILTER_SESSION_NOT_ADOPTED/);
  assert.match(body, /The previous payment preview remains unchanged; please try again\./);
});

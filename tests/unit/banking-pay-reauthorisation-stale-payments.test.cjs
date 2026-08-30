const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'js', 'main.js'), 'utf8');

test('reauthorisation freshness failures name affected payments and give an actionable recovery path', () => {
  assert.match(source, /Reauthorisation blocked by changed payments/);
  assert.match(source, /candidate_tms_ref/);
  assert.match(source, /candidate_display_name/);
  assert.match(source, /client_name/);
  assert.match(source, /week_ending_date/);
  assert.match(source, /payment_amount/);
  assert.match(source, /<th style="padding:8px;">Candidate<\/th>/);
  assert.match(source, /<th style="padding:8px;">Client<\/th>/);
  assert.match(source, />Week ending<\/th>/);
  assert.match(source, />Amount<\/th>/);
  assert.match(source, />Why it failed<\/th>/);
  assert.match(source, /Remove or resolve every payment listed, then reauthorise the remaining batch/);
  assert.match(source, /If these are the only freshness failures, reauthorisation can proceed/);
  assert.match(source, /Additional failures exist/);
  assert.doesNotMatch(source, /item\.description \|\| item\.source_ref/);
});

test('freshness reason codes are converted to plain-English explanations', () => {
  assert.match(source, /PAY_BATCH_ITEM_MISSING: 'The frozen payment item is no longer available\.'/);
  assert.match(source, /AMOUNT_INC_VAT_CHANGED: 'The frozen total amount changed\.'/);
  assert.match(source, /ACTIVE_SNOOZE_CHANGED: 'A current Snooze now blocks this payment\.'/);
});

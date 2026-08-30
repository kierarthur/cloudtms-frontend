const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const main = fs.readFileSync(path.resolve(__dirname, '..', '..', 'js', 'main.js'), 'utf8');

const canonicalOptions = [
  ['NO_MATCH_ID', 'Candidate/client missing'],
  ['RATE_MISSING', 'Rate missing'],
  ['PAY_CHAN_MISS', 'Pay channel missing'],
  ['ON_HOLD', 'On hold'],
  ['HR_HOURS_MISMATCH', 'Hours mismatch (HealthRoster)'],
  ['HR_HOURS_MISSING', 'HR hours missing'],
  ['DUPLICATE_CONTRACTS', 'Duplicate contracts'],
  ['EXPENSES_EVIDENCE', 'Expenses evidence missing'],
  ['MILEAGE_EVIDENCE', 'Mileage evidence missing'],
  ['REFS_MISSING', 'Refs missing'],
  ['AWAITING_VALIDATION', 'Awaiting validation'],
  ['VALIDATION_FAILED', 'Validation failed'],
  ['PAIRED_NEEDS_INVOICING', 'Paired needs invoicing'],
  ['OVERPAID', 'Overpaid']
];

test('both timesheet Issues menus expose only canonical working issue filters', () => {
  for (const [value, label] of canonicalOptions) {
    assert.ok(main.includes(`value=\"${value}\">${label}`) || main.includes(`['${value}',`), `${value} is missing`);
  }
  for (const removed of [
    'TIMESHEET_EVIDENCE', 'REFERENCE_MISSING', 'REFS_PDF_INVALID',
    'QR_NOT_ISSUED', 'QR_AWAITING_SIGNATURE', 'AWAITING_HR_VALIDATION'
  ]) {
    assert.doesNotMatch(main, new RegExp(`<option value=\"${removed}\"|\\['${removed}',`));
  }
});

test('issue-free rows render a blank Issues cell rather than OK', () => {
  assert.doesNotMatch(main, /ok\.textContent = 'OK'/);
});

test('required reference and pair hints use the agreed plain language', () => {
  assert.match(main, /A required reference is missing\./);
  assert.match(main, /This paired timesheet needs invoicing\. The other timesheet is attached to an invoice, this timesheet needs attaching as soon as possible/);
});

test('overpaid presentation requires the server-proven badge token', () => {
  const showOverpaidDefinitions = main.match(/showOverpaid:\s*\n\s*paymentTokens\.has\('__PAY_BADGE_OVERPAID__'\)/g) || [];
  assert.equal(showOverpaidDefinitions.length, 3);
});

test('paid and partly-paid coin renderers are preserved', () => {
  assert.ok((main.match(/payStatus === 'PAID'\) iconCode = 'COIN'/g) || []).length >= 3);
  assert.ok((main.match(/payStatus === 'PARTIALLY_PAID'\) iconCode = 'HALF_COIN'/g) || []).length >= 3);
  assert.ok((main.match(/linear-gradient\(90deg, #d4af37 0%, #d4af37 50%/g) || []).length >= 3);
});

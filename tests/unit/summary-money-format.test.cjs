const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
const startMarker = '// SUMMARY_MONEY_FORMAT_START';
const endMarker = '// SUMMARY_MONEY_FORMAT_END';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

assert.notEqual(start, -1, 'money-format start marker must exist');
assert.notEqual(end, -1, 'money-format end marker must exist');

const context = { window: {}, Set, Object, String, Number };
vm.runInNewContext(source.slice(start + startMarker.length, end), context, {
  filename: 'summary-money-format.js'
});

test('summary money values always display exactly two decimal places', () => {
  const format = context.window.formatSummaryMoneyValue;
  assert.equal(format(31.3), '31.30');
  assert.equal(format(31.03), '31.03');
  assert.equal(format(31), '31.00');
  assert.equal(format(0), '0.00');
  assert.equal(format(-30), '-30.00');
  assert.equal(format(-87.5), '-87.50');
  assert.equal(format('2012.5'), '2012.50');
  assert.equal(format(null), '—');
});

test('only money columns in Timesheets and Invoices summaries use money formatting', () => {
  const isMoney = context.window.isSummaryMoneyColumn;
  assert.equal(isMoney('timesheets', 'total_pay_ex_vat'), true);
  assert.equal(isMoney('timesheets', 'margin_ex_vat'), true);
  assert.equal(isMoney('timesheets', 'pay_rate_day'), true);
  assert.equal(isMoney('invoices', 'subtotal_ex_vat'), true);
  assert.equal(isMoney('invoices', 'vat_amount'), true);
  assert.equal(isMoney('invoices', 'balance_outstanding'), true);
  assert.equal(isMoney('timesheets', 'total_hours'), false);
  assert.equal(isMoney('invoices', 'vat_rate_pct'), false);
  assert.equal(isMoney('invoices', 'invoice_no'), false);
  assert.equal(isMoney('candidates', 'margin_ex_vat'), false);
});

test('summary row renderer routes recognised money cells through the fixed formatter', () => {
  assert.match(
    source,
    /else if \(isSummaryMoneyColumn\(currentSection, c\)\) \{[\s\S]*?td\.textContent = formatSummaryMoneyValue\(v\);/
  );
});

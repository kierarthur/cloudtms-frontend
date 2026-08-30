const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

test('ready-to-pay breakdown uses authoritative payable remainder for clamped worked-time rows', () => {
  assert.match(
    mainSource,
    /const getPayOutstandingClampAmounts = \(row\) => \{[\s\S]*pay_outstanding_available_ex_vat[\s\S]*return \{\s*clamped: true,\s*original,\s*remaining,\s*accounted\s*\};/
  );
  assert.match(
    mainSource,
    /const payableAmountHtml = clampAmounts\.clamped[\s\S]*fmtMoney\(clampAmounts\.remaining\)[\s\S]*payable[\s\S]*fmtMoney\(clampAmounts\.original\)[\s\S]*original/
  );
});

test('multi-segment clamped rows do not invent a payable allocation per segment', () => {
  assert.match(
    mainSource,
    /segment_index: index,[\s\S]*segment_count: operationalRows\.length/
  );
  assert.match(
    mainSource,
    /segmentIndex === 0[\s\S]*segmentCount > 1[\s\S]*Total for this component[\s\S]*Included above/
  );
});

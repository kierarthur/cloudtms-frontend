const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing start marker: ${startMarker}`);
  assert.ok(end > start, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('Banking uses a dedicated responsive modal shell and removes it on dismiss', () => {
  const open = slice("async function openBanking(startTabKey = 'pay')", 'function buildTimesheetSummaryFilterSpec');
  assert.match(open, /const MODAL_CLASS = 'banking-modal'/);
  assert.match(open, /classList\.add\(MODAL_CLASS\)/);
  assert.match(open, /classList\.remove\(MODAL_CLASS\)/);
  assert.match(index, /#modal\.banking-modal\{[\s\S]*?width:min\(1520px,calc\(100vw - 20px\)\)/);
  assert.match(index, /#modal\.banking-modal \.modal-b > #modalBody\{[\s\S]*?overflow-x:hidden;[\s\S]*?overflow-y:auto;/);
});

test('wide Banking tables are contained by their own scroll hosts', () => {
  const wizard = slice('function renderPayNewBatchWizard()', 'function deriveBankingAttentionStateFromBatchList');
  assert.match(wizard, /width:100%;max-width:100%;min-width:0;box-sizing:border-box/);
  assert.match(wizard, /id="bankingPayReadyScrollHost"/);
  assert.match(index, /#modal\.banking-modal #bankingPayReadyScrollHost,[\s\S]*?max-width:100%;[\s\S]*?overflow:auto;/);

  const batches = slice('function renderPayBatchListPanel()', 'function deriveTimesheetModalInvoicingState');
  assert.match(batches, /class="banking-pay-batch-table-scroll"/);
  assert.match(batches, />Type<\/th>/);
  assert.match(batches, />Status<\/th>/);
  assert.match(batches, />Timing<\/th>/);
  assert.match(batches, />Route<\/th>/);
  assert.match(batches, />Timesheets<\/th>/);
  assert.match(batches, />Actions<\/th>/);
});

test('the responsive asset has an explicit cache-busting release marker', () => {
  assert.match(index, /banking-responsive-layout=20260807-r1/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const moduleSource = () => fs.readFileSync(path.join(root, 'js', 'banking-pay-modal-v2.js'), 'utf8');
const source = (name) => fs.readFileSync(path.join(root, 'js', name), 'utf8');
const mainSource = () => fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const htmlSource = () => fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('main candidate table is exactly four columns and one non-expandable row per candidate', () => {
  const table = source('banking-pay-modal-v2-table.js');
  assert.match(table, /<th[^>]*>\s*<label[^>]*>\s*<input[^>]*>Include<\/label><\/th>/);
  assert.match(table, />Candidate<\/button>/);
  assert.match(table, />Deductions<\/button>/);
  assert.match(table, />Ready to pay<\/button>/);
  assert.match(table, /data-banking-pay-v2-candidate-row/);
  assert.doesNotMatch(table, /View (?:breakdown|details)/i);
  assert.doesNotMatch(table, /data-banking-pay-v2-expand/);
  assert.doesNotMatch(table, /<th[^>]*>\s*Timesheets\s*<\/th>/i);
  assert.doesNotMatch(table, /candidate-search|search candidates/i);
});

test('selected-only amount, deduction and Timesheet wording is explicit', () => {
  const combined = source('banking-pay-modal-v2-table.js') + source('banking-pay-modal-v2-copy.js');
  assert.match(combined, /selected_display_amount/);
  assert.match(combined, /selected_deduction_exists/);
  assert.match(combined, /selected_timesheet_count/);
  assert.match(combined, /No Ready Timesheet is linked to this candidate's selected payments\./);
  assert.equal(require(path.join(root, 'js', 'banking-pay-modal-v2-table.js')).formatAmount('0.00'), '£0.00');
  assert.match(combined, /aria-checked.*mixed/);
});

test('the v2 surface has dedicated Candidate Banking, Action Required and Blocked modal owners', () => {
  const combined = [
    'banking-pay-modal-v2.js',
    'banking-pay-modal-v2-candidate.js',
    'banking-pay-modal-v2-issues.js',
    'banking-pay-modal-v2-issue-detail.js',
    'banking-pay-modal-v2-integration.js',
    'banking-pay-modal-v2-copy.js'
  ].map(source).join('\n');
  assert.match(combined, /Candidate Banking/);
  assert.match(combined, /Action Required/);
  assert.match(combined, /Blocked for Pay/);
  assert.match(combined, /Updating/);
  assert.match(combined, /Insufficient funds to deduct/);
  const copy = fs.readFileSync(path.join(root, 'js', 'banking-pay-modal-v2-copy.js'), 'utf8');
  assert.match(copy, /Payment was originally PAYE\. Candidate is now paid through an umbrella company\./);
  assert.match(copy, /Payment was originally through an umbrella company\. Candidate is now PAYE\./);
  const legacyDetails = source('banking-pay-modal-v2-details-legacy.js');
  assert.match(legacyDetails, /Payment was originally PAYE\. Candidate is now paid through an umbrella company\./);
  assert.match(legacyDetails, /Payment was originally through an umbrella company\. Candidate is now PAYE\./);
  assert.doesNotMatch(legacyDetails, /currently determined as .* needs resolution to convert/i);
  assert.doesNotMatch(combined, /Insufficient recovery headroom/i);
});

test('Candidate Banking separates the full and selected group amounts without changing their authority', () => {
  const candidate = source('banking-pay-modal-v2-candidate.js');
  const css = fs.readFileSync(path.join(root, 'css', 'banking-pay-modal-v2.css'), 'utf8');
  assert.match(candidate, /wrapper\.className='bpv2-ready-group-amount'/);
  assert.match(candidate, /selected\.className='mini bpv2-ready-group-selected'/);
  assert.match(css, /\.bpv2-ready-group-selected\{grid-column:1 \/ -1/);
});

test('main.js delegates v2 actions while retaining every legacy Banking Pay handler', () => {
  const main = mainSource();
  assert.ok(main.includes('CloudTMSBankingPayModalV2'), 'main asset must delegate to the contained v2 controller');
  for (const action of [
    'banking:pay:createDraft',
    'banking:pay:togglePreviewRow',
    'banking:pay:toggleAllReadyPreviewRows',
    'banking:pay:viewRowTimesheets',
    'banking:pay:clearAllDecisions',
    'banking:pay:openFiltersModal'
  ]) assert.ok(main.includes(action), `legacy action retained: ${action}`);
  const html = htmlSource();
  assert.match(html, /banking-pay-modal-v2\.css\?v=20260830-r1/);
  assert.match(html, /banking-pay-modal-v2-integration\.js\?v=20260830-r2/);
  const integrationIndex = html.indexOf('./js/banking-pay-modal-v2-integration.js');
  const mainIndex = html.indexOf('./js/main.js');
  assert.ok(integrationIndex >= 0 && mainIndex > integrationIndex, 'the capability-gated integration must load before main.js');
  assert.ok(main.includes('CloudTMSBankingPayModalV2Integration.afterRender'));
  assert.ok(main.includes('dispatch,'), 'the unchanged delegated handler is exposed to the contained integration');
});

test('Banking navigation and confirmed Draft success follow the settled four-sheet and exact-batch handoff policy', () => {
  const main = mainSource();
  const menuStart = main.indexOf("menu.id = '__bankingMenu'");
  const menuEnd = main.indexOf('document.body.appendChild(menu)', menuStart);
  assert.ok(menuStart >= 0 && menuEnd > menuStart, 'the discreet Banking destination menu must exist');
  const menu = main.slice(menuStart, menuEnd);
  for (const destination of ['Banking Pay', 'Payment Batches', 'Loans and Snoozes', 'Invoice Discounting']) {
    assert.match(menu, new RegExp(`>${destination}<`));
  }
  assert.doesNotMatch(menu, />ID History</);

  const tabsStart = main.indexOf('const tabs = [', main.indexOf('async function openBanking'));
  const tabsEnd = main.indexOf('];', tabsStart);
  assert.ok(tabsStart >= 0 && tabsEnd > tabsStart, 'the outer Banking tab list must exist');
  const tabs = main.slice(tabsStart, tabsEnd);
  assert.match(tabs, /label: 'Banking Pay'[\s\S]*label: 'Payment Batches'[\s\S]*label: 'Loans \/ Snoozes'[\s\S]*label: 'Invoice Discounting'/);
  assert.doesNotMatch(tabs, /label: 'ID History'/);

  const handoffStart = main.indexOf('function handoffSuccessfulBankingPayDraftToBatch');
  const handoffEnd = main.indexOf('function renderBankingTab', handoffStart);
  assert.ok(handoffStart >= 0 && handoffEnd > handoffStart, 'the confirmed-success presentation handoff must exist');
  const handoff = main.slice(handoffStart, handoffEnd);
  assert.match(handoff, /__draft_create_success_handoff_keys/);
  assert.match(handoff, /frame\.setTab\('payment_batches'\)/);
  assert.match(handoff, /openBankingPayBatchChildModal\(ids\[0\]/);
  assert.match(handoff, /if \(!state \|\| !wizard \|\| !ids\.length\) return/);
  assert.match(handoff, /finally \{\s*try \{ frame\._suppressDirty = false/);
  assert.match(main, /\['pay_batch_id', 'payBatchId', 'primary_pay_batch_id', 'primaryPayBatchId'\]/,
    'the server-designated primary batch remains first in the exact ordered result');
});

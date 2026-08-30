const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

function sliceBetween(start, end) {
  const from = mainSource.indexOf(start);
  const to = mainSource.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return mainSource.slice(from, to);
}

test('cancel modal has no session-discard choice or technical session wording', () => {
  const modal = sliceBetween(
    'async function openPayBatchPasswordConfirmModal',
    'async function openUiPromptModal'
  );

  assert.doesNotMatch(modal, /discard_session|defaultDiscardSession|bankingCancelDiscardSession/);
  assert.doesNotMatch(modal, /Discard the staged workbench session/);
  assert.match(modal, /Cancelling returns the draft items to Banking Pay/);
  assert.match(modal, /refreshes each affected candidate using their current pay and finance position/);
  assert.match(modal, /finish\(\{ password: pw, reason \}\)/);
  assert.match(modal, /width:min\(100%,720px\);min-width:0/);
  assert.doesNotMatch(modal, /min-width:360px/);
});

test('cancel request keeps the workbench context server-controlled', () => {
  const flow = sliceBetween(
    'async function runBankingPayBatchCancelFlow',
    'function isBulkAuthoriseEditableDirty'
  );

  assert.doesNotMatch(flow, /creds\.discard_session|discard_session:/);
  assert.match(flow, /source_workbench_session_id/);
  assert.match(flow, /expected_source_session_version/);
  assert.match(flow, /PRE_PROVIDER_CANCEL_AND_RECALCULATE/);
});

test('draft cancellation uses the payment-reversal ceremony and the strict draft endpoint', () => {
  const flow = sliceBetween(
    'async function runBankingPayBatchCancelFlow',
    'function isBulkAuthoriseEditableDirty'
  );
  const request = sliceBetween(
    'async function bankingPayCancelNotSentAndRecalculate',
    'async function bankingPayConfirmNoMoneyAndUnwind'
  );

  assert.match(flow, /isDraftDeleteMode && typeof openBankingReauthModal === 'function'/);
  assert.match(flow, /purpose: 'PAYMENT_REVERSAL'/);
  assert.match(flow, /draft_cancel_request: true,\s*reauth_token: reauthToken/);
  assert.match(request, /isDraftCancelRequest \? 'cancel' : 'cancel-not-sent-recalculate'/);
  assert.match(request, /isDraftCancelRequest\s*\? \{ reauth_token:/);
});

test('cancellation authentication modals remain interactive under the shared modal framework', () => {
  const reauthModal = sliceBetween(
    'async function openBankingReauthModal',
    'async function openPayBatchPasswordConfirmModal'
  );
  const passwordModal = sliceBetween(
    'async function openPayBatchPasswordConfirmModal',
    'async function openUiPromptModal'
  );

  assert.match(reauthModal, /noParentGate: true,\s*forceEdit: true,/);
  assert.match(reauthModal, /const parentModalCtx/);
  assert.match(reauthModal, /restoreParentModalCtx/);
  assert.match(passwordModal, /noParentGate: true,\s*forceEdit: true,/);
});

test('same-week PAYE draft cancellation repaints the intact Banking modal', () => {
  const flow = sliceBetween(
    'async function bankingPayCreateDraft',
    'async function openPayeSameWeekOverrideDecisionModal'
  );

  assert.match(flow, /const finishCancelledCreateDraft = async \(resultLike\) =>/);
  assert.match(flow, /wiz\.createDraftBusy = false/);
  assert.match(flow, /activeModalContext === sourceModalContext/);
  assert.match(flow, /await bankingRerender\(null\)/);
  assert.match(flow, /return await finishCancelledCreateDraft\(actionDecision\.result\)/);
  assert.match(flow, /return await finishCancelledCreateDraft\(finalSubmissionCancelledResult\)/);
});

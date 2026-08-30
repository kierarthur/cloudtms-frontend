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

test('Banking Pay lifecycle trace is bounded, TEST-only and uses an explicit safe-field allowlist', () => {
  const trace = sliceBetween(
    "const BANKING_PAY_LIFECYCLE_TRACE_CONTRACT",
    'async function bankingPayBatchesList'
  );

  assert.match(trace, /BANKING_PAY_LIFECYCLE_TRACE_R1/);
  assert.match(trace, /BANKING_PAY_LIFECYCLE_TRACE_MAX_EVENTS = 200/);
  assert.match(trace, /hostname === 'testmode\.arthur-rai\.co\.uk'/);
  assert.match(trace, /hostname\.endsWith\('\.testmode\.arthur-rai\.co\.uk'\)/);
  assert.match(trace, /const stringKeys = \['source', 'phase', 'action', 'result', 'reason'\]/);
  assert.match(trace, /const numberKeys = \[/);
  assert.match(trace, /const booleanKeys = \['stale_response', 'financial_complete', 'visible'\]/);
  assert.doesNotMatch(trace, /\.\.\.source/);
  assert.doesNotMatch(trace, /password|reauth_token|access_token|refresh_token|cookie|authorization|payload|candidate_id|pay_batch_id|request_id/i);
  assert.match(trace, /readBankingPayLifecycleTrace/);
  assert.match(trace, /clearBankingPayLifecycleTrace/);
});

test('parent list and child payment-status limits are traced separately without changing allowed child limits', () => {
  const parentList = sliceBetween(
    'async function bankingPayBatchesList',
    'async function bankingPayBatchGet'
  );
  const childStatus = sliceBetween(
    'async function bankingPayPaymentStatusPage',
    'const BANKING_PAY_STAGE3_STATUS_ACTIONS'
  );

  assert.match(parentList, /parent-list-request/);
  assert.match(parentList, /parent-list-response-stale/);
  assert.match(parentList, /parent-list-response-adopted/);
  assert.match(parentList, /listLoadSequence/);
  assert.match(childStatus, /child_requested_limit: requestedLimit/);
  assert.match(childStatus, /child_effective_limit: limit/);
  assert.match(childStatus, /const allowedLimits = new Set\(\[25, 50, 75, 100\]\)/);
  assert.match(childStatus, /allowedLimits\.has\(requestedLimit\) \? requestedLimit : 25/);
});

test('all known parent page-size writers and cancellation refresh paths emit source-labelled events', () => {
  const handlers = sliceBetween(
    'function attachBankingModalDelegatedHandlers',
    'function openAudit'
  );

  for (const source of [
    'attachBankingModalDelegatedHandlers.refreshBankingPayAll',
    'attachBankingModalDelegatedHandlers.setPageSize',
    'attachBankingModalDelegatedHandlers.listNavigation',
    'attachBankingModalDelegatedHandlers.cancelSuccess'
  ]) {
    assert.match(handlers, new RegExp(source.replaceAll('.', '\\.')));
  }
  assert.match(handlers, /parent-limit-writer/);
  assert.match(handlers, /delegated-cancellation-start/);
  assert.match(handlers, /delegated-cancellation-success-callback/);
  assert.match(handlers, /delegated-cancellation-error/);
});

test('cancel and reauthentication modal traces preserve owner-bound close and parent restoration', () => {
  const reauth = sliceBetween(
    'async function openBankingReauthModal',
    'async function openPayBatchPasswordConfirmModal'
  );
  const confirm = sliceBetween(
    'async function openPayBatchPasswordConfirmModal',
    'async function openUiPromptModal'
  );
  const batchChild = sliceBetween(
    'async function openBankingPayBatchChildModal',
    'async function openBanking'
  );

  assert.match(reauth, /reauth-modal-open-start/);
  assert.match(reauth, /reauth-modal-opened/);
  assert.match(reauth, /reauth-modal-verified/);
  assert.match(reauth, /restoreParentModalCtx/);
  assert.match(reauth, /closeTop\(\)/);
  assert.match(confirm, /cancel-confirm-modal-open-start/);
  assert.match(confirm, /cancel-confirm-modal-opened/);
  assert.match(confirm, /cancel-confirm-modal-submitted/);
  assert.match(batchChild, /batch-child-close-requested/);
  assert.match(batchChild, /batch-child-dismiss-complete/);
  assert.doesNotMatch(`${reauth}\n${confirm}`, /window\.modalCtx\s*=\s*null/);
});

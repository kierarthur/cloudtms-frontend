const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../js/main.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

function stage3Context() {
  const code = slice('const BANKING_PAY_STAGE3_STATUS_ACTIONS', 'async function bankingPayPaymentCorrectionReauth');
  const context = {
    window: { modalCtx: { banking: { pay: { child: { correction: {}, data: { id: 'batch-1' } } } } } },
    globalThis: { crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    Set, Map, Array, Object, String, Number, Math, Date, Error, AbortController,
    bankingPayPaymentStatusPage: async () => ({}), bankingRerender: async () => {}, toast: () => {}
  };
  vm.runInNewContext(`${code}\nthis.api = { canonical: bankingPayStage3CanonicalStatusAction, ensure: ensureBankingPayStage3SelectionState, reset: resetBankingPayStage3Selection, stale: isBankingPayStage3SelectionSnapshotStaleError, recoverStale: recoverBankingPayStage3SelectionSnapshot, normalise: normaliseBankingPayStage3StatusRow, apply: applyBankingPayStage3StatusPage, load: loadBankingPayStage3StatusPage, selectedActions: bankingPayStage3SelectedActions, build: buildBankingPayStage3Selection, getCorrection: () => window.modalCtx.banking.pay.child.correction }; this.setStatusPage = (value) => { bankingPayPaymentStatusPage = value; };`, context);
  context.api.setStatusPage = context.setStatusPage;
  return context.api;
}

test('Stage 3 consumes only server-returned candidate tokens and available actions', () => {
  const api = stage3Context();
  const state = {};
  const row = api.normalise({ candidate_token: 'candidate-1', payment_display_state: 'NOT_PAID', available_actions: ['RELEASE_FAILED_PAYMENT'], active_payment_amount_pence: 1234 }, state);
  assert.equal(row.candidate_token, 'candidate-1');
  assert.deepEqual(Array.from(row.available_actions), ['RELEASE_FAILED_PAYMENT']);
  assert.equal(row.selectable, true);
  const blocked = api.normalise({ candidate_token: 'candidate-2', payment_display_state: 'ACTIVE', available_actions: [], pre_provider_cancel_eligible: true }, state);
  assert.equal(blocked.selectable, false);
  const legacyAliasOnly = api.normalise({ candidate_token: 'candidate-3', available_actions: [], eligible_action_codes: ['CANCEL_PAYMENT'] }, state);
  assert.equal(legacyAliasOnly.selectable, false);
  assert.deepEqual(Array.from(legacyAliasOnly.available_actions), []);
});

test('cancelled payment rows preserve channel-specific frozen amounts instead of displaying active zero', () => {
  const api = stage3Context();
  const paye = api.normalise({
    candidate_token: 'candidate-paye',
    payment_display_state: 'CANCELLED',
    pay_channel: 'PAYE',
    available_actions: [],
    active_payment_amount_pence: 0,
    original_payment_amount_pence: 5,
    cancelled_gross_base_amount_pence: 14882,
    cancelled_payable_amount_pence: 14882,
    cancelled_bank_amount_pence: 5
  }, {});
  assert.equal(paye.paymentAmountPence, 0);
  assert.equal(paye.cancelledGrossBaseAmountPence, 14882);
  assert.equal(paye.cancelledBankAmountPence, 5);
  assert.equal(paye.payChannel, 'PAYE');

  const umbrella = api.normalise({
    candidate_token: 'candidate-umbrella',
    payment_display_state: 'CANCELLED',
    pay_channel: 'UMBRELLA',
    available_actions: [],
    active_payment_amount_pence: 0,
    cancelled_payable_amount_pence: 22500,
    cancelled_bank_amount_pence: 22500
  }, {});
  assert.equal(umbrella.cancelledPayableAmountPence, 22500);
  assert.equal(umbrella.payChannel, 'UMBRELLA');
});

test('explicit selection emits the exact Stage 2 contract with no filter authority', () => {
  const api = stage3Context();
  const state = { stage3Enabled: true, stage3SnapshotToken: 'filtered-snapshot', stage3ExplicitSnapshotToken: 'explicit-snapshot-1', stage3SortKey: 'STATUS', stage3SortDirection: 'ASC' };
  const selection = api.ensure(state);
  selection.explicitCandidateTokens.add('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  selection.explicitCandidateTokens.add('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  selection.tokenActions.set('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ['CANCEL_PAYMENT']);
  selection.tokenActions.set('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ['CANCEL_PAYMENT']);
  const payload = api.build(state, 'CANCEL_PAYMENT');
  assert.equal(payload.command, 'PREPARE');
  assert.equal(payload.context, 'CURRENT_PAYMENT_STATUS');
  assert.equal(payload.contract_version, 1);
  assert.equal(payload.mode, 'EXPLICIT');
  assert.equal(payload.snapshot_token, 'explicit-snapshot-1');
  assert.equal(payload.requested_action, 'PRE_BANK_CANCEL');
  assert.deepEqual(Array.from(payload.explicit_candidate_tokens), ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
  assert.equal(Object.hasOwn(payload, 'filter_json'), false);
});

test('all-matching selection freezes filter, action, snapshot and exclusions', () => {
  const api = stage3Context();
  const state = { stage3Enabled: true, stage3SnapshotToken: 'snapshot-2', stage3Filter: { status: 'NOT_PAID', action: 'RELEASE_FAILED_PAYMENT' }, stage3SortKey: 'AMOUNT', stage3SortDirection: 'DESC' };
  const selection = api.ensure(state);
  selection.mode = 'ALL_MATCHING';
  selection.requestedAction = 'RELEASE_FAILED_PAYMENT';
  selection.excludedCandidateTokens.add('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  const payload = api.build(state, 'RELEASE_FAILED_PAYMENT');
  assert.equal(payload.requested_action, 'NO_MONEY_RELEASE');
  assert.equal(payload.filter_json.action, 'RELEASE_FAILED_PAYMENT');
  assert.equal(payload.filter_json.status, 'NOT_PAID');
  assert.equal(payload.filter_json.actionable_only, undefined);
  assert.deepEqual(Array.from(payload.excluded_candidate_tokens), ['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
  assert.equal(Object.hasOwn(payload, 'explicit_candidate_tokens'), false);
});

test('Stage 3 status panel is selection-first and renders no technical evidence controls', () => {
  const panel = slice('function renderBankingPayStage3StatusPanel', 'function refreshBankingPayStage3SelectedRows');
  assert.match(panel, /Select payments first/);
  assert.match(panel, /data-banking-pay-stage3-action="toggle-all"/);
  assert.match(panel, /data-banking-pay-stage3-action="review"/);
  assert.match(panel, /Previous/);
  assert.match(panel, /Next/);
  assert.doesNotMatch(panel, /Select all visible|Select all matching this issue|Clear selection|View details|Technical details|status signature|provider payload/i);
  assert.doesNotMatch(panel, /type="checkbox" disabled aria-disabled/);
});

test('All loading is sequential, snapshot-bound and capped at 10,000 candidates', () => {
  const loader = slice('async function loadBankingPayStage3StatusPage', 'function bankingPayStage3SelectedActions');
  assert.match(loader, /while \(cursor && rows\.length < 10000 && pageCount < 100\)/);
  assert.match(loader, /snapshot_token/);
  assert.match(loader, /await bankingPayPaymentStatusPage/);
  assert.doesNotMatch(loader, /Promise\.all|candidate.*authFetch|forEach\([^)]*bankingPayPaymentStatusPage/);
});

test('exactly 10,000 rows complete in 100 sequential pages without a false overflow', async () => {
  const api = stage3Context();
  let callCount = 0;
  api.setStatusPage(async () => {
    const pageIndex = callCount++;
    return {
      ok: true,
      snapshot_token: 'stable-snapshot',
      explicit_snapshot_token: 'explicit-snapshot',
      sort_key: 'STATUS',
      sort_direction: 'ASC',
      page_size: 100,
      rows: Array.from({ length: 100 }, (_, offset) => ({
        candidate_token: `candidate-${pageIndex * 100 + offset + 1}`,
        available_actions: []
      })),
      next_cursor_json: pageIndex < 99 ? { page: pageIndex + 1 } : null
    };
  });
  const result = await api.load({ all: true, pageSize: 'ALL', silent: true, resetHistory: true });
  assert.equal(callCount, 100);
  assert.equal(result.rows.length, 10000);
  assert.equal(result.next_cursor_json, null);
});

test('a stale correction snapshot refreshes authority and clears the obsolete selection without retrying', async () => {
  const api = stage3Context();
  const state = api.getCorrection();
  state.stage3SnapshotToken = 'stale-filtered-snapshot';
  state.stage3ExplicitSnapshotToken = 'stale-explicit-snapshot';
  const selection = api.ensure(state);
  selection.explicitCandidateTokens.add('candidate-stale');
  selection.tokenActions.set('candidate-stale', ['CANCEL_PAYMENT']);
  let statusCalls = 0;
  api.setStatusPage(async () => {
    statusCalls += 1;
    return {
      snapshot_token: 'fresh-filtered-snapshot',
      explicit_snapshot_token: 'fresh-explicit-snapshot',
      sort_key: 'STATUS',
      sort_direction: 'ASC',
      page_size: 25,
      rows: [{ candidate_token: 'candidate-stale', available_actions: ['CANCEL_PAYMENT'] }]
    };
  });

  const recovered = await api.recoverStale({
    status: 400,
    message: 'CloudTMS could not complete this Banking action.',
    json: { error: 'PAYMENT_CORRECTION_SELECTION_SNAPSHOT_STALE' }
  });
  const refreshedSelection = api.ensure(state);

  assert.equal(recovered, true);
  assert.equal(statusCalls, 1);
  assert.equal(refreshedSelection.explicitCandidateTokens.size, 0);
  assert.equal(refreshedSelection.tokenActions.size, 0);
  assert.equal(state.stage3SnapshotToken, 'fresh-filtered-snapshot');
  assert.equal(state.stage3ExplicitSnapshotToken, 'fresh-explicit-snapshot');
  assert.match(state.planError, /refreshed the authoritative list and cleared the old selection/i);
});

test('an unrelated correction failure is not treated as stale and does not refresh or clear selection', async () => {
  const api = stage3Context();
  const state = api.getCorrection();
  const selection = api.ensure(state);
  selection.explicitCandidateTokens.add('candidate-kept');
  let statusCalls = 0;
  api.setStatusPage(async () => { statusCalls += 1; return {}; });

  assert.equal(await api.recoverStale({ status: 400, json: { error: 'OTHER_FAILURE' } }), false);
  assert.equal(statusCalls, 0);
  assert.equal(api.ensure(state).explicitCandidateTokens.has('candidate-kept'), true);
});

test('progress modal obeys server-safe action and polling contracts', () => {
  const modal = slice('function renderBankingPayCancellationProgressModal', 'function buildBankingPayCancellationActiveProjection');
  assert.match(modal, /const enc = typeof escapeHtml === 'function'/);
  assert.match(modal, /status\.progress_stage/);
  assert.match(modal, /status\.user_message/);
  assert.match(modal, /status\.candidate_counts/);
  assert.match(modal, /status\.blockers/);
  assert.match(modal, /availableActions\.includes\('REAUTHENTICATE'\)/);
  assert.match(modal, /AUTHORISE/);
  assert.match(modal, /REJECT/);
  assert.match(modal, /REAUTHORISE_REMAINING/);
  assert.match(modal, /USE_GOLDEN_KEY/);
  assert.match(modal, /selected_amount_pence/);
  assert.match(modal, /<progress/);
  assert.match(modal, /Releasing failed payment/);
  assert.match(modal, /Still working/);
  assert.match(modal, /Payment cancellation complete/);
  assert.match(modal, /closeBankingPayCancellationProgressModal\(\);\s*const ceremonyToken/);
  assert.match(modal, /ctms-cancel-btn is-primary/);
  assert.doesNotMatch(modal, /<strong>Status:<\/strong>|<strong>Stage:<\/strong>|Payment availability/);
  assert.doesNotMatch(modal, /JSON\.stringify\(status|provider_event_id|plan_hash|selection_hash/);
  const polling = slice('function scheduleBankingPayCancellationProgressPoll', 'async function openBankingPayCancellationProgressModal');
  assert.match(polling, /startBankingPayBatchLiveWatch\(state\.payBatchId/);
  assert.match(polling, /forceCancellationStatusPoll:\s*true/);
  assert.match(polling, /allowAnyBankingModal:\s*true/);
});

test('nested payment verification keeps its delegated handlers attached', () => {
  const reauth = slice('async function openBankingReauthModal', 'async function openPayBatchPasswordConfirmModal');
  assert.match(reauth, /let wireAttempts = 0/);
  assert.match(reauth, /if \(!body \|\| !reauthRoot\)/);
  assert.match(reauth, /wireAttempts < 60/);
  assert.match(reauth, /setTimeout\(wire, 50\)/);
  assert.match(reauth, /reauthRoot\.setAttribute\('data-banking-reauth-wired', '1'\)/);
  assert.match(reauth, /\n    wire\(\);/);
  assert.doesNotMatch(reauth, /requestAnimationFrame\(\(\) => requestAnimationFrame\(wire\)\)/);
  assert.match(reauth, /window\.addEventListener\('click', onClick, true\)/);
  assert.match(reauth, /window\.addEventListener\('input', onInput, true\)/);
  assert.match(reauth, /setTimeout\(wire, 0\)/);
  assert.match(reauth, /window\.__bankingReauthHandler = \{ openToken, onClick, onInput \}/);
  const afterAttach = reauth.slice(reauth.indexOf("window.addEventListener('click', onClick, true)"));
  assert.doesNotMatch(afterAttach.slice(0, 500), /rerender\(\)/);
});

test('successful payment verification closes its clean child through the owner-bound parent restore path', () => {
  const reauth = slice('async function openBankingReauthModal', 'async function openPayBatchPasswordConfirmModal');
  assert.match(reauth, /const finishVerified = \(token\) =>/);
  assert.match(reauth, /done = true;\s*detachDelegated\(\);/);
  assert.match(reauth, /frame\.isDirty = false;/);
  assert.match(reauth, /frame\._snapshot = null;/);
  assert.match(reauth, /frame\.isDirty = false;[\s\S]*frame\._snapshot = null;[\s\S]*closeTop\(\);/);
  assert.doesNotMatch(reauth, /finishVerified[\s\S]{0,900}?closeModal\(\)/);
  assert.match(reauth, /if \(directToken && j\?\.tfa_required === false\) \{\s*finishVerified\(directToken\);/);
  assert.match(reauth, /const tok2 = String\(j\?\.reauth_token \|\| ''\)\.trim\(\);[\s\S]*?finishVerified\(tok2\);/);
  assert.doesNotMatch(reauth, /finish\(directToken\);\s*closeTop\(\)/);
  assert.doesNotMatch(reauth, /finish\(tok2\);\s*closeTop\(\)/);
});

test('payment-status resolution sends only the bounded server context and user evidence', () => {
  const resolver = slice('async function resolveBankingPayStage3PaymentStatus', 'function installBankingPayStage3Handlers');
  assert.match(resolver, /source\.resolution_context/);
  assert.match(resolver, /candidate_token/);
  assert.match(resolver, /active_batch_scope_hash/);
  assert.match(resolver, /context_token/);
  assert.match(resolver, /evidence_reference/);
  assert.match(resolver, /reauth_token/);
  assert.doesNotMatch(resolver, /source\.operation_id|source\.banking_pay_operation_id|source\.pay_bank_transfer_id|instruction_scope_ids:/);
});

test('Stage 3 performs one plan request and never loops candidate mutations', () => {
  const handlers = slice('function installBankingPayStage3Handlers', 'function renderBankingPaymentIssuePanel');
  assert.match(handlers, /await bankingPayPaymentCorrectionPlan\(payBatchId, prepared, \{ reason: confirmation\.reason \}\)/);
  assert.match(handlers, /openBankingPayStage3CancellationConfirmation/);
  assert.match(handlers, /openBankingReauthModal\(\{ purpose: 'PAYMENT_REVERSAL' \}\)/);
  assert.match(handlers, /openBankingPayCancellationProgressModal/);
  assert.doesNotMatch(handlers, /for\s*\([^)]*candidate|forEach\([^)]*(correctionPlan|correctionStart)|Promise\.all/);
  assert.doesNotMatch(handlers, /bankingPayPaymentCorrectionProcess/);
});

test('multi-row selections never expose payment-status resolution', () => {
  const api = stage3Context();
  const state = {};
  const selection = api.ensure(state);
  for (const token of ['candidate-1', 'candidate-2']) {
    selection.explicitCandidateTokens.add(token);
    selection.tokenActions.set(token, ['RESOLVE_PAYMENT_STATUS']);
  }
  assert.deepEqual(Array.from(api.selectedActions(state)), []);
});

test('active Overview and PAYE projections remain complete above 100 rows', () => {
  const code = slice('function buildBankingPayCancellationActiveProjection', 'function applyBankingPayCancellationActiveProjection');
  const context = { Number, Array, Object, String, Intl };
  vm.runInNewContext(`${code}\nthis.build = buildBankingPayCancellationActiveProjection;`, context);
  const rows = Array.from({ length: 150 }, (_, index) => ({
    candidate_token: `candidate-${index + 1}`,
    include_in_active_overview: true,
    include_in_active_paye_schedule: true
  }));
  const projection = context.build({
    rows,
    projection_complete: true,
    active_overview_candidate_count: 150,
    active_paye_schedule_line_count: 150
  });
  assert.equal(projection.active_overview_rows.length, 150);
  assert.equal(projection.active_paye_schedule_rows.length, 150);
  assert.equal(projection.active_overview_projection_authoritative, true);
  assert.equal(projection.active_paye_schedule_projection_authoritative, true);
});

test('executed cancellation sends one shared reason and top-level requested action', () => {
  const wrapper = slice('async function bankingPayPaymentCorrectionPlan', 'async function bankingPayPaymentCorrectionStatus');
  assert.match(wrapper, /requested_action: upper\(selection\?\.requested_action\)/);
  assert.match(wrapper, /if \(reason\) body\.reason = reason/);
  const confirmation = slice('async function openBankingPayStage3CancellationConfirmation', 'async function bankingPayPaymentCorrectionReauth');
  assert.match(confirmation, /Reason for cancellation/);
  assert.match(confirmation, /Enter one shared reason/);
});

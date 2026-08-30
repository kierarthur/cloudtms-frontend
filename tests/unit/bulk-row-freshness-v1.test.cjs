const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontendRoot = path.resolve(__dirname, '..', '..');
const modulePath = path.join(frontendRoot, 'js', 'bulk-row-freshness-v1.js');
const mainPath = path.join(frontendRoot, 'js', 'main.js');
const lifecyclePath = path.join(frontendRoot, 'js', 'bulk-authorise-lifecycle-v2.js');

function loadModule(overrides = {}) {
  const window = {
    API: (value) => `https://test-backend.invalid${value}`,
    authFetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    ...overrides
  };
  const context = {
    window,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    Error,
    Map,
    Set,
    Object,
    Array,
    JSON,
    String,
    Number,
    Math
  };
  vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return window.bulkRowFreshnessV1;
}

const TS1 = 'timesheet:11111111-1111-4111-8111-111111111111';
const TS2 = 'timesheet:22222222-2222-4222-8222-222222222222';
const CW1 = '33333333-3333-4333-8333-333333333333';
const row = (key = TS1, overrides = {}) => ({
  row_key: key,
  timesheet_id: key.startsWith('timesheet:') ? key.slice('timesheet:'.length) : null,
  contract_week_id: CW1,
  backend_row_signature: 'sig-1',
  bulk_process_bucket: 'UNPROCESSED',
  bulk_authorise_section: 'processed_eligible',
  ...overrides
});

test('every explicit preflight calls freshness, including repeated same-row clicks', async () => {
  let calls = 0;
  const api = loadModule({
    authFetch: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, outcome: 'CURRENT', changed: false }) };
    }
  });
  const state = {};
  await api.fetchDecision({ surface: 'bulk_process', state, row: row() });
  await api.fetchDecision({ surface: 'bulk_process', state, row: row() });
  assert.equal(calls, 2);
});

test('duplicate clicks share one in-flight promise and only the newest transition is accepted', async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const api = loadModule({
    authFetch: async () => {
      calls += 1;
      await pending;
      return { ok: true, status: 200, json: async () => ({ ok: true, outcome: 'CURRENT', changed: false }) };
    }
  });
  const state = {};
  const first = api.fetchDecision({ surface: 'bulk_process', state, row: row() });
  const second = api.fetchDecision({ surface: 'bulk_process', state, row: row() });
  assert.equal(state.__bulk_process_freshness_checking, true);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.accepted, false);
  assert.equal(b.accepted, true);
  assert.equal(state.__bulk_process_freshness_checking, false);
});

test('rapid clicks cannot let an older row response commit', async () => {
  const resolvers = new Map();
  const api = loadModule({
    authFetch: async (url) => {
      const key = new URL(url).searchParams.get('row_key');
      await new Promise((resolve) => resolvers.set(key, resolve));
      return { ok: true, status: 200, json: async () => ({ ok: true, outcome: 'CURRENT', changed: false }) };
    }
  });
  const state = {};
  const first = api.fetchDecision({ surface: 'bulk_process', state, row: row(TS1) });
  const second = api.fetchDecision({ surface: 'bulk_process', state, row: row(TS2, { contract_week_id: null }) });
  await new Promise((resolve) => setImmediate(resolve));
  resolvers.get(TS2)();
  const secondResult = await second;
  resolvers.get(TS1)();
  const firstResult = await first;
  assert.equal(secondResult.accepted, true);
  assert.equal(firstResult.accepted, false);
});

test('unchanged adapters retain context, preview, image URL, queue and dataset by reference', () => {
  const api = loadModule();
  const processState = {
    dataset: { unprocessed_rows: [row()], processed_rows: [] },
    active_context: { marker: 1 },
    evidence_pane_state: { __preview_signed_url: 'cached-image', queue_rows: [{ id: 'q1' }], active_queue_id: 'q1' }
  };
  const authoriseState = {
    dataset: { rows: [row()] },
    active_context: { marker: 2 },
    evidence_pane_state: { __preview_signed_url: 'cached-image-2', queue_rows: [{ id: 'q2' }], active_queue_id: 'q2' }
  };
  const processDataset = processState.dataset;
  const processPane = processState.evidence_pane_state;
  const authoriseDataset = authoriseState.dataset;
  const authorisePane = authoriseState.evidence_pane_state;
  assert.equal(api.reconcileBulkProcess(processState, { outcome: 'CURRENT', changed: false }).unchanged, true);
  assert.equal(api.reconcileBulkAuthorise(authoriseState, { outcome: 'CURRENT', changed: false }).unchanged, true);
  assert.equal(processState.dataset, processDataset);
  assert.equal(processState.evidence_pane_state, processPane);
  assert.equal(authoriseState.dataset, authoriseDataset);
  assert.equal(authoriseState.evidence_pane_state, authorisePane);
});

test('Bulk Process changed row updates badges and moves section without changing scroll or queue position', () => {
  const api = loadModule();
  const state = {
    dataset: { unprocessed_rows: [row()], processed_rows: [], counts: {} },
    selected_row_keys: [TS1],
    active_row: row(),
    active_row_key: TS1,
    __bulk_process_left_pane_scroll: { container: 20, unprocessed: 30, processed: 40 },
    evidence_pane_state: { queue_rows: [{ id: 'q1' }], active_queue_id: 'q1' }
  };
  const next = row(TS1, { backend_row_signature: 'sig-2', bulk_process_bucket: 'PROCESSED', evidence_badges: [{ kind: 'TIMESHEET' }] });
  const result = api.reconcileBulkProcess(state, {
    outcome: 'MOVED', changed: true, eligible_for_surface: true,
    previous_row_key: TS1, row_key: TS1, target_section: 'processed_eligible', row: next
  }, row());
  assert.equal(result.needs_context, true);
  assert.equal(state.dataset.unprocessed_rows.length, 0);
  assert.equal(state.dataset.processed_rows.length, 1);
  assert.deepEqual(state.dataset.processed_rows[0].evidence_badges, [{ kind: 'TIMESHEET' }]);
  assert.deepEqual(state.selected_row_keys, [TS1]);
  assert.deepEqual(state.__bulk_process_left_pane_scroll, { container: 20, unprocessed: 30, processed: 40 });
  assert.equal(state.evidence_pane_state.active_queue_id, 'q1');
});

test('Bulk Authorise row-key transition is atomic and preserves checkbox selection in destination section', () => {
  const api = loadModule();
  const oldKey = `contract_week:${CW1}`;
  const canonical = row(TS1, { bulk_authorise_section: 'authorised_eligible', is_authorised: true });
  const state = {
    dataset: { rows: [row(oldKey, { timesheet_id: null })], counts: {} },
    selected_row_keys_by_section: { processed_eligible: [oldKey], authorised_eligible: [] },
    active_row: row(oldKey, { timesheet_id: null }),
    active_row_key: oldKey,
    section_scroll_top: { processed_eligible: 11, authorised_eligible: 22 },
    evidence_pane_state: { queue_rows: [{ id: 'q1' }], active_queue_id: 'q1' }
  };
  const result = api.reconcileBulkAuthorise(state, {
    outcome: 'MOVED', changed: true, eligible_for_surface: true,
    previous_row_key: oldKey, row_key: TS1, target_section: 'authorised_eligible', row: canonical
  }, state.active_row);
  assert.equal(result.canonical_row_key, TS1);
  assert.equal(state.dataset.rows.some((candidate) => candidate.row_key === oldKey), false);
  assert.equal(state.dataset.rows.some((candidate) => candidate.row_key === TS1), true);
  assert.deepEqual(state.selected_row_keys_by_section.processed_eligible, []);
  assert.deepEqual(state.selected_row_keys_by_section.authorised_eligible, [TS1]);
  assert.deepEqual(state.section_scroll_top, { processed_eligible: 11, authorised_eligible: 22 });
  assert.equal(state.evidence_pane_state.active_queue_id, 'q1');
});

for (const surface of ['bulk_process', 'bulk_authorise']) {
  test(`${surface} removes deleted row and returns one successor`, () => {
    const api = loadModule();
    const second = row(TS2, { contract_week_id: null });
    const state = surface === 'bulk_process'
      ? {
          dataset: { unprocessed_rows: [row(), second], processed_rows: [] },
          active_row: row(), active_row_key: TS1, selected_row_keys: [TS1],
          active_context: { row_key: TS1 }, active_ctx: { row_key: TS1 }, active_details: { row_key: TS1 },
          evidence_pane_state: { __preview_signed_url: 'old' }
        }
      : {
          dataset: { rows: [row(), second] },
          active_row: row(), active_row_key: TS1,
          selected_row_keys_by_section: { processed_eligible: [TS1], authorised_eligible: [] },
          active_context: { row_key: TS1 }, active_ctx: { row_key: TS1 }, active_details: { row_key: TS1 },
          evidence_pane_state: { __preview_signed_url: 'old' }
        };
    const decision = { outcome: 'DELETED', changed: true, eligible_for_surface: false, previous_row_key: TS1, row_key: null, row: null };
    const result = surface === 'bulk_process'
      ? api.reconcileBulkProcess(state, decision, row())
      : api.reconcileBulkAuthorise(state, decision, row());
    assert.equal(result.replacement_row_key, TS2);
    assert.equal(state.active_row, null);
    assert.equal(state.active_context, null);
    assert.equal(state.evidence_pane_state.__preview_signed_url, '');
  });
}

test('removed final row produces an empty state with no replacement', () => {
  const api = loadModule();
  const state = { dataset: { rows: [row()] }, active_row: row(), active_row_key: TS1, selected_row_keys_by_section: {} };
  const result = api.reconcileBulkAuthorise(state, {
    outcome: 'REMOVED', changed: true, eligible_for_surface: false,
    previous_row_key: TS1, row_key: TS1, row: row()
  }, row());
  assert.equal(result.replacement_row_key, null);
  assert.equal(state.dataset.rows.length, 0);
});

test('dirty conflict uses the application modal and never silently overwrites on cancel', async () => {
  let modalCalls = 0;
  const state = { dirty: true };
  const api = loadModule({
    openUiConfirmModal: async () => { modalCalls += 1; return { confirmed: false }; }
  });
  const confirmed = await api.confirmDirtyConflict({
    surface: 'bulk_process', state,
    decision: { outcome: 'CURRENT', changed: true }
  });
  assert.equal(confirmed, false);
  assert.equal(state.dirty, true);
  assert.equal(modalCalls, 1);
});

test('failure disables stale actions and a later click can retry', async () => {
  let calls = 0;
  const state = {};
  const api = loadModule({
    authFetch: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 504, json: async () => ({ ok: false, error_code: 'FRESHNESS_TIMEOUT', message: 'Retry' }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, outcome: 'CURRENT', changed: false }) };
    }
  });
  await assert.rejects(api.fetchDecision({ surface: 'bulk_process', state, row: row() }), /Retry/);
  api.markUnconfirmed(state, 'bulk_process', new Error('Retry'));
  assert.equal(state.__bulk_process_freshness_unconfirmed, true);
  const retried = await api.fetchDecision({ surface: 'bulk_process', state, row: row() });
  api.markConfirmed(state, 'bulk_process');
  assert.equal(retried.accepted, true);
  assert.equal(calls, 2);
  assert.equal(state.__bulk_process_freshness_unconfirmed, false);
});

test('click integrations place freshness before cache trust and disable unsafe actions on failure', () => {
  const main = fs.readFileSync(mainPath, 'utf8');
  const lifecycle = fs.readFileSync(lifecyclePath, 'utf8');
  assert.match(main, /handleBulkProcessRowChange\(rowKey, \{ explicitActivation: true, source: 'row_click' \}\)/);
  assert.match(main, /wantedKey === currentKey && !forceRefresh && !deferContextRefreshAfterPatch && !explicitActivation/);
  assert.match(main, /bulkRowFreshnessV1[\s\S]*same-row:freshness-current:return/);
  assert.match(main, /let freshnessChangedEligible = trimStr\(opts\.source \|\| opts\.refresh_source \|\| ''\) === 'freshness_replacement';/);
  assert.match(main, /freshnessChangedEligible = freshnessDecision\.changed === true;/);
  assert.match(main, /const primaryContextIncludeEvidence = freshnessChangedEligible \|\| evidenceRefreshRequested;/);
  assert.match(main, /profile: contextProfile,\s*includeEvidence: primaryContextIncludeEvidence,/);
  assert.match(main, /const shouldHydrateEvidenceAfterNonEvidenceContext = !!\(\s*!primaryContextIncludeEvidence &&/);
  assert.match(main, /__bulk_process_freshness_unconfirmed === true/);
  assert.match(main, /__bulk_authorise_freshness_unconfirmed === true/);
  assert.match(main, /__bulk_process_freshness_checking === true/);
  assert.match(lifecycle, /__bulk_authorise_freshness_checking === true/);
  const preflightIndex = lifecycle.indexOf("source === 'row_click' && target");
  const snapshotIndex = lifecycle.indexOf('if (fastPathEligible) this.captureSnapshot(currentKey)');
  assert.ok(preflightIndex >= 0 && preflightIndex < snapshotIndex);
  assert.match(lifecycle, /freshnessUnchanged === true\s*\? true\s*:\s*await this\.validateSnapshot/);
});

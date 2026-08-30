const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const controllerSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/bulk-authorise-lifecycle-v2.js'),
  'utf8'
);

const clone = (value) => JSON.parse(JSON.stringify(value));

function row(key, section = 'processed_eligible', extra = {}) {
  return {
    row_key: key,
    timesheet_id: key.replace(/^timesheet:/, ''),
    current_timesheet_id: key.replace(/^timesheet:/, ''),
    bulk_authorise_section: section,
    bulk_authorise_classification: 'TIMESHEETS',
    row_signature: `signature:${key}`,
    ...extra
  };
}

function stateFor(rows, activeKey = '') {
  const active = rows.find((entry) => entry.row_key === activeKey) || null;
  return {
    classification: 'TIMESHEETS',
    filters: {},
    dataset: { rows: clone(rows), counts: {} },
    selected_row_keys: [],
    selected_section: null,
    selected_row_keys_by_section: {
      processed_eligible: [],
      authorised_eligible: []
    },
    active_row_key: active ? active.row_key : null,
    active_row: active ? clone(active) : null,
    active_context: active ? { row: clone(active) } : null,
    active_ctx: null,
    active_details: null,
    loading: false,
    batch_busy: false,
    dirty: false,
    __bulk_authorise_row_change_seq: 1,
    evidence_pane_state: {
      active_tab: 'attached',
      queue_rows: [{ id: 'queue:global' }],
      attached_rows: [{ id: 'evidence:stale' }],
      active_attached_id: 'evidence:stale',
      active_attached_item: { id: 'evidence:stale' },
      __preview_target_key: 'stale-target',
      __preview_signed_url: 'https://example.invalid/stale',
      __preview_identity: activeKey
    }
  };
}

function installHarness(initialState, overrides = {}) {
  const renderReasons = [];
  const root = { dataset: {}, querySelectorAll() { return []; } };
  const frame = { kind: 'bulk-authorise-workbench', _onDismiss() { frame.dismissed = true; } };
  const win = {
    modalCtx: { entity: 'bulk-authorise', bulkAuthoriseState: initialState },
    document: {
      getElementById(id) {
        return id === 'bulkAuthoriseWorkbenchRoot' ? root : null;
      }
    },
    __getModalFrame: () => frame,
    getVisibleBulkAuthoriseRows(state) {
      const rows = Array.isArray(state.dataset && state.dataset.rows) ? state.dataset.rows : [];
      return {
        visible_rows: rows,
        visible_processed_eligible_rows: rows.filter((entry) => entry.bulk_authorise_section === 'processed_eligible'),
        visible_authorised_eligible_rows: rows.filter((entry) => entry.bulk_authorise_section === 'authorised_eligible')
      };
    },
    buildBulkAuthoriseDatasetRequestFilters(state) {
      return { classification: state.classification };
    },
    async openBulkAuthoriseWorkbench() {
      return initialState;
    },
    async setActiveBulkAuthoriseRowFromVisibleRows(state, preferredRowKey, options = {}) {
      const rows = state.dataset.rows || [];
      const allowEmptySelection = options.allowEmptySelection === true || options.allow_empty_selection === true;
      const next = rows.find((entry) => entry.row_key === preferredRowKey)
        || (allowEmptySelection ? null : rows.find((entry) => entry.bulk_authorise_section === 'processed_eligible'))
        || (allowEmptySelection ? null : rows.find((entry) => entry.bulk_authorise_section === 'authorised_eligible'))
        || null;
      state.active_row_key = next ? next.row_key : null;
      state.active_row = next ? clone(next) : null;
      if (next && options.preserveActiveContext === true && state.active_context) {
        state.active_context.row = clone(next);
        state.active_context.bulk_authorise_section = next.bulk_authorise_section;
        state.active_context.is_authorised = next.is_authorised;
        state.active_context.read_only = next.read_only;
        state.active_context.can_bulk_authorise = next.can_bulk_authorise;
        state.active_context.action_flags = {
          ...(state.active_context.action_flags || {}),
          can_bulk_authorise: next.can_bulk_authorise,
          read_only: next.read_only
        };
      } else {
        state.active_context = next ? { row: clone(next), profile: 'status_header' } : null;
      }
      state.active_ctx = null;
      state.active_details = null;
      return true;
    },
    bindBulkAuthoriseClassificationButtons() {},
    async rerenderBulkAuthoriseWorkbench(_state, reason) {
      renderReasons.push(reason);
      return true;
    },
    async refreshBulkAuthoriseActiveContext(state, options) {
      state.active_context = {
        row: clone(options.row),
        profile: 'full',
        evidence_loaded: true,
        compare_loaded: true,
        full_loaded: true
      };
      state.__bulkAuthorisePreviewActiveRowKey = options.row_key;
      state.evidence_pane_state.__bulk_authorise_evidence_identity = options.row_key;
      state.evidence_pane_state.attached_rows = [{ id: `evidence:${options.row_key}` }];
      return true;
    },
    async fetchBulkAuthoriseDataset() {
      return clone(initialState.dataset);
    },
    async handleBulkAuthoriseSelected() {
      return { ok: false, batch_completed: false, success_count: 0 };
    },
    async handleBulkUnauthoriseSelected() {
      return { ok: false, batch_completed: false, success_count: 0 };
    },
    bulkRowFreshnessV1: {
      async fetchDecision(options) {
        const target = options.row || {};
        return {
          accepted: true,
          stale: false,
          decision: {
            ok: true,
            outcome: 'CURRENT',
            changed: false,
            eligible_for_surface: true,
            previous_row_key: target.row_key,
            row_key: target.row_key,
            signature: target.row_signature,
            target_section: target.bulk_authorise_section,
            row: clone(target)
          }
        };
      },
      reconcileBulkAuthorise(state, decision) {
        const canonical = clone(decision.row || {});
        const key = decision.row_key || canonical.row_key;
        state.dataset.rows = (state.dataset.rows || []).filter((entry) => entry.row_key !== decision.previous_row_key && entry.row_key !== key);
        state.dataset.rows.push(canonical);
        return { eligible: true, canonical_row_key: key, needs_context: true };
      },
      markConfirmed() {},
      markUnconfirmed() {},
      async confirmDirtyConflict() { return true; }
    },
    ...overrides
  };
  const context = {
    window: win,
    console,
    Promise,
    Set,
    WeakMap,
    JSON,
    Date,
    Math,
    Object,
    Array,
    String,
    Number
  };
  vm.runInNewContext(controllerSource, context, { filename: 'bulk-authorise-lifecycle-v2.js' });
  return { win, root, frame, renderReasons, controller: win.__bulkAuthoriseLifecycleV2Test.controllerFor(initialState) };
}

test('row navigation preserves checkbox selection and commits one full row context', async () => {
  const first = row('timesheet:A');
  const second = row('timesheet:B');
  const state = stateFor([first, second], first.row_key);
  state.selected_row_keys_by_section.processed_eligible = [second.row_key];
  const { controller, root } = installHarness(state);

  const changed = await controller.transitionToRow(second.row_key);

  assert.equal(changed, true);
  assert.equal(state.active_row_key, second.row_key);
  assert.deepEqual(Array.from(state.selected_row_keys), []);
  assert.equal(state.selected_section, null);
  assert.deepEqual(Array.from(state.selected_row_keys_by_section.processed_eligible), [second.row_key]);
  assert.equal(state.active_context.profile, 'full');
  assert.equal(state.active_context.full_loaded, true);
  assert.equal(state.evidence_pane_state.active_tab, 'attached');
  assert.equal(state.evidence_pane_state.__preview_signed_url, '');
  assert.equal(root.dataset.bulkAuthoriseController, 'v2');
});

test('row navigation leaves all context hydration to the lifecycle full request', async () => {
  const first = row('timesheet:A');
  const second = row('timesheet:B');
  const state = stateFor([first, second], first.row_key);
  let selectionOptions = null;
  const contextProfiles = [];
  const { controller } = installHarness(state, {
    async setActiveBulkAuthoriseRowFromVisibleRows(current, preferredRowKey, options = {}) {
      selectionOptions = { ...options };
      const next = current.dataset.rows.find((entry) => entry.row_key === preferredRowKey) || null;
      if (next?.row_key !== current.active_row_key) {
        current.__bulk_authorise_row_change_seq = (Number(current.__bulk_authorise_row_change_seq || 0) || 0) + 1;
      }
      current.active_row_key = next ? next.row_key : null;
      current.active_row = next ? clone(next) : null;
      current.active_context = next ? { row: clone(next), profile: 'status_header' } : null;
      return true;
    },
    async refreshBulkAuthoriseActiveContext(current, options) {
      contextProfiles.push(options.profile);
      assert.equal(options.rowChangeSeq, current.__bulk_authorise_row_change_seq);
      current.active_context = { row: clone(options.row), profile: options.profile, full_loaded: true, evidence_loaded: true };
      current.__bulk_authorise_row_context_ready = true;
      return true;
    }
  });

  await controller.transitionToRow(second.row_key, { source: 'row_click' });

  assert.equal(selectionOptions.datasetOnly, true);
  assert.equal(selectionOptions.minimalOnly, true);
  assert.equal(selectionOptions.deferContextRefresh, false);
  assert.equal(selectionOptions.scheduleHydration, false);
  assert.equal(selectionOptions.skipEvidenceHydration, true);
  assert.deepEqual(contextProfiles, ['full']);
});

test('a full response without evidence is completed sequentially before the ready render', async () => {
  const first = row('timesheet:A');
  const second = row('timesheet:B');
  const state = stateFor([first, second], first.row_key);
  const contextProfiles = [];
  const { controller, renderReasons } = installHarness(state, {
    async refreshBulkAuthoriseActiveContext(current, options) {
      contextProfiles.push(options.profile);
      current.active_context = {
        row: clone(options.row),
        profile: options.profile,
        full_loaded: true,
        evidence_loaded: options.profile === 'evidence'
      };
      return true;
    }
  });

  await controller.transitionToRow(second.row_key, { source: 'row_click' });

  assert.deepEqual(contextProfiles, ['full', 'evidence']);
  assert.equal(renderReasons.filter((reason) => reason.includes('[ROW-SKELETON]')).length, 1);
  assert.equal(renderReasons.filter((reason) => reason.includes('[ROW-READY]')).length, 1);
});

test('same-row lifecycle refresh clears stale authorised context before loading the processed context', async () => {
  const processed = row('timesheet:A', 'processed_eligible', {
    is_authorised: false,
    can_bulk_authorise: true
  });
  const state = stateFor([processed], processed.row_key);
  state.active_context = {
    row: row('timesheet:A', 'authorised_eligible', {
      is_authorised: true,
      can_bulk_authorise: false
    }),
    action_flags: {
      can_bulk_authorise: false,
      read_only: true
    },
    profile: 'full'
  };
  state.active_ctx = clone(state.active_context);
  state.active_details = clone(state.active_context);
  state.__bulk_authorise_row_context_ready = true;

  const { controller } = installHarness(state, {
    async setActiveBulkAuthoriseRowFromVisibleRows(current, preferredRowKey) {
      const next = current.dataset.rows.find((entry) => entry.row_key === preferredRowKey) || null;
      current.active_row_key = next ? next.row_key : null;
      current.active_row = next ? clone(next) : null;
      return true;
    },
    async refreshBulkAuthoriseActiveContext(current, options) {
      assert.equal(current.active_context, null);
      assert.equal(current.active_ctx, null);
      assert.equal(current.active_details, null);
      assert.equal(current.__bulk_authorise_row_context_ready, false);
      current.active_context = {
        row: clone(options.row),
        action_flags: { can_bulk_authorise: true, read_only: false },
        profile: 'full',
        full_loaded: true,
        evidence_loaded: true
      };
      return true;
    }
  });

  const changed = await controller.transitionToRow(processed.row_key, {
    skipDirtyGuard: true,
    source: 'canonical-mutation-refresh'
  });

  assert.equal(changed, true);
  assert.equal(state.active_context.action_flags.can_bulk_authorise, true);
  assert.equal(state.active_context.action_flags.read_only, false);
});

test('a later row transition wins and the stale transition cannot render ready', async () => {
  const first = row('timesheet:A');
  const second = row('timesheet:B');
  const state = stateFor([first, second], first.row_key);
  const pending = new Map();
  const { controller, renderReasons } = installHarness(state, {
    refreshBulkAuthoriseActiveContext(current, options) {
      return new Promise((resolve) => {
        pending.set(options.row_key, () => {
          if (current.active_row_key === options.row_key) {
            current.active_context = { row: clone(options.row), profile: 'full', full_loaded: true, evidence_loaded: true };
          }
          resolve(true);
        });
      });
    }
  });

  const firstTransition = controller.transitionToRow(first.row_key, { skipDirtyGuard: true, source: 'canonical-mutation-refresh' });
  await new Promise((resolve) => setImmediate(resolve));
  const secondTransition = controller.transitionToRow(second.row_key, { skipDirtyGuard: true });
  await new Promise((resolve) => setImmediate(resolve));
  pending.get(second.row_key)();
  await secondTransition;
  pending.get(first.row_key)();
  await firstTransition;

  assert.equal(state.active_row_key, second.row_key);
  assert.equal(state.active_context.row.row_key, second.row_key);
  assert.equal(
    renderReasons.filter((reason) => reason.includes('[ROW-READY]')).length,
    1
  );
});

test('a proven-unchanged revisit restores the cached row without a full render or context reload', async () => {
  const first = row('timesheet:A');
  const second = row('timesheet:B');
  const state = stateFor([first, second], first.row_key);
  state.active_context = {
    row: clone(first),
    profile: 'full',
    full_loaded: true,
    watch_vector: { cacheable: true, watch_token: 'watch:A' }
  };
  state.__bulk_authorise_row_context_ready = true;
  let contextRefreshes = 0;
  let busy = false;
  const surfaces = [];
  const { controller, renderReasons } = installHarness(state, {
    __bulkAuthoriseFastSurfaceAdapter: {
      capture(rowKey) {
        const surface = { rowKey };
        surfaces.push(surface);
        return surface;
      },
      restore(surface, rowKey) { return surface.rowKey === rowKey; },
      setBusy(value) { busy = value === true; },
      release() {}
    },
    async fetchBulkAuthoriseRowWatch(_row, options) {
      assert.equal(options.known_watch_token, 'watch:A');
      return {
        ok: true,
        unchanged: true,
        watch_vector: { cacheable: true, watch_token: 'watch:A' }
      };
    },
    async refreshBulkAuthoriseActiveContext(current, options) {
      contextRefreshes += 1;
      current.active_context = { row: clone(options.row), profile: 'full', full_loaded: true, evidence_loaded: true };
      return true;
    }
  });

  await controller.transitionToRow(second.row_key, { source: 'row_click' });
  const renderCountBeforeRevisit = renderReasons.length;
  const refreshCountBeforeRevisit = contextRefreshes;
  const revisited = await controller.transitionToRow(first.row_key, { source: 'row_click' });

  assert.equal(revisited, true);
  assert.equal(state.active_row_key, first.row_key);
  assert.equal(state.__bulk_authorise_last_transition_mode, 'validated-cache-hit');
  assert.equal(contextRefreshes, refreshCountBeforeRevisit);
  assert.equal(renderReasons.length, renderCountBeforeRevisit);
  assert.equal(busy, false);
  assert.equal(state.evidence_pane_state.__preview_signed_url, 'https://example.invalid/stale');
  assert.ok(surfaces.length >= 1);
});

test('a changed click freshness result fails closed to one full refresh path', async () => {
  const first = row('timesheet:A');
  const second = row('timesheet:B');
  const state = stateFor([first, second], first.row_key);
  state.active_context = {
    row: clone(first),
    profile: 'full',
    full_loaded: true,
    watch_vector: { cacheable: true, watch_token: 'watch:A' }
  };
  state.__bulk_authorise_row_context_ready = true;
  let contextRefreshes = 0;
  const { controller, renderReasons } = installHarness(state, {
    __bulkAuthoriseFastSurfaceAdapter: {
      capture(rowKey) { return { rowKey }; },
      restore(surface, rowKey) { return surface.rowKey === rowKey; },
      setBusy() {},
      release() {}
    },
    bulkRowFreshnessV1: {
      async fetchDecision(options) {
        const target = options.row || {};
        const changed = target.row_key === first.row_key;
        return {
          accepted: true,
          stale: false,
          decision: {
            ok: true,
            outcome: 'CURRENT',
            changed,
            eligible_for_surface: true,
            previous_row_key: target.row_key,
            row_key: target.row_key,
            signature: changed ? `${target.row_signature}:changed` : target.row_signature,
            target_section: target.bulk_authorise_section,
            row: clone(target)
          }
        };
      },
      reconcileBulkAuthorise(current, decision) {
        const canonical = clone(decision.row || {});
        current.dataset.rows = current.dataset.rows.map((entry) => entry.row_key === decision.row_key ? canonical : entry);
        return { eligible: true, canonical_row_key: decision.row_key, needs_context: true };
      },
      markConfirmed() {},
      markUnconfirmed() {},
      async confirmDirtyConflict() { return true; }
    },
    async refreshBulkAuthoriseActiveContext(current, options) {
      contextRefreshes += 1;
      current.active_context = { row: clone(options.row), profile: 'full', full_loaded: true, evidence_loaded: true };
      return true;
    }
  });

  await controller.transitionToRow(second.row_key, { source: 'row_click' });
  const refreshCountBeforeRevisit = contextRefreshes;
  const renderCountBeforeRevisit = renderReasons.length;
  await controller.transitionToRow(first.row_key, { source: 'row_click' });

  assert.equal(state.__bulk_authorise_last_transition_mode, 'full');
  assert.equal(contextRefreshes, refreshCountBeforeRevisit + 1);
  assert.ok(renderReasons.length >= renderCountBeforeRevisit + 2);
  assert.ok(renderReasons.some((reason) => reason.includes('[ROW-SKELETON]')));
});

test('classification change to an empty dataset clears active row and every stale preview owner', async () => {
  const first = row('timesheet:A');
  const state = stateFor([first], first.row_key);
  state.evidence_pane_state.active_tab = 'queue';
  state.evidence_pane_state.active_queue_id = 'queue:old';
  state.evidence_pane_state.active_queue_item = { id: 'queue:old' };
  const { controller } = installHarness(state, {
    async fetchBulkAuthoriseDataset(filters) {
      assert.equal(filters.classification, 'HR');
      return { rows: [], counts: { total: 0 } };
    }
  });

  const changed = await controller.transitionToClassification('HR');

  assert.equal(changed, true);
  assert.equal(state.classification, 'HR');
  assert.equal(state.active_row_key, null);
  assert.equal(state.active_row, null);
  assert.equal(state.evidence_pane_state.active_tab, 'attached');
  assert.equal(state.evidence_pane_state.active_attached_item, null);
  assert.equal(state.evidence_pane_state.active_queue_item, null);
  assert.equal(state.evidence_pane_state.__preview_identity, '');
  assert.equal(state.evidence_pane_state.__preview_signed_url, '');
});

test('post-mutation reconciliation replaces partial rows with the canonical dataset', async () => {
  const partial = row('timesheet:A', 'processed_eligible', { candidate_name: null, client_name: null });
  const failed = row('timesheet:B', 'processed_eligible', { candidate_name: null });
  const state = stateFor([partial, failed], partial.row_key);
  state.selected_row_keys_by_section.processed_eligible = [partial.row_key, failed.row_key];
  const canonical = {
    rows: [
      row('timesheet:A', 'authorised_eligible', { candidate_name: 'Full Candidate A', client_name: 'Full Client A' }),
      row('timesheet:B', 'processed_eligible', { candidate_name: 'Full Candidate B', client_name: 'Full Client B' })
    ],
    counts: { total: 2 }
  };
  const { controller } = installHarness(state, {
    async fetchBulkAuthoriseDataset() {
      return clone(canonical);
    }
  });
  const result = {
    ok: true,
    batch_completed: true,
    success_count: 1,
    failed_items: [{ row_key: 'timesheet:B' }],
    mutationSeq: 9
  };

  const refreshed = await controller.refreshCanonicalDatasetAfterMutation('authorise', result, {
    active_row_key: partial.row_key,
    affected_row_keys: [partial.row_key, failed.row_key],
    active_affected: true,
    fallback_row_keys: [failed.row_key],
    checkbox_selection: clone(state.selected_row_keys_by_section),
    source: 'selected-bulk',
    preserve_checkbox_selection: false,
    section_scroll_top: {}
  });

  assert.equal(refreshed, true);
  assert.equal(result.canonical_dataset_refreshed, true);
  assert.equal(state.dataset.rows[0].candidate_name, 'Full Candidate A');
  assert.equal(state.dataset.rows[0].client_name, 'Full Client A');
  assert.deepEqual(Array.from(state.selected_row_keys), []);
  assert.equal(state.selected_section, null);
  assert.deepEqual(Array.from(state.selected_row_keys_by_section.processed_eligible), ['timesheet:B']);
  assert.equal(state.active_row_key, 'timesheet:B');
  assert.equal(state.active_row.candidate_name, 'Full Candidate B');
});

test('a zero-success authorise restores the canonical processed row and its fresh context', async () => {
  const active = row('timesheet:A', 'processed_eligible', {
    is_authorised: false,
    can_bulk_authorise: true,
    read_only: false
  });
  const state = stateFor([active], active.row_key);
  const retainedEvidence = [{ id: 'evidence:current', kind: 'ACCOMMODATION' }];
  state.active_context = {
    row: clone(active),
    action_flags: { can_bulk_authorise: true, read_only: false },
    evidence: clone(retainedEvidence),
    evidence_loaded: true,
    profile: 'full'
  };
  const canonical = { rows: [active], counts: { total: 1 } };
  let fullContextRefreshes = 0;
  const { win } = installHarness(state, {
    async fetchBulkAuthoriseDataset() { return clone(canonical); },
    async refreshBulkAuthoriseActiveContext() {
      fullContextRefreshes += 1;
      return true;
    },
    async handleBulkAuthoriseSelected() {
      state.selected_row_keys = [active.row_key];
      state.selected_section = 'processed_eligible';
      state.active_context = {
        row: row(active.row_key, 'authorised_eligible', { is_authorised: true, read_only: true }),
        action_flags: { can_bulk_authorise: false, read_only: true },
        evidence: clone(retainedEvidence),
        evidence_loaded: true,
        profile: 'full'
      };
      return {
        ok: false,
        batch_completed: false,
        success_count: 0,
        failure_count: 1,
        failed_items: [{ row_key: active.row_key, error_code: 'EVIDENCE_REQUIRED' }]
      };
    }
  });

  const result = await win.handleBulkAuthoriseSelected(state, {});

  assert.equal(result.failed_mutation_reconciled, true);
  assert.equal(state.active_row_key, active.row_key);
  assert.equal(state.active_row.bulk_authorise_section, 'processed_eligible');
  assert.equal(state.active_context.row.bulk_authorise_section, 'processed_eligible');
  assert.equal(state.active_context.row.read_only, false);
  assert.deepEqual(state.active_context.evidence, retainedEvidence);
  assert.equal(state.active_context.profile, 'full');
  assert.equal(fullContextRefreshes, 0);
  assert.deepEqual(Array.from(state.selected_row_keys), []);
  assert.equal(state.selected_section, null);
  assert.equal(state.lifecycle_refresh_failed, false);
  assert.equal(result.refresh_failed, false);
});

test('authorising the active row selects its original successor without wrapping to the top', async () => {
  const first = row('timesheet:A');
  const active = row('timesheet:B');
  const successor = row('timesheet:C');
  const state = stateFor([first, active, successor], active.row_key);
  state.selected_row_keys = [active.row_key];
  state.selected_section = 'processed_eligible';
  const canonical = {
    rows: [first, row(active.row_key, 'authorised_eligible'), successor],
    counts: { total: 3 }
  };
  const { win } = installHarness(state, {
    async fetchBulkAuthoriseDataset() { return clone(canonical); },
    async handleBulkAuthoriseSelected() {
      return { ok: true, batch_completed: true, success_count: 1, failed_items: [], mutationSeq: 12 };
    }
  });

  await win.handleBulkAuthoriseSelected(state, {});

  assert.equal(state.active_row_key, successor.row_key);
  assert.deepEqual(Array.from(state.selected_row_keys), []);
});

test('authorising the final processed row leaves a clean empty selection', async () => {
  const active = row('timesheet:A');
  const alreadyAuthorised = row('timesheet:B', 'authorised_eligible');
  const state = stateFor([active, alreadyAuthorised], active.row_key);
  state.selected_row_keys = [active.row_key];
  state.selected_section = 'processed_eligible';
  const canonical = {
    rows: [row(active.row_key, 'authorised_eligible'), alreadyAuthorised],
    counts: { total: 2 }
  };
  const { win } = installHarness(state, {
    async fetchBulkAuthoriseDataset() { return clone(canonical); },
    async handleBulkAuthoriseSelected() {
      return { ok: true, batch_completed: true, success_count: 1, failed_items: [], mutationSeq: 13 };
    }
  });

  await win.handleBulkAuthoriseSelected(state, {});

  assert.equal(state.active_row_key, null);
  assert.equal(state.active_row, null);
  assert.deepEqual(Array.from(state.selected_row_keys), []);
});

test('unauthorising a row keeps it active without changing checkbox state', async () => {
  const active = row('timesheet:A', 'authorised_eligible');
  const other = row('timesheet:B', 'authorised_eligible');
  const state = stateFor([active, other], active.row_key);
  const canonical = {
    rows: [row(active.row_key, 'processed_eligible'), other],
    counts: { total: 2 }
  };
  const { win } = installHarness(state, {
    async fetchBulkAuthoriseDataset() { return clone(canonical); },
    async handleBulkUnauthoriseSelected() {
      return { ok: true, batch_completed: true, success_count: 1, failed_items: [], mutationSeq: 14 };
    }
  });

  await win.handleBulkUnauthoriseSelected(state, {});

  assert.equal(state.active_row_key, active.row_key);
  assert.equal(state.active_row.bulk_authorise_section, 'processed_eligible');
  assert.deepEqual(Array.from(state.selected_row_keys), []);
  assert.equal(state.selected_section, null);
  assert.deepEqual(Array.from(state.selected_row_keys_by_section.processed_eligible), []);
  assert.deepEqual(Array.from(state.selected_row_keys_by_section.authorised_eligible), []);
});

test('a bulk unauthorise consumes successes but leaves failed checkboxes for retry', async () => {
  const active = row('timesheet:A', 'authorised_eligible');
  const failed = row('timesheet:B', 'authorised_eligible');
  const state = stateFor([active, failed], active.row_key);
  state.selected_row_keys_by_section.authorised_eligible = [active.row_key, failed.row_key];
  state.selected_row_keys = [active.row_key, failed.row_key];
  state.selected_section = 'authorised_eligible';
  const canonical = {
    rows: [row(active.row_key, 'processed_eligible'), failed],
    counts: { total: 2 }
  };
  const { win } = installHarness(state, {
    async fetchBulkAuthoriseDataset() { return clone(canonical); },
    async handleBulkUnauthoriseSelected() {
      return {
        ok: true,
        batch_completed: true,
        success_count: 1,
        failed_items: [{ row_key: failed.row_key }],
        mutationSeq: 15
      };
    }
  });

  await win.handleBulkUnauthoriseSelected(state, { source: 'selected-bulk' });

  assert.deepEqual(Array.from(state.selected_row_keys), []);
  assert.equal(state.selected_section, null);
  assert.deepEqual(Array.from(state.selected_row_keys_by_section.authorised_eligible), [failed.row_key]);
});

test('the right-pane action renders once more after its modal spinner has cleared', async () => {
  const active = row('timesheet:A');
  const state = stateFor([active], active.row_key);
  const renderStates = [];
  const { controller } = installHarness(state, {
    async handleBulkAuthoriseSelected() {
      return { ok: false, batch_completed: false, success_count: 0 };
    },
    async withExistingModalLoadingSpinner(current, _label, run) {
      current.__workbench_modal_spinner_active = true;
      try {
        return await run();
      } finally {
        current.__workbench_modal_spinner_active = false;
      }
    },
    async rerenderBulkAuthoriseWorkbench(current, reason) {
      renderStates.push({
        reason,
        spinnerActive: current.__workbench_modal_spinner_active === true
      });
      return true;
    }
  });
  const button = {
    id: 'bulkAuthActionRowAuthoriseBtn',
    disabled: false,
    dataset: {},
    getAttribute() { return ''; }
  };

  await controller.runOwnedAction(button);

  assert.ok(renderStates.length >= 1);
  assert.match(renderStates.at(-1).reason, /AUTHORISE-ACTION-SETTLED/);
  assert.equal(renderStates.at(-1).spinnerActive, false);
});

test('required physical evidence uses a UI confirmation before authorise', async () => {
  const active = row('timesheet:A', 'processed_eligible', {
    client_no_timesheet_required: false,
    __evidence_badges_verified: true,
    evidence_badges: []
  });
  const state = stateFor([active], active.row_key);
  let handlerCalls = 0;
  let confirmation = null;
  const { controller } = installHarness(state, {
    __bulkAuthoriseEvidenceControllerTest: {
      controllerFor() {
        return {
          isTimesheets() { return false; },
          async hydrateDatasetBadges() { return { applied: true }; }
        };
      }
    },
    async openUiConfirmModal(options) {
      confirmation = options;
      return { confirmed: false };
    },
    async handleBulkAuthoriseSelected() {
      handlerCalls += 1;
      return { ok: true, success_count: 1 };
    }
  });
  const button = {
    id: 'bulkAuthActionRowAuthoriseBtn',
    disabled: false,
    dataset: {},
    getAttribute() { return ''; }
  };

  assert.equal(await controller.runOwnedAction(button), false);
  assert.equal(handlerCalls, 0);
  assert.equal(confirmation.title, 'Missing timesheet image');
  assert.equal(confirmation.message, 'This timesheet has no physical timesheet image attached. Are you sure you want to continue?');
  assert.equal(confirmation.cancel_label, 'Cancel');
});

test('effective no-timesheet-required settings skip the physical evidence warning', async () => {
  const active = row('timesheet:A', 'processed_eligible', {
    client_no_timesheet_required: true,
    __evidence_badges_verified: true,
    evidence_badges: []
  });
  const state = stateFor([active], active.row_key);
  let confirmationCalls = 0;
  let handlerCalls = 0;
  const { controller } = installHarness(state, {
    async openUiConfirmModal() {
      confirmationCalls += 1;
      return { confirmed: false };
    },
    async handleBulkAuthoriseSelected() {
      handlerCalls += 1;
      return { ok: false, batch_completed: false, success_count: 0 };
    }
  });
  const button = {
    id: 'bulkAuthActionRowAuthoriseBtn',
    disabled: false,
    dataset: {},
    getAttribute() { return ''; }
  };

  await controller.runOwnedAction(button);
  assert.equal(confirmationCalls, 0);
  assert.equal(handlerCalls, 1);
});

test('a right-pane action preserves every checkbox while the active row moves section', async () => {
  const active = row('timesheet:A', 'processed_eligible');
  const processedOther = row('timesheet:B', 'processed_eligible');
  const authorisedOther = row('timesheet:C', 'authorised_eligible');
  const state = stateFor([active, processedOther, authorisedOther], active.row_key);
  state.selected_row_keys_by_section.processed_eligible = [active.row_key, processedOther.row_key];
  state.selected_row_keys_by_section.authorised_eligible = [authorisedOther.row_key];
  const canonical = {
    rows: [row(active.row_key, 'authorised_eligible'), processedOther, authorisedOther],
    counts: { total: 3 }
  };
  const { win } = installHarness(state, {
    async fetchBulkAuthoriseDataset() { return clone(canonical); },
    async handleBulkAuthoriseSelected() {
      return { ok: true, batch_completed: true, success_count: 1, failed_items: [], mutationSeq: 20 };
    }
  });

  await win.handleBulkAuthoriseSelected(state, { source: 'action-row' });

  assert.deepEqual(Array.from(state.selected_row_keys_by_section.processed_eligible), [processedOther.row_key]);
  assert.deepEqual(Array.from(state.selected_row_keys_by_section.authorised_eligible), [active.row_key, authorisedOther.row_key]);
});

test('authorised Additional Rates controls are locked only inside Bulk Authorise', () => {
  const active = row('timesheet:A', 'authorised_eligible', { is_authorised: true });
  const state = stateFor([active], active.row_key);
  const input = {
    disabled: false,
    readOnly: false,
    title: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const { controller, root } = installHarness(state);
  root.querySelectorAll = (selector) => selector.includes('input[data-extra-code]') ? [input] : [];

  controller.stampRoot();

  assert.equal(input.disabled, true);
  assert.equal(input.readOnly, true);
  assert.equal(input.attributes['data-bulk-authorise-authorised-lock'], '1');
});

test('an invoice-locked authorised row still locks Additional Rates when its action section is empty', () => {
  const active = row('timesheet:A', '', { is_authorised: false });
  const state = stateFor([active], active.row_key);
  const input = {
    disabled: false,
    readOnly: false,
    title: '',
    setAttribute() {}
  };
  const renderedRow = {
    getAttribute(name) {
      if (name === 'data-row-key') return active.row_key;
      if (name === 'data-section') return 'authorised_eligible';
      if (name === 'style') return 'border-color:var(--accent,#6ea8fe);';
      return '';
    }
  };
  const { controller, root } = installHarness(state);
  root.querySelectorAll = (selector) => {
    if (selector.includes('[data-bulk-authorise-row')) return [renderedRow];
    if (selector.includes('input[data-extra-code]')) return [input];
    return [];
  };

  controller.stampRoot();

  assert.equal(input.disabled, true);
  assert.equal(input.readOnly, true);
});

test('modal dismissal invalidates the controller and clears row-owned state', async () => {
  const first = row('timesheet:A');
  const state = stateFor([first], first.row_key);
  const { controller, frame } = installHarness(state);
  controller.attachFrameTeardown();

  frame._onDismiss();

  assert.equal(frame.dismissed, true);
  assert.equal(controller.closed, true);
  assert.equal(state.active_row, null);
  assert.equal(state.evidence_pane_state.queue_rows.length, 0);
  assert.equal(await controller.transitionToRow(first.row_key), false);
});

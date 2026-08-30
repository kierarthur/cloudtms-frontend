const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

function sliceBetween(start, end) {
  const from = mainSource.indexOf(start);
  const to = mainSource.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return mainSource.slice(from, to);
}

test('selection drift displays a specific readable cancellation explanation', async () => {
  const source = sliceBetween('  const showCancelFailureModal =', '  const resolvePayState =');
  let modalInput = null;
  const context = {
    id: 'test-batch-id',
    isDraftDeleteMode: true,
    window: {},
    console: { error() {} },
    Number,
    String,
    Math,
    Object,
    Array,
    extractCancelFailurePayload(value) { return value; },
    isPlainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); },
    upper(value) { return String(value == null ? '' : value).trim().toUpperCase(); },
    formatCancelFailureSummary() { return ''; },
    resolvePayState() { return null; },
    async openUiConfirmModal(input) { modalInput = input; return true; }
  };
  vm.runInNewContext(`${source}\nglobalThis.showCancelFailureModalForTest = showCancelFailureModal;`, context, { filename: 'cancel-draft-error-ui.js' });

  const result = await context.showCancelFailureModalForTest({ code: 'WORK_SELECTION_DRIFT' });

  assert.equal(result.error_code, 'WORK_SELECTION_DRIFT');
  assert.equal(result.title, 'Cancel Draft Batch selection could not be verified');
  assert.match(result.message, /could not safely select the full frozen draft/);
  assert.match(result.message, /Nothing was cancelled/);
  assert.match(result.message, /Refresh Banking Pay and try again/);
  assert.equal(modalInput.title, result.title);
  assert.equal(modalInput.message, result.message);
  assert.equal(modalInput.hide_cancel, true);
});

test('safe draft cancellation remains available after a pre-provider review failure', () => {
  const source = sliceBetween('  const canShowDraftCancel = !!(', '  const canShowCancelReverseCorrectPanel = !!(');

  assert.match(source, /overviewCancelMode === 'DRAFT_DELETE'/);
  assert.match(source, /providerSubmitOverviewModel\.hasIssue !== true/);
  assert.match(source, /overviewHasExecutionEvidence !== true/);
  assert.doesNotMatch(source, /!activePaymentExecuteOperation/);
  assert.doesNotMatch(source, /!reviewRequired/);
});

test('a stopped payment operation waiting for user review does not impersonate provider activity', () => {
  const source = sliceBetween(
    "  const terminalOperationStatuses = new Set(['COMPLETE'",
    '  const activeOperationStatuses = new Set('
  );

  assert.match(source, /'REVIEW_REQUIRED'/);
  assert.match(source, /'WAITING_USER_REVIEW'/);
});

test('successful draft cancellation immediately clears only affected visible selections', () => {
  const source = sliceBetween(
    '  const reconcileCancelPatchSelectionState =',
    '  const markCancelPatchCandidatesRefreshing ='
  );
  const wizard = {
    workbench: {
      server_selected_preview_row_ids: ['cancelled-row', 'unrelated-row'],
      selected_preview_row_ids: ['cancelled-row', 'unrelated-row']
    },
    decisions: {
      server_selected_preview_row_ids: ['cancelled-row', 'unrelated-row'],
      selected_preview_row_ids: ['cancelled-row', 'unrelated-row']
    },
    selected_preview_row_ids: ['cancelled-row', 'unrelated-row'],
    local_selected_preview_row_ids_dirty: true
  };
  const context = {
    Set,
    Array,
    String,
    Object,
    isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); },
    resolvePayState() { return { draftWizard: wizard }; },
    readPatchPreviewRows(value) { return Array.isArray(value?.rows) ? value.rows : []; },
    readIdsFromCancelPatch(value, ...keys) { return keys.flatMap((key) => Array.isArray(value?.[key]) ? value[key] : []); },
    upper(value) { return String(value == null ? '' : value).trim().toUpperCase(); },
    uniqStrings(...values) {
      const out = [];
      const add = (value) => {
        if (Array.isArray(value)) return value.forEach(add);
        const text = String(value == null ? '' : value).trim();
        if (text && !out.includes(text)) out.push(text);
      };
      values.forEach(add);
      return out;
    }
  };
  vm.runInNewContext(
    `${source}\nglobalThis.reconcileCancelPatchSelectionStateForTest = reconcileCancelPatchSelectionState;`,
    context,
    { filename: 'cancel-draft-selection-ui.js' }
  );

  const result = context.reconcileCancelPatchSelectionStateForTest({
    patched_row_ids: ['cancelled-row'],
    rows: [{
      preview_row_id: 'cancelled-row',
      selected: false,
      selection_state: 'UNSELECTED'
    }]
  });

  assert.equal(result.applied, true);
  assert.deepEqual(Array.from(result.removed_preview_row_ids), ['cancelled-row']);
  assert.deepEqual(Array.from(wizard.workbench.server_selected_preview_row_ids), ['unrelated-row']);
  assert.deepEqual(Array.from(wizard.decisions.selected_preview_row_ids), ['unrelated-row']);
  assert.equal(wizard.workbench.server_selected_preview_row_ids_provided, true);
  assert.equal(wizard.selected_preview_row_mode, 'EXPLICIT_SUBSET');
  assert.equal(wizard.local_selected_preview_row_ids_dirty, false);
});

test('settled candidate refresh removes a cancelled row tick from every paged cache', () => {
  const source = sliceBetween(
    'function mergePayWorkbenchCandidatePreviewIntoState',
    'async function pollPayWorkbenchCandidateUntilSettled'
  );
  const candidateId = 'bfdc14ec-82a6-566c-b6d5-bf760ecaf030';
  const previewRowId = '52aea6d8-cdd9-4c5f-bb87-32ceff983735';
  const staleRow = {
    preview_row_id: previewRowId,
    candidate_id: candidateId,
    presentation_section: 'READY_TO_PAY',
    status: 'READY',
    selected: true,
    selection_state: 'SELECTED',
    selection_allowed: true,
    draftable: true,
    is_ready_for_draft: true,
    row_json: {
      preview_row_id: previewRowId,
      candidate_id: candidateId,
      selected: true,
      selection_state: 'SELECTED'
    }
  };
  const freshRow = {
    ...staleRow,
    selected: false,
    selection_state: 'UNSELECTED',
    row_json: {
      ...staleRow.row_json,
      selected: false,
      selection_state: 'UNSELECTED'
    }
  };
  const makePageMap = () => ({
    canonical_preview_lines: {
      section: 'canonical_preview_lines',
      resolved_section: 'canonical_preview_lines',
      rows: [structuredClone(staleRow)],
      items: [structuredClone(staleRow)],
      returned_count: 1,
      rows_count: 1
    }
  });
  const wizard = {
    preview: {
      data: {
        session_id: 'f3523145-c8d6-42e1-9e95-510e4da1db67',
        session: {
          session_id: 'f3523145-c8d6-42e1-9e95-510e4da1db67',
          session_version: 7,
          server_selected_preview_row_ids_provided: true,
          server_selected_preview_row_ids: [previewRowId]
        },
        preview: {
          canonical_preview_lines: [structuredClone(staleRow)],
          preview_pages: makePageMap()
        }
      },
      preview_pages: makePageMap(),
      componentStateCache: {
        canonical_preview_lines: [structuredClone(staleRow)],
        ready_preview_lines: [structuredClone(staleRow)],
        ready_to_pay_now: [structuredClone(staleRow)],
        draftable_now: [structuredClone(staleRow)]
      }
    },
    workbench: {
      session_id: 'f3523145-c8d6-42e1-9e95-510e4da1db67',
      session_version: 7,
      server_selected_preview_row_ids_provided: true,
      server_selected_preview_row_ids: [previewRowId],
      preview_pages: makePageMap(),
      preview_page_cache: makePageMap(),
      canonical_preview_lines: [structuredClone(staleRow)]
    },
    decisions: {
      session_id: 'f3523145-c8d6-42e1-9e95-510e4da1db67',
      server_selected_preview_row_ids_provided: true,
      server_selected_preview_row_ids: [previewRowId],
      selected_preview_row_ids: [previewRowId]
    },
    selected_preview_row_mode: 'EXPLICIT_SUBSET',
    local_selected_preview_row_ids_dirty: false
  };
  const context = {
    Set,
    WeakSet,
    Array,
    String,
    Number,
    Object,
    Date,
    Math,
    structuredClone,
    createBankingPayGraphCloneV1() {
      return (value) => structuredClone(value);
    }
  };
  vm.runInNewContext(
    `${source}\nglobalThis.mergePayWorkbenchCandidatePreviewIntoStateForTest = mergePayWorkbenchCandidatePreviewIntoState;`,
    context,
    { filename: 'candidate-refresh-selection-cache.js' }
  );

  const state = { pay: { draftWizard: wizard } };
  context.mergePayWorkbenchCandidatePreviewIntoStateForTest({
    ok: true,
    ready: true,
    status: 'READY',
    session_id: 'f3523145-c8d6-42e1-9e95-510e4da1db67',
    session_version: 7,
    candidate_id: candidateId,
    server_selected_preview_row_ids_provided: true,
    server_selected_preview_row_ids: [],
    canonical_preview_lines: [freshRow],
    ready_to_pay_now: [freshRow],
    draftable_now: [freshRow],
    ready_preview_lines: [freshRow]
  }, state);

  for (const [label, row] of [
    ['workbench preview pages', wizard.workbench.preview_pages.canonical_preview_lines.rows[0]],
    ['workbench preview-page cache', wizard.workbench.preview_page_cache.canonical_preview_lines.items[0]],
    ['preview pages', wizard.preview.preview_pages.canonical_preview_lines.rows[0]],
    ['preview data pages', wizard.preview.data.preview.preview_pages.canonical_preview_lines.rows[0]],
    ['component cache', wizard.preview.componentStateCache.ready_to_pay_now[0]],
    ['workbench canonical rows', wizard.workbench.canonical_preview_lines[0]]
  ]) {
    assert.ok(row, `${label} should retain the row`);
    assert.equal(row.selected, false);
    assert.equal(row.selection_state, 'UNSELECTED');
    assert.equal(row.row_json.selected, false);
    assert.equal(row.row_json.selection_state, 'UNSELECTED');
  }
  assert.deepEqual(Array.from(wizard.workbench.server_selected_preview_row_ids), []);
  assert.equal(wizard.workbench.server_selected_preview_row_ids_provided, true);
  assert.deepEqual(Array.from(wizard.decisions.selected_preview_row_ids), []);
  assert.equal(wizard.selected_preview_row_mode, 'EXPLICIT_NONE');
});

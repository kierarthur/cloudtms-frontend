const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `expected source range ${startMarker} -> ${endMarker}`);
  return mainSource.slice(start, end);
}

function installListHarness(document = {}) {
  const source = sliceBetween('function getBulkProcessVisibleRows(state)', 'async function attachQueueItemToTimesheetEvidence');
  const context = {
    document,
    html: (value) => String(value ?? ''),
    escapeHtml: (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;'),
    setTimeout,
    clearTimeout,
    String,
    Number,
    Math,
    Set,
    Map,
    Array,
    Object
  };
  vm.runInNewContext(source, context, { filename: 'bulk-process-lists.js' });
  return context;
}

test('Bulk Process row statuses are pills and daily rows display work_date', () => {
  const harness = installListHarness();
  const markup = harness.renderBulkProcessLists({
    active_row_key: 'timesheet:daily-1',
    active_row: { row_key: 'timesheet:daily-1', timesheet_id: 'daily-1' },
    dataset: {
      unprocessed_rows: [{
        row_key: 'contract_week:weekly-1',
        contract_week_id: 'weekly-1',
        candidate_name: 'Weekly Person',
        client_name: 'Weekly Client',
        sheet_scope: 'WEEKLY',
        week_ending_date: '2026-07-19'
      }],
      processed_rows: [{
        row_key: 'timesheet:daily-1',
        timesheet_id: 'daily-1',
        candidate_name: 'Daily Person',
        client_name: 'Daily Client',
        sheet_scope: 'DAILY',
        week_ending_date: '2026-07-19',
        work_date: '2026-07-15'
      }]
    },
    filters: { show_weekly_manual: true, show_daily_manual: true }
  });

  assert.match(markup, /class="pill bulk-process-lifecycle-badge bulk-process-lifecycle-badge--unprocessed" data-bulk-process-lifecycle="Unprocessed"/);
  assert.match(markup, /class="pill pill-ok bulk-process-lifecycle-badge bulk-process-lifecycle-badge--processed" data-bulk-process-lifecycle="Processed"/);
  assert.match(markup, /15-07-2026/);
  assert.doesNotMatch(markup, /15-07-2026[\s\S]{0,160}19-07-2026/);
  assert.match(markup, /bulkProcessUnprocessedList" style="[^"]*overflow-y:auto/);
  assert.match(markup, /bulkProcessProcessedList" style="[^"]*overflow-y:auto/);
  assert.match(markup, /bulkProcessListsRoot" style="[^"]*overflow:hidden/);
});

test('Bulk Process row activation captures scroll before focus and restores both section lists', async () => {
  const listeners = {};
  const rowEl = {
    dataset: {},
    getAttribute(name) { return name === 'data-row-key' ? 'timesheet:row-2' : ''; },
    addEventListener(name, handler) { listeners[name] = handler; }
  };
  const leftPane = { scrollTop: 0 };
  const unprocessed = { scrollTop: 17 };
  const processed = { scrollTop: 43 };
  const root = {
    dataset: {},
    querySelectorAll() { return [rowEl]; }
  };
  const document = {
    getElementById(id) {
      return {
        bulkProcessListsRoot: root,
        bulkProcessLeftPane: leftPane,
        bulkProcessUnprocessedList: unprocessed,
        bulkProcessProcessedList: processed
      }[id] || null;
    }
  };
  const harness = installListHarness(document);
  harness.handleBulkProcessRowChange = async () => {
    leftPane.scrollTop = 99;
    unprocessed.scrollTop = 88;
    processed.scrollTop = 77;
    return true;
  };
  const state = {};
  harness.bindBulkProcessLists(state);

  let prevented = false;
  listeners.pointerdown({ button: 0, preventDefault() { prevented = true; } });
  leftPane.scrollTop = 12;
  unprocessed.scrollTop = 34;
  processed.scrollTop = 56;
  await listeners.click();

  assert.equal(prevented, true);
  assert.equal(state.__bulk_process_left_pane_scroll.container, 0);
  assert.equal(state.__bulk_process_left_pane_scroll.unprocessed, 17);
  assert.equal(state.__bulk_process_left_pane_scroll.processed, 43);
  assert.equal(leftPane.scrollTop, 0);
  assert.equal(unprocessed.scrollTop, 17);
  assert.equal(processed.scrollTop, 43);
});

test('selected summary keeps canonical dataset identity and daily date through sparse hydration', () => {
  const source = sliceBetween('function renderBulkProcessSelectedSummaryStrip(state)', 'function renderBulkProcessEvidencePane(state)');
  const context = {
    html: (value) => String(value ?? ''),
    escapeHtml: (value) => String(value ?? ''),
    String,
    Number,
    Array,
    Object,
    Set
  };
  vm.runInNewContext(source, context, { filename: 'bulk-process-summary.js' });
  const markup = context.renderBulkProcessSelectedSummaryStrip({
    active_row_key: 'timesheet:daily-1',
    active_row: {
      row_key: 'timesheet:daily-1',
      timesheet_id: 'daily-1',
      candidate_name: 'normalised sparse name',
      sheet_scope: 'DAILY',
      work_date: '2026-07-15'
    },
    dataset: {
      unprocessed_rows: [],
      processed_rows: [{
        row_key: 'timesheet:daily-1',
        timesheet_id: 'daily-1',
        candidate_name: 'Daily Person',
        client_name: 'Canonical Client',
        sheet_scope: 'DAILY',
        work_date: '2026-07-15',
        week_ending_date: '2026-07-19'
      }]
    },
    active_context: { row_key: 'timesheet:daily-1', details: { candidate_name: 'lowercase' } },
    active_ctx: { row: { row_key: 'timesheet:daily-1', candidate_name: 'lowercase' }, details: {}, state: {} }
  });

  assert.match(markup, /Daily Person/);
  assert.match(markup, /Canonical Client/);
  assert.match(markup, /15-07-2026/);
  assert.doesNotMatch(markup, />lowercase</);
});

test('Bulk Process preview/evidence waits for a coherent row context instead of publishing partial thumbnails', () => {
  const previewSource = sliceBetween('function renderBulkProcessPreviewPane(state)', 'function bindBulkProcessPreviewPane(state)');
  const evidenceSource = sliceBetween('function renderBulkProcessEvidencePane(state)', 'function bindBulkProcessEvidencePane(state)');
  assert.match(previewSource, /data-bulk-process-preview-settling="\$\{previewSettling \? '1' : '0'\}"/);
  assert.match(evidenceSource, /data-bulk-process-evidence-settling="\$\{evidenceSettling \? '1' : '0'\}"/);
  assert.match(previewSource, /data-bulk-process-preview-content="1"/);
  assert.match(evidenceSource, /data-bulk-process-evidence-content="1"/);
  assert.match(previewSource, /previewSettling \? 'opacity:0;pointer-events:none;'/);
  assert.match(evidenceSource, /evidenceSettling \? 'opacity:0;pointer-events:none;'/);
  assert.match(previewSource, /st\.__active_context_pending === true/);
  assert.match(evidenceSource, /st\.__active_context_pending === true/);
});

test('Bulk Process reuses a bounded asset blob cache without changing Bulk Authorise preview rendering', () => {
  const previewSource = sliceBetween('function renderBulkProcessPreviewPane(state)', 'function bindBulkProcessPreviewPane(state)');
  const binderSource = sliceBetween('function bindBulkProcessPreviewPane(state)', 'function bindBulkProcessEvidencePane(state)');
  assert.match(previewSource, /bindBulkProcessPreviewPane\.__bulkProcessPreviewAssetBlobCache/);
  assert.match(previewSource, /const previewAssetDisplayUrl = renderIsBulkAuthorisePreviewState \? signedUrl : cachedPreviewAssetBlobUrl;/);
  assert.match(previewSource, /const hasDisplayableCurrentPreview =/);
  assert.match(previewSource, /src="\$\{enc\(previewAssetDisplayUrl\)\}"/);
  assert.match(binderSource, /const getBulkProcessPreviewAssetBlobCache = \(\) => \{/);
  assert.match(binderSource, /const isBulkAuthorisePreviewContext = !!bulkAuthoriseSurfaceAtBind && !!trimStr\(bulkAuthoriseOwnerIdentity \|\| ''\);/);
  assert.match(binderSource, /if \(isBulkAuthorisePreviewContext\) return null;/);
  assert.match(binderSource, /holder\.ownerState !== st/);
  assert.match(binderSource, /URL\.createObjectURL\(blob\)/);
  assert.match(binderSource, /URL\.revokeObjectURL\(oldest\.objectUrl\)/);
  assert.match(binderSource, /while \(cache\.size > 12\)/);
  assert.match(binderSource, /holder\.inflight\.has\(cacheKey\)/);
  assert.match(binderSource, /data-bulk-process-preview-asset-loading="1"/);
  assert.match(binderSource, /commitBulkProcessPreviewAssetBlobIfCurrent/);
  assert.match(binderSource, /const renderImageStageWithUrl =/);
  assert.match(binderSource, /const renderPdfStageWithUrl =/);
  assert.match(binderSource, /const renderBulkAuthoriseLiveImageStage =/);
  assert.match(binderSource, /if \(isBulkAuthorisePreviewContext\) \{\s*renderBulkAuthoriseLiveImageStage/);
  assert.match(binderSource, /else \{\s*renderImageStage\(stage, signedUrl, liveFileKey/);
});

test('empty Attached is identity-scoped and Queue does not discard the remembered attached selection', () => {
  const binderSource = sliceBetween('function bindBulkProcessEvidencePane(state)', 'function renderBulkProcessManualEditor(state)');
  const evidenceSource = sliceBetween('function renderBulkProcessEvidencePane(state)', 'function bindBulkProcessEvidencePane(state)');
  const reconcileSource = sliceBetween('function reconcileBulkProcessEvidenceStateAfterContextRefresh(state)', 'async function rerenderBulkProcessWorkbench(state, logPrefix)');
  assert.match(binderSource, /__attached_manual_override_identity = getActiveIdentity\(\)/);
  assert.match(binderSource, /__attached_selection_by_identity/);
  assert.match(binderSource, /__bulkProcessAttachedSelectionPreferences/);
  assert.match(binderSource, /getRememberedAttachedSelectionKey\(\) \|\|\s*pane\.__active_attached_preview_target/);
  assert.match(binderSource, /return \{ rows: \[\], badgeRows: \[\] \};/);
  assert.match(reconcileSource, /manualOverrideIdentity === activeIdentity/);
  assert.match(reconcileSource, /explicitBulkProcessTabPreference === 'attached'/);
  assert.match(reconcileSource, /manualOverride && \(hasAnyAttachedEvidence \|\| requestedSource === 'attached'\)/);
  assert.match(evidenceSource, /No attached evidence for this row\./);
});

test('NHSP/HR additional manual rows use the existing schedule renderer in forced read-only mode', () => {
  const editorSource = sliceBetween('function renderBulkProcessManualEditor(state)', 'function getBulkProcessRouteKindFromRow');
  const binderSource = sliceBetween('function bindBulkProcessManualEditor(state)', 'function getBulkProcessRouteKindFromRow');
  assert.doesNotMatch(editorSource, /if \(protectedNoTimesheetManualEditorRow && !earlyBulkAuthoriseManualContext\)/);
  assert.match(editorSource, /forceReadOnly: protectedNoTimesheetManualEditorRow/);
  assert.match(editorSource, /renderWeeklyManualScheduleEditor\(buildEditorOpts\(\)\)/);
  assert.match(editorSource, /renderDailyManualScheduleEditor\(buildEditorOpts\(\)\)/);
  assert.match(editorSource, /data-bulk-process-import-expense-readonly="1"/);
  assert.match(binderSource, /root\.querySelector\('\[data-bulk-process-import-expense-readonly="1"\]'\)/);
});

test('signed canonical dataset authority enables valid lifecycle actions without weakening mutation gates', () => {
  const classifierSource = sliceBetween('function classifyBulkProcessEditability(ctxInput)', 'function bindBulkProcessManualEditor(state)');
  const datasetRow = {
    row_key: 'contract_week:weekly-1',
    row_signature: 'weekly-signature-1',
    contract_week_id: 'weekly-1',
    sheet_scope: 'WEEKLY',
    submission_mode: 'MANUAL',
    summary_stage: 'UNPROCESSED',
    bulk_process_bucket: 'UNPROCESSED',
    processing_status: 'UNPROCESSED',
    route_family: 'MANUAL_NON_QR',
    is_archived: false,
    has_retained_financial_history: false,
    can_unprocess: false,
    unprocess_action_visible: false,
    review_only: false,
    can_edit_timesheet_data: true,
    can_save: true,
    can_process: true
  };
  const context = {
    window: { modalCtx: { bulkProcessState: { dataset: { unprocessed_rows: [datasetRow], processed_rows: [] } } } },
    classifyTimesheetEditDomains: () => ({
      isManualRoute: true,
      isQrRoute: false,
      isElectronicRoute: false,
      canEditHoursSchedule: true,
      canEditTimesheetData: true,
      canEditExpenses: false,
      canManageExpenseEvidence: false,
      canProcess: true,
      canUnprocess: false
    }),
    isTimesheetExpensesDraftDirty: () => ({ dirty: false }),
    String,
    Number,
    Array,
    Object,
    Set,
    Map,
    JSON
  };
  vm.runInNewContext(classifierSource, context, { filename: 'bulk-process-editability.js' });
  const editorCtx = {
    row_key: datasetRow.row_key,
    row_signature: 'editor-context-signature-1',
    profile: 'editor',
    context_profile: 'editor',
    editor_loaded: true,
    is_hydrated: true,
    schedule_authoritative: true,
    context_degraded: false,
    row: { ...datasetRow },
    details: {
      ...datasetRow,
      contract_week: { id: 'weekly-1', submission_mode_snapshot: 'MANUAL' }
    },
    state: {}
  };

  const freshEditor = context.classifyBulkProcessEditability(editorCtx);
  assert.equal(freshEditor.lifecycleAuthorityComplete, true);
  assert.equal(freshEditor.signedDatasetLifecycleAuthorityComplete, true);
  assert.equal(freshEditor.editorContextAuthorityComplete, true);
  assert.equal(freshEditor.editorDataAuthorityComplete, true);
  assert.equal(freshEditor.canEditHoursSchedule, true);
  assert.equal(freshEditor.canEditTimesheetData, true);
  assert.equal(freshEditor.canProcess, true);
  assert.equal(freshEditor.canUnprocess, false);

  const identityMismatch = context.classifyBulkProcessEditability({
    ...editorCtx,
    row_key: 'contract_week:other-week',
    row: { ...editorCtx.row, row_key: 'contract_week:other-week' }
  });
  assert.equal(identityMismatch.editorContextAuthorityComplete, false);
  assert.equal(identityMismatch.signedDatasetLifecycleAuthorityComplete, false);
  assert.equal(identityMismatch.canEditHoursSchedule, false);

  const incompleteMutationPatch = context.classifyBulkProcessEditability({
    ...editorCtx,
    permission_state_patch_complete: false,
    priority_badges_patch_complete: true,
    refresh_required: false
  });
  assert.equal(incompleteMutationPatch.editorContextAuthorityComplete, false);
  assert.equal(incompleteMutationPatch.signedDatasetLifecycleAuthorityComplete, false);
  assert.equal(incompleteMutationPatch.editorDataAuthorityComplete, false);
  assert.equal(incompleteMutationPatch.canEditHoursSchedule, false);
  assert.equal(incompleteMutationPatch.canProcess, false);
  assert.equal(incompleteMutationPatch.canUnprocess, false);

  const unsignedDatasetRow = { ...datasetRow };
  delete unsignedDatasetRow.row_signature;
  const unsignedContext = {
    ...context,
    window: { modalCtx: { bulkProcessState: { dataset: { unprocessed_rows: [unsignedDatasetRow], processed_rows: [] } } } }
  };
  vm.runInNewContext(classifierSource, unsignedContext, { filename: 'bulk-process-editability-unsigned.js' });
  const unsignedResult = unsignedContext.classifyBulkProcessEditability({
    ...editorCtx,
    row: { ...unsignedDatasetRow },
    details: { ...editorCtx.details, row_signature: '' }
  });
  assert.equal(unsignedResult.signedDatasetLifecycleAuthorityComplete, false);
  assert.equal(unsignedResult.canProcess, false);

  const retainedProcessedRow = {
    ...datasetRow,
    row_key: 'timesheet:retained-1',
    row_signature: 'retained-signature-1',
    timesheet_id: 'retained-1',
    contract_week_id: 'weekly-1',
    summary_stage: 'PROCESSED',
    bulk_process_bucket: 'PROCESSED',
    processing_status: 'PENDING_AUTH',
    has_retained_financial_history: true,
    can_process: false,
    can_unprocess: false,
    unprocess_action_visible: true
  };
  const retainedContext = {
    ...context,
    window: { modalCtx: { bulkProcessState: { dataset: { unprocessed_rows: [], processed_rows: [retainedProcessedRow] } } } }
  };
  vm.runInNewContext(classifierSource, retainedContext, { filename: 'bulk-process-editability-retained.js' });
  const retainedResult = retainedContext.classifyBulkProcessEditability({
    ...editorCtx,
    row_key: retainedProcessedRow.row_key,
    row: { ...retainedProcessedRow },
    details: {
      ...retainedProcessedRow,
      timesheet: { timesheet_id: 'retained-1', submission_mode: 'MANUAL', sheet_scope: 'WEEKLY' },
      contract_week: { id: 'weekly-1', submission_mode_snapshot: 'MANUAL' }
    }
  });
  assert.equal(retainedResult.lifecycleAuthorityComplete, true);
  assert.equal(retainedResult.hasRetainedFinancialHistory, true);
  assert.equal(retainedResult.canUnprocess, false);
});

test('Bulk Process modal is viewport bounded and the outer left pane is not scrollable', () => {
  assert.match(indexSource, /#modal\.bulk-process-workbench\{[\s\S]*width:min\(1660px, calc\(100vw - 16px\)\);[\s\S]*min-width:0;[\s\S]*max-width:calc\(100vw - 16px\);/);
  const shellSource = sliceBetween('function renderBulkProcessShell(state)', 'function getBulkProcessVisibleRows(state)');
  assert.match(shellSource, /id="bulkProcessLeftPane"[^>]*overflow:hidden/);
  assert.doesNotMatch(shellSource, /id="bulkProcessLeftPane"[^>]*overflow:auto/);
});

test('Bulk Process evidence removal exposes delete, return-to-queue, and cancel without changing Bulk Authorise choices', () => {
  const dialogSource = sliceBetween('function openBulkProcessEvidenceDispositionDialog()', 'function bindBulkProcessEvidencePane(state)');
  const binderSource = sliceBetween('function bindBulkProcessEvidencePane(state)', 'function normaliseBankingPayOperationProgress(operationPayload = {})');
  assert.match(dialogSource, /value: 'delete', label: 'Permanently delete'/);
  assert.match(dialogSource, /value: 'return-to-queue', label: 'Return to timesheet queue'/);
  assert.match(dialogSource, /value: 'cancel', label: 'Cancel'/);
  assert.match(binderSource, /if \(isBulkAuthoriseContext\) \{[\s\S]*confirm_label: 'Permanently delete',[\s\S]*cancel_label: 'Return to timesheet queue'/);
  assert.match(binderSource, /action = await openBulkProcessEvidenceDispositionDialog\(\);[\s\S]*\['delete', 'return-to-queue'\]\.includes\(action\)/);
  assert.doesNotMatch(binderSource, /window\.confirm\('Permanently delete this attached file\?'\)/);
});

test('Bulk Process recognises genuine staged contract-week evidence when reprocessing an unprocessed weekly row', () => {
  const processSource = sliceBetween('async function handleBulkProcessProcess(state)', 'function normaliseBulkProcessRemovedEvidenceKind(value)');
  assert.match(processSource, /const isActiveContractWeekStagedEvidence = !!\(/);
  assert.match(processSource, /status === 'STAGED'[\s\S]*\/\^contract_week:\/i\.test\(activeRowKey\)[\s\S]*processEvidenceStagedSignal\(item\) === true/);
  assert.match(processSource, /!!stagedQueueId[\s\S]*!isSyntheticEvidenceId\(stagedQueueId\)[\s\S]*!!evidenceKindOf\(item\)/);
  assert.match(processSource, /if \(status === 'QUEUED' \|\| status === 'DISCARDED'\) return false;/);
  assert.match(processSource, /if \(status === 'STAGED'\) return isActiveContractWeekStagedEvidence;/);
});

test('Process and Unprocess release lifecycle busy state before their final render', () => {
  const processSource = sliceBetween('async function handleBulkProcessProcess(state)', 'function normaliseBulkProcessRemovedEvidenceKind(value)');
  const unprocessSource = sliceBetween('async function handleBulkProcessUnprocess(state)', 'function applyBulkTimesheetRowPatches(state, patches, options = {})');
  assert.match(processSource, /mirrorBulkProcessProcessCompletionBusyFlags\(cleanReason, \{ releaseMutationToken: true \}\);[\s\S]*await st\.__rerenderWorkbench/);
  assert.match(processSource, /releaseProcessMutationToken\('process-error-reconciliation-complete-before-final-render'\);\s*await rerenderBulkProcessWorkbench/);
  assert.match(unprocessSource, /resetBusy\('success'\);\s*releaseLifecycleMutation\('success-before-final-render'\);\s*if \(typeof rerenderBulkProcessWorkbench/);
  assert.match(unprocessSource, /releaseLifecycleMutation\('error-before-final-render'\);\s*if \(typeof rerenderBulkProcessWorkbench/);
});

test('Bulk Process lifecycle actions resynchronise rendered action buttons after mutation', () => {
  const binderSource = sliceBetween('function bindBulkProcessManualEditor(state)', 'function renderBulkProcessEvidencePane(state)');
  const processSource = sliceBetween('async function handleBulkProcessProcess(state)', 'function normaliseBulkProcessRemovedEvidenceKind(value)');
  const unprocessSource = sliceBetween('async function handleBulkProcessUnprocess(state)', 'function applyBulkTimesheetRowPatches(state, patches, options = {})');

  assert.match(binderSource, /if \(!isBulkAuthoriseCtx\(\)\)\s*\{\s*st\.__syncBulkProcessPrimaryActionButtonStates = syncPrimaryActionButtonStates;/);
  assert.match(processSource, /st\.__syncBulkProcessPrimaryActionButtonStates\(\);[\s\S]*scheduleBulkProcessProcessCompletionButtonSafetyCheck/);
  assert.match(unprocessSource, /\[TS\]\[BULK-PROCESS\]\[UNPROCESS\]\[AFFECTED-REFRESHED\][\s\S]*st\.__syncBulkProcessPrimaryActionButtonStates\(\);/);
});

test('fresh signed row hydration replaces stale lifecycle flags on the matching dataset row', () => {
  const rowChangeSource = sliceBetween('async function handleBulkProcessRowChange(nextRowKey, options = {})', 'function reconcileBulkProcessStateAfterAction(state, nextDataset, snapshot, options = {})');
  assert.match(rowChangeSource, /const syncHydratedBulkProcessLifecycleToDataset = \(activeRowLike = \{\}\) => \{/);
  assert.match(rowChangeSource, /const activeSignature = trimStr\(activeRow\.backend_row_signature \|\| activeRow\.row_signature \|\| activeRow\.expected_row_signature/);
  assert.match(rowChangeSource, /\['unprocess_action_visible', 'show_unprocess', 'showUnprocess'\]/);
  assert.match(rowChangeSource, /\['refresh_required', 'requires_affected_row_refresh'\]/);
  assert.match(rowChangeSource, /syncHydratedBulkProcessLifecycleToDataset\(st\.active_row\);/);
  assert.match(rowChangeSource, /harmoniseHydratedBulkProcessLifecycleContext\(finalContext, st\.active_row\);/);
});

test('Bulk Process stale preview binds cannot overwrite a newer row preview', () => {
  const binderSource = sliceBetween('function bindBulkProcessPreviewPane(state)', 'function renderBulkProcessDockedEvidenceViewer(state)');

  assert.match(binderSource, /const isBulkProcessPreviewBind = !bulkAuthoriseSurfaceAtBind/);
  assert.match(binderSource, /root\.dataset\.bulkProcessPreviewBindToken = token/);
  assert.match(binderSource, /const liveRoot = document\.getElementById\('bulkProcessPreviewPaneRoot'\)/);
  assert.match(binderSource, /!root\.isConnected \|\| liveRoot !== root/);
  assert.match(binderSource, /root\.dataset\.bulkProcessPreviewBindToken/);
  assert.match(binderSource, /signedUrl = await presignRecord\.promise;\s*if \(isBulkProcessPreviewBind && !isActiveBind\(\)\) return;/);
  assert.match(binderSource, /if \(isBulkProcessPreviewBind && !signedUrl && isActiveBind\(\)\)/);
  assert.match(binderSource, /let bulkProcessMissingPresignRetryCount = 0/);
  assert.match(binderSource, /bulkProcessMissingPresignRetryCount < 1/);
  assert.match(binderSource, /Preview is loading…/);
  assert.match(binderSource, /Preview could not be loaded\. Select the preview item again to retry\./);
  assert.match(binderSource, /if \(\s*!signedUrl \|\|[\s\S]*?\) \{\s*if \(isBulkProcessPreviewBind && !isActiveBind\(\)\) return;/);
});

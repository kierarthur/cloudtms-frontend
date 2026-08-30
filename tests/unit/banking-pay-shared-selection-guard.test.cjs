const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

function sliceBetween(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  assert.ok(start >= 0, startMarker + ' must exist');
  const end = mainSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, endMarker + ' must follow ' + startMarker);
  return mainSource.slice(start, end);
}

test('selection authority accepts only the newest shared database revision', () => {
  const body = sliceBetween(
    'function bankingPaySelectionAuthorityDecisionV1',
    'function attachBankingModalDelegatedHandlers'
  );
  const context = { Array, Set, String, Number, Object };
  vm.runInNewContext(
    body + '\nthis.__decide = bankingPaySelectionAuthorityDecisionV1;',
    context,
    { filename: 'banking-selection-authority-decision.js' }
  );

  const current = {
    incomingSessionId: 'session-1',
    acceptedSessionId: 'session-1',
    incomingRevision: 42,
    acceptedRevision: 42,
    incomingMembershipProvided: true,
    acceptedMembershipProvided: true,
    incomingIds: ['row-2', 'row-1'],
    acceptedIds: ['row-1', 'row-2'],
    incomingModeProvided: true,
    acceptedModeProvided: true,
    incomingMode: 'IMPLICIT_ALL',
    acceptedMode: 'IMPLICIT_ALL'
  };
  assert.equal(context.__decide(current).suppress, false);
  assert.equal(
    context.__decide({ ...current, incomingRevision: 41 }).reason,
    'SELECTION_REVISION_BELOW_ACCEPTED_FLOOR'
  );
  assert.equal(
    context.__decide({ ...current, incomingIds: ['row-1'] }).reason,
    'SELECTION_SAME_REVISION_DIGEST_MISMATCH'
  );
  assert.equal(
    context.__decide({ ...current, incomingSessionId: 'session-old' }).reason,
    'SELECTION_SESSION_LINEAGE_MISMATCH'
  );
  assert.equal(
    context.__decide({ ...current, incomingMode: 'EXPLICIT_SUBSET' }).reason,
    'SELECTION_SAME_REVISION_MODE_MISMATCH'
  );
  assert.equal(
    context.__decide({ ...current, incomingMode: 'EXPLICIT_INCLUDE' }).reason,
    'SELECTION_SAME_REVISION_MODE_MISMATCH'
  );
  assert.equal(
    context.__decide({ ...current, incomingRevision: 43, incomingIds: ['row-3'] }).suppress,
    false
  );
});

test('mutation and preview adoption both use the same shared selection authority fence', () => {
  const mutationBody = sliceBetween(
    'const applySelectionPayloadSummaryToWizard =',
    'const togglePreviewRowSelection ='
  );
  const previewBody = sliceBetween(
    'function applyPayWorkbenchPreviewToState',
    'function mergePayWorkbenchCandidatePreviewIntoState'
  );

  assert.match(mutationBody, /bankingPaySelectionAuthorityDecisionV1/);
  assert.match(mutationBody, /if \(authorityDecision\.suppress\)/);
  assert.match(mutationBody, /acceptedMembershipProvided: existingServerSelectionProvided/);
  assert.match(mutationBody, /incomingMode: payloadMode/);
  assert.match(mutationBody, /acceptedMode: existingAuthoritativeSelectionMode/);
  assert.match(previewBody, /bankingPaySelectionAuthorityDecisionV1/);
  assert.match(previewBody, /suppressIncomingSelectionMembership = authorityDecision\.suppress/);
  assert.match(previewBody, /incomingMode: inferredIncomingAuthoritativeSelectionMode/);
  assert.match(previewBody, /acceptedMode: existingAuthoritativeSelectionMode/);
  assert.match(previewBody, /authoritative_selected_preview_row_mode = acceptedAuthoritativeSelectionMode/);
  assert.match(previewBody, /row\.selected = selected/);
});

test('successful selection changes store the returned server progress revision', () => {
  const body = sliceBetween(
    'const applySelectionPayloadSummaryToWizard =',
    'const togglePreviewRowSelection ='
  );

  assert.match(body, /payload\.progress_counter_version/);
  assert.match(body, /workbench\.progress_counter_version = progressCounterVersion/);
  assert.match(body, /decisions\.progress_counter_version = progressCounterVersion/);
});

test('selection requests use the highest adopted progress revision across overlapping page state', () => {
  const body = sliceBetween(
    'function bankingPayAugmentWorkbenchFreshnessPayload',
    'async function bankingPayWorkbenchSessionClearCaseResolution'
  );
  const state = {
    pay: {
      draftWizard: {
        selection_progress_counter_floor: 4491,
        workbench: {
          session_id: 'session-1',
          session_version: 16,
          progress_counter_version: 4489
        },
        decisions: {
          session_id: 'session-1',
          session_version: 16,
          progress_counter_version: 4489
        },
        preview: {
          data: {
            session_id: 'session-1',
            session_version: 16,
            progress_counter_version: 4489
          }
        }
      }
    }
  };
  const context = {
    JSON,
    String,
    Number,
    Object,
    Array,
    bankingGetState: () => state
  };
  vm.runInNewContext(
    body + '\nthis.__augment = bankingPayAugmentWorkbenchFreshnessPayload;',
    context,
    { filename: 'banking-selection-progress-monotonic.js' }
  );

  const payload = context.__augment('session-1', { section: 'canonical_preview_lines' });
  assert.equal(payload.expected_session_version, 16);
  assert.equal(payload.expected_progress_counter_version, 4491);
});

test('successful selection changes adopt mutation-owned Draft readiness without inventing the distinct eligible count', () => {
  const body = sliceBetween(
    'const applySelectionPayloadSummaryToWizard =',
    'const togglePreviewRowSelection ='
  );

  assert.match(body, /readyForDraftProvided/);
  assert.match(body, /workbench\.ready_for_draft = readyForDraft/);
  assert.match(body, /workbench\.can_create_draft = readyForDraft/);
  assert.match(body, /decisions\.ready_for_draft = readyForDraft/);
  assert.match(body, /preview\.data\.ready_for_draft = readyForDraft/);
  assert.match(body, /workbench\.draft_blocker_codes = safeBlockerCodes/);
  assert.match(body, /const authoritativeProgressNodes = \[/);
  assert.match(body, /workbench\.progress/);
  assert.match(body, /decisions\.progress/);
  assert.match(body, /preview\?\.data\?\.progress/);
  assert.match(body, /preview\?\.data\?\.preview\?\.progress/);
  assert.doesNotMatch(body, /node\.selected_eligible_ready_row_count = boundedSelectedCount/);
  assert.doesNotMatch(body, /node\.selected_rows_available = boundedSelectedCount > 0/);
  assert.match(body, /node\.ready_for_draft = readyForDraft/);
  assert.match(body, /node\.draft_blocker_codes = \[\.\.\.draftBlockerCodes\]/);
  assert.match(body, /node\.progress_counter_version = progressCounterVersion/);
});

test('selection changes respect an explicit incomplete server-selected-row set', () => {
  const body = sliceBetween(
    'const applySelectionPayloadSummaryToWizard =',
    'const togglePreviewRowSelection ='
  );

  assert.match(body, /Array\.isArray\(payload\.server_selected_preview_row_ids\)/);
  assert.match(body, /Object\.prototype\.hasOwnProperty\.call\(payload, 'server_selected_preview_row_ids_provided'\)/);
  assert.match(body, /payload\.server_selected_preview_row_ids_provided === true/);
  assert.match(body, /Object\.prototype\.hasOwnProperty\.call\(payload, 'selected_preview_row_ids_provided'\)/);
  assert.match(body, /payload\.selected_preview_row_ids_provided === true/);
  assert.match(body, /workbench\.server_selected_preview_row_ids_provided = serverSelectedIdsProvided/);
  assert.match(body, /local_selected_preview_row_ids_dirty = false/);
  assert.match(body, /localSelectedPreviewRowIdsDirty = false/);
});

test('all-pages selection adopts the authoritative mode without requiring a complete selected-ID array', () => {
  const body = sliceBetween(
    'const applySelectionPayloadSummaryToWizard =',
    'const togglePreviewRowSelection ='
  );

  assert.match(body, /const reportedPayloadMode = String\(/);
  assert.match(body, /payload\.selection_intent_mode/);
  assert.match(body, /selectedCount === 0\s*\? 'EXPLICIT_NONE'/);
  assert.match(body, /else if \(payloadMode === 'IMPLICIT_ALL' \|\| payloadMode === 'EXPLICIT_NONE'\)/);
  assert.match(body, /writePreviewSelectionState\(decisions, \[\], payloadMode\)/);
  assert.match(body, /workbench\.authoritative_selected_preview_row_mode = payloadMode/);
  assert.match(body, /selection_mutation_authority = \{/);
  assert.match(body, /progress_counter_version: progressCounterVersion/);
  assert.match(body, /getRenderedPreviewRowIds\(\),\s*payloadMode === 'IMPLICIT_ALL'/);
  assert.match(body, /local_selected_preview_row_ids_dirty = false/);
});

test('an in-flight Ready to Pay selection refresh is shown as quiet progress rather than a stale-row warning', () => {
  const body = sliceBetween(
    'function renderBankingPayTab(scopePreset)',
    'function renderPayNewBatchWizard()'
  );

  assert.match(body, /data-banking-selection-mutation-pending/);
  assert.match(body, /Updating selection…/);
  assert.match(body, /selectionMutationPending \?/);
  assert.match(body, /Create Draft disabled: selected rows need refresh/);
});

test('rendered preview checkboxes use the complete server-owned selection when provided', () => {
  const body = sliceBetween(
    'const buildPayPreviewRowsViewModel =',
    'const previewRowsVm = buildPayPreviewRowsViewModel()'
  );

  assert.match(body, /const serverSelectionProvidedForRows =/);
  assert.match(body, /workbench\.server_selected_preview_row_ids_provided === true/);
  assert.match(body, /decisions\.server_selected_preview_row_ids_provided === true/);
  assert.match(body, /const serverSelectedRowIdSet = new Set\(uniqTrimmed/);
  assert.match(
    body,
    /if \(serverSelectionProvidedForRows\) \{\s*return new Set\(allSelectableRowIds\.filter\(\(rowId\) => serverSelectedRowIdSet\.has\(rowId\)\)\);\s*\}/
  );
});

test('a resolved Ready row is not hidden by its historical case-readiness label', () => {
  const body = sliceBetween(
    'const isPreviewRowSelectionAllowed =',
    'const allPreviewRowIds ='
  );

  assert.match(body, /const currentReadyContract = sectionSignals\.some\(\(section\) => section === 'READY_TO_PAY'\)/);
  assert.match(body, /&& asBool\(explicitSelectionAllowed\)/);
  assert.match(body, /&& asBool\(explicitReadyForDraft\)/);
  assert.match(body, /&& asBool\(explicitDraftable\)/);
  assert.match(body, /if \(forbiddenSections\.has\(readinessState\) && !currentReadyContract\) return false/);
});

test('a certified promoted recovery uses its effective Ready section for the row checkbox', () => {
  const body = sliceBetween(
    'const isPreviewRowSelectionAllowed =',
    'const allPreviewRowIds ='
  );

  assert.doesNotMatch(body, /readCreateDraftRecoverySelectionOverlay\(line\)/);
  assert.match(body, /selection_recovery_headroom_v1/);
  assert.match(body, /line\.selection_recovery_headroom_v1/);
  assert.match(body, /overlay\.contract_version\) === 1/);
  assert.match(body, /overlay\.static_recovery_eligible/);
  assert.match(body, /overlay\.policy_x_authority_scope/);
  assert.match(body, /effectiveSection === 'READY_TO_PAY'/);
  assert.match(body, /recoverySelectionOverlay\.effective_section/);
  assert.match(
    body,
    /const sectionSignals = \(recoverySelectionOverlay[\s\S]*?: \[[\s\S]*?line\.section/,
    'the physical Blocked partition must remain a veto only when no certified effective overlay exists'
  );
});

test('case rows present an expense only as a separate independently selected component', () => {
  const body = sliceBetween(
    'const renderExpenseComponentBreakdown =',
    'const getReadyTimesheetGroupKey ='
  );

  assert.match(body, /Show separate expense component/);
  assert.match(body, /It is not part of this case resolution and keeps its own selection\./);
  assert.match(body, /upperTrim\(renderContextSection \|\| getLinePresentationSection\(line\)\) === 'CASES_RESOLUTIONS'/);
  assert.match(body, /\? ''\s*:\s*renderExpenseComponentBreakdown\(line, options\)/);
  assert.match(
    mainSource,
    /const expenseComponentLabel = isExactTimesheetExpenseLine\(line\) \? getExpenseComponentFriendlyLabel\(line\) : '';/g
  );
});

test('active-draft reservations are excluded from display and candidate refresh caches', () => {
  const renderBody = sliceBetween(
    'const isActiveDraftReservedRenderedRow =',
    'const collectRowsFromPageCaches ='
  );
  assert.match(renderBody, /post_draft_unavailable/);
  assert.match(renderBody, /post_draft_overlay_active/);
  assert.match(renderBody, /post_draft_overlay_operation_type/);
  assert.match(renderBody, /\['DRAFT_CREATE', 'PAYMENT_EXECUTE', 'PAYMENT_SETTLE'\]/);
  assert.match(renderBody, /if \(isActiveDraftReservedRenderedRow\(line\)\) continue/);

  const mergeBody = sliceBetween(
    'function mergePayWorkbenchCandidatePreviewIntoState(',
    'async function bankingPayWorkbench'
  );
  assert.match(mergeBody, /const isActiveDraftReservedCandidateRow =/);
  assert.match(mergeBody, /post_draft_unavailable/);
  assert.match(mergeBody, /post_draft_overlay_active/);
  assert.match(mergeBody, /post_draft_overlay_operation_type/);
  assert.match(mergeBody, /\['DRAFT_CREATE', 'PAYMENT_EXECUTE', 'PAYMENT_SETTLE'\]/);
  assert.match(mergeBody, /filterActiveDraftReservedCandidateRows\(directRows\)/);
  assert.match(mergeBody, /filterActiveDraftReservedCandidateRows\(combined\)/);
  assert.match(mergeBody, /filterActiveDraftReservedCandidateRows\(explicit\)/);
});

test('the canonical page replaces stale session selection totals with current eligible selections', () => {
  const body = sliceBetween(
    'const applyPreviewPagePayloadToState =',
    'const applyAuthoritativePreviewVisualState ='
  );

  assert.match(body, /if \(resolvedSection === 'canonical_preview_lines'\)/);
  assert.match(body, /page\.selected_row_count/);
  assert.match(body, /page\.selected_eligible_ready_row_count/);
  assert.match(body, /wiz\.workbench\.selected_row_count = boundedSelectedEligibleCount/);
  assert.match(body, /wiz\.workbench\.selected_eligible_ready_row_count = boundedSelectedEligibleCount/);
});

test('a canonical page with an authoritative zero selection clears stale visible ticks', () => {
  const body = sliceBetween(
    'const buildSectionSpecificSyntheticPreviewPayload =',
    'const applyPreviewPagePayloadToState ='
  );

  assert.match(body, /const authoritativePageSelectionIsEmpty =/);
  assert.match(body, /normalisedSection === 'canonical_preview_lines'/);
  assert.match(body, /Math\.trunc\(selectedCount\) === 0/);
  assert.match(body, /wiz\.local_selected_preview_row_ids_dirty !== true/);
  assert.match(body, /synthetic\.server_selected_preview_row_ids_provided = true/);
  assert.match(body, /synthetic\.server_selected_preview_row_ids = \[\]/);
  assert.match(body, /preview\.server_selected_preview_row_ids_provided = true/);

  const context = {
    Number,
    Math,
    Object,
    Array,
    normalisePreviewPageSectionName: (value) => String(value || '').toLowerCase(),
    normalisePreviewPagePayloadForState: (value) => ({ ...(value || {}) }),
    deep: (value) => JSON.parse(JSON.stringify(value)),
    isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    hasActiveWorkbenchPendingWork: () => false,
    trimStr: (value) => String(value == null ? '' : value).trim(),
    effectivePayDate: '2026-07-31',
    weekEndingCutoffDate: '2026-07-26',
    wiz: {
      local_selected_preview_row_ids_dirty: false,
      localSelectedPreviewRowIdsDirty: false,
      workbench: { snapshot_run_id: 'snapshot-1', session_version: 1, session_signature: 'sig-1' }
    }
  };
  vm.runInNewContext(
    body + '\nthis.__buildSynthetic = buildSectionSpecificSyntheticPreviewPayload;',
    context,
    { filename: 'banking-canonical-page-selection-contract.js' }
  );

  const authoritativeEmpty = context.__buildSynthetic(
    'canonical_preview_lines',
    [{ id: 'row-1', selected: false, selection_state: 'UNSELECTED' }],
    { session_id: 'session-1', selected_row_count: 0, rows: [] }
  );
  assert.equal(authoritativeEmpty.server_selected_preview_row_ids_provided, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(authoritativeEmpty.server_selected_preview_row_ids)),
    []
  );

  context.wiz.local_selected_preview_row_ids_dirty = true;
  const inFlightLocalChange = context.__buildSynthetic(
    'canonical_preview_lines',
    [{ id: 'row-1', selected: false, selection_state: 'UNSELECTED' }],
    { session_id: 'session-1', selected_row_count: 0, rows: [] }
  );
  assert.equal(inFlightLocalChange.server_selected_preview_row_ids_provided, undefined);
});

test('optimistic selection traversal is cycle-safe and bounded', () => {
  const body = sliceBetween(
    'const updatePreviewRowSelectionInLoadedState =',
    'const applySelectionPayloadSummaryToWizard ='
  );

  assert.match(body, /const visited = new WeakSet\(\)/);
  assert.match(body, /const MAX_VISITED_SELECTION_NODES = 20000/);
  assert.match(body, /if \(visited\.has\(node\)\) return/);
  assert.match(body, /visited\.add\(node\)/);
  assert.match(body, /if \(visitedNodeCount > MAX_VISITED_SELECTION_NODES\) return/);

  const row = {
    preview_row_id: 'row-1',
    selected: true,
    selection_state: 'SELECTED',
    row_json: {}
  };
  const workbench = { rows: [row] };
  const draftWizard = { workbench, preview: { data: workbench } };
  workbench.preview = draftWizard;
  const context = {
    Set,
    WeakSet,
    Array,
    String,
    st: { pay: { draftWizard } },
    normalizePreviewRowIdArray: (values) => Array.from(new Set(Array.isArray(values) ? values.map(String) : [])),
    getPreviewRowIdFromRow: (value) => String(value?.preview_row_id || '')
  };
  vm.runInNewContext(
    body + '\nthis.__updateSelection = updatePreviewRowSelectionInLoadedState;',
    context,
    { filename: 'banking-selection-cycle-guard.js' }
  );

  assert.doesNotThrow(() => context.__updateSelection(['row-1'], false));
  assert.equal(row.selected, false);
  assert.equal(row.selection_state, 'UNSELECTED');
  assert.equal(row.row_json.selected, false);
});

test('a rejected optimistic selection restores only uncommitted local control state and always repaints', () => {
  const toggleBody = sliceBetween(
    'const togglePreviewRowSelection =',
    'const setPreviewRowsSelection ='
  );
  assert.match(toggleBody, /if \(!serverAuthorityApplied\) updatePreviewRowSelectionInLoadedState\(\[rowId\], !wantChecked\)/);
  assert.doesNotMatch(toggleBody, /catch \(error\) \{[\s\S]*reloadCanonicalPreviewAfterSelectionMutation/);

  assert.match(
    mainSource,
    /try \{\s*return await togglePreviewRowSelection\(previewRowId, checked, \{ selectionEpoch \}\);\s*\} finally \{\s*await safeRerender\(null\);\s*\}/
  );
});

test('a successful selection reloads ready and blocked pages without replaying a stale mutation snapshot', () => {
  const toggleBody = sliceBetween(
    'const togglePreviewRowSelection =',
    'const setPreviewRowsSelection ='
  );
  const groupedBody = sliceBetween(
    'const setPreviewRowsSelection =',
    'const setPreviewRowsGlobalSelection ='
  );
  const globalBody = sliceBetween(
    'const setPreviewRowsGlobalSelection =',
    'const normalisePayPreviewPageUiSection ='
  );
  const helperBody = sliceBetween(
    'const reloadCanonicalPreviewAfterSelectionMutation =',
    'const togglePreviewRowSelection ='
  );

  assert.match(helperBody, /await Promise\.all\(\[/);
  assert.match(helperBody, /loadPayWorkbenchPreviewPageForSection\('canonical_preview_lines', 'reload', \{/);
  assert.match(helperBody, /loadPayWorkbenchPreviewPageForSection\('blocked_for_pay', 'reload', \{/);
  assert.match(toggleBody, /applySelectionPayloadSummaryToWizard\(result, \{ selectionEpoch \}\);[\s\S]*reloadCanonicalPreviewAfterSelectionMutation\(\{ acceptedAuthority \}\)/);
  assert.match(groupedBody, /finalAcceptedAuthority = acceptedAuthority;[\s\S]*reloadCanonicalPreviewAfterSelectionMutation\(\{ acceptedAuthority: finalAcceptedAuthority \}\)/);
  assert.doesNotMatch(toggleBody, /reloadCanonicalPreviewAfterSelectionMutation\([\s\S]{0,200}applySelectionPayloadSummaryToWizard\(result/);
  assert.doesNotMatch(groupedBody, /reloadCanonicalPreviewAfterSelectionMutation\([\s\S]{0,200}applySelectionPayloadSummaryToWizard\(result/);
  assert.doesNotMatch(globalBody, /reloadCanonicalPreviewAfterSelectionMutation\([\s\S]{0,200}applySelectionPayloadSummaryToWizard\(result/);
});

test('Create Draft requires review when the authoritative selected set changed', () => {
  const refreshBody = sliceBetween(
    'const refreshCurrentSelectedPreviewRowsForCreateDraft =',
    'const countEligibleCandidatesForScope ='
  );

  assert.match(refreshBody, /const rawSelectionReviewContext =/);
  assert.match(refreshBody, /const currentRevisionUnavailable =/);
  assert.match(refreshBody, /const reviewedProgressChanged =/);
  assert.match(refreshBody, /reviewedSelectionSetComplete/);
  assert.match(refreshBody, /const remapped = currentRevisionUnavailable \|\| reviewedProgressChanged/);
  assert.match(refreshBody, /WORKBENCH_SELECTION_CHANGED_REVIEW_REQUIRED/);
  assert.match(refreshBody, /operation_started: false/);
  assert.match(refreshBody, /no_operation_started: true/);
  assert.match(refreshBody, /no_batch_created: true/);

  const createBody = sliceBetween(
    'async function bankingPayCreateDraft',
    'function bankingPayHasPollableRailEvidence'
  );
  const refreshCall = createBody.indexOf('refreshCurrentSelectedPreviewRowsForCreateDraft(');
  const failureStop = createBody.indexOf('if (!currentSelectionBeforeSubmit || currentSelectionBeforeSubmit.ok !== true)');
  const draftRequest = createBody.indexOf('/api/banking/pay/batch/create-draft');

  assert.match(createBody, /const createDraftSelectionReviewSnapshot =/);
  assert.match(createBody, /selection_review_snapshot/);
  assert.match(createBody, /expectedSessionVersion,\s*createDraftSelectionReviewSnapshot/);
  assert.match(mainSource, /captured_from_rendered_workbench: true/);

  assert.ok(refreshCall >= 0);
  assert.ok(failureStop > refreshCall, 'selection mismatch must stop after the authoritative refresh');
  assert.ok(draftRequest > failureStop, 'no create request may be sent before the mismatch stop');
});

test('an early shared-session revision change reaches the exact selection recheck', () => {
  const createBody = sliceBetween(
    'async function bankingPayCreateDraft',
    'function bankingPayHasPollableRailEvidence'
  );
  const progressChangedGuard = createBody.indexOf('if (localExpectedProgressCounterVersion && authoritativeProgressCounterVersion && localExpectedProgressCounterVersion !== authoritativeProgressCounterVersion)');
  const deferredLog = createBody.indexOf('INITIAL_PROGRESS_COUNTER_CHANGED_DEFERRED_TO_EXACT_SELECTION_RECHECK');
  const exactSelectionRefresh = createBody.indexOf('const currentSelectionBeforeSubmit = await refreshCurrentSelectedPreviewRowsForCreateDraft(');
  const draftRequest = createBody.indexOf('/api/banking/pay/batch/create-draft');

  assert.ok(progressChangedGuard >= 0, 'the early revision comparison must remain');
  assert.ok(deferredLog > progressChangedGuard, 'revision drift must be explicitly deferred');
  assert.ok(exactSelectionRefresh > deferredLog, 'server truth must be re-read after revision drift');
  assert.ok(draftRequest > exactSelectionRefresh, 'the draft request must remain after the exact selection guard');
  assert.doesNotMatch(
    createBody,
    /return await rejectAuthoritativeCreateDraftReadiness\('INITIAL_PROGRESS_COUNTER_CHANGED'/
  );
});

test('Create Draft adopts the progress counter refreshed by its exact selection recheck', () => {
  const createBody = sliceBetween(
    'async function bankingPayCreateDraft',
    'function bankingPayHasPollableRailEvidence'
  );
  const exactSelectionRefresh = createBody.indexOf('const currentSelectionBeforeSubmit = await refreshCurrentSelectedPreviewRowsForCreateDraft(');
  const refreshedBaseline = createBody.indexOf(
    'localExpectedProgressCounterVersion = readLocalProgressCounterVersionForCreateDraft()',
    exactSelectionRefresh
  );
  const finalReadiness = createBody.indexOf("readAuthoritativeCreateDraftReadiness(sessionId, expectedSessionVersion, 'FINAL_PRE_BACKEND_POST_READINESS')");

  assert.match(createBody, /let localExpectedProgressCounterVersion = readLocalProgressCounterVersionForCreateDraft\(\)/);
  assert.ok(refreshedBaseline > exactSelectionRefresh, 'the reviewed selection refresh must establish the new progress baseline');
  assert.ok(finalReadiness > refreshedBaseline, 'the final readiness fence must compare against the refreshed baseline');
});

test('current-page reload keeps the existing page instead of advancing pagination', () => {
  const pageBody = sliceBetween(
    'const loadPayWorkbenchPreviewPageForSection =',
    'const ensurePayWorkbenchUiState ='
  );

  assert.match(pageBody, /reloadCurrentPage = dir === 'reload'/);
  assert.match(pageBody, /targetPage = reloadCurrentPage \? currentPage/);
});
test('selection-driven page reload preserves the authoritative session context for the next selection', () => {
  const pageBody = sliceBetween(
    'const loadPayWorkbenchPreviewPageForSection =',
    'const ensurePayWorkbenchUiState ='
  );

  assert.match(pageBody, /session_version: appliedPage\.session_version \?\? appliedPage\.sessionVersion \?\? null/);
  assert.match(pageBody, /session_signature: appliedPage\.session_signature \?\? appliedPage\.sessionSignature \?\? null/);
  assert.match(pageBody, /progress_counter_version: appliedPage\.progress_counter_version \?\? appliedPage\.progressCounterVersion \?\? null/);
  assert.match(pageBody, /ready: appliedPage\.ready !== false/);
});
test('selection-review failure retains its specific user-friendly browser message', () => {
  const normalizerBody = sliceBetween(
    'function bankingNormalizeApiError',
    'function bankingPayNormaliseBatchIssueBadge'
  );

  assert.match(normalizerBody, /'WORKBENCH_SELECTION_CHANGED_REVIEW_REQUIRED'/);
  assert.match(normalizerBody, /WORKBENCH_SELECTION_CHANGED_REVIEW_REQUIRED: \{/);
  assert.match(normalizerBody, /title: 'Banking Pay selection changed'/);
  assert.match(normalizerBody, /The latest selection is now shown\. Review it, then click Create Draft again\./);

  const createBody = sliceBetween(
    'async function bankingPayCreateDraft',
    'function bankingPayHasPollableRailEvidence'
  );
  assert.match(createBody, /const selectionReviewFailure = \[/);
  assert.match(createBody, /const friendly = selectionReviewFailure/);
});
test('a rejected draft request clears busy state and repaints the same Banking modal', () => {
  const createBody = sliceBetween(
    'async function bankingPayCreateDraft',
    'function bankingPayHasPollableRailEvidence'
  );

  assert.match(createBody, /await presentCreateDraftFriendlyError\(friendlyForDisplay/);
  assert.match(createBody, /wiz\.createDraftBusy = false/);
  assert.match(createBody, /activeModalContext === sourceModalContext/);
  assert.match(createBody, /activeModalEpoch === sourceModalEpoch/);
  assert.match(createBody, /await bankingRerender\(null\)/);

  const friendlyPosition = createBody.lastIndexOf('await presentCreateDraftFriendlyError(friendlyForDisplay');
  const repaintPosition = createBody.indexOf('await bankingRerender(null)', friendlyPosition);
  const returnPosition = createBody.indexOf('return null;', repaintPosition);
  assert.ok(friendlyPosition >= 0);
  assert.ok(repaintPosition > friendlyPosition, 'the parent repaint must happen after the friendly modal closes');
  assert.ok(returnPosition > repaintPosition, 'the failed request must repaint before returning');
});

test('frozen batch detail distinguishes a payable remainder from its full resolved basis', () => {
  assert.match(mainSource, /full_resolved_target_amount_ex_vat/);
  assert.match(mainSource, /Payable remainder · full resolved value/);
  assert.match(mainSource, /This row pays only the remaining amount/);
  assert.match(mainSource, /line\.isPayableRemainder \|\| line\.units === null \? '—'/);
  assert.match(mainSource, /line\.isPayableRemainder \|\| line\.rate === null \? '—'/);
});

test('normalizer behavior preserves the selection-review code and copy', () => {
  const normalizerBody = sliceBetween(
    'function bankingNormalizeApiError',
    'function bankingPayNormaliseBatchIssueBadge'
  );
  const context = { JSON, Array, Number, String, Boolean, Object, Set, Map, WeakSet, Error, RegExp, Math, Date };
  vm.runInNewContext(
    normalizerBody + '\nthis.__normalize = bankingNormalizeApiError;',
    context,
    { filename: 'banking-normalizer.js' }
  );

  const payload = {
    ok: false,
    error_code: 'WORKBENCH_SELECTION_CHANGED_REVIEW_REQUIRED',
    code: 'WORKBENCH_SELECTION_CHANGED_REVIEW_REQUIRED',
    title: 'Banking Pay selection changed',
    message: 'Banking Pay was changed by another user or window. The latest selection is now shown. Review it, then click Create Draft again.',
    operation_started: false,
    no_operation_started: true,
    no_batch_created: true
  };
  const normalized = context.__normalize(payload, payload, {
    action: 'CREATE_DRAFT',
    fallbackCode: 'BANKING_PAY_CREATE_DRAFT_FAILED',
    userInitiated: true,
    showModal: true
  });

  assert.equal(normalized.error_code, 'WORKBENCH_SELECTION_CHANGED_REVIEW_REQUIRED');
  assert.equal(normalized.title, 'Banking Pay selection changed');
  assert.equal(normalized.message, payload.message);
});

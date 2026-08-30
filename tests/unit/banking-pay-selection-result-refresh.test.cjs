const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} must exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return source.slice(start, end);
}

const helperSource = sliceBetween(
  'function adoptSelectionMutationReadyBlockedPagesV1(options = {}) {',
  'function attachBankingModalDelegatedHandlers() {'
);
const helperContext = vm.createContext({ Date, Number, String, Object, Array, Set, RegExp });
vm.runInContext(`${helperSource}\nglobalThis.__adoptSelectionPair = adoptSelectionMutationReadyBlockedPagesV1;`, helperContext);
const adoptSelectionPair = helperContext.__adoptSelectionPair;

function cloneGraph(value) {
  return structuredClone(value);
}

function makeState() {
  const caseRows = [{ preview_row_id: 'case-1', effective_section: 'CASES_RESOLUTIONS' }];
  return {
    pay: {
      pay_date: '2026-08-21',
      selectedPayDate: '2026-08-21',
      week_ending_cutoff_date: '2026-08-16',
      draftWizard: {
        pay_date: '2026-08-21',
        week_ending_cutoff_date: '2026-08-16',
        selection_authority_epoch: 7,
        selection_progress_counter_floor: 33,
        selection_authority_last_intent: {
          epoch: 7,
          session_id: 'session-1',
          session_version: 12,
          progress_counter_version: 33,
          paired_ready_blocked_status: 'PENDING'
        },
        workbench: {
          session_id: 'session-1',
          session_version: 12,
          session_signature: 'signature-1',
          progress_counter_version: 33,
          server_selected_preview_row_ids_provided: true,
          server_selected_preview_row_ids: ['positive-1'],
          selected_row_count: 1,
          ready_for_draft: true,
          draft_blocker_codes: [],
          canonical_preview_lines: [
            { preview_row_id: 'positive-1', effective_section: 'READY_TO_PAY' },
            { preview_row_id: 'recovery-1', effective_section: 'READY_TO_PAY' }
          ],
          blocked_for_pay: [],
          cases_resolutions: structuredClone(caseRows)
        },
        decisions: {
          session_id: 'session-1',
          session_version: 12,
          server_selected_preview_row_ids_provided: true,
          server_selected_preview_row_ids: ['positive-1'],
          selected_row_count: 1,
          ready_for_draft: true,
          draft_blocker_codes: [],
          cases_resolutions: structuredClone(caseRows)
        },
        preview: { data: { cases_resolutions: structuredClone(caseRows) } },
        ui_state: { preview_page_state: {} }
      }
    }
  };
}

function pageResult(section, rows, overrides = {}) {
  return {
    section,
    page: {
      ok: true,
      ready: true,
      session_id: 'session-1',
      session_version: 12,
      progress_counter_version: 33,
      requested_section: section,
      resolved_section: section,
      section,
      rows: structuredClone(rows),
      items: structuredClone(rows),
      has_more: false,
      ...overrides
    },
    pageStatePatch: { current_page: 1, limit: 100, has_more: false },
    scrollRestore: { scrollHostId: section, scrollTop: 25 }
  };
}

function acceptedAuthority() {
  return {
    accepted: true,
    authorityApplied: true,
    session_id: 'session-1',
    session_version: 12,
    progress_counter_version: 33,
    selection_epoch: 7
  };
}

function applyCombinedPayload(payload, stagedState) {
  const wizard = stagedState.pay.draftWizard;
  const ready = structuredClone(payload.canonical_preview_lines);
  const blocked = structuredClone(payload.blocked_for_pay);
  const pageMap = structuredClone(payload.preview_pages);
  wizard.workbench.canonical_preview_lines = ready;
  wizard.workbench.blocked_for_pay = blocked;
  wizard.workbench.preview_pages = pageMap;
  wizard.decisions.canonical_preview_lines = structuredClone(ready);
  wizard.decisions.blocked_for_pay = structuredClone(blocked);
  wizard.preview.data.canonical_preview_lines = structuredClone(ready);
  wizard.preview.data.blocked_for_pay = structuredClone(blocked);
  wizard.preview.data.preview_pages = structuredClone(pageMap);
  return { ok: true };
}

test('validated Ready and Blocked pages adopt once and remove the stale opposite-section identity', () => {
  const state = makeState();
  const beforeCases = structuredClone(state.pay.draftWizard.workbench.cases_resolutions);
  let applyCount = 0;
  let combinedPayload = null;
  const outcome = adoptSelectionPair({
    bankingState: state,
    acceptedAuthority: acceptedAuthority(),
    readyResult: pageResult('canonical_preview_lines', [
      { preview_row_id: 'positive-1', effective_section: 'READY_TO_PAY' }
    ]),
    blockedResult: pageResult('blocked_for_pay', [
      {
        preview_row_id: 'recovery-1',
        effective_section: 'BLOCKED_FOR_PAY',
        selection_allowed: false,
        draftable: false,
        recoverable_amount: 0,
        nominal_amount: 95.65
      }
    ]),
    cloneGraph,
    applyPreview(payload, stagedState) {
      applyCount += 1;
      combinedPayload = payload;
      return applyCombinedPayload(payload, stagedState);
    }
  });

  assert.equal(outcome.adopted, true);
  assert.equal(applyCount, 1);
  assert.deepEqual(state.pay.draftWizard.workbench.canonical_preview_lines.map((row) => row.preview_row_id), ['positive-1']);
  assert.deepEqual(state.pay.draftWizard.workbench.blocked_for_pay.map((row) => row.preview_row_id), ['recovery-1']);
  assert.equal(state.pay.draftWizard.workbench.canonical_preview_lines.some((row) => row.preview_row_id === 'recovery-1'), false);
  assert.equal(state.pay.draftWizard.workbench.blocked_for_pay.filter((row) => row.preview_row_id === 'recovery-1').length, 1);
  assert.deepEqual(state.pay.draftWizard.workbench.cases_resolutions, beforeCases);
  assert.deepEqual(state.pay.draftWizard.workbench.server_selected_preview_row_ids, ['positive-1']);
  assert.equal(state.pay.draftWizard.workbench.selected_row_count, 1);
  assert.equal(state.pay.draftWizard.workbench.ready_for_draft, true);
  assert.deepEqual(state.pay.draftWizard.workbench.draft_blocker_codes, []);
  assert.equal(state.pay.draftWizard.selection_authority_last_intent.paired_ready_blocked_status, 'ADOPTED');
  assert.deepEqual(Object.keys(combinedPayload.preview_pages).sort(), ['blocked_for_pay', 'canonical_preview_lines']);
  assert.equal(Object.hasOwn(combinedPayload, 'cases_resolutions'), false);
  assert.equal(Object.hasOwn(combinedPayload, 'selected_eligible_ready_row_count'), false);
});

test('the same atomic owner performs the exact Blocked-to-Ready reverse transition', () => {
  const state = makeState();
  state.pay.draftWizard.workbench.canonical_preview_lines = [{ preview_row_id: 'positive-1', effective_section: 'READY_TO_PAY' }];
  state.pay.draftWizard.workbench.blocked_for_pay = [{ preview_row_id: 'recovery-1', effective_section: 'BLOCKED_FOR_PAY' }];
  let applyCount = 0;
  const outcome = adoptSelectionPair({
    bankingState: state,
    acceptedAuthority: acceptedAuthority(),
    readyResult: pageResult('canonical_preview_lines', [
      { preview_row_id: 'positive-1', effective_section: 'READY_TO_PAY' },
      { preview_row_id: 'recovery-1', effective_section: 'READY_TO_PAY', selection_allowed: true }
    ]),
    blockedResult: pageResult('blocked_for_pay', []),
    cloneGraph,
    applyPreview(payload, stagedState) {
      applyCount += 1;
      return applyCombinedPayload(payload, stagedState);
    }
  });

  assert.equal(outcome.adopted, true);
  assert.equal(applyCount, 1);
  assert.deepEqual(
    state.pay.draftWizard.workbench.canonical_preview_lines.map((row) => row.preview_row_id),
    ['positive-1', 'recovery-1']
  );
  assert.deepEqual(state.pay.draftWizard.workbench.blocked_for_pay, []);
  assert.equal(state.pay.draftWizard.workbench.canonical_preview_lines.filter((row) => row.preview_row_id === 'recovery-1').length, 1);
});

test('merged Ready and Blocked pages replace the render-consumed preview wrapper cache', () => {
  const aliasOwnerSource = sliceBetween(
    'const applyMergedPreviewPagesToState = (targetEnvelope = null) => {',
    '  const responseMutationContext ='
  );
  const staleRecovery = {
    preview_row_id: 'recovery-stale',
    effective_section: 'READY_TO_PAY'
  };
  const readyRow = {
    preview_row_id: 'positive-current',
    effective_section: 'READY_TO_PAY'
  };
  const blockedRecovery = {
    preview_row_id: 'recovery-stale',
    effective_section: 'BLOCKED_FOR_PAY'
  };
  const wiz = {
    workbench: {},
    preview: {
      data: {},
      preview_pages: {
        canonical_preview_lines: {
          section: 'canonical_preview_lines',
          rows: [staleRecovery],
          items: [staleRecovery]
        }
      }
    }
  };
  const targetEnvelope = {};
  const mergedPreviewPages = {
    canonical_preview_lines: {
      section: 'canonical_preview_lines',
      rows: [readyRow],
      items: [readyRow]
    },
    blocked_for_pay: {
      section: 'blocked_for_pay',
      rows: [blockedRecovery],
      items: [blockedRecovery]
    }
  };
  const context = vm.createContext({
    wiz,
    targetEnvelope,
    mergedPreviewPages,
    cloneJson: structuredClone,
    isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value)
  });
  vm.runInContext(`${aliasOwnerSource}\napplyMergedPreviewPagesToState(targetEnvelope);`, context);

  const installedPageMap = wiz.workbench.preview_pages;
  for (const root of [wiz.workbench, wiz.preview, wiz.preview.data, targetEnvelope]) {
    for (const alias of [
      'preview_pages',
      'previewPages',
      'preview_page_cache',
      'previewPageCache',
      'page_cache',
      'pageCache'
    ]) {
      assert.equal(root[alias], installedPageMap, `${alias} must share the accepted page graph`);
    }
  }
  assert.deepEqual(
    installedPageMap.canonical_preview_lines.rows.map((row) => row.preview_row_id),
    ['positive-current']
  );
  assert.deepEqual(
    installedPageMap.blocked_for_pay.rows.map((row) => row.preview_row_id),
    ['recovery-stale']
  );
  assert.equal(
    wiz.preview.preview_pages.canonical_preview_lines.rows.some((row) => row.preview_row_id === 'recovery-stale'),
    false
  );
});

test('a cross-section duplicate fails closed before any state adoption', () => {
  const state = makeState();
  const before = structuredClone(state);
  let applyCount = 0;
  const outcome = adoptSelectionPair({
    bankingState: state,
    acceptedAuthority: acceptedAuthority(),
    readyResult: pageResult('canonical_preview_lines', [{ preview_row_id: 'duplicate-1' }]),
    blockedResult: pageResult('blocked_for_pay', [{ preview_row_id: 'duplicate-1' }]),
    cloneGraph,
    applyPreview() { applyCount += 1; return { ok: true }; }
  });
  assert.equal(outcome.adopted, false);
  assert.equal(outcome.reason, 'SELECTION_PAIR_CROSS_SECTION_DUPLICATE');
  assert.equal(applyCount, 0);
  assert.deepEqual(state, before);
});

test('a mismatched page tuple fails closed before adoption', () => {
  const state = makeState();
  let applyCount = 0;
  const outcome = adoptSelectionPair({
    bankingState: state,
    acceptedAuthority: acceptedAuthority(),
    readyResult: pageResult('canonical_preview_lines', [], { progress_counter_version: 32 }),
    blockedResult: pageResult('blocked_for_pay', []),
    cloneGraph,
    applyPreview() { applyCount += 1; return { ok: true }; }
  });
  assert.equal(outcome.adopted, false);
  assert.equal(outcome.reason, 'SELECTION_PAIR_REVISION_MISMATCH');
  assert.equal(applyCount, 0);
});

test('an adoption throw cannot partially mutate the live Workbench state', () => {
  const state = makeState();
  const before = structuredClone(state);
  assert.throws(() => adoptSelectionPair({
    bankingState: state,
    acceptedAuthority: acceptedAuthority(),
    readyResult: pageResult('canonical_preview_lines', [{ preview_row_id: 'positive-1' }]),
    blockedResult: pageResult('blocked_for_pay', [{ preview_row_id: 'recovery-1' }]),
    cloneGraph,
    applyPreview(_payload, stagedState) {
      stagedState.pay.draftWizard.workbench.canonical_preview_lines = [];
      throw new Error('synthetic adoption failure');
    }
  }), /synthetic adoption failure/);
  assert.deepEqual(state, before);
});

test('selection settlement starts both deferred page reads together and has one combined owner', () => {
  const reloadBody = sliceBetween(
    'const reloadCanonicalPreviewAfterSelectionMutation =',
    'const togglePreviewRowSelection ='
  );
  const loaderBody = sliceBetween(
    'const loadPayWorkbenchPreviewPageForSection =',
    'const ensurePayWorkbenchUiState ='
  );
  assert.match(reloadBody, /await Promise\.all\(\[/);
  assert.match(reloadBody, /loadPayWorkbenchPreviewPageForSection\('canonical_preview_lines', 'reload', \{/);
  assert.match(reloadBody, /loadPayWorkbenchPreviewPageForSection\('blocked_for_pay', 'reload', \{/);
  assert.match(reloadBody, /deferAdoption: true/g);
  assert.equal((reloadBody.match(/adoptSelectionMutationReadyBlockedPagesV1\(/g) || []).length, 1);
  assert.match(loaderBody, /store_cursor: !deferAdoption/);
  assert.match(loaderBody, /if \(deferAdoption\) \{\s*return \{/);
  assert.match(loaderBody, /if \(!deferAdoption\) \{\s*pageState\.loading = true;/);
  assert.match(loaderBody, /if \(!deferAdoption\) \{\s*try \{ setTimeout/);
});

test('every selection entry point passes the exact queued epoch and renders only after settlement', () => {
  const handlerBody = sliceBetween(
    'function attachBankingModalDelegatedHandlers()',
    'function timesheetDiagSanitiseForConsole'
  );
  assert.match(handlerBody, /outcome = await mutation\(\{ selectionEpoch: mutationEpoch \}\)/);
  assert.match(handlerBody, /applySelectionPayloadSummaryToWizard\(result, \{ selectionEpoch \}\)/);
  assert.match(handlerBody, /finalAcceptedAuthority = acceptedAuthority/);
  assert.match(handlerBody, /reloadCanonicalPreviewAfterSelectionMutation\(\{ acceptedAuthority: finalAcceptedAuthority \}\)/);
  for (const action of [
    'toggleTimesheetPreviewGroup',
    'toggleAllReadyPreviewRows',
    'togglePreviewRow',
    'selectAllPreviewRows',
    'clearAllPreviewRows'
  ]) {
    const actionAt = handlerBody.indexOf(`if (a === 'banking:pay:${action}')`);
    assert.ok(actionAt >= 0, `${action} entry point must exist`);
    const actionSlice = handlerBody.slice(actionAt, actionAt + 1400);
    assert.match(actionSlice, /async \(\{ selectionEpoch \}\) =>/);
  }
  assert.doesNotMatch(
    sliceBetween('const reloadCanonicalPreviewAfterSelectionMutation =', 'const togglePreviewRowSelection ='),
    /safeRerender\(/
  );
});

test('selection settlement immediately gates Create Draft and restores its prior UI only when no rerender replaced it', () => {
  const busyOwnerSource = sliceBetween(
    'const setPreviewSelectionControlsBusy =',
    'let previewSelectionMutationTail ='
  );
  const makeClassList = (initial = []) => {
    const values = new Set(initial);
    return {
      add(value) { values.add(value); },
      remove(value) { values.delete(value); },
      contains(value) { return values.has(value); }
    };
  };
  const attributes = new Map([
    ['data-disabled', '0'],
    ['aria-disabled', 'false'],
    ['title', 'Create draft batches from the selected current Ready to Pay rows']
  ]);
  const createDraftControl = {
    textContent: 'Create drafts',
    disabled: false,
    classList: makeClassList(['btn', 'btn-primary']),
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); }
  };
  const targetEl = {
    querySelectorAll() { return []; },
    querySelector(selector) {
      return selector === '[data-action="banking:pay:createDraft"]' ? createDraftControl : null;
    }
  };
  const context = vm.createContext({ targetEl });
  vm.runInContext(`${busyOwnerSource}\nglobalThis.__setBusy = setPreviewSelectionControlsBusy;`, context);

  context.__setBusy(true);
  assert.equal(createDraftControl.textContent, 'Updating selection…');
  assert.equal(createDraftControl.disabled, true);
  assert.equal(createDraftControl.classList.contains('disabled'), true);
  assert.equal(attributes.get('data-disabled'), '1');
  assert.equal(attributes.get('aria-disabled'), 'true');
  assert.equal(attributes.get('aria-busy'), 'true');
  assert.match(attributes.get('title'), /validating the selected rows/i);

  context.__setBusy(false);
  assert.equal(createDraftControl.textContent, 'Create drafts');
  assert.equal(createDraftControl.disabled, false);
  assert.equal(createDraftControl.classList.contains('disabled'), false);
  assert.equal(attributes.get('data-disabled'), '0');
  assert.equal(attributes.get('aria-disabled'), 'false');
  assert.equal(attributes.has('aria-busy'), false);
  assert.equal(attributes.get('title'), 'Create draft batches from the selected current Ready to Pay rows');
  assert.equal(createDraftControl.__bankingSelectionCreateDraftBusyState, undefined);
});

test('the watcher suppresses only the exact pending or adopted selection revision', () => {
  const watcherBody = sliceBetween(
    'const refreshWorkbenchVisiblePageAfterProgress =',
    'const scheduleWorkbenchCandidateSettlePoll ='
  );
  assert.match(watcherBody, /selectionPairStatus === 'PENDING' \|\| selectionPairStatus === 'ADOPTED'/);
  assert.match(watcherBody, /selectionIntentEpoch === currentSelectionEpoch/);
  assert.match(watcherBody, /selectionIntentProgressVersion === nextProgressCounterVersion/);
  assert.match(watcherBody, /if \(exactSelectionPairRevision\) \{\s*return applyProgressMetadataToState/);
  assert.doesNotMatch(watcherBody, /selectionPairStatus === 'FAILED'[\s\S]{0,160}return applyProgressMetadataToState/);
});

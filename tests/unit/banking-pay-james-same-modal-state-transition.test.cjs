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

const mergeSource = sliceBetween(
  'function mergePayWorkbenchCandidatePreviewIntoState(candidateResponse, state = null) {',
  'async function pollPayWorkbenchCandidateUntilSettled(sessionId, candidateId, options = {}) {'
);
const adoptedSectionHelpersSource = sliceBetween(
  'function normaliseBankingPayAdoptedPreviewSectionV1(value) {',
  'async function openBankingFinanceCaseRestructureModal(seed = {}) {'
);

const JAMES_ID = '6e8493ae-c207-497e-8d83-0b518753f590';
const OTHER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '01245cf8-6819-41de-a9a7-f6641a34ad26';
const CASE_KEYS = ['case_resolution_states', 'caseResolutionStates', 'cases_resolutions', 'casesResolutions'];
const PAGE_KEYS = ['preview_pages', 'previewPages', 'preview_page_cache', 'previewPageCache', 'page_cache', 'pageCache', 'pages'];

function makeRow(candidateId, id, section, amount, overrides = {}) {
  const ready = section === 'READY_TO_PAY';
  return {
    preview_row_id: id,
    candidate_id: candidateId,
    effective_section: section,
    presentation_section: section,
    section,
    status: ready ? 'READY' : 'BLOCKED',
    selected: ready,
    selection_state: ready ? 'SELECTED' : 'NOT_SELECTABLE',
    selection_allowed: ready,
    draftable: ready,
    is_ready_for_draft: ready,
    amount,
    row_json: {
      preview_row_id: id,
      candidate_id: candidateId,
      effective_section: section,
      presentation_section: section,
      selected: ready,
      selection_state: ready ? 'SELECTED' : 'NOT_SELECTABLE'
    },
    ...overrides
  };
}

function makePage(section, rows) {
  return {
    section,
    requested_section: section,
    resolved_section: section,
    rows: structuredClone(rows),
    items: structuredClone(rows),
    returned_count: rows.length,
    returnedCount: rows.length,
    rows_count: rows.length,
    rowsCount: rows.length,
    known_count: rows.length,
    knownCount: rows.length,
    total_count: rows.length,
    totalCount: rows.length,
    total_count_estimate: rows.length,
    totalCountEstimate: rows.length,
    has_more: false,
    hasMore: false,
    next_cursor: null,
    nextCursor: null
  };
}

function makePageMap(readyRows, caseRows, blockedRows) {
  return {
    canonical_preview_lines: makePage('canonical_preview_lines', readyRows),
    cases_resolutions: makePage('cases_resolutions', caseRows),
    blocked_for_pay: makePage('blocked_for_pay', blockedRows)
  };
}

function assignCaseAliases(target, rows) {
  for (const key of CASE_KEYS) target[key] = structuredClone(rows);
  return target;
}

function assignPageAliases(target, pageMap) {
  for (const key of PAGE_KEYS) target[key] = structuredClone(pageMap);
  return target;
}

function makeFixture() {
  const makeNestedCaseRow = (candidateId, id, amount) => {
    const row = makeRow(candidateId, id, 'CASES_RESOLUTIONS', amount);
    delete row.candidate_id;
    delete row.row_json.candidate_id;
    row.__case_entry = {
      candidate: {
        candidate_id: candidateId
      }
    };
    return row;
  };
  const jamesCases = [
    makeNestedCaseRow(JAMES_ID, 'james-case-26750', 267.50),
    makeNestedCaseRow(JAMES_ID, 'james-case-22000', 220.00),
    makeNestedCaseRow(JAMES_ID, 'james-case-20000', 200.00)
  ];
  const jamesBlocked = [
    makeRow(JAMES_ID, 'james-recovery-26750', 'BLOCKED_FOR_PAY', 0),
    makeRow(JAMES_ID, 'james-recovery-24250', 'BLOCKED_FOR_PAY', 0),
    makeRow(JAMES_ID, 'james-recovery-22000', 'BLOCKED_FOR_PAY', 0),
    makeRow(JAMES_ID, 'james-recovery-2500', 'BLOCKED_FOR_PAY', 0)
  ];
  const unrelatedCase = makeNestedCaseRow(OTHER_ID, 'other-case', 10);
  const unrelatedBlocked = makeRow(OTHER_ID, 'other-blocked', 'BLOCKED_FOR_PAY', 11);
  const unrelatedReady = makeRow(OTHER_ID, 'other-ready', 'READY_TO_PAY', 12);
  const allCases = [...jamesCases, unrelatedCase];
  const allBlocked = [...jamesBlocked, unrelatedBlocked];
  const allReady = [unrelatedReady];
  const pageMap = makePageMap(allReady, allCases, allBlocked);
  const componentCache = assignCaseAliases({
    canonical_preview_lines: structuredClone(allReady),
    ready_preview_lines: structuredClone(allReady),
    ready_to_pay_now: structuredClone(allReady),
    draftable_now: structuredClone(allReady),
    blocked_case_states: structuredClone(allBlocked),
    blocked_now: structuredClone(allBlocked),
    blocked_for_pay_now: structuredClone(allBlocked),
    blocked_preview_lines: structuredClone(allBlocked),
    safe_case_states: []
  }, allCases);
  const preview = assignPageAliases(assignCaseAliases({
    paye_candidates: [assignCaseAliases({ candidate_id: OTHER_ID }, [unrelatedCase])],
    non_paye_payees: [assignCaseAliases({ candidate_id: JAMES_ID }, jamesCases)],
    canonical_preview_lines: structuredClone(allReady),
    preview_rows: structuredClone(allReady),
    ready_preview_lines: structuredClone(allReady),
    ready_to_pay_now: structuredClone(allReady),
    draftable_now: structuredClone(allReady),
    blocked_case_states: structuredClone(allBlocked),
    blocked_now: structuredClone(allBlocked),
    blocked_for_pay_now: structuredClone(allBlocked),
    blocked_preview_lines: structuredClone(allBlocked),
    safe_case_states: [],
    componentStateCache: structuredClone(componentCache),
    component_state_cache: structuredClone(componentCache)
  }, allCases), pageMap);
  const envelope = assignPageAliases(assignCaseAliases({
    session_id: SESSION_ID,
    session_version: 19,
    session_signature: 'session-signature-19',
    pay_date: '2026-08-17',
    week_ending_cutoff_date: '2026-08-16',
    server_selected_preview_row_ids_provided: true,
    server_selected_preview_row_ids: ['other-ready'],
    session: {
      session_id: SESSION_ID,
      session_version: 19,
      session_signature: 'session-signature-19',
      pay_date: '2026-08-17',
      week_ending_cutoff_date: '2026-08-16',
      server_selected_preview_row_ids_provided: true,
      server_selected_preview_row_ids: ['other-ready']
    },
    preview,
    componentStateCache: structuredClone(componentCache),
    component_state_cache: structuredClone(componentCache)
  }, allCases), pageMap);
  const workbench = assignPageAliases(assignCaseAliases({
    session_id: SESSION_ID,
    session_version: 19,
    session_signature: 'session-signature-19',
    pay_date: '2026-08-17',
    week_ending_cutoff_date: '2026-08-16',
    server_selected_preview_row_ids_provided: true,
    server_selected_preview_row_ids: ['other-ready'],
    canonical_preview_lines: structuredClone(allReady)
  }, allCases), pageMap);
  const decisions = assignCaseAliases({
    session_id: SESSION_ID,
    session_version: 19,
    session_signature: 'session-signature-19',
    server_selected_preview_row_ids_provided: true,
    server_selected_preview_row_ids: ['other-ready'],
    selected_preview_row_ids: ['other-ready']
  }, allCases);
  return {
    state: {
      pay: {
        draftWizard: {
          preview: assignPageAliases({
            data: envelope,
            componentStateCache: structuredClone(componentCache),
            component_state_cache: structuredClone(componentCache)
          }, pageMap),
          workbench,
          decisions,
          selected_preview_row_mode: 'EXPLICIT_SUBSET',
          local_selected_preview_row_ids_dirty: false
        }
      }
    },
    unrelatedCase,
    unrelatedBlocked,
    unrelatedReady
  };
}

function makeReadyResponse(unrelatedReady) {
  const positiveAmounts = [307.63, 253.00, 230.00];
  const recoveryAmounts = [-220.00, -242.50, -25.00, -267.50];
  const jamesRows = [
    ...positiveAmounts.map((amount, index) => makeRow(JAMES_ID, `james-ready-positive-${index}`, 'READY_TO_PAY', amount)),
    ...recoveryAmounts.map((amount, index) => makeRow(JAMES_ID, `james-ready-recovery-${index}`, 'READY_TO_PAY', amount, { line_type: 'OVERPAYMENT_RECOVERY' }))
  ];
  const selectedIds = [unrelatedReady.preview_row_id, ...jamesRows.map((row) => row.preview_row_id)];
  return {
    ok: true,
    ready: true,
    status: 'READY',
    session_id: SESSION_ID,
    session_version: 20,
    session_signature: 'session-signature-19',
    pay_date: '2026-08-17',
    week_ending_cutoff_date: '2026-08-16',
    candidate_id: JAMES_ID,
    pending_refresh: false,
    pending_candidate_ids: [],
    failed_candidate_ids: [],
    server_selected_preview_row_ids_provided: true,
    server_selected_preview_row_ids: selectedIds,
    preview_rows: jamesRows
  };
}

function makeUnresolvedResponse() {
  const caseRows = [
    makeRow(JAMES_ID, 'james-case-26750-new', 'CASES_RESOLUTIONS', 267.50),
    makeRow(JAMES_ID, 'james-case-22000-new', 'CASES_RESOLUTIONS', 220.00),
    makeRow(JAMES_ID, 'james-case-20000-new', 'CASES_RESOLUTIONS', 200.00)
  ];
  const blockedRows = [
    makeRow(JAMES_ID, 'james-recovery-26750-new', 'BLOCKED_FOR_PAY', 0),
    makeRow(JAMES_ID, 'james-recovery-24250-new', 'BLOCKED_FOR_PAY', 0),
    makeRow(JAMES_ID, 'james-recovery-22000-new', 'BLOCKED_FOR_PAY', 0),
    makeRow(JAMES_ID, 'james-recovery-2500-new', 'BLOCKED_FOR_PAY', 0)
  ];
  return {
    ok: true,
    ready: true,
    status: 'READY',
    session_id: SESSION_ID,
    session_version: 21,
    session_signature: 'session-signature-19',
    pay_date: '2026-08-17',
    week_ending_cutoff_date: '2026-08-16',
    candidate_id: JAMES_ID,
    pending_refresh: false,
    pending_candidate_ids: [],
    failed_candidate_ids: [],
    server_selected_preview_row_ids_provided: true,
    server_selected_preview_row_ids: ['other-ready'],
    preview_rows: [...caseRows, ...blockedRows]
  };
}

function createMerge() {
  const context = {
    Set,
    Map,
    WeakSet,
    Array,
    String,
    Number,
    Object,
    Date,
    Math,
    structuredClone,
    activeWeekEndingCutoffDate: '2026-08-16',
    window: {},
    createBankingPayGraphCloneV1() {
      return (value) => structuredClone(value);
    }
  };
  vm.runInNewContext(
    `${adoptedSectionHelpersSource}\n${mergeSource}\nglobalThis.mergeForTest = mergePayWorkbenchCandidatePreviewIntoState;`,
    context,
    { filename: 'banking-pay-james-same-modal-state-transition.js' }
  );
  return context.mergeForTest;
}

function createFinanceTransitionValidator() {
  const context = { Array, String, Object, JSON };
  vm.runInNewContext(
    `${adoptedSectionHelpersSource}\nglobalThis.validateForTest = bankingPayCandidatePreviewMatchesFinanceCaseTransitionV1;`,
    context,
    { filename: 'banking-pay-finance-transition-validator.js' }
  );
  return context.validateForTest;
}

function rowCandidateId(row) {
  return row?.candidate_id || row?.row_json?.candidate_id || row?.__case_entry?.candidate?.candidate_id || '';
}

function rowsForCandidate(rows, candidateId) {
  return Array.isArray(rows) ? rows.filter((row) => rowCandidateId(row) === candidateId) : [];
}

function assertCaseAliases(owner, jamesCount, otherCount, label) {
  assert.ok(owner && typeof owner === 'object', `${label} must exist`);
  for (const key of CASE_KEYS) {
    assert.equal(rowsForCandidate(owner[key], JAMES_ID).length, jamesCount, `${label}.${key} James count`);
    assert.equal(rowsForCandidate(owner[key], OTHER_ID).length, otherCount, `${label}.${key} unrelated count`);
  }
}

function assertPageAliases(owner, expected, label) {
  assert.ok(owner && typeof owner === 'object', `${label} must exist`);
  for (const key of PAGE_KEYS) {
    const pageMap = owner[key];
    assert.ok(pageMap && typeof pageMap === 'object', `${label}.${key} must exist`);
    for (const [section, counts] of Object.entries(expected)) {
      const page = pageMap[section];
      assert.ok(page, `${label}.${key}.${section} must exist`);
      assert.equal(rowsForCandidate(page.rows, JAMES_ID).length, counts.james, `${label}.${key}.${section} James count`);
      assert.equal(rowsForCandidate(page.rows, OTHER_ID).length, counts.other, `${label}.${key}.${section} unrelated count`);
      assert.equal(page.returned_count, counts.james + counts.other, `${label}.${key}.${section} returned_count`);
      assert.equal(page.returnedCount, counts.james + counts.other, `${label}.${key}.${section} returnedCount`);
      for (const totalKey of ['rows_count', 'rowsCount', 'known_count', 'knownCount', 'total_count', 'totalCount', 'total_count_estimate', 'totalCountEstimate']) {
        assert.equal(page[totalKey], counts.james + counts.other, `${label}.${key}.${section}.${totalKey}`);
      }
    }
  }
}

function assertState(state, expected) {
  const wiz = state.pay.draftWizard;
  const envelope = wiz.preview.data;
  const preview = envelope.preview;
  for (const [label, owner] of [
    ['preview', preview],
    ['envelope', envelope],
    ['preview.componentStateCache', preview.componentStateCache],
    ['preview.component_state_cache', preview.component_state_cache],
    ['envelope.componentStateCache', envelope.componentStateCache],
    ['envelope.component_state_cache', envelope.component_state_cache],
    ['wiz.preview.componentStateCache', wiz.preview.componentStateCache],
    ['wiz.preview.component_state_cache', wiz.preview.component_state_cache],
    ['wiz.decisions', wiz.decisions],
    ['wiz.workbench', wiz.workbench]
  ]) assertCaseAliases(owner, expected.cases, 1, label);

  const jamesCandidate = [...preview.paye_candidates, ...preview.non_paye_payees]
    .find((candidate) => candidate.candidate_id === JAMES_ID);
  const otherCandidate = [...preview.paye_candidates, ...preview.non_paye_payees]
    .find((candidate) => candidate.candidate_id === OTHER_ID);
  assertCaseAliases(jamesCandidate, expected.cases, 0, 'James candidate bucket');
  assertCaseAliases(otherCandidate, 0, 1, 'unrelated candidate bucket');

  const expectedPages = {
    canonical_preview_lines: { james: expected.ready, other: 1 },
    cases_resolutions: { james: expected.cases, other: 1 },
    blocked_for_pay: { james: expected.blocked, other: 1 }
  };
  for (const [label, owner] of [
    ['preview', preview],
    ['envelope', envelope],
    ['wiz.preview', wiz.preview],
    ['wiz.workbench', wiz.workbench]
  ]) assertPageAliases(owner, expectedPages, label);

  assert.equal(rowsForCandidate(preview.canonical_preview_lines, JAMES_ID).length, expected.ready);
  assert.equal(rowsForCandidate(preview.blocked_for_pay_now, JAMES_ID).length, expected.blocked);
  assert.equal(rowsForCandidate(preview.canonical_preview_lines, OTHER_ID).length, 1);
  assert.equal(rowsForCandidate(preview.blocked_for_pay_now, OTHER_ID).length, 1);
}

test('candidate adoption atomically cycles James through resolved and unresolved sections without stale aliases', () => {
  const merge = createMerge();
  const { state, unrelatedReady } = makeFixture();
  const readyResponse = makeReadyResponse(unrelatedReady);

  merge(readyResponse, state);
  assertState(state, { ready: 7, cases: 0, blocked: 0 });
  assert.deepEqual(Array.from(state.pay.draftWizard.decisions.selected_preview_row_ids), readyResponse.server_selected_preview_row_ids);
  assert.equal(state.pay.draftWizard.preview.data.session_version, 20);
  assert.equal(state.pay.draftWizard.preview.data.session_signature, 'session-signature-19');
  assert.equal(state.pay.draftWizard.preview.data.pay_date, '2026-08-17');
  assert.equal(state.pay.draftWizard.preview.data.week_ending_cutoff_date, '2026-08-16');

  merge(makeUnresolvedResponse(), state);
  assertState(state, { ready: 0, cases: 3, blocked: 4 });

  const finalReady = { ...readyResponse, session_version: 22 };
  merge(finalReady, state);
  assertState(state, { ready: 7, cases: 0, blocked: 0 });
  assert.equal(state.pay.draftWizard.preview.data.session_version, 22);
  assert.equal(state.pay.draftWizard.preview.data.session_signature, 'session-signature-19');

  const jamesReadyRows = rowsForCandidate(state.pay.draftWizard.preview.data.preview.canonical_preview_lines, JAMES_ID);
  const positive = jamesReadyRows.filter((row) => Number(row.amount) > 0).reduce((sum, row) => sum + Number(row.amount), 0);
  const recoveries = jamesReadyRows.filter((row) => Number(row.amount) < 0).reduce((sum, row) => sum + Number(row.amount), 0);
  assert.equal(Number(positive.toFixed(2)), 790.63);
  assert.equal(Number(recoveries.toFixed(2)), -755.00);
  assert.equal(Number((positive + recoveries).toFixed(2)), 35.63);
});

test('validated effective section overrides stale presentation aliases in both finance transition directions', () => {
  const merge = createMerge();
  const { state, unrelatedReady } = makeFixture();

  const readyResponse = makeReadyResponse(unrelatedReady);
  for (const row of readyResponse.preview_rows) {
    row.presentation_section = 'CASES_RESOLUTIONS';
    row.section = 'cases_resolutions';
    row.resolved_section = 'cases_resolutions';
    row.row_json.presentation_section = 'CASES_RESOLUTIONS';
    row.row_json.section = 'cases_resolutions';
  }
  merge(readyResponse, state);
  assertState(state, { ready: 7, cases: 0, blocked: 0 });
  for (const row of rowsForCandidate(state.pay.draftWizard.preview.data.preview.canonical_preview_lines, JAMES_ID)) {
    assert.equal(row.effective_section, 'canonical_preview_lines');
    assert.equal(row.presentation_section, 'READY_TO_PAY');
    assert.equal(row.section, 'canonical_preview_lines');
  }

  const unresolvedResponse = makeUnresolvedResponse();
  for (const row of unresolvedResponse.preview_rows.filter((entry) => entry.effective_section === 'CASES_RESOLUTIONS')) {
    row.presentation_section = 'READY_TO_PAY';
    row.section = 'canonical_preview_lines';
    row.resolved_section = 'canonical_preview_lines';
    row.row_json.presentation_section = 'READY_TO_PAY';
    row.row_json.section = 'canonical_preview_lines';
  }
  merge(unresolvedResponse, state);
  assertState(state, { ready: 0, cases: 3, blocked: 4 });
});

test('finance transition gate accepts only the exact terminal clear or restore postcondition', () => {
  const validate = createFinanceTransitionValidator();
  const financeCaseId = '22222222-2222-4222-8222-222222222222';
  const caseKey = `finance:${financeCaseId}`;
  const exact = {
    candidate_id: JAMES_ID,
    finance_case_id: financeCaseId,
    case_key: caseKey
  };
  const resolvedAction = {
    action: 'CLEAR_CASE_RESOLUTION',
    enabled: true,
    candidate_id: JAMES_ID,
    finance_case_id: financeCaseId,
    case_key: caseKey,
    resolution_family: 'TAXABLE_CHANNEL_RESTRUCTURE'
  };
  const resolvedRow = makeRow(JAMES_ID, 'finance-ready', 'READY_TO_PAY', -220, {
    finance_case_id: financeCaseId,
    case_key: caseKey,
    clear_case_resolution_action: resolvedAction
  });
  const clearedRow = makeRow(JAMES_ID, 'finance-case', 'CASES_RESOLUTIONS', 220, {
    finance_case_id: financeCaseId,
    case_key: caseKey,
    selected: false,
    draftable: false,
    is_ready_for_draft: false
  });

  assert.equal(validate({ rows: [resolvedRow] }, { ...exact, transition: 'RESOLVED' }), true);
  assert.equal(validate({ rows: [clearedRow] }, { ...exact, transition: 'CLEARED' }), true);
  assert.equal(validate({ rows: [resolvedRow, clearedRow] }, { ...exact, transition: 'RESOLVED' }), false);
  assert.equal(validate({ rows: [resolvedRow, clearedRow] }, { ...exact, transition: 'CLEARED' }), false);
  assert.equal(validate({ rows: [] }, { ...exact, transition: 'CLEARED' }), false);
});

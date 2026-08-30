const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

const helperStart = mainSource.indexOf('const isOverpaymentRecoveryLine =');
const helperEnd = mainSource.indexOf('const getLineCandidateId =', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Banking Pay overpayment presentation helpers must be present');

const helperSource = mainSource.slice(helperStart, helperEnd);

function installHarness() {
  const context = {
    Math,
    String,
    Number,
    Array,
    isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    getNestedLinePayload: (value) => value?.nested || {},
    upperTrim: (value) => String(value || '').trim().toUpperCase(),
    trimStr: (value) => String(value || '').trim(),
    asArray: (value) => (Array.isArray(value) ? value : []),
    firstFinitePreviewNumber: (...values) => {
      for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const number = Number(value);
        if (Number.isFinite(number)) return number;
      }
      return null;
    },
    getLineCaseComponents: (value) => (Array.isArray(value?.case_components) ? value.case_components : []),
    getPreviewRowId: (value) => String(value?.preview_row_id || '').trim(),
    isPreviewRowSelectionAllowed: (value) => value?.selection_allowed !== false,
    getLineRowLevelAmount: (value) => Number(value?.amount_ex_vat || 0),
    getLineSectionAmount: (value) => Number(value?.amount_ex_vat || 0),
    toNum: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    uniqTrimmed: (values) => Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))),
    getFriendlyExpenseLabel: (value) => ({ ACCOMMODATION: 'Accommodation', TRAVEL: 'Travel' }[String(value || '').toUpperCase()] || 'Other Expense'),
    ymdToUk: (value) => {
      const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
    },
    enc: (value) => String(value),
    fmtMoney: (value) => Number(value || 0).toFixed(2),
    resolvedRateBadgeHtml: () => ''
  };
  vm.runInNewContext(`${helperSource}\nthis.__overpaymentHelpers = { getOverpaymentRecoveryPresentation, getManualDebtRecoveryPresentation, buildOverpaymentRecoveryDisplayLines, buildOverpaymentRecoverySectionDisplayState, getPreviewLineDisplayAmount, getCaseResolutionDisplayAmount, getCaseResolutionPayRoutePresentation, renderPreviewLineTypeHtml, renderPreviewLineAmountHtml };`, context, {
    filename: 'banking-pay-overpayment-presentation-helpers.js'
  });
  return context.__overpaymentHelpers;
}

const eduardoRecoveryRow = {
  line_type: 'OVERPAYMENT_RECOVERY',
  presentation_reason: 'NO_PAY_HEADROOM',
  blocked_reason_codes: ['NO_PAY_HEADROOM'],
  amount_ex_vat: '0.00',
  case_components: [
    { component_key_type: 'EXPENSE_CODE', component_key_value: 'ACCOMMODATION', source_amount: '2.00', remaining_source_amount: '2.00', preview_due_amount_ex_vat: '0.00' },
    { component_key_type: 'EXPENSE_CODE', component_key_value: 'TRAVEL', source_amount: '11.99', remaining_source_amount: '11.99', preview_due_amount_ex_vat: '0.00' },
    { component_key_type: 'TS_DAY', component_key_value: '2026-06-09', source_amount: '0.98', remaining_source_amount: '0.98', preview_due_amount_ex_vat: '0.00' },
    { component_key_type: 'TS_DAY', component_key_value: '2026-06-10', source_amount: '0.87', remaining_source_amount: '0.87', preview_due_amount_ex_vat: '0.00' }
  ]
};

test('shows the outstanding amount due and explains zero headroom in Blocked for Pay', () => {
  const helpers = installHarness();
  const presentation = helpers.getOverpaymentRecoveryPresentation(eduardoRecoveryRow);

  assert.equal(presentation.outstanding_total, 15.84);
  assert.equal(presentation.recoverable_this_run, 0);
  assert.equal(presentation.no_available_funds, true);
  assert.equal(helpers.getPreviewLineDisplayAmount(eduardoRecoveryRow), 0);
  assert.match(helpers.renderPreviewLineTypeHtml(eduardoRecoveryRow), /No available funds to recover this yet\./);
  const blockedAmountHtml = helpers.renderPreviewLineAmountHtml(eduardoRecoveryRow, 'BLOCKED_FOR_PAY');
  assert.match(blockedAmountHtml, />15\.84</);
  assert.doesNotMatch(blockedAmountHtml, />0\.00</);
  assert.match(blockedAmountHtml, /No recovery can be made because there are no available funds to deduct from this pay run\./);
  assert.match(mainSource, /insufficientRecoveryFunds \? 'Insufficient funds'/);
  assert.match(mainSource, /compactReady \|\| insufficientRecoveryFunds \? ''/);
  assert.match(mainSource, /!insufficientRecoveryFunds && blockedUi\.detailTexts\.length/);
});

test('shows the source amount and conversion direction for a pay-channel case resolution', () => {
  const helpers = installHarness();
  const unresolvedRecovery = {
    line_type: 'OVERPAYMENT_RECOVERY',
    presentation_section: 'CASES_RESOLUTIONS',
    pay_channel: 'UMBRELLA',
    amount_ex_vat: '0.00',
    nominal_due_amount_ex_vat: '25.00',
    case_components: [{
      source_pay_method: 'PAYE',
      current_target_pay_method: 'UMBRELLA',
      source_amount: '25.00',
      remaining_source_amount: '25.00',
      preview_due_amount_ex_vat: '0.00'
    }]
  };

  const route = helpers.getCaseResolutionPayRoutePresentation(unresolvedRecovery);
  assert.equal(route.source_pay_method, 'PAYE');
  assert.equal(route.target_pay_method, 'UMBRELLA');
  assert.equal(route.direction_label, 'Payment was originally PAYE. Candidate is now paid through an umbrella company.');
  assert.equal(route.action_description, 'Payment was originally PAYE. Candidate is now paid through an umbrella company. Choose how this payment should be handled.');
  assert.equal(route.nominal_amount, 25);
  assert.match(helpers.renderPreviewLineAmountHtml(unresolvedRecovery, 'CASES_RESOLUTIONS'), /<strong>PAYE<\/strong> £25\.00/);
  assert.match(helpers.renderPreviewLineAmountHtml(unresolvedRecovery, 'CASES_RESOLUTIONS'), /Payment was originally PAYE\. Candidate is now paid through an umbrella company\. Choose how this payment should be handled\./);
  assert.match(helpers.renderPreviewLineAmountHtml(unresolvedRecovery), />0\.00</);
});

test('supports the reverse Umbrella to PAYE direction for non-recovery payment cases', () => {
  const helpers = installHarness();
  const unresolvedLoan = {
    line_type: 'LOAN_REPAYMENT',
    presentation_section: 'CASES_RESOLUTIONS',
    amount_ex_vat: '0.00',
    nominal_due_amount_ex_vat: '40.00',
    case_components: [{
      source_pay_method: 'UMBRELLA',
      current_target_pay_method: 'PAYE'
    }]
  };

  const route = helpers.getCaseResolutionPayRoutePresentation(unresolvedLoan);
  assert.equal(route.direction_label, 'Payment was originally through an umbrella company. Candidate is now PAYE.');
  assert.equal(route.action_description, 'Payment was originally through an umbrella company. Candidate is now PAYE. Choose how this payment should be handled.');
  assert.match(helpers.renderPreviewLineAmountHtml(unresolvedLoan, 'CASES_RESOLUTIONS'), /<strong>UMBRELLA<\/strong> £40\.00/);
  assert.match(helpers.renderPreviewLineAmountHtml(unresolvedLoan, 'CASES_RESOLUTIONS'), /Payment was originally through an umbrella company\. Candidate is now PAYE\. Choose how this payment should be handled\./);
});

test('uses the source-to-target direction beneath Resolution required for both case row renderers', () => {
  const directionBindings = mainSource.match(/caseRecoveryRoute \? enc\(caseRecoveryRoute\.direction_label\)/g) || [];
  assert.equal(directionBindings.length, 2);
});

test('shows the unresolved correction amount in Cases / Resolutions without treating it as allocatable pay', () => {
  const helpers = installHarness();
  const unresolvedCorrection = {
    line_type: 'TIMESHEET_PAYMENT',
    presentation_section: 'CASES_RESOLUTIONS',
    presentation_reason: 'PAY_METHOD_RESOLUTION_REQUIRED',
    amount_ex_vat: '0.00',
    section_amount_ex_vat: '0.00',
    nominal_due_amount_ex_vat: '67.50',
    case_resolution_summary: {
      case_needs_resolution: true,
      unresolved_taxable_amount_ex_vat: '67.50',
      blocked_case_amount_ex_vat: '0.00',
      safe_amount_ex_vat: '0.00'
    },
    selection_allowed: false,
    draftable: false,
    is_ready_for_draft: false
  };

  assert.equal(helpers.getCaseResolutionDisplayAmount(unresolvedCorrection), 67.5);
  assert.match(
    helpers.renderPreviewLineAmountHtml(unresolvedCorrection, 'CASES_RESOLUTIONS'),
    />67\.50</
  );
  assert.equal(unresolvedCorrection.amount_ex_vat, '0.00');
  assert.equal(unresolvedCorrection.selection_allowed, false);
  assert.equal(unresolvedCorrection.draftable, false);
});

test('keeps an ordinary zero-value case at zero when no unresolved amount exists', () => {
  const helpers = installHarness();
  const zeroCase = {
    line_type: 'TIMESHEET_PAYMENT',
    presentation_section: 'CASES_RESOLUTIONS',
    amount_ex_vat: '0.00',
    case_resolution_summary: {
      case_needs_resolution: false,
      unresolved_taxable_amount_ex_vat: '0.00'
    }
  };

  assert.equal(helpers.getCaseResolutionDisplayAmount(zeroCase), 0);
  assert.match(helpers.renderPreviewLineAmountHtml(zeroCase, 'CASES_RESOLUTIONS'), />0\.00</);
});

test('shows scheduled manual-debt recovery separately from a zero current-run recovery', () => {
  const helpers = installHarness();
  const manualDebtRow = {
    line_type: 'MANUAL_DEBT_RECOVERY',
    presentation_reason: 'NO_PAY_HEADROOM',
    blocked_reason_codes: ['NO_PAY_HEADROOM'],
    amount_ex_vat: '0.00',
    case_components: [{
      source_basis_json: { weekly_due: '100.00' },
      preview_due_amount_ex_vat: '0.00'
    }]
  };

  const presentation = helpers.getManualDebtRecoveryPresentation(manualDebtRow);
  assert.equal(presentation.scheduled_due, 100);
  assert.equal(presentation.recoverable_this_run, 0);
  assert.equal(presentation.no_available_funds, true);
  assert.equal(helpers.getPreviewLineDisplayAmount(manualDebtRow), -100);
  assert.match(helpers.renderPreviewLineTypeHtml(manualDebtRow), /No unreserved payable earnings are available for this recovery\./);
  assert.match(helpers.renderPreviewLineAmountHtml(manualDebtRow), /-100\.00/);
  assert.match(helpers.renderPreviewLineAmountHtml(manualDebtRow), /Scheduled recovery due/);
  assert.match(helpers.renderPreviewLineAmountHtml(manualDebtRow), /Recoverable this pay run: 0\.00/);
});

test('never substitutes the scheduled debt amount for a recoverable ready amount', () => {
  const helpers = installHarness();
  const readyManualDebtRow = {
    line_type: 'MANUAL_DEBT_RECOVERY',
    presentation_reason: 'READY_TO_PAY',
    nominal_due_amount_ex_vat: '100.00',
    recoverable_this_pay_run_ex_vat: '50.00',
    amount_ex_vat: '-50.00'
  };

  const presentation = helpers.getManualDebtRecoveryPresentation(readyManualDebtRow);
  assert.equal(presentation.scheduled_due, 100);
  assert.equal(presentation.recoverable_this_run, 50);
  assert.equal(presentation.no_available_funds, false);
  assert.equal(helpers.getPreviewLineDisplayAmount(readyManualDebtRow), -50);
  assert.match(helpers.renderPreviewLineAmountHtml(readyManualDebtRow), /-50\.00/);
  assert.doesNotMatch(helpers.renderPreviewLineAmountHtml(readyManualDebtRow), /Scheduled recovery due/);
});

test('uses friendly descriptions for every overpayment constituent', () => {
  const helpers = installHarness();
  const presentation = helpers.getOverpaymentRecoveryPresentation(eduardoRecoveryRow);

  assert.deepEqual(
    Array.from(presentation.components, (component) => component.label),
    ['Accommodation', 'Travel', 'Timesheet pay — 09/06/2026', 'Timesheet pay — 10/06/2026']
  );
});

test('renders a dedicated overpayment breakdown instead of the expense-component dropdown', () => {
  assert.match(mainSource, /<summary class="mini"[^>]*>Show overpayment breakdown<\/summary>/);
  assert.match(mainSource, /This overpayment is made up of the following amounts\./);
  assert.match(mainSource, /<th>Description<\/th>/);
  assert.match(mainSource, /<th[^>]*>Original overpayment<\/th>/);
  assert.match(mainSource, /<th[^>]*>Outstanding<\/th>/);
  assert.match(mainSource, /<th[^>]*>Recoverable this pay run<\/th>/);
  assert.match(mainSource, /isOverpaymentRecoveryLine\(line\)[\s\S]*renderOverpaymentRecoveryBreakdown\(line, options\)[\s\S]*renderExpenseComponentBreakdown\(line, options\)/);
});

test('groups one multi-component recovery into one visible parent while preserving every economic row id', () => {
  const helpers = installHarness();
  const rows = Array.from({ length: 5 }, (_, index) => ({
    line_type: 'OVERPAYMENT_RECOVERY',
    presentation_role: 'CHILD',
    presentation_parent_line_id: 'finance:case-1:overpayment_recovery',
    finance_case_id: 'case-1',
    preview_row_id: `row-${index + 1}`,
    amount_ex_vat: '-0.25',
    selection_allowed: true,
    case_components: [{
      finance_component_id: `component-${index + 1}`,
      component_key_type: 'TS_DAY',
      component_key_value: `2026-07-${String(index + 6).padStart(2, '0')}`,
      source_amount: '11.25',
      remaining_source_amount: '11.25',
      preview_due_amount_ex_vat: '0.25'
    }]
  }));

  const displayRows = helpers.buildOverpaymentRecoveryDisplayLines(rows);
  assert.equal(displayRows.length, 1);
  assert.deepEqual(Array.from(displayRows[0].__presentation_group_preview_row_ids), ['row-1', 'row-2', 'row-3', 'row-4', 'row-5']);
  assert.equal(displayRows[0].case_components.length, 5);
  assert.equal(displayRows[0].amount_ex_vat, -1.25);
  assert.equal(displayRows[0].presentation_role, 'PARENT');
  assert.equal(displayRows[0].source_ref, 'advance:case-1');

  const presentation = helpers.getOverpaymentRecoveryPresentation(displayRows[0]);
  assert.equal(presentation.outstanding_total, 56.25);
  assert.equal(presentation.recoverable_this_run, 1.25);
  assert.match(mainSource, /if \(a === 'banking:pay:toggleTimesheetPreviewGroup'\)[\s\S]*setPreviewRowsSelection\(previewRowIds, selectAllChildren, \{ selectionEpoch \}\)/);
});

test('caps a grouped recovery breakdown to the row-level pre-draft headroom', () => {
  const helpers = installHarness();
  const rows = [
    ['row-1', '2026-06-29', 79.72],
    ['row-2', '2026-06-30', 87.53],
    ['row-3', '2026-07-01', 87.53],
    ['row-4', '2026-07-02', 56.08]
  ].map(([previewRowId, componentDate, recoverable]) => ({
    line_type: 'OVERPAYMENT_RECOVERY',
    presentation_role: 'CHILD',
    presentation_parent_line_id: 'finance:case-kier:overpayment_recovery',
    finance_case_id: 'case-kier',
    preview_row_id: previewRowId,
    amount_display: String(-recoverable),
    amount_ex_vat: String(-recoverable),
    section_amount_display: String(-recoverable),
    selection_allowed: true,
    case_components: [{
      finance_component_id: `component-${previewRowId}`,
      component_key_type: 'TS_DAY',
      component_key_value: componentDate,
      source_amount: '270.876',
      remaining_source_amount: '270.876',
      preview_due_amount_ex_vat: '486.94'
    }]
  }));

  const grouped = helpers.buildOverpaymentRecoveryDisplayLines(rows)[0];
  const presentation = helpers.getOverpaymentRecoveryPresentation(grouped);

  assert.equal(grouped.amount_ex_vat, -310.86);
  assert.equal(grouped.amount_display, -310.86);
  assert.equal(grouped.section_amount_display, -310.86);
  assert.equal(presentation.outstanding_total, 1083.52);
  assert.equal(presentation.recoverable_this_run, 310.86);
  assert.deepEqual(
    Array.from(presentation.components, (component) => component.recoverable_this_run),
    [79.72, 87.53, 87.53, 56.08]
  );
  assert.match(helpers.renderPreviewLineAmountHtml(grouped), /-310\.86/);
  assert.match(helpers.renderPreviewLineAmountHtml(grouped), /310\.86 will be recovered from the total outstanding amount of 1083\.52\./);
});

test('presents one finance-case recovery in Ready while preserving only selectable economic row ids', () => {
  const helpers = installHarness();
  const readyComponent = {
    line_type: 'OVERPAYMENT_RECOVERY',
    presentation_parent_line_id: 'finance:case-kier:overpayment_recovery',
    finance_case_id: 'case-kier',
    preview_row_id: 'ready-row',
    amount_ex_vat: '-1.00',
    selection_allowed: true,
    case_components: [{
      finance_component_id: 'component-ready',
      component_key_type: 'EXPENSE_CODE',
      component_key_value: 'ACCOMMODATION',
      remaining_source_amount: '221.73',
      preview_due_amount_ex_vat: '1.00'
    }]
  };
  const blockedComponents = [
    ['blocked-1', 'component-1', '243.47'],
    ['blocked-2', 'component-2', '243.47'],
    ['blocked-3', 'component-3', '293.49'],
    ['blocked-4', 'component-4', '352.22']
  ].map(([previewRowId, financeComponentId, outstanding]) => ({
    line_type: 'OVERPAYMENT_RECOVERY',
    presentation_parent_line_id: `component-parent:${financeComponentId}`,
    finance_case_id: 'case-kier',
    preview_row_id: previewRowId,
    amount_ex_vat: '0.00',
    selection_allowed: false,
    presentation_reason: 'NO_PAY_HEADROOM',
    case_components: [{
      finance_component_id: financeComponentId,
      component_key_type: 'TS_DAY',
      component_key_value: previewRowId,
      remaining_source_amount: outstanding,
      preview_due_amount_ex_vat: '0.00'
    }]
  }));

  const state = helpers.buildOverpaymentRecoverySectionDisplayState({
    readyLines: [readyComponent],
    blockedLines: blockedComponents
  });

  assert.equal(state.readyLines.length, 1);
  assert.equal(state.blockedLines.length, 0);
  assert.deepEqual(Array.from(state.readyLines[0].__presentation_group_preview_row_ids), [
    'ready-row',
    'blocked-1',
    'blocked-2',
    'blocked-3',
    'blocked-4'
  ]);
  assert.deepEqual(Array.from(state.readyLines[0].__presentation_group_selectable_row_ids), ['ready-row']);
  const presentation = helpers.getOverpaymentRecoveryPresentation(state.readyLines[0]);
  assert.equal(presentation.outstanding_total, 1354.38);
  assert.equal(presentation.recoverable_this_run, 1);
  assert.equal(presentation.no_available_funds, false);
  assert.equal(helpers.getPreviewLineDisplayAmount(state.readyLines[0]), -1);
  assert.match(helpers.renderPreviewLineAmountHtml(state.readyLines[0]), /1\.00 will be recovered from the total outstanding amount of 1354\.38\./);
});

test('presentation grouping cannot broaden the authoritative draft selection', () => {
  const selectionStart = mainSource.indexOf('const localSelectedCurrentEligibleReadyRows =');
  const displayStart = mainSource.indexOf('const overpaymentRecoveryDisplaySections =');
  const createGateStart = mainSource.indexOf('const authoritativeSelectedCurrentEligibleReadyRowCount =');
  assert.ok(selectionStart >= 0 && displayStart >= 0 && createGateStart >= 0);
  assert.match(
    mainSource.slice(selectionStart, createGateStart),
    /localSelectedCurrentEligibleReadyRows = readyPreviewLines\.filter/
  );
  assert.doesNotMatch(
    mainSource.slice(selectionStart, createGateStart),
    /localSelectedCurrentEligibleReadyRows = readyPreviewLinesForDisplay\.filter/
  );
  assert.match(
    mainSource,
    /__presentation_group_selectable_row_ids: selectablePreviewRowIds/
  );
});

test('gives terminal failure precedence over stale pending state and de-duplicates failure levels', () => {
  assert.match(mainSource, /if \(authoritativeRenderState\.hasFailure \|\| hasFailedCandidates\) return 'Refresh failed';\s*if \(authoritativeRenderState\.displayReady && !authoritativeRenderState\.draftSafe\) return 'Checking changes…';\s*if \(hasPendingCandidates\) return 'Preparing…';/);
  assert.match(mainSource, /const issueCount = Math\.max\([\s\S]*candidateCounts\.failed[\s\S]*lineCounts\.failed[\s\S]*jobCounts\.unresolved_failed/);
  assert.match(mainSource, /pendingCandidateIds\.filter\(\(candidateId\) => !failedCandidateIdSet\.has\(candidateId\)\)/);
});

test('Banking Pay Refresh enqueues a full live workbench refresh without clearing decisions', () => {
  const helperStart = mainSource.indexOf('async function bankingPayWorkbenchSessionRefresh');
  const helperEnd = mainSource.indexOf('async function bankingPayWorkbenchSessionClearAllDecisions', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'workbench refresh helper must be present');
  const helperBody = mainSource.slice(helperStart, helperEnd);
  assert.match(helperBody, /\/api\/banking\/pay\/workbench\/session\/\$\{encodeURIComponent\(sessionIdText\)\}\/refresh/);
  assert.doesNotMatch(helperBody, /clear-all-decisions|\/discard|create-draft|execute|settle/i);

  const refreshStart = mainSource.indexOf('const refreshBankingPayAll = async');
  const refreshEnd = mainSource.indexOf('const childResultShouldRefreshPayWorkbench', refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'Banking Pay Refresh action must be present');
  const refreshBody = mainSource.slice(refreshStart, refreshEnd);
  const enqueueIndex = refreshBody.indexOf('await bankingPayWorkbenchSessionRefresh');
  const rereadIndex = refreshBody.indexOf('await refreshPayWorkbench');
  assert.ok(enqueueIndex >= 0, 'Refresh must enqueue authoritative workbench recomputation');
  assert.ok(rereadIndex > enqueueIndex, 'Refresh must reread the workbench after enqueueing recomputation');
  assert.doesNotMatch(refreshBody, /bankingPayWorkbenchSessionClearAllDecisions|bankingPayWorkbenchSessionDiscard/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'js', 'main.js'), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} source must be present`);
  return source.slice(start, end);
}

test('Banking Pay batch list hides technical ids and presents one status with UK timing and plain routes', () => {
  const list = sliceBetween('function renderPayBatchListPanel', 'function deriveTimesheetModalInvoicingState');
  assert.match(list, />Type<\/th>/);
  assert.match(list, />Status<\/th>/);
  assert.match(list, />Timing<\/th>/);
  assert.match(list, />Route<\/th>/);
  assert.match(list, />Timesheets<\/th>/);
  assert.doesNotMatch(list, /<th>ID<\/th>/);
  assert.doesNotMatch(list, /<th>Rail<\/th>/);
  assert.match(list, /CSV upload/);
  assert.match(list, /Cashless settlement/);
  assert.match(list, /Revolut/);
  assert.match(list, /Created \$\{enc\(created\)\}/);
  assert.match(list, /Scheduled for \$\{scheduledAtUkLabel\}/);
  assert.doesNotMatch(list, /class="mono">\$\{enc\(id/);
  assert.match(source, /const listLoadSequence =/);
  assert.match(source, /pay\.list\.loading = false;\s*try \{ if \(typeof bankingRerender/);
  assert.match(source, /if \(Number\(pay\.list\.__loadSequence \|\| 0\) === listLoadSequence\)/);
});

test('completed cancellation history does not render an in-progress batch banner', () => {
  const helper = sliceBetween('function bankingPayCorrectionRequestIsActive', 'function getBankingPayStage3Context');
  const batchChild = sliceBetween('async function openBankingPayBatchChildModal', 'function openBulkTimesheetActionProgressModal');
  const classify = new Function(`${helper}; return bankingPayCorrectionRequestIsActive;`)();
  assert.match(helper, /terminalFlag === true \|\| activeFlag === false/);
  assert.match(helper, /'APPLIED', 'APPLIED_WITH_BLOCKERS', 'BLOCKED', 'FAILED', 'REJECTED', 'CANCELLED'/);
  assert.match(helper, /'PLANNING', 'PLANNED', 'REQUESTED', 'AWAITING_AUTHORISATION'/);
  assert.match(batchChild, /!bankingPayCorrectionRequestIsActive\(request\)/);
  assert.equal(classify({ id: 'request-active', status: 'PROCESSING', is_active: true, is_terminal: false }), true);
  assert.equal(classify({ id: 'request-complete', status: 'APPLIED', is_active: false, is_terminal: true }), false);
  assert.equal(classify({ id: 'request-history-only' }), false);
});

test('draft and payment progress use friendly operation-wide or indeterminate progress only', () => {
  const modal = sliceBetween('function openBankingPayOperationProgressModal', 'async function bankingPayOperationGet');
  assert.match(modal, /Still working…/);
  assert.match(modal, /maxMeaningfulPercent/);
  assert.match(modal, /counterMode === 'CUMULATIVE'/);
  assert.match(modal, /counterScope === 'DRAFT_CREATE'/);
  assert.match(modal, /is-indeterminate/);
  assert.doesNotMatch(modal, /This progress covers the complete operation and will not move backwards/);
  assert.doesNotMatch(modal, /data-role="op-total"/);
  assert.doesNotMatch(modal, /data-role="op-chunk"/);
  assert.doesNotMatch(modal, /data-role="op-failed"/);
  assert.doesNotMatch(modal, /Heartbeat:/);
  assert.doesNotMatch(modal, /Resume reason:/);
  assert.doesNotMatch(modal, /Lease:/);
  assert.match(modal, /refreshButton\.style\.display = operationType === 'DRAFT_CREATE' \? 'none' : ''/);
  assert.doesNotMatch(source, /handleViewActiveDraftCreateStatus\(operation, 'Refresh status'/);
});

test('a failed cancellation start remains visible until status changes or the user refreshes', () => {
  const cancellation = sliceBetween('const bankingPayCancellationProgressState', 'async function loadCompleteBankingPayCancellationProjectionStatus');
  assert.match(cancellation, /errorStatusKey/);
  assert.match(cancellation, /Identity was confirmed, but CloudTMS could not start the cancellation/);
  assert.match(source, /if \(!state\.error \|\| !state\.errorStatusKey \|\| nextStatusKey !== state\.errorStatusKey\)/);
  assert.match(cancellation, /data-banking-pay-cancellation-refresh="1"/);
  assert.doesNotMatch(cancellation, /Retry cancellation preparation/);
});

test('cancellation authenticates before the progress modal and uses a calm Workbench-pending state', () => {
  const cancellation = sliceBetween('const bankingPayCancellationProgressState', 'async function loadCompleteBankingPayCancellationProjectionStatus');
  const reauth = sliceBetween('async function openBankingReauthModal', 'async function openPayBatchPasswordConfirmModal');
  assert.match(source, /const requiresCancellationReauth = \['DRAFT_CANCEL', 'CANCEL_PAYMENT'\]/);
  assert.match(source, /if \(requiresCancellationReauth && !draftReauthToken\) return/);
  assert.match(reauth, /const lexicalParentModalCtx =/);
  assert.match(reauth, /const restoredModalCtx = parentModalCtx \|\| lexicalParentModalCtx/);
  assert.match(reauth, /if \(title\) title\.textContent = parentModalTitle/);
  assert.match(cancellation, /Financial cancellation is complete\./);
  assert.match(cancellation, /Banking Pay is updating quietly in the background\./);
  assert.doesNotMatch(cancellation, /aria-label="\$\{workbenchPending \? 'Banking Pay update in progress'/);
});

test('terminal cancellation results say failed explicitly and distinguish mixed outcomes', () => {
  const cancellation = sliceBetween('const bankingPayCancellationProgressState', 'async function loadCompleteBankingPayCancellationProjectionStatus');
  const batchChild = sliceBetween('async function openBankingPayBatchChildModal', 'function openBulkTimesheetActionProgressModal');
  assert.match(cancellation, /\['BLOCKED', 'Cancellation failed'\]/);
  assert.match(cancellation, /terminalFailedCount/);
  assert.match(cancellation, /terminalMixedResult/);
  assert.match(cancellation, /Cancellation partly completed — some payments failed/);
  assert.match(cancellation, /Cancellation failed\. No payment was cancelled/);
  assert.match(cancellation, /succeeded and/);
  assert.match(cancellation, /failed\. Failed payments were left unchanged/);
  assert.match(cancellation, /REAUTHORISE_REMAINING: 'Review and reauthorise remaining batch'/);
  assert.match(cancellation, /typeof batchChild\.openReauthorisationReview !== 'function'/);
  assert.match(cancellation, /await batchChild\.openReauthorisationReview\(\)/);
  assert.doesNotMatch(cancellation, /if \(action === 'REAUTHORISE_REMAINING'\) \{\s*await bankingPayBatchPrepare/);
  assert.match(batchChild, /child\.openReauthorisationReview = async \(\) =>/);
  assert.match(batchChild, /return executePaymentPipeline\(\{ reauthoriseRemaining: true \}\)/);
  assert.doesNotMatch(cancellation, /terminal \? 'Cancellation ended'/);
});

test('Banking Pay keeps operational diagnostics out of the customer modal and presents a compact create summary', () => {
  const banking = sliceBetween('function renderBankingTab', 'function renderBankingPayTab');
  assert.doesNotMatch(banking, /Test mode: $\{isTestMode \? 'On' : 'Off'\}/);
  assert.doesNotMatch(banking, /<summary[^>]*>Diagnostics/);

  const wizard = sliceBetween('const readyEmptyMessage', 'function deriveBankingAttentionStateFromBatchList');
  assert.match(wizard, /Create payment batch/);
  assert.match(wizard, /Choose Ready to Pay rows, then create a draft/);
  assert.match(source, /const filterSummary = `Scope:/);
  assert.doesNotMatch(wizard, /Create \/ Preview/);
  assert.doesNotMatch(wizard, /Selected current eligible Ready to Pay rows:/);
});

test('Current Payment Status presents cancelled PAYE gross after deductions and net and one Umbrella payable amount', () => {
  const panel = sliceBetween('function renderBankingPayStage3StatusPanel', 'function refreshBankingPayStage3SelectedRows');
  assert.match(panel, /Gross after deductions/);
  assert.match(panel, /historicalVerb\.toLowerCase/);
  assert.match(panel, /cancelledPayableAmountPence/);
  assert.match(panel, /cancelledBankAmountPence/);
  assert.doesNotMatch(panel, /Gross\/base/);
});

test('Draft PAYE amounts distinguish missing net input from a real zero bank payment', () => {
  const helper = sliceBetween('function bankingPayCandidateAwaitingPayeNetAmount', 'function normaliseBankingPayStage3StatusRow');
  const statusPanel = sliceBetween('function renderBankingPayStage3StatusPanel', 'function refreshBankingPayStage3SelectedRows');
  const overview = sliceBetween('function renderBankingPayBatchChildModalOverview', 'function renderBankingPayBatchChildModalRemittanceTab');
  assert.match(helper, /latest_paye_net_input/);
  assert.match(helper, /global_missing_explicit_paye_input_count/);
  assert.match(statusPanel, /Awaiting PAYE net amount/);
  assert.match(overview, /PAYE net amount required/);
  assert.match(overview, /Ready to execute/);
  assert.match(overview, /active_overview_candidate_count/);
  assert.match(overview, /active_overview_amount_pence/);
  assert.match(overview, /data-banking-pay-awaiting-paye-net/);
});

test('Overview has a prominent whole-candidate tree toggle in addition to nested toggles', () => {
  const overview = sliceBetween('function renderBankingPayBatchChildModalOverview', 'function renderBankingPayBatchChildModalRemittanceTab');
  const handlers = sliceBetween("if (act === 'banking:pay:child:expandAll')", 'const onChange = async');
  assert.match(overview, /data-action="banking:pay:child:toggleCandidateTree"/);
  assert.match(overview, /font-size:21px/);
  assert.match(overview, /expandWholeTree \|\| groupExpansionState\[weekKey\]/);
  assert.match(overview, /expandWholeTree \|\| groupExpansionState\[clientKey\]/);
  assert.match(overview, /expandWholeTree \|\| groupExpansionState\[timesheetKey\]/);
  assert.match(handlers, /toggleCandidateTree/);
  assert.match(handlers, /candidateDetailExpandAllByKey/);
});

test('payment execution confirmation retains an exact DOM ownership fence without modal frame globals', () => {
  const confirmation = sliceBetween('async function openBankingPayExecuteConfirmModal', 'async function bankingPayBatchExecutePayment');
  assert.match(confirmation, /const root = getRoot\(\)/);
  assert.match(confirmation, /let wireAttempts = 0/);
  assert.match(confirmation, /if \(wireAttempts < 40\) setTimeout\(wire, 50\)/);
  assert.match(confirmation, /document\.addEventListener\('click', onClick, true\)/);
  assert.match(confirmation, /setTimeout\(wire, 0\);\s*try \{ requestAnimationFrame\(\(\) => requestAnimationFrame\(wire\)\)/);
  assert.match(confirmation, /const bodyNow = getBody\(\)/);
  assert.match(confirmation, /if \(!bodyNow \|\| !root \|\| !bodyNow\.contains\(root\)\) return false/);
  assert.doesNotMatch(confirmation, /ctxSeed && fr\._ctxRef/);
});

test('batch child error and recovery cards close through the owning capture handler', () => {
  const batchChild = sliceBetween('async function openBankingPayBatchChildModal', 'function openBulkTimesheetActionProgressModal');
  assert.match(batchChild, /if \(act === 'modal:close' \|\| act === 'banking:pay:child:close'\) \{\s*closeTop\(\);\s*return;/);
});

test('awaiting-authorisation batch opens the normal reauthorisation review', () => {
  const batchChild = sliceBetween('async function openBankingPayBatchChildModal', 'function openBulkTimesheetActionProgressModal');
  assert.match(batchChild, /act === 'banking:pay:child:openAuthorisation'/);
  assert.match(batchChild, /await child\.openReauthorisationReview\(\)/);
  assert.match(source, /title="Review and reauthorise the remaining batch">Review and reauthorise batch<\/button>/);
  assert.match(source, /const reauthorisationRequired = readFirstBool\(/);
  assert.match(source, /reauthorisationRequired \? 'Review and reauthorise batch' : 'Execute payment'/);
  assert.match(source, /function readFirstBool\(\.\.\.values\) \{/);
  assert.doesNotMatch(source, /const readFirstBool = \(\.\.\.values\) => \{/);
  assert.match(source, /const lowerTrim = \(v\) => trimStr\(v\)\.toLowerCase\(\);/);
});

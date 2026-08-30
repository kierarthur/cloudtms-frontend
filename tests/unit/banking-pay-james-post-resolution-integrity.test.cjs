const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} must exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return source.slice(start, end);
}

test('settled candidate adoption reads every page and merges once atomically', () => {
  const poll = sliceBetween(
    'async function pollPayWorkbenchCandidateUntilSettled(sessionId, candidateId, options = {}) {',
    'async function bankingPayWorkbenchSessionOpen(payload = {}) {'
  );

  assert.match(poll, /while \(candidatePreviewPageCount < 100\)/);
  assert.match(poll, /before_candidate_preview_page_fetch/);
  assert.match(poll, /after_candidate_preview_page_fetch/);
  assert.match(poll, /returnedSessionId !== sessionIdText \|\| returnedCandidateId !== candidateIdText/);
  assert.match(poll, /returnedVersion !== candidatePreviewVersion/);
  assert.match(poll, /returnedVersion < minimumSessionVersion/);
  assert.match(poll, /BANKING_PAY_CANDIDATE_ATOMIC_REFRESH_ROW_IDENTITY_INVALID/);
  assert.match(poll, /candidatePreviewRows\.length > 10000/);
  assert.match(poll, /atomic_candidate_refresh_complete: true/);
  assert.match(poll, /typeof options\.validateSettledCandidatePreview === 'function'/);
  assert.match(poll, /terminalCandidatePreviewAccepted/);
  assert.match(poll, /await guardedSleep\(fastPollMs\)/);
  assert.match(poll, /mergePayWorkbenchCandidatePreviewIntoState\(candidatePreview\)/);
  assert.equal((poll.match(/mergePayWorkbenchCandidatePreviewIntoState\(candidatePreview\)/g) || []).length, 1);
});

test('candidate merge treats the complete response as authoritative across all sections', () => {
  const merge = sliceBetween(
    'function mergePayWorkbenchCandidatePreviewIntoState(candidateResponse, state = null) {',
    'async function pollPayWorkbenchCandidateUntilSettled(sessionId, candidateId, options = {}) {'
  );

  assert.match(merge, /candidateRowPayloadProvided/);
  assert.match(merge, /mergeRowsForCandidate\(nextPreview\[key\], incoming, responseCandidateId\)/);
  assert.match(merge, /const caseEntry = isPlainObject\(row\.__case_entry\)/);
  assert.match(merge, /caseEntryCandidate\.candidate_id/);
  for (const key of ['case_resolution_states', 'caseResolutionStates', 'cases_resolutions', 'casesResolutions']) {
    assert.match(merge, new RegExp(`'${key}'`));
  }
  assert.match(merge, /assignCaseResolutionAliases\(nextPreview, authoritativeCaseResolutionRows\)/);
  assert.match(merge, /assignCaseResolutionAliases\(nextEnvelope, nextPreview\.case_resolution_states\)/);
  assert.match(merge, /nextPreview\.componentStateCache = normalizedCandidateComponentStateCache/);
  assert.match(merge, /nextPreview\.component_state_cache = normalizedCandidateComponentStateCache/);
  assert.match(merge, /wiz\.preview\.componentStateCache = normalizedCandidateComponentStateCache/);
  assert.match(merge, /wiz\.preview\.component_state_cache = normalizedCandidateComponentStateCache/);
  assert.match(merge, /assignCaseResolutionAliases\(wiz\.decisions, caseResolutionStates\)/);
  assert.match(merge, /assignCaseResolutionAliases\(wiz\.workbench, caseResolutionStates\)/);
  assert.match(merge, /attachPreviewPageCacheAliases\(wiz\.preview, canonicalCandidatePageMap\)/);
  assert.match(merge, /attachPreviewPageCacheAliases\(wiz\.workbench, canonicalCandidatePageMap\)/);
  assert.doesNotMatch(merge, /rows_count = Math\.max\(Number\(pageValue\.rows_count/);
  assert.match(merge, /canonical_preview_lines = mergeRowsForKey\('canonical_preview_lines', \['canonical_preview_lines'\]\)/);
  assert.match(merge, /blocked_for_pay_now = mergeRowsForKey\('blocked_for_pay_now', \['blocked_for_pay'\]\)/);
});

test('Ready grouped timesheets expose one exact cancel action and fail closed on identity conflict', () => {
  const render = sliceBetween(
    'const resolvedRateCancelActionHtml =',
    'const previewActionHtml ='
  ) + sliceBetween(
    'const renderReadyTimesheetGroupedRows =',
    'const renderTimesheetParentRows ='
  );

  assert.match(source, /const resolvedRateGroupClearIdentity =/);
  assert.match(source, /resolved_rate_clear_payload_json/);
  assert.match(render, /resolvedRateClearIdentities\.length !== 1/);
  assert.match(render, /resolvedRateActionLines\.some\(\(line\) => resolvedRateGroupClearIdentity\(line\)/);
  assert.match(render, /const resolvedRateActionCarrier = resolvedRateActionLines\[0\] \|\| null/);
  assert.match(render, /BANKING_PAY_RESOLVED_RATE_GROUP_IDENTITY_CONFLICT/);
  assert.match(render, /data-action="banking:pay:clearCaseResolution"/);
  assert.match(render, />Cancel Resolved Rate<\/button>/);
  assert.doesNotMatch(render, /Cancel Resolved Pay Channel/);
  assert.doesNotMatch(render, /Cancel Resolved Gross Total/);
});

test('finance cancellation does not alter the BUCKETED resolved-rate owner', () => {
  const finance = sliceBetween(
    'const FINANCE_CLEAR_RESOLUTION_FAMILIES =',
    'const displayBlockedReasonText ='
  );

  assert.match(finance, /new Set\(\['TAXABLE_CHANNEL_RESTRUCTURE', 'NON_BUCKET'\]\)/);
  assert.match(finance, /if \(!FINANCE_CLEAR_RESOLUTION_FAMILIES\.has\(resolutionFamily\)\) return null/);
  assert.doesNotMatch(finance, /FINANCE_CLEAR_RESOLUTION_FAMILIES[^\n]*BUCKETED/);
  assert.match(source, /data-action="banking:pay:clearCaseResolution"/);
  assert.match(source, />Cancel Resolved Rate<\/button>/);
});

test('expanded Ready timesheet breakdown renders canonical segment details rather than parent placeholders', () => {
  const breakdown = sliceBetween(
    'const buildReadyTimesheetBreakdownEntries =',
    'const renderReadyTimesheetGroupedRows ='
  );

  assert.match(breakdown, /segment\?\.date/);
  assert.match(breakdown, /segment\?\.role/);
  assert.match(breakdown, /segment\?\.band/);
  assert.match(breakdown, /segment\?\.start_utc/);
  assert.match(breakdown, /segment\?\.end_utc/);
  assert.match(breakdown, /segment\?\.break_start/);
  assert.match(breakdown, /findExactOperationalContext/);
  assert.match(breakdown, /contextSegment\?\.role/);
  assert.match(breakdown, /contextSegment\?\.band/);
  assert.match(breakdown, /getLineSectionAmount\(line\)/);
  assert.match(breakdown, /const buildResolvedRateSummary =/);
  assert.match(breakdown, /Original \$\{enc\(sourceLabel\)\} rate/);
  assert.match(breakdown, /New \$\{enc\(targetLabel\)\} rate/);
  assert.match(breakdown, /Original \$\{enc\(sourceLabel\)\} amount/);
  assert.match(breakdown, /New \$\{enc\(targetLabel\)\} amount/);
  assert.doesNotMatch(breakdown, /Source pay:/);
  assert.doesNotMatch(breakdown, /Target pay:/);
  assert.match(
    breakdown,
    /isSyntheticTimesheetResidualLine\(line\)[\s\S]*isReadyTimesheetDisplayContextLine\(line\)[\s\S]*continue;/
  );
});

test('authoritative row-backed page copies outrank stale duplicate component-cache copies', () => {
  const rendering = sliceBetween(
    'const collectUnionRows =',
    'const hasOwnValue ='
  );

  assert.match(rendering, /const rowAuthorityScore =/);
  assert.match(rendering, /effective_section/);
  assert.match(rendering, /physical_section/);
  assert.match(rendering, /score > existing\.score/);
  assert.match(source, /evictAuthoritativeRowsFromOtherSections/);
});

test('recovery presentation allocates the certified row recovery when legacy components still report zero', () => {
  const presentation = sliceBetween(
    'const getOverpaymentRecoveryPresentation =',
    'const getManualDebtRecoveryPresentation ='
  );

  assert.match(presentation, /selection_recovery_headroom_v1/);
  assert.match(presentation, /recoverable_this_pay_run_ex_vat/);
  assert.match(presentation, /useCertifiedRowRecoveryAllocation/);
  assert.match(presentation, /component\.outstanding \?\? component\.original/);
  assert.match(presentation, /Math\.min\(rawRecoverable, remainingRowRecovery\)/);
});

test('taxable restructure refreshes and atomically adopts the affected Workbench candidate', () => {
  const restructure = sliceBetween(
    'async function openBankingFinanceCaseRestructureModal(seed = {}) {',
    'async function runBulkTimesheetSelectionChunks(action, items, options = {}) {'
  );

  assert.match(restructure, /refreshTaxableRestructureWorkbenchAfterSave/);
  assert.match(restructure, /bankingPayWorkbenchSessionRefresh\(sessionId,\s*\{[\s\S]*TAXABLE_CHANNEL_RESTRUCTURE_APPLIED/);
  assert.match(restructure, /pollPayWorkbenchCandidateUntilSettled\(sessionId, candidateId/);
  assert.match(restructure, /requirePreviewSectionsAfterReady:\s*true/);
  assert.match(restructure, /minimumSessionVersion/);
  assert.doesNotMatch(restructure, /preRefreshSessionVersionRaw\s*\+\s*1/);
  assert.match(restructure, /exact RESOLVED postcondition/);
  assert.match(restructure, /candidateScopedAuthorityComplete:\s*true/);
  assert.match(restructure, /validateSettledCandidatePreview:/);
  assert.match(restructure, /transition:\s*'RESOLVED'/);
  assert.doesNotMatch(restructure, /forceFullSessionRefresh:\s*true/);
  assert.match(restructure, /scheduleTaxableRestructureWorkbenchRefresh\(result\)/);
  assert.match(restructure, /setTimeout\(\(\) => \{[\s\S]*refreshTaxableRestructureWorkbenchAfterSave/);
  assert.match(restructure, /dirty_reason = 'TAXABLE_CHANNEL_RESTRUCTURE_APPLIED'/);
});

test('candidate adoption advances all current section pages before publishing the settled modal', () => {
  const poll = sliceBetween(
    'async function pollPayWorkbenchCandidateUntilSettled(sessionId, candidateId, options = {}) {',
    'async function bankingPayWorkbenchSessionOpen(payload = {}) {'
  );

  assert.match(poll, /fetchFirstSessionPageIfAvailable = async \(progressLike, fetchOptions = \{\}\)/);
  assert.match(poll, /expectedPageSessionVersion/);
  assert.match(poll, /code: 'PREVIEW_PAGE_VERSION_MISMATCH'/);
  assert.match(poll, /expectedSessionVersion: candidatePreviewVersion/);
  assert.match(poll, /deferRender: true/);
  assert.match(poll, /settledSectionPages\.all_required_sections_loaded !== true/);
  assert.match(poll, /markProgressPollStopped\(\);[\s\S]*await rerenderQuietly\(\)/);
  assert.match(poll, /section_pages: cloneJson\(settledSectionPages\)/);
});

test('linked suggested-rate saves atomically adopt one complete candidate instead of a broad session snapshot', () => {
  const suggestedRates = sliceBetween(
    'async function openBankingPaySuggestedRatesReviewModal(seed = {}) {',
    'async function injectDefaultEmailSignature(input = {}) {'
  );

  assert.match(suggestedRates, /const linkedScopeSpansCandidates = mutationMeta\.resolveAllLinked === true && affectedCandidateIds\.length > 1/);
  assert.match(suggestedRates, /shouldForceFullSessionRefreshAfterMutation\(queued, linkedScopeSpansCandidates\)/);
  assert.match(suggestedRates, /pollPayWorkbenchCandidateUntilSettled\(sessionId, refreshCandidateId/);
  assert.match(suggestedRates, /requirePreviewSectionsAfterReady:\s*true/);
  assert.match(suggestedRates, /affectedCandidateIds,/);
  assert.match(suggestedRates, /const candidatePreviewMatchesTimesheetSection =/);
  assert.match(suggestedRates, /validateSettledCandidatePreview:/);
  assert.match(suggestedRates, /expectedTimesheetIds: authoritativeScope\.targeted_timesheet_ids/);
  assert.match(suggestedRates, /expectedPresentationSection: 'canonical_preview_lines'/);
  assert.match(suggestedRates, /expectedTimesheetIds: cancelResult\.discovery\?\.clearable_timesheet_ids/);
  assert.match(suggestedRates, /expectedPresentationSection: 'cases_resolutions'/);
  assert.doesNotMatch(
    suggestedRates,
    /shouldForceFullSessionRefreshAfterMutation\(queued, mutationMeta\.resolveAllLinked === true\)/
  );
});

test('linked suggested-rate success closes the child before repainting the Banking parent exactly once', () => {
  const suggestedRates = sliceBetween(
    'async function openBankingPaySuggestedRatesReviewModal(seed = {}) {',
    'async function injectDefaultEmailSignature(input = {}) {'
  );

  assert.match(suggestedRates, /const bankingParentFrameAtOpen =/);
  assert.match(suggestedRates, /const repaintBankingParentAfterSuggestedRatesClose = async \(\) =>/);
  assert.match(suggestedRates, /top !== bankingParentFrameAtOpen/);
  assert.match(suggestedRates, /await bankingRerender\('pay'\)/);
  assert.match(
    suggestedRates,
    /const childClosed = closeChild\(\{ applied: true, clean: true \}\);[\s\S]*childClosed && await repaintBankingParentAfterSuggestedRatesClose\(\)/
  );
  assert.doesNotMatch(
    suggestedRates,
    /recomputePayWizardLiveTruth\(\);[\s\S]{0,180}await bankingRerender\(null\)/
  );
  assert.match(suggestedRates, /await finishSuggestedRatesApplySuccess\(\{ queued, settledResult, affectedCandidateIds, adoptionError \}\)/);
  assert.match(suggestedRates, /onDismiss: \(\) => \{\s*if \(state\.accepted === true\) return;/);
});

test('non-draftable READY parent context is merged back beside allocation children', () => {
  const adoption = sliceBetween(
    'const isReadyToPayDisplayContextRow =',
    'const derivePayeesForWorkbench ='
  );

  assert.match(adoption, /presentationSection !== 'READY_TO_PAY'/);
  assert.match(adoption, /presentationRole !== 'PARENT'/);
  assert.match(adoption, /lineType !== 'TIMESHEET_PAYMENT'/);
  assert.match(adoption, /const contextRows = asArray\(rowUniverse\)\.filter\(isReadyToPayDisplayContextRow\)/);
  assert.match(adoption, /return withDisplayContext\(filtered\)/);
  assert.match(source, /const isCanonicalReadyDisplayRow = \(row\) => isReadyToPayPreviewRow\(row\) \|\| isReadyToPayDisplayContextRow\(row\)/);
  assert.match(source, /const previewStatePageRows = collectRowsFromPageCaches\(wiz\.preview/);
  assert.match(source, /preview\.state\.page\.cache\.preview\.rows/);
  assert.match(source, /const isReadyTimesheetDisplayContextLine =/);
  assert.match(source, /!isReadyTimesheetDisplayContextLine\(line\)/);
  assert.match(source, /asBool\(line\?\.is_excluded_from_allocation\) && !isReadyTimesheetDisplayContextLine\(line\)/);
});

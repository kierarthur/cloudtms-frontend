import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/import-review-v1.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/import-review-v1.css', import.meta.url), 'utf8');
const nhspLinesCss = readFileSync(new URL('../css/timesheet-nhsp-lines.css', import.meta.url), 'utf8');

test('the isolated import-review asset is loaded after the legacy application asset', () => {
  const legacy = html.indexOf('./js/main.js');
  const review = html.indexOf('./js/import-review-v1.js');
  assert.ok(legacy > 0);
  assert.ok(review > legacy);
  assert.match(html, /css\/import-review-v1\.css/);
});

test('the frontend fails closed on the full approved DB and Worker contract', () => {
  for (const marker of [
    'IMPORT_REVIEW_DB_V1', 'IMPORT_REVIEW_APPLY_V1', 'IMPORT_APPLY_OPERATION_V2',
    'IMPORT_CORRECTION_OPERATION_V2', 'IMPORT_REVIEW_FOLLOW_UP_COMPONENT_V1',
    'IMPORT_REVIEW_TSFIN_SETTLEMENT_V1',
    'IMPORT_REVIEW_UI_V6', 'TIMESHEET_QUERY_RECIPIENT_EMAIL_V1'
  ]) assert.match(source, new RegExp(marker));
  assert.match(source, /legacy_contracts_supported === false/);
});

test('review pagination uses only the approved page sizes and saves before navigation', () => {
  assert.match(source, /PAGE_SIZES = Object\.freeze\(\[25, 50, 75, 100\]\)/);
  assert.match(source, /await flushSelections\(\{ quiet: true \}\)/);
  assert.match(source, /sort_by/);
  assert.match(source, /data-ir-action="sort"/);
  assert.match(source, /currentItem\.selected = change\.selected === true/);
  assert.match(source, /review\.error = '';\s*review\.saveState = 'Selections saved'/);
  assert.match(source, /review\.saveState = 'Selections saved';\s*if \(!quiet\) showScreen\('Import review', renderReview, 'import-review-v1'\)/);
});

test('review nesting follows the active sort and keeps full-branch context', () => {
  assert.match(source, /primary === 'CLIENT'.*\['client', 'candidate', 'week'\]/s);
  assert.match(source, /primary === 'WEEK_ENDING'.*\['week', 'candidate'/s);
  assert.match(source, /primary === 'WORK_DATE'.*\['date', 'candidate'/s);
  assert.match(source, /primary === 'ACTION'.*\['action', 'candidate'/s);
  assert.match(source, /primary === 'STATUS'.*\['status', 'candidate'/s);
  assert.match(source, /isSingleClientHealthRoster/);
  assert.match(source, /candidate_branch_key/);
  assert.match(source, /branch_badges/);
  assert.match(source, /data-ir-action="toggle-branch"/);
  assert.match(source, /expanded: prior\?\.expanded \|\| new Set\(\)/);
  assert.match(source, /const key = `\$\{keyPrefix\}:u-\$\{opaqueUiToken\(path\.join\('\|'\)\)\}`/);
  assert.doesNotMatch(source, /review\.view === 'PENDING' && isPrimary/);
  assert.match(css, /\.irv1-branch-toggle/);
  assert.match(css, /\.irv1-branch-badge/);
});

test('review lifecycle supports resume, recheck, abandon, apply status and follow-up retry', () => {
  for (const route of [
    '/refresh', '/abandon', '/apply', '/apply-status', '/follow-up/retry',
    '/apply-recover', '/daily-timesheet-resolution'
  ]) assert.ok(source.includes(route), `${route} must be wired`);
  assert.match(source, /Save & close/);
  assert.match(source, /Abandon import/);
  assert.match(source, /if \(normalized === 'BLOCKED'\) return 'NEEDS ATTENTION'/);
  assert.match(source, /displayReviewStatus\(item\.status, item\.partial_application === true\)/);
  assert.match(source, /displayReviewStatus\(header\.state\.status, header\.state\.partial_application === true\)/);
  assert.match(source, /last_operation_request_hash[\s\S]*?recovery\?\.request_hash[\s\S]*?review\?\.requestHash/);
  assert.match(source, /const hash = review\?\.header\?\.state\?\.last_operation_request_hash;[\s\S]*?follow-up\/retry/);
  assert.match(source, /for \(let attempt = 0; attempt < 30; attempt \+= 1\)[\s\S]*?followUpStatus === 'COMPLETE'[\s\S]*?retryCount > priorRetryCount/);
});

test('unknown apply responses are status-checked and never reposted automatically', () => {
  assert.match(source, /timeoutMs:\s*40000/);
  assert.match(source, /function shouldRecoverApplyOutcome\(error\)/);
  assert.match(source, /review\.operationId && review\.requestHash && shouldRecoverApplyOutcome\(error\)/);
  assert.match(source, /error\.code = 'REQUEST_TIMEOUT'/);
  assert.match(source, /error\.action = 'CHECK_APPLY_STATUS'/);
  assert.match(source, /const maxAttempts = method === 'GET' \? 2 : 1/);
  assert.match(source, /timeoutController\.abort\(\)/);
});

test('NHSP segment timesheets use the compact non-wrapping Lines presentation only for NHSP bases', () => {
  assert.match(html, /css\/timesheet-nhsp-lines\.css/);
  assert.match(main, /const isNhspBasis = \[[\s\S]*?'NHSP'[\s\S]*?'NHSP_ADJUSTMENT'[\s\S]*?\]\.includes\(basis\)/);
  for (const heading of ['Date', 'Reference', 'Shift', 'Break', 'Hours', 'Financials', 'Pay status', 'Snooze', 'Exclude pay', 'Invoice delay']) {
    assert.match(main, new RegExp(`<th>${heading}</th>`));
  }
  assert.match(main, /class="nhsp-date" data-label="Date"/);
  assert.match(main, /class="nhsp-shift" data-label="Shift"/);
  assert.match(main, /Pay \$\{esc\(fmtMoney\(pay\)\)\}/);
  assert.match(main, /Charge \$\{esc\(fmtMoney\(charge\)\)\}/);
  assert.match(main, /aria-label="Exclude this line from pay"/);
  assert.match(main, /aria-label="Delay invoicing until date in DD\/MM\/YYYY format"/);
  assert.match(main, /Changes to pay exclusion and invoice delay are staged until you click Save/);
  assert.match(nhspLinesCss, /\.nhsp-date\{[^}]*white-space:nowrap/);
  assert.match(nhspLinesCss, /\.nhsp-invoice-date\{[^}]*width:120px!important/);
  assert.match(nhspLinesCss, /@media\(max-width:900px\)/);
});

test('browser sends intent through the Worker and never direct-calls Supabase', () => {
  assert.doesNotMatch(source, /supabase\.co|rest\/v1|createClient\(/i);
  assert.match(source, /authFetch/);
  assert.match(source, /api\/import-reviews/);
  assert.doesNotMatch(source, /validation_rows|alternative_email|financial_values/);
});

test('transient import-review reads retry once without retrying mutations', () => {
  assert.match(source, /const maxAttempts = method === 'GET' \? 2 : 1/);
  assert.match(source, /status === 502/);
  assert.match(source, /global\.setTimeout\(resolve, 250\)/);
  assert.match(source, /cache: fetchOptions\.cache \|\| 'no-store'/);
});

test('email confirmation states and renders one message per shared recipient with contract sections', () => {
  assert.match(source, /One email to/);
  assert.match(source, /combined into one message/);
  assert.match(source, /contract_label/);
  assert.match(source, /recipient_email/);
  assert.match(source, /Client → Candidate → Contract → Shift/);
  assert.match(source, /opaqueUiToken/);
  assert.match(source, /validation failed:/);
  assert.match(source, /reviewRoute\(review\)\.includes\('DAILY'\)/);
  assert.match(source, /Date \$\{formatDate\(workDate\)\}/);
  assert.match(source, /Previously sent/);
  assert.match(source, /reminder is never selected automatically/);
});

test('V4 grade resolution is server-option-only and route specific', () => {
  assert.match(source, /resolution_options/);
  assert.match(source, /WEEKLY_ASSIGNMENT_CONTRACT/);
  assert.match(source, /DAILY_GRADE_ROLE/);
  assert.match(source, /apiCreateAssignmentBandMapping/);
  assert.match(source, /postHrRotaResolveMappings/);
  assert.match(source, /freshItem\.evidence_fingerprint !== item\.evidence_fingerprint/);
  assert.doesNotMatch(source, /irv2GradeRole|irv2GradeBand|Role code is required/);
  assert.match(source, /contract is not currently eligible/);
  assert.match(source, /rates are incomplete for authoritative processing/);
});

test('candidate and client picker success returns to the intact parent before recheck', () => {
  assert.match(source, /await persistMapping\(item, kind, \{ id, label \}\);[\s\S]*setTimeout\(\(\) =>/);
  assert.match(source, /if \(state\.review\?\.importId === reviewRouteState\.importId\) void refreshReview\(\)/);
});

test('V4 renders imported and current evidence with safe operator wording', () => {
  for (const token of ['imported_evidence', 'current_evidence', 'difference_codes', 'evidence_rows', 'outcome_label']) {
    assert.match(source, new RegExp(token));
  }
  for (const code of [
    'ACTUAL_HOURS_MISMATCH', 'START_END_MISMATCH', 'BREAK_MINUTES_MISMATCH',
    'MISSING_FROM_IMPORT', 'REFERENCE_ON_SHIFT_MISSING_FROM_COMPLETE_IMPORT',
    'CONTRACT_OUT_OF_SCOPE', 'CONTRACT_RATES_INCOMPLETE',
    'TIMESHEET_OCCUPIED_BY_EXPENSES'
  ]) assert.match(source, new RegExp(code));
  assert.match(source, /Remove the expenses from this timesheet, save or recalculate it, then choose Recheck/);
  assert.match(source, /Expenses must be invoiced on a separate timesheet for import-authoritative work/);
  assert.match(source, /This item needs review/);
  assert.match(source, /function evidenceCell/);
  assert.match(source, /function workedHoursForDisplay/);
  assert.match(source, /timeZone: 'Europe\/London'/);
  assert.match(source, /hasExplicitZone/);
  assert.match(source, /grossMinutes - breakMinutes/);
  assert.match(source, /grossMinutes \+= 24 \* 60/);
  assert.match(source, /After apply \(imported\)/);
  assert.match(source, /Before apply \(current\)/);
  assert.match(source, /Timesheet shift is missing from the import/);
  assert.match(source, /Imported shift is not currently in CloudTMS/);
  assert.doesNotMatch(source, /replaceAll\('_', ' '\)\.toLowerCase/);
});

test('final confirmation is server paged, grouped and rechecked before apply', () => {
  assert.match(source, /CONFIRM_STANDARD/);
  assert.match(source, /CONFIRM_NON_STANDARD/);
  assert.match(source, /CONFIRM_VALIDATION/);
  assert.match(source, /CONFIRM_EMAIL/);
  assert.match(source, /CONFIRM_REFERENCE/);
  assert.match(source, /data-ir-confirm-page-size/);
  assert.match(source, /Page \$\{page\} of \$\{totalPages\}/);
  assert.match(source, /candidate_section_total_count/);
  assert.match(source, /client_section_total_count/);
  assert.match(source, /Standard imported shifts/);
  assert.match(source, /Changed and cancelled shifts/);
  assert.match(source, /Before apply \(current\)/);
  assert.match(source, /After apply \(imported\)/);
  assert.match(source, /selectedSetFingerprint/);
  assert.match(source, /confirmationStillCurrent/);
  assert.match(source, /Explicit reference decisions/);
  assert.match(source, /Outgoing client query email/);
  assert.match(source, /selectedOutcomeCount/);
  assert.match(source, /selectedActionCount/);
  assert.match(source, /reviewed outcome\(s\)/);
  assert.match(source, /route === 'AMEND_SOURCE'/);
  assert.match(source, /route === 'AMEND_PAID_UNINVOICED_SOURCE'/);
  assert.match(source, /route === 'AMEND_EXISTING_REPLACEMENT'/);
  assert.match(source, /route === 'CREATE_REVERSAL_REPLACEMENT'/);
  assert.match(source, /complete signed frozen invoice history/);
  assert.match(source, /Unchanged outcomes are recorded for audit without changing CloudTMS data/);
  assert.match(source, /Selected batch: server-approved import-authoritative action/);
  assert.match(source, /unresolved rows remain pending/);
  assert.doesNotMatch(source, /selected ready action\(s\)/);
  assert.doesNotMatch(source, /DB-owned correction units/);
  assert.doesNotMatch(source, /if \(page > 5\)/);
  assert.match(source, /expected_request_hash: review\.header\.state\.apply_contract\.request_hash/);
});

test('coverage and overlap choices are explicit and review editing is server-authoritative', () => {
  assert.match(source, /mode: null/);
  assert.match(source, /overlapping_unfinished_reviews/);
  assert.match(source, /SUPERSEDE/);
  assert.match(source, /Continue existing review/);
  assert.match(source, /Replace existing review/);
  assert.match(source, /Cancel new import/);
  assert.match(source, /supersede_import_id/);
  assert.match(source, /expected_supersede_state_version/);
  assert.doesNotMatch(source, /Keep both as separate reviews|START_SEPARATE/);
  assert.match(source, /editability\?\.allowed_commands/);
  assert.match(source, /createOperationKey/);
});

test('reopening an editable saved review automatically rechecks current server evidence', () => {
  assert.match(source, /options\.skipAutoRecheck !== true && canRefresh/);
  assert.match(source, /expected_state_version: header\.state\.state_version/);
  assert.match(source, /Current records could not be rechecked automatically/);
  assert.match(source, /This saved view may be out of date/);
});

test('Weekly and Daily distinguish no submitted timesheet from an omitted shift', () => {
  for (const code of [
    'WEEKLY_TIMESHEET_NOT_SUBMITTED', 'DAILY_TIMESHEET_NOT_SUBMITTED',
    'WEEKLY_SHIFT_ABSENT_FROM_TIMESHEET', 'DAILY_SHIFT_ABSENT_FROM_TIMESHEET'
  ]) assert.match(source, new RegExp(code));
  assert.match(source, /Request timesheet from candidate/);
  assert.match(source, /Confirm candidate did not work this shift/);
  assert.match(source, /submitted Weekly candidate timesheet/);
  assert.match(source, /No timesheet hours, TSFIN, invoice, payment or financial record will be changed/);
  assert.match(source, /weekly-candidate-not-worked/);
});

test('validation-only review presents passed rows without duplicating mismatches', () => {
  assert.match(source, /Passed checks/);
  assert.match(source, /CANDIDATE_DID_NOT_WORK_CONFIRMED/);
  assert.match(source, /Undo confirmation/);
  assert.match(source, /openUiConfirmModal/);
  assert.match(source, /week_validation_badges/);
  assert.match(source, /node\.type === 'week' \? branchBadgesHtml\(node\.badges\) : ''/);
  assert.doesNotMatch(source, /client:email:/);
  assert.doesNotMatch(source, /week:email:/);
});

test('coverage sends only the Worker-approved scope fields and shows mapping status in every mode', () => {
  assert.match(source, /function clientScopeRequest/);
  assert.match(source, /function candidateScopeRequest/);
  assert.match(source, /scope_clients: \(allScope\.scope_clients \|\| \[\]\)\.map\(clientScopeRequest\)/);
  assert.match(source, /candidates\.map\(candidateScopeRequest\)/);
  assert.match(source, /if \(!coverage \|\| !coverage\.mode\) return ''/);
  assert.match(source, /Candidates covered by all shifts for this period/);
  assert.match(source, /Candidates found in this partial file/);
  assert.match(source, /data-mapping-status/);
  assert.match(css, /\.irv1-scope-chip\.is-matched/);
  assert.match(css, /\.irv1-scope-chip\.is-unmatched/);
  assert.match(css, /\.irv1-candidate-row\.is-matched/);
  assert.match(css, /\.irv1-candidate-row\.is-unmatched/);
});

test('coverage wording is explicit for validation-only, authoritative and mixed files', () => {
  for (const text of [
    'Complete validation file – all candidates',
    'Complete validation file – selected candidates',
    'Partial validation file',
    'No timesheet hours or financial values will be changed',
    'Complete authoritative file – all candidates',
    'Complete authoritative file – selected candidates',
    'Their imported shifts may be added or amended in CloudTMS',
    'Partial authoritative file',
    'Complete mixed file – all candidates',
    'Complete mixed file – selected candidates',
    'Partial mixed file'
  ]) assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /scope\?\.authority_mode/);
  assert.match(source, /data-authority-mode/);
  assert.match(source, /No browser choice can grant financial authority/);
});

test('import screens reuse one modal frame and use only the CloudTMS confirmation modal', () => {
  assert.match(source, /function repaintImportFrame/);
  assert.match(source, /if \(repaintImportFrame\(title, render, kind\)\) return/);
  assert.match(source, /openUiConfirmModal/);
  assert.match(source, /Discard staged import\?/);
  assert.match(source, /Discard unsaved review changes\?/);
  assert.doesNotMatch(source, /\b(?:global|window)\.(?:confirm|alert|prompt)\s*\(/);
});

test('all import, mapping and timesheet-resolution flows avoid native browser dialogs', () => {
  const topLevelFunction = (name) => {
    const signature = new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm');
    const match = signature.exec(main);
    assert.ok(match, `${name} must exist`);
    const start = match.index;
    const remainder = main.slice(start + match[0].length);
    const next = /\n(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/.exec(remainder);
    return main.slice(start, next ? start + match[0].length + next.index : main.length);
  };

  const auditedFunctions = [
    'postWeeklyResolveMappings', 'refreshHrRotaSummary', 'openHrRotaAssignRoleModal',
    'openHrRotaAssignCandidateModal', 'openHrRotaResolveGradeRoleModal', 'openHrRotaAssignClientModal',
    'openCandidatePicker', 'openClientPicker', 'openImportColumnAliasesModal',
    'openTimesheetsResolveModal', 'openResolveCandidatePicker', 'openResolveClientPicker',
    'openImportsModal', 'wireImportDropzones', 'handleHrWeeklyFileDrop',
    'openHrWeeklyBandResolveModal', 'openHrWeeklyClientPicker', 'openClientHospitalModal',
    'openWeeklyClientResolveModal', 'openWeeklyCandidateResolveModal', 'openAssignmentBandMappingsModal',
    'openWeeklyImportOptionsModal', 'handleNhspFileDrop', 'refreshWeeklyImportSummary',
    'renderWeeklyImportSummary', 'applyWeeklyImportTransactional', 'handleHrRotaFileDrop',
    'postHrRotaResolveMappings'
  ];
  const nativeDialog = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/;
  for (const name of auditedFunctions) {
    assert.doesNotMatch(topLevelFunction(name), nativeDialog, `${name} must use the CloudTMS modal system`);
  }

  const topLevelMatches = [...main.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)];
  for (let index = 0; index < topLevelMatches.length; index += 1) {
    const name = topLevelMatches[index][1];
    if (!/(?:import|resolve|mapping|alias|hrrota|healthroster|nhsp|hrweekly|weeklyvalidation)/i.test(name)) continue;
    const body = main.slice(topLevelMatches[index].index, topLevelMatches[index + 1]?.index ?? main.length);
    assert.doesNotMatch(body, nativeDialog, `${name} must not expose a native browser dialog`);
  }

  assert.match(main, /async function showImportFlowNotice/);
  assert.match(main, /hide_cancel: true/);
  assert.match(main, /kind: 'import-flow-notice'/);
  assert.match(main, /async function showImportFlowConfirm/);
  assert.match(main, /kind: 'import-flow-confirm'/);
});

test('save, close, conflict and apply recovery state are durable', () => {
  assert.match(source, /saveChain/);
  assert.match(source, /conflictBuffer/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /FAILED_BEFORE_COMMIT/);
  assert.match(source, /btnCloseModal/);
  assert.match(source, /let reviewCreated = false/);
  assert.match(source, /The review was created, but its next screen could not be loaded safely/);
});

test('saved selections refresh server editability before repainting the review', () => {
  assert.match(source, /const freshHeader = await fetchReviewHeader\(review\.importId\)\.catch\(\(\) => null\)/);
  assert.match(source, /if \(freshHeader\?\.state\) \{\s*review\.header = freshHeader;/);
});

test('global, eligible-client and independent contract query settings are wired', () => {
  assert.match(source, /data-ir-global-policy/);
  assert.match(source, /data-ir-client-policy/);
  assert.match(source, /data-ir-contract-query-enabled/);
  assert.match(main, /send_ts_queries_to_different_email/);
  assert.match(main, /ts_queries_alt_email_address/);
  assert.doesNotMatch(source, /settingsValue\(source, 'reversal_complete_financials_date', 'NOW'\)/);
});

test('HealthRoster eligibility is always reloaded without browser cache and invalidated after a client save', () => {
  assert.match(source, /request\('\/api\/healthroster\/autoprocess\/clients', \{ method: 'GET', cache: 'no-store' \}\)/);
  assert.match(source, /function invalidateClientEligibility\(\) \{[\s\S]*state\.home\.clients = \[\]/);
  assert.match(source, /addEventListener\('cloudtms:client-saved', invalidateClientEligibility\)/);
  assert.match(source, /async function openImportsModalV1\(\) \{[\s\S]*await loadHome\(\)/);
  assert.match(source, /if \(action === 'reload-home'\) \{[\s\S]*await loadHome\(\{ resetPaging: false \}\)/);
  assert.match(main, /dispatchEvent\(new CustomEvent\('cloudtms:client-saved'/);
});

test('Daily Validation is vendor-neutral until the Worker reports the detected format', () => {
  assert.match(source, /'Daily Validation'/);
  assert.match(source, /'Choose a Daily Client'/);
  assert.match(source, /'Drop the daily roster file here'/);
  assert.match(source, /'No shifts in roster yet'/);
  assert.match(source, /inputFormat === 'NHSP'.*'NHSP import'/s);
  assert.match(source, /return 'HealthRoster import'/);
  assert.doesNotMatch(source, /'HealthRoster daily validation'/);
  assert.match(html, /daily-roster-compat=20260822-r1/);
  assert.match(html, /import-review-v1\.js[^"']*daily-zero-dialog=20260822-r1/);
});

test('no-shifts declaration uses a client-scoped bounded Daily review modal', () => {
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /data-ir-zero-client/);
  assert.match(source, /data-ir-zero-start/);
  assert.match(source, /data-ir-zero-end/);
  assert.match(source, /inclusiveDays > 366/);
  assert.match(source, /api\/imports\/daily-validation\/zero-shifts/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /Nothing is applied until the review is approved/);
  assert.match(source, /parser\.includes\('ZERO_DECLARATION'\)/);
  assert.match(css, /\.irv1-dialog-backdrop/);
  assert.match(css, /\.irv1-dialog-date-grid/);
});

test('break-entry preference is shown only for roster-validation timesheets and remains non-economic', () => {
  assert.match(main, /timesheet_break_entry_mode/);
  assert.match(main, /Break start and finish times/);
  assert.match(main, /Break length in minutes/);
  assert.match(main, /if \(mode !== 'HEALTHROSTER' \|\| behaviour === 'CREATE'\) return ''/);
  assert.match(main, /display:\$\{\(showHr && !isHrCreate\) \? '' : 'none'\}/);
  assert.match(main, /A dormant stored[\s\S]*value is deliberately preserved/);
  const changedStart = main.indexOf('const settingsChanged =');
  const changedEnd = main.indexOf('const contractSettingsTouched', changedStart);
  assert.ok(changedStart > 0 && changedEnd > changedStart);
  assert.doesNotMatch(main.slice(changedStart, changedEnd), /timesheet_break_entry_mode/);
});

test('styles provide professional tiles, nested expandables, paging and responsive layouts', () => {
  for (const selector of ['.irv1-tiles', '.irv1-tile', '.irv1-group', '.irv1-pager', '.irv1-email-group', '.irv1-confirm-table', '.irv1-confirm-pager', '.irv1-confirm-candidate']) {
    assert.ok(css.includes(selector), `${selector} must be styled`);
  }
  assert.match(css, /@media\(max-width:640px\)/);
  assert.match(css, /\.irv1-card-filter strong,\.irv1-card-filter span,\.irv1-card-filter small\{display:block\}/);
});

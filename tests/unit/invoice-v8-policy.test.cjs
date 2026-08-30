const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const asyncSource = read('js/invoice-async-ui.js');
const batchSource = read('js/invoice-batch-modal.js');
const mainSource = read('js/main.js');
const diagnosticSource = read('js/invoice-diagnostic-catalog.js');
const batchCss = read('css/invoice-batch-modal.css');
const indexSource = read('index.html');

test('shared diagnostic catalogue exposes locked labels and a bounded unknown fallback', () => {
  const window = {};
  vm.runInNewContext(diagnosticSource, { window, Object, String });
  const expected = new Map([
    ['INVOICE_CORRECTION_CONTRACT_MISMATCH', 'Contract mismatch'],
    ['INVOICE_CORRECTION_STREAM_MISMATCH', 'Invoice stream mismatch'],
    ['INVOICE_REFERENCE_REQUIRED', 'Missing refs'],
    ['MISSING_REFERENCE', 'Missing refs'],
    ['MISSING_IMPORT_SOURCE_EVIDENCE', 'Source evidence missing'],
    ['HR_VALIDATION_BLOCKED', 'Validation failed'],
    ['NOT_READY_FOR_INVOICE', 'Timesheet not ready'],
    ['SEGMENT_ALREADY_LOCKED', 'Already locked'],
    ['BLOCKED_FOR_SENDING', 'Blocked for sending']
  ]);
  for (const [code, label] of expected) {
    const diagnostic = window.invoiceDiagnosticForCode(code);
    assert.equal(diagnostic.short_label, label);
    assert.ok(diagnostic.long_explanation.length > 10);
    assert.ok(diagnostic.family);
  }
  assert.equal(window.invoiceDiagnosticForCode('FUTURE_CODE').short_label, 'Unable to continue');
  assert.equal(
    window.invoiceDiagnosticForCode('FUTURE_CODE').long_explanation,
    'CloudTMS could not complete one of its checks. Refresh the list and try again. If the problem remains, contact support.'
  );
});

test('invoice diagnostics combine related causes and keep issue and delivery messages distinct', () => {
  const window = {};
  vm.runInNewContext(diagnosticSource, { window, Object, String, Array, Set });

  const combined = window.invoiceDiagnosticsForCodes([
    'MANUAL_TIMESHEET_SOURCE_MISSING',
    'ASSET_NOT_REGISTERED',
    'MISSING_RECIPIENT'
  ]);
  assert.deepEqual(Array.from(combined, item => item.short_label), [
    'Signed timesheet missing',
    'No email recipient'
  ]);
  assert.equal(combined[0].family, 'DOCUMENT');
  assert.equal(combined[1].family, 'DELIVERY');
  assert.equal(combined[1].detail_label, 'Cannot be emailed');

  const assetOnly = window.invoiceDiagnosticsForCodes(['ASSET_NOT_REGISTERED']);
  assert.equal(assetOnly.length, 1);
  assert.equal(assetOnly[0].short_label, 'Timesheet file not ready');

  const unknowns = window.invoiceDiagnosticsForCodes(['FUTURE_CODE_A', 'FUTURE_CODE_B']);
  assert.equal(unknowns.length, 1);
  assert.equal(unknowns[0].short_label, 'Unable to continue');
});

test('invoice item details use clear status and separated explanations without technical boilerplate', () => {
  assert.match(batchSource, /isGenerate \? 'Cannot generate yet' : 'Cannot issue yet'/);
  assert.match(batchSource, /This invoice cannot be generated yet/);
  assert.match(batchSource, /This invoice cannot be issued yet/);
  assert.match(batchSource, /aria-label="What needs fixing"/);
  assert.match(batchSource, /aria-label="Sending"/);
  assert.match(batchSource, /isGenerate \? 'generated' : 'issued'/);
  assert.doesNotMatch(batchSource, /Eligibility and legal status are determined by the server/);
  assert.doesNotMatch(batchSource, /Internal technical details are intentionally hidden/);
});

test('hard cutover never restores captured legacy Invoice actions', () => {
  assert.match(asyncSource, /installInvoiceAsyncUnavailableActions/);
  assert.doesNotMatch(asyncSource, /captureOriginalFunctions/);
  assert.doesNotMatch(asyncSource, /originalFunctions/);
  assert.doesNotMatch(asyncSource, /InvoiceBatchModalV1/);
  assert.match(mainSource, /openInvoiceBatchV8WhenReady[\s\S]*window\.InvoiceBatchModalV8\?\.open/);
  assert.doesNotMatch(mainSource, /Batch (?:Generate|Issue) modal not yet implemented/);
  assert.doesNotMatch(
    mainSource,
    /openInvoiceBatch(?:Generate|Issue)Modal\(\)[\s\S]{0,300}alert\('Invoice processing is temporarily unavailable/,
  );
  assert.match(batchSource, /installInvoiceBatchModalOverrides\(\);\s*\n\}\)\(\);/);
  assert.match(batchSource, /__invoiceBatchModalV8 = true/);
});

test('browser-side V8 never decodes candidate, facet or result keysets', () => {
  assert.match(batchSource, /cursor:\s*options\.cursor\s*\|\|\s*null/);
  assert.match(batchSource, /result_cursor\s*=\s*options\.cursor/);
  assert.doesNotMatch(batchSource, /after_sort_date|after_sort_text|after_sort_numeric|after_chunk_id/);
  assert.doesNotMatch(batchSource, /atob\s*\(|base64.*cursor/i);
});

test('active Invoice and Timesheet document preparation is POST-only and exact-version access has no raw key', () => {
  assert.match(asyncSource, /\/api\/invoices\/\$\{encodeURIComponent\(invoiceId\)\}\/render/);
  assert.match(asyncSource, /\/api\/timesheets\/\$\{encodeURIComponent\(canonicalId\)\}\/pdf/);
  assert.match(asyncSource, /method:\s*'POST'/);
  assert.match(asyncSource, /\/api\/invoice-document-versions\/\$\{encodeURIComponent\(id\)\}\/presign/);
  assert.doesNotMatch(asyncSource, /\br2_key\b|\bstorage_key\b|\/api\/files\/presign-download/);
});

test('Batch Issue uses the locked default and keeps legal Issue separate from Delivery', () => {
  assert.match(batchSource, /issue_mode:\s*'ISSUE_AND_SEND'/);
  assert.match(batchSource, /Issue and email/);
  assert.match(batchSource, /Issue without emailing/);
  assert.match(batchSource, /Issued but delivery suppressed/);
  assert.match(batchSource, /delivery_request_token/);
  assert.match(batchSource, /SERVER_RESOLVED/);
  assert.match(batchSource, /INVOICE_EMAIL_V2/);
});

test('frontend progress uses only V2 total fields and committed_at_utc', () => {
  for (const field of [
    'candidate_total',
    'invoice_total',
    'selected_total',
    'released_total',
    'generated_total',
    'regenerated_total',
    'issued_total',
    'issued_send_blocked_total',
    'blocked_total',
    'changed_total',
    'missing_total',
    'failed_total',
    'in_progress_total',
    'delivery_complete_total',
    'release_conflict_total',
    'release_blocked_total',
    'committed_at_utc'
  ]) assert.match(batchSource, new RegExp(`\\b${field}\\b`));
  assert.doesNotMatch(batchSource, /\b(?:generated|issued|blocked|failed)_count\b/);
  assert.doesNotMatch(batchSource, /manifest_committed_at_utc/);
});

test('Timesheet hard-cutover callers delegate to the unified V8 viewer', () => {
  assert.match(mainSource, /window\.openTimesheetDocumentV8\(tsIdForPdf\)/);
  assert.match(mainSource, /window\.openTimesheetDocumentV8\(idNow\)/);
  assert.match(mainSource, /async function openTimesheetPdf[\s\S]*window\.openTimesheetDocumentV8\(timesheetId\)/);
  assert.match(mainSource, /async function getTimesheetPdfUrl[\s\S]*window\.openTimesheetDocumentV8\(timesheetId\)/);
});

test('the V8 batch modal remains usable at a narrow viewport without global style drift', () => {
  assert.match(batchCss, /@media \(max-width: 600px\)/);
  assert.match(batchCss, /#modal\.invbatch-modal \.invbatch-candidate-table[\s\S]*table-layout: fixed/);
  assert.match(batchCss, /#modal\.invbatch-modal \.invbatch-list[\s\S]*overflow: auto/);
  assert.match(batchCss, /#modal\.invbatch-modal \.invbatch-footer[\s\S]*flex-direction: column/);
  assert.doesNotMatch(batchCss, /(?:^|\n)\s*(?:button|input|select|table|\.modal)\s*\{/);
});

test('batch tables use drag-only sort priority and the filter drawer remains closable above modal bands', () => {
  assert.match(batchSource, /DEFAULT_GROUP_ORDER[\s\S]*'WEEK', 'CLIENT', 'CANDIDATE', 'STATUS'/);
  assert.match(batchSource, /draggable="true"/);
  assert.match(batchSource, /Sort priority \(drag only\)/);
  assert.match(batchSource, /applyInvoiceBatchSortPriorityChange[\s\S]*await reloadFirstPage\(state\)/);
  assert.doesNotMatch(batchSource, /Primary sort|data-batch-field="sort-key"/);
  assert.doesNotMatch(batchSource, /data-batch-action="group-up"/);
  assert.doesNotMatch(batchSource, /data-batch-action="group-down"/);
  assert.doesNotMatch(batchSource, /data-batch-action="toggle-group"/);
  assert.doesNotMatch(batchSource, /data-batch-action="toggle-group-all"/);
  assert.doesNotMatch(batchSource, /collapsed_group_ids: new Set\(\)/);
  assert.doesNotMatch(indexSource, /#modal\.invbatch-modal \.invbatch-row\s*\{[\s\S]*display:flex/);
  assert.doesNotMatch(indexSource, /#modal\.invbatch-modal \.invbatch-badge\s*\{[\s\S]*background:#0b152a/);
  assert.match(batchSource, /invbatch-toolbar-row--primary/);
  assert.match(batchSource, /invbatch-toolbar-row--secondary/);
  assert.doesNotMatch(batchSource, /data-batch-field="grouping"/);
  assert.match(batchSource, /<table class="invbatch-candidate-table">/);
  assert.match(batchSource, /<th class="invbatch-cell invbatch-cell--week" scope="col">Week ending<\/th>/);
  assert.match(batchSource, /<th class="invbatch-cell invbatch-cell--client" scope="col">Trust \/ client<\/th>/);
  assert.doesNotMatch(batchSource, /invbatch-group-header/);
  assert.match(batchSource, /class="btn btn-sm btn-outline invbatch-drawer-close"/);
  assert.match(batchSource, /captureInvoiceBatchViewport/);
  assert.match(batchSource, /restoreInvoiceBatchViewport/);
  assert.match(batchSource, /focus\(\{ preventScroll: true \}\)/);
  assert.match(batchCss, /#modal\.invbatch-modal\s*\{[\s\S]*position: relative/);
  assert.match(batchCss, /\.invbatch-filter-drawer[\s\S]*z-index: 120/);
  assert.match(batchCss, /\.invbatch-filter-drawer[\s\S]*inset: 58px 10px 10px auto/);
  assert.match(batchCss, /\.invbatch-filter-drawer header[\s\S]*position: sticky/);
  assert.doesNotMatch(batchCss, /\.invbatch-group-toggle-all/);
  assert.match(batchCss, /\.invbatch-cell[\s\S]*border-right:[\s\S]*border-bottom:/);
  assert.match(batchCss, /\.invbatch-badge--ready[\s\S]*background: #86efac/);
});

test('opening a batch modal rechecks a transiently unavailable capability', () => {
  assert.match(
    batchSource,
    /openInvoiceBatchModal\(mode\)[\s\S]*recoverInvoiceAsyncUiCapability\(\)[\s\S]*refreshed\?\.enabled_for_user !== true/,
  );
});
test('unavailable document actions recover without replacing stable Batch Generate and Issue entry points', () => {
  assert.match(
    asyncSource,
    /invoiceAsyncUnavailableAction\(actionName[\s\S]*initialiseInvoiceAsyncUi\(\{ force: true \}\)[\s\S]*recovered !== unavailableInvoiceActionHandlers\[actionName\]/,
  );
  assert.doesNotMatch(asyncSource, /openInvoiceBatchGenerateModal:\s*\(\.\.\.args\)/);
  assert.doesNotMatch(asyncSource, /openInvoiceBatchIssueModal:\s*\(\.\.\.args\)/);
  assert.match(asyncSource, /installInvoiceAsyncUnavailableActions\(\)[\s\S]*InvoiceBatchModalV8\?\.install\?\.\(\)/);
  assert.match(mainSource, /function reloadInvoiceAsyncUiAsset\(\)[\s\S]*invoice_async_recovery/);
  assert.match(mainSource, /invokeInvoiceAsyncActionWithRecovery\('handleInvoiceRenderPdfAsync', \[modalCtx\]\)/);
  assert.match(mainSource, /invokeInvoiceAsyncActionWithRecovery\('handleInvoiceEmailAsync', \[modalCtx\]\)/);
  assert.match(asyncSource, /const retryDelaysMs = \[0, 250, 1000\]/);
  const unavailableStart = asyncSource.indexOf('async function invoiceAsyncUnavailableAction');
  const unavailableEnd = asyncSource.indexOf('const unavailableInvoiceActionHandlers', unavailableStart);
  assert.ok(unavailableStart >= 0 && unavailableEnd > unavailableStart);
  assert.doesNotMatch(asyncSource.slice(unavailableStart, unavailableEnd), /window\.alert|\balert\s*\(/);
  const renderFallbackStart = mainSource.indexOf('async function handleInvoiceRenderPdf');
  const renderFallbackEnd = mainSource.indexOf('async function handleInvoiceEmail', renderFallbackStart);
  assert.ok(renderFallbackStart >= 0 && renderFallbackEnd > renderFallbackStart);
  assert.doesNotMatch(mainSource.slice(renderFallbackStart, renderFallbackEnd), /temporarily unavailable while the new invoice system/);
});

test('existing document readers stay installed when generation readiness is false', () => {
  assert.match(asyncSource, /document_read_ready/);
  assert.match(asyncSource, /document_generation_ready/);
  assert.match(
    asyncSource,
    /window\.handleInvoiceRenderPdf\s*=\s*handleInvoiceRenderPdfAsync[\s\S]*window\.openTimesheetDocumentV8\s*=\s*openTimesheetDocumentV8/
  );
  assert.match(
    asyncSource,
    /window\.handleInvoiceEmail\s*=\s*generationEnabled[\s\S]*unavailableInvoiceActionHandlers\.handleInvoiceEmail/
  );
  assert.match(
    asyncSource,
    /if \(capabilities\.document_read_ready !== true\)[\s\S]*uninstallOverrides/
  );
});

test('batch selection gives immediate local feedback without rebuilding the whole modal', () => {
  assert.match(batchSource, /function markInvoiceBatchSelectionSummaryPending/);
  assert.match(batchSource, /data-batch-selected-count/);
  assert.match(batchSource, /primary\.disabled = true/);
  assert.match(batchSource, /selectedCount\.textContent = 'Calculating…'/);
  assert.match(
    batchSource,
    /function scheduleInvoiceBatchSelectionSummary[\s\S]*markInvoiceBatchSelectionSummaryPending\(state\)/,
  );
});

test('Invoice Summary uses one fixed attachment column and invoice document actions expose exact lifecycle labels', () => {
  assert.match(mainSource, /cols\.splice\(invoiceNumberIndex >= 0 \? invoiceNumberIndex \+ 1 : 0, 0, 'attachment_state'\)/);
  assert.match(mainSource, /label = 'Attachment'/);
  assert.match(mainSource, /function paintInvoiceAttachmentIndicator/);
  assert.match(mainSource, /Invoice attachment waiting to be generated/);
  assert.match(mainSource, /Invoice attachment generated/);
  assert.match(mainSource, /Generate invoice PDF now/);
  assert.match(mainSource, /Generate invoice PDF/);
  assert.match(mainSource, /Open invoice PDF/);
  assert.match(asyncSource, /if \(state\.view_available\) return 'Ready'/);
});

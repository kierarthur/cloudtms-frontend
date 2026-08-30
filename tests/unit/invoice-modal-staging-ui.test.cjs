const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const mainSource = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const asyncUiSource = fs.readFileSync(path.join(root, 'js', 'invoice-async-ui.js'), 'utf8');
const batchUiSource = fs.readFileSync(path.join(root, 'js', 'invoice-batch-modal.js'), 'utf8');
const diagnosticUiSource = fs.readFileSync(path.join(root, 'js', 'invoice-diagnostic-catalog.js'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

const nativePromptCall = /(?<![A-Za-z0-9_$])(?:window\.)?(?:alert|confirm|prompt)\s*\(/;
const primaryInvoiceModalSource = sourceBetween(
  mainSource,
  'async function invoiceModalUiConfirm',
  'function deriveTimesheetInvoicingDisplay'
);
const invoiceBatchModalSource = sourceBetween(
  mainSource,
  'async function openInvoiceBatchV8WhenReady',
  'async function openUserManagementModal'
);

test('invoice modal uses styled UI confirmations and notices without native browser prompts', () => {
  assert.doesNotMatch(primaryInvoiceModalSource, nativePromptCall);
  assert.match(primaryInvoiceModalSource, /async function invoiceModalUiConfirm[\s\S]*openUiConfirmModal/);
  assert.match(primaryInvoiceModalSource, /async function invoiceModalUiNotice[\s\S]*openUiConfirmModal/);
  assert.match(primaryInvoiceModalSource, /kind: 'invoice-issued-stage-confirm'/);
  assert.match(primaryInvoiceModalSource, /kind: 'invoice-issued-save-confirm'/);
});

test('invoice batch modals use the same styled confirmation path', () => {
  assert.doesNotMatch(invoiceBatchModalSource, nativePromptCall);
  assert.doesNotMatch(batchUiSource, nativePromptCall);
  assert.doesNotMatch(diagnosticUiSource, nativePromptCall);
  assert.match(invoiceBatchModalSource, /await invoiceModalUiConfirm\(/);
  assert.match(invoiceBatchModalSource, /await invoiceModalUiNotice\(/);
});

test('invoice async modal actions contain no native browser prompts', () => {
  assert.doesNotMatch(asyncUiSource, nativePromptCall);
  assert.match(asyncUiSource, /async function invoiceAsyncUiNotice[\s\S]*window\.openUiConfirmModal/);
});

test('unissue is allowed through the synchronous unissue route while async issue remains gated', () => {
  assert.doesNotMatch(mainSource, /!asyncInvoiceUiEnabled \|\| wantIssued !== true/);
  assert.match(mainSource, /if \(wantIssued === true && !asyncInvoiceUiEnabled\)/);
  assert.match(
    primaryInvoiceModalSource,
    /if \(wantIssued\)[\s\S]*else \{[\s\S]*\/api\/invoices\/\$\{encodeURIComponent\(invoiceId\)\}\/unissue/
  );
});

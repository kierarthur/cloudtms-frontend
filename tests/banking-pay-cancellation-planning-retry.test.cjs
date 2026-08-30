const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the progress modal accepts only the server-returned safe retry actions', () => {
  assert.match(source, /'CANCEL_REQUEST', 'REAUTHORISE_REMAINING', 'RETRY_PLANNING', 'RETRY_PROCESSING'/);
  assert.match(source, /RETRY_PLANNING: 'Continue preparation'/);
  assert.match(source, /RETRY_PROCESSING: 'Retry Banking Pay update'/);
  assert.match(source, /const retryProcessingAllowed = availableActions\.includes\('RETRY_PROCESSING'\)/);
  assert.match(source, /status\.financial_complete === true && workbenchRefreshStatus === 'FAILED'/);
  assert.match(source, /\.\.\.\(retryProcessingAllowed \? \['RETRY_PROCESSING'\] : \[\]\)/);
  assert.match(source, /const retryProcessing = retryProcessingAllowed/);
  assert.match(source, /const secondaryActions = \['REJECT', 'CANCEL_REQUEST'\]\.filter\(\(action\) => availableActions\.includes\(action\)\)/);
  assert.match(source, /\[primaryAction, \.\.\.secondaryActions\]\.filter\(Boolean\)/);
});

test('planning retry reuses the existing correction auth-action route', () => {
  assert.match(source, /data-banking-pay-cancellation-auth-action/);
  assert.match(source, /const rpcAction = action === 'CANCEL_REQUEST' \? 'CANCEL' : action/);
  assert.match(source, /bankingPayPaymentCorrectionAuthAction\(state\.correctionRequestId, \{ action: rpcAction \}\)/);
});

test('the deployed entry point cache-busts the cancellation progress bundle', () => {
  assert.match(indexSource, /banking-cancellation-progress=20260812-r21/);
});

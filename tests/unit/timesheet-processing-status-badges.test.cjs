const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'summary-modernisation.css'), 'utf8');

test('every canonical processing summary stage has an explicit badge tone', () => {
  for (const stage of [
    'UNPROCESSED',
    'PROCESSING_DELAYED',
    'PROCESSED',
    'AUTHORISED_FOR_INVOICING',
    'INVOICED',
    'PARTIALLY_INVOICED',
    'ARCHIVED'
  ]) {
    assert.match(main, new RegExp(`\\b${stage}: '(?:unprocessed|processed|authorised|invoiced|delayed|archived)'`));
  }
});

test('raw workflow and exception statuses cannot fall back to plain text', () => {
  for (const status of [
    'PENDING_AUTH',
    'READY_FOR_INVOICE',
    'READY_FOR_HR',
    'AWAITING_MANUAL_SIGNATURE',
    'UNASSIGNED',
    'CLIENT_UNRESOLVED',
    'RATE_MISSING',
    'PAY_CHANNEL_MISSING',
    'VALIDATION_FAILED',
    'FAILED',
    'ERROR',
    'BLOCKED'
  ]) {
    assert.match(main, new RegExp(`\\b${status}: '(?:processed|authorised|delayed|attention)'`));
  }
  assert.match(main, /return 'neutral';/);
  assert.match(main, /ctms-processing-status-badge ctms-processing-status-\$\{tone\}/);
});

test('existing friendly wording is preserved and raw tokens receive friendly labels', () => {
  assert.match(main, /if \(existing && !looksLikeRawToken\) return existing;/);
  for (const [token, label] of [
    ['PENDING_AUTH', 'Processed'],
    ['READY_FOR_INVOICE', 'Authorised for Invoicing'],
    ['READY_FOR_HR', 'Processing Delayed'],
    ['UNASSIGNED', 'Candidate Required'],
    ['CLIENT_UNRESOLVED', 'Client Required'],
    ['RATE_MISSING', 'Rate Required'],
    ['PAY_CHANNEL_MISSING', 'Pay Channel Required']
  ]) {
    assert.match(main, new RegExp(`\\b${token}: '${label}'`));
  }
  assert.match(main, /PARTIALLY_INVOICED: 'Partially Invoiced'/);
  assert.match(main, /fallbackToken[\s\S]*?\.split\('_'\)[\s\S]*?\.join\(' '\)/);
});

test('all three timesheet summary rendering paths use the shared badge painter', () => {
  const calls = main.match(/paintTimesheetProcessingStatusCell\(td, (?:row|r), txt\);/g) || [];
  assert.equal(calls.length, 3);
  assert.match(main, /wrap\.appendChild\(badge\);[\s\S]*?wrap\.appendChild\(coin\);/);
});

test('badge palette includes every tone and remains readable on compact cards', () => {
  for (const tone of [
    'unprocessed',
    'processed',
    'authorised',
    'invoiced',
    'delayed',
    'attention',
    'archived',
    'neutral'
  ]) {
    assert.match(css, new RegExp(`ctms-processing-status-${tone}`));
  }
  assert.match(css, /\.ctms-processing-status-badge\{[\s\S]*?white-space:normal/);
});

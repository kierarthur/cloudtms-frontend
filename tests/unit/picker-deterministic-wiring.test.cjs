const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

function functionSource(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} must be present`);
  return mainSource.slice(start, end);
}

test('candidate picker wires its controls during the live modal render', () => {
  const source = functionSource(
    'async function openCandidatePicker',
    '\nasync function openClientPicker'
  );

  assert.match(
    source,
    /\{ kind: 'candidate-picker', noParentGate: true, runOnRender: true \}/
  );
  assert.match(source, /if \(!search\.__wiredInput\)/);
  assert.match(source, /search\.addEventListener\('input'/);
  assert.match(source, /const wireCandidatePicker = \(\) =>/);
  assert.match(source, /scheduleCandidatePickerWire\(\)/);
  assert.match(source, /data-picker-kind="candidate"/);
  assert.match(source, /let retainedCandidateQuery = seedQuery/);
  assert.match(source, /retainedCandidateQuery = q/);
  assert.match(source, /pickerAlreadyWired/);
});

test('client picker uses the same deterministic render wiring', () => {
  const source = functionSource(
    'async function openClientPicker',
    '\nasync function openCandidatePayMethodChangeModal'
  );

  assert.match(
    source,
    /\{ kind: 'client-picker', noParentGate: true, runOnRender: true \}/
  );
  assert.match(source, /if \(!search\.__wiredInput\)/);
  assert.match(source, /search\.addEventListener\('input'/);
  assert.match(source, /const wireClientPicker = \(\) =>/);
  assert.match(source, /scheduleClientPickerWire\(\)/);
  assert.match(source, /data-picker-kind="client"/);
  assert.match(source, /let retainedClientQuery = seedQuery/);
  assert.match(source, /retainedClientQuery = q/);
  assert.match(source, /pickerAlreadyWired/);
});

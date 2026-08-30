const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'main.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `missing section start: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `missing section end: ${to}`);
  return source.slice(start, end);
}

test('umbrella picker searches enabled companies and resolves exact typed matches before save', () => {
  const payTab = section(
    'async function mountCandidatePayTab()',
    'function ymd(d)'
  );

  assert.match(payTab, /qs\.set\('enabled', 'true'\)/);
  assert.match(payTab, /async function syncUmbrellaSelection\(\)/);
  assert.match(payTab, /await loadUmbrellaList\(val\)/);
  assert.match(payTab, /resolveCandidateUmbrellaSelection = async/);
});

test('candidate save waits for umbrella resolution and uses friendly notices', () => {
  const saveFlow = section(
    'async function openCandidate(row)',
    'async function openCandidateRateModal(candidate_id, existing)'
  );

  assert.match(saveFlow, /await resolver\(\)/);
  assert.match(saveFlow, /kind: 'candidate-pay-method-notice'/);
  assert.doesNotMatch(saveFlow, /alert\('Select an umbrella company/);
});

test('dedicated pay-method modal contains no native alert calls', () => {
  const payMethodModal = section(
    'async function openCandidatePayMethodChangeModal(candidate, context = {})',
    'function focusContractsAfterBulkChange(info)'
  );

  assert.match(payMethodModal, /const presentNotice = async/);
  assert.match(payMethodModal, /await openUiConfirmModal\(/);
  assert.doesNotMatch(payMethodModal, /\balert\s*\(/);
});

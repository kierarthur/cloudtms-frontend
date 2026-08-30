const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

const normalizerStart = mainSource.indexOf('const normalizePayWizardDecisionState =');
const normalizerEnd = mainSource.indexOf('\nconst ensurePayWizardDecisionState =', normalizerStart);
assert.ok(normalizerStart >= 0 && normalizerEnd > normalizerStart, 'Banking Pay decision normalizer must be present');

const normalizerSource = mainSource.slice(normalizerStart, normalizerEnd);

function installHarness() {
  const context = {
    JSON,
    Array,
    Number,
    String,
    deep: (value) => JSON.parse(JSON.stringify(value))
  };

  vm.runInNewContext(
    `${normalizerSource}\nthis.__normalizePayWizardDecisionState = normalizePayWizardDecisionState;`,
    context,
    { filename: 'banking-pay-selection-normalizer.js' }
  );

  return context.__normalizePayWizardDecisionState;
}

test('preserves IMPLICIT_ALL when the compact selected-id list is intentionally empty', () => {
  const normalize = installHarness();
  const normalized = normalize({
    selected_preview_row_ids: [],
    selected_preview_row_mode: 'IMPLICIT_ALL'
  });

  assert.equal(normalized.selected_preview_row_mode, 'IMPLICIT_ALL');
  assert.deepEqual(Array.from(normalized.selected_preview_row_ids), []);
});

test('preserves each explicit selection mode through decision normalization', () => {
  const normalize = installHarness();

  assert.equal(normalize({ selected_preview_row_mode: 'EXPLICIT_NONE' }).selected_preview_row_mode, 'EXPLICIT_NONE');
  assert.equal(normalize({ selected_preview_row_mode: 'EXPLICIT_SUBSET' }).selected_preview_row_mode, 'EXPLICIT_SUBSET');
});

test('accepts the internal create-draft mode alias without weakening invalid-mode handling', () => {
  const normalize = installHarness();

  assert.equal(normalize({ __selected_preview_row_mode: 'implicit_all' }).selected_preview_row_mode, 'IMPLICIT_ALL');
  assert.equal(normalize({ selected_preview_row_mode: 'select_everything' }).selected_preview_row_mode, '');
});

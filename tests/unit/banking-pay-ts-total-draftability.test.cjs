const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

const selectedStart = mainSource.indexOf('const createDraftRowSelectedOrReady =');
const helperEnd = mainSource.indexOf('\n  const collectPageRowsFromNode =', selectedStart);
assert.ok(selectedStart >= 0 && helperEnd > selectedStart, 'TS_TOTAL create-draft helper must be present');

const helperSource = mainSource.slice(selectedStart, helperEnd);
const renderedHelperStart = mainSource.indexOf('const isSyntheticTimesheetResidualLine =');
const renderedHelperEnd = mainSource.indexOf('\n  const getLineComponentKeyType =', renderedHelperStart);
assert.ok(renderedHelperStart >= 0 && renderedHelperEnd > renderedHelperStart, 'rendered TS_TOTAL helper must be present');
const renderedHelperSource = mainSource.slice(renderedHelperStart, renderedHelperEnd);

function installHarness() {
  const context = {
    Array,
    Object,
    String,
    isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    booleanFlag: (value) => value === true || ['true', '1', 'yes'].includes(String(value || '').toLowerCase()),
    upperTrim: (value) => String(value || '').trim().toUpperCase(),
    trimStr: (value) => String(value || '').trim(),
    asArray: (value) => Array.isArray(value) ? value : [],
    getCreateDraftRowJson: (row) => row.row_json || {},
    getCreateDraftSourceBasis: (row) => row.source_basis_json || row.row_json?.source_basis_json || {},
    getCreateDraftKeyType: (row) => row.key_type || row.row_json?.key_type || row.row_json?.economic_key?.key_type || '',
    getCreateDraftKeyValue: (row) => row.key_value || row.row_json?.key_value || row.row_json?.economic_key?.key_value || '',
    getCreateDraftSourceBasisKeyType: (row) => row.source_basis_json?.component_key_type || row.row_json?.source_basis_json?.component_key_type || '',
    getCreateDraftSourceBasisKeyValue: (row) => row.source_basis_json?.component_key_value || row.row_json?.source_basis_json?.component_key_value || '',
    createDraftRowIdentityText: (row) => [row.row_key, row.preview_row_id, row.row_json?.row_key, row.row_json?.preview_row_id].filter(Boolean).join('|').toLowerCase(),
    getCreateDraftTimesheetId: (row) => row.timesheet_id || row.row_json?.timesheet_id || ''
  };

  vm.runInNewContext(
    `${helperSource}\nthis.__isSynthetic = isSyntheticResolvedTimesheetResidualPreviewRow;`,
    context,
    { filename: 'banking-pay-ts-total-draftability.js' }
  );
  return context.__isSynthetic;
}

const totalRow = (overrides = {}) => ({
  row_key: '11111111-1111-4111-8111-111111111111:non_segment:total',
  preview_row_id: '11111111-1111-4111-8111-111111111111:non_segment:total',
  timesheet_id: '11111111-1111-4111-8111-111111111111',
  key_type: 'TS_TOTAL',
  key_value: 'TOTAL',
  selected: true,
  selection_state: 'SELECTED',
  status: 'READY',
  ...overrides
});

test('keeps a genuine non-segment TS_TOTAL row draftable', () => {
  const isSynthetic = installHarness();
  assert.equal(isSynthetic(totalRow(), []), false);
});

test('rejects a TS_TOTAL row explicitly replaced by resolved segment rows', () => {
  const isSynthetic = installHarness();
  assert.equal(isSynthetic(totalRow({ resolved_segment_rows_replace_source_total: true }), []), true);
});

test('rejects a stale TS_TOTAL row when a real TS_DAY sibling exists', () => {
  const isSynthetic = installHarness();
  const total = totalRow();
  const day = {
    timesheet_id: total.timesheet_id,
    key_type: 'TS_DAY',
    key_value: '2026-06-30',
    selected: true,
    selection_state: 'SELECTED',
    status: 'READY'
  };
  assert.equal(isSynthetic(total, [total, day]), true);
});

test('uses the renderer-local boolean parser for the displayed TS_TOTAL decision', () => {
  assert.match(renderedHelperSource, /const explicitResolvedReplacementMarker = asBool\(/);
  assert.doesNotMatch(renderedHelperSource, /\bbooleanFlag\(/);
});

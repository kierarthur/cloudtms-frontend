const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
const helperStart = mainSource.indexOf('const resolveFrozenBreakdownDisplayBasis =');
const helperEnd = mainSource.indexOf('const detailLineRowsForItem =', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'frozen breakdown basis helper must be present');
const helperSource = mainSource.slice(helperStart, helperEnd);

function loadHelper() {
  const firstText = (...values) => {
    for (const value of values) {
      const text = String(value == null ? '' : value).trim();
      if (text) return text;
    }
    return '';
  };
  const firstFiniteNumber = (...values) => {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return null;
  };
  const context = {
    Array,
    Map,
    Number,
    String,
    asObj: (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null,
    asArr: (value) => Array.isArray(value) ? value : [],
    upperTrim: (value) => String(value == null ? '' : value).trim().toUpperCase(),
    firstText,
    firstFiniteNumber
  };
  vm.runInNewContext(`${helperSource}\nthis.__helper = resolveFrozenBreakdownDisplayBasis;`, context, {
    filename: 'banking-pay-frozen-breakdown-basis-helper.js'
  });
  return context.__helper;
}

test('uses the immutable nested target basis for an exact TS_DAY, timesheet, and bucket match', () => {
  const helper = loadHelper();
  const timesheetId = '10da74a1-e8b7-4cce-8d17-46980ce8725b';
  const item = {
    timesheet_id: timesheetId,
    frozen_component_key_type: 'TS_DAY',
    frozen_component_key_value: '2026-06-08'
  };
  const breakdown = {
    bucket_code: 'NIGHT',
    meta_json: {
      resolution_payload_json: {
        case_components: [{
          component_key_type: 'TS_DAY',
          component_key_value: '2026-06-08',
          resolution_rows: [{
            payload_json: {
              bucket_resolutions: [{
                timesheet_id: timesheetId,
                source_basis_work_date: '2026-06-08',
                bucket_code: 'NIGHT',
                target_units: '1.000000',
                target_rate: '28.75',
                source_rate: '25.00'
              }]
            }
          }]
        }]
      }
    }
  };

  assert.deepEqual({ ...helper(item, breakdown) }, { units: 1, rate: 28.75 });
});

test('does not guess from source rate or from a different timesheet, date, or bucket', () => {
  const helper = loadHelper();
  const item = {
    timesheet_id: '10da74a1-e8b7-4cce-8d17-46980ce8725b',
    frozen_component_key_type: 'TS_DAY',
    frozen_component_key_value: '2026-06-08'
  };
  const breakdown = {
    bucket_code: 'NIGHT',
    meta_json: {
      resolution_payload_json: {
        case_components: [{
          component_key_type: 'TS_DAY',
          component_key_value: '2026-06-09',
          resolution_rows: [{
            payload_json: {
              bucket_resolutions: [{
                timesheet_id: '22512673-988f-48c8-b2e4-e6d8f649679c',
                source_basis_work_date: '2026-06-09',
                bucket_code: 'DAY',
                source_units: '1',
                source_rate: '25.00'
              }]
            }
          }]
        }]
      }
    }
  };

  assert.equal(helper(item, breakdown), null);
  assert.doesNotMatch(helperSource, /amount\s*\/\s*rate|source_rate|sourceRate/);
});

test('the frozen detail renderer prefers target compatibility basis and never falls back to item source_rate for a breakdown', () => {
  const rendererStart = mainSource.indexOf('const detailLineRowsForItem =');
  const rendererEnd = mainSource.indexOf('const detailItemStableId =', rendererStart);
  const rendererSource = mainSource.slice(rendererStart, rendererEnd);

  assert.match(rendererSource, /firstFiniteNumber\(breakdown\.units, frozenDisplayBasis\?\.units, item\.units\)/);
  assert.match(rendererSource, /firstFiniteNumber\(breakdown\.rate, frozenDisplayBasis\?\.rate, item\.rate\)/);
  assert.doesNotMatch(rendererSource, /breakdown\.rate, item\.rate, item\.source_rate/);
});

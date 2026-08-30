const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
const v2Css = fs.readFileSync(path.resolve(__dirname, '../../css/banking-pay-modal-v2.css'), 'utf8');

const helperStart = mainSource.indexOf('const getRelatedTimesheetIds =');
const helperEnd = mainSource.indexOf('const getExpenseBreakdownRowIdentity =', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'row Timesheet shortcut helpers must be present');

function loadHelpers() {
  const context = {
    Array,
    JSON,
    Set,
    WeakSet,
    String,
    isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    asArray: (value) => (Array.isArray(value) ? value : []),
    trimStr: (value) => String(value == null ? '' : value).trim(),
    enc: (value) => String(value)
  };
  vm.runInNewContext(
    `${mainSource.slice(helperStart, helperEnd)}\nthis.__helpers = { getRelatedTimesheetIds, renderRowTimesheetShortcut };`,
    context,
    { filename: 'banking-pay-row-timesheet-shortcut-helpers.js' }
  );
  return context.__helpers;
}

test('resolves only explicit row-related timesheet identities, including nested case-resolution buckets', () => {
  const helpers = loadHelpers();
  const first = '10da74a1-e8b7-4cce-8d17-46980ce8725b';
  const second = '22512673-988f-48c8-b2e4-e6d8f649679c';
  const ids = helpers.getRelatedTimesheetIds({
    candidate_id: 'ea7d481c-78d4-4195-979b-8a295231e661',
    linked_timesheet_id: first,
    frozen_resolution_payload_json: {
      case_components: [{
        resolution_rows: [{
          payload_json: {
            bucket_resolutions: [
              { timesheet_id: second },
              { timesheet_id: first }
            ]
          }
        }]
      }]
    }
  });

  assert.deepEqual(Array.from(ids), [first, second]);
});

test('renders a compact row shortcut only when an explicit timesheet is present', () => {
  const helpers = loadHelpers();
  const timesheetId = '10da74a1-e8b7-4cce-8d17-46980ce8725b';
  const html = helpers.renderRowTimesheetShortcut({ timesheet_id: timesheetId }, 'James Terwane');

  assert.match(html, /data-action="banking:pay:viewRowTimesheets"/);
  assert.match(html, /data-timesheet-ids=/);
  assert.match(html, /class="btn btn-xs btn-outline bpv2-timesheet-icon banking-timesheet-shortcut"/);
  assert.match(html, /<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(v2Css, /\.bpv2-timesheet-icon[^\{]*\{[^}]*width:28px!important;[^}]*height:28px!important;/);
  assert.equal(helpers.renderRowTimesheetShortcut({ candidate_id: timesheetId }, 'Candidate only'), '');
});

test('row shortcut navigation loads the Timesheets summary by exact ids and leaves batch navigation intact', () => {
  const navigationStart = mainSource.indexOf('async function navigateBankingPayBatchTimesheetsSummary');
  const navigationEnd = mainSource.indexOf('function installBankingPayBatchTimesheetSummaryShortcut', navigationStart);
  const navigationSource = mainSource.slice(navigationStart, navigationEnd);
  const installerStart = navigationEnd;
  const installerEnd = mainSource.indexOf('function normaliseActiveDraftCreateOperationLookupResponse', installerStart);
  const installerSource = mainSource.slice(installerStart, installerEnd);

  assert.match(navigationSource, /isRowScope \? \{ ids: rowTimesheetIds\.slice\(\) \} : \{ pay_batch_id: id \}/);
  assert.match(navigationSource, /await renderAll\(\)/);
  assert.doesNotMatch(navigationSource, /closeModal|closeChildModal|hideModal/);
  assert.match(installerSource, /banking:pay:viewRowTimesheets/);
  assert.match(installerSource, /timesheet_ids: rowTimesheetIds/);
});

test('Timesheets summary serializes exact id filters for one or several row-related timesheets', () => {
  const listStart = mainSource.indexOf('async function listTimesheetsSummary');
  const listEnd = mainSource.indexOf('async function listInvoicesSummary', listStart);
  const listSource = mainSource.slice(listStart, listEnd);

  assert.match(listSource, /Array\.isArray\(f\.ids\)/);
  assert.match(listSource, /qs\.set\('ids', explicitIds\.join\(','\)\)/);
});

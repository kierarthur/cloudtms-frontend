const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'modal-modernisation.css'), 'utf8');

const section = (startMarker, endMarker) => {
  const start = main.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = main.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return main.slice(start, end);
};

test('Office contract settings expose a separate tri-state printed-timesheet policy', () => {
  const source = section('function openContractSettingsModal()', 'function computePayWorkbenchSessionSignature');
  assert.match(source, /candidate_paper_submission_policy/);
  assert.match(source, /<h3 id="contractPrintedTimesheetsHeading">Printed QR Timesheets<\/h3>/);
  assert.match(source, /aria-label="Printed QR Timesheet policy"/);
  assert.match(source, /Use Client setting/);
  assert.match(source, /Allow for this Contract/);
  assert.match(source, /Do not allow for this Contract/);
  assert.match(source, /Independent of “Override client settings”/);
  assert.match(source, /central printed-timesheet feature/);
  assert.match(source, /Standard weekly timesheets/);
  assert.match(source, /data-ctms-intentional-lock/);
  assert.match(main, /Child settings panels can have their own inheritance and authority gates/);
  assert.match(source, /changedPrintedPolicy/);
  assert.match(source, /status surface in place/);
  assert.match(source, /await fr\.setTab/);
  assert.match(source, /wire\(\);/);
  assert.doesNotMatch(source, /Staged only until/);
});

test('default submission mode remains ELECTRONIC or MANUAL and is read-only on Contract Main', () => {
  const source = section('function renderContractMainTab(ctx)', 'function openContractCloneAndExtend');
  assert.match(source, /ctms-readonly-setting/);
  assert.match(source, /Contract override/);
  assert.match(source, /Client default/);
  assert.match(source, /type="hidden" name="default_submission_mode"/);
  assert.doesNotMatch(source, /<option value="QR"/);
  const settings = section('function openContractSettingsModal()', 'function computePayWorkbenchSessionSignature');
  assert.doesNotMatch(settings, /<option value="QR"/);
});

test('existing Client and Contract printed-timesheet changes use narrow exact endpoints', () => {
  const helpers = section('function printedTimesheetPolicyRequestKey', 'async function listContractWeeks');
  assert.match(helpers, /\/api\/contracts\/\$\{_enc\(contractId\)\}\/printed-timesheet-policy/);
  assert.match(helpers, /expected_contract_updated_at/);
  assert.match(helpers, /\/api\/clients\/\$\{_enc\(clientId\)\}\/printed-timesheet-policy/);
  assert.match(helpers, /expected_settings_updated_at/);
  assert.match(helpers, /if \(id\) delete patch\.candidate_paper_submission_enabled_override/);

  const clientSave = section('async function openClient(row)', 'function ensureSelectionStyles');
  assert.match(clientSave, /delete csClean\.candidate_paper_submission_enabled/);
  assert.match(clientSave, /updateClientPrintedTimesheetPolicy/);
});

test('Client settings use the same polished policy card and preserve workflow restrictions', () => {
  const source = section('async function renderClientSettingsUI(settingsObj)', 'async function upsertClient(payload, id)');
  assert.match(source, /clientPrintedTimesheetsHeading/);
  assert.match(source, /<h3 id="clientPrintedTimesheetsHeading">Printed QR Timesheets<\/h3>/);
  assert.match(source, /Allow candidates to use Printed QR Timesheets/);
  assert.match(source, /central printed-timesheet feature/);
  assert.match(source, /Daily and import-authoritative timesheets remain unavailable/);
  assert.match(source, /candidate_paper_submission_enabled/);
  assert.match(css, /\.ctms-policy-card/);
  assert.match(css, /\.ctms-policy-options > label:focus-within/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.ctms-policy-options \{ grid-template-columns: 1fr; \}/);
});

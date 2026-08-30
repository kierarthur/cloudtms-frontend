const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const modernisation = fs.readFileSync(path.join(root, 'js', 'modal-modernisation.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'modal-modernisation.css'), 'utf8');

const section = (startMarker, endMarker) => {
  const start = main.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = main.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return main.slice(start, end);
};

test('Rate preset picker reports API failures and formats displayed money consistently', () => {
  const picker = section('function openRatePresetPicker', 'function openPresetRatesManager');
  assert.match(picker, /Rate presets could not be loaded/);
  assert.match(picker, /data-rp-retry/);
  assert.match(picker, /n\.toFixed\(2\)/);
  assert.doesNotMatch(picker, /<th>Dates<\/th>/);
  assert.match(picker, /requestSequence !== pickerRequestSequence/);

  const list = section('async function listRatePresets', 'async function deleteRatePreset');
  assert.match(list, /if \(!r\.ok\)/);
  assert.match(list, /throw new Error/);
});

test('Rate preset editor keeps decimal and schedule-clearing semantics correct', () => {
  const editor = section('async function openRatePresetModal', '// Rates Presets — API wrappers');
  assert.match(editor, /Number\.isFinite\(n\) \? n\.toFixed\(2\)/);
  assert.match(editor, /const numVal = Number\(v\)/);
  assert.doesNotMatch(editor, /Number\(v\) \/ 100/);
  assert.match(editor, /payload\.std_schedule_json = null/);
  assert.match(editor, /if \(Object\.keys\(S\)\.length\) payload\.std_schedule_json = S/);
  assert.match(editor, /kind: 'rate-preset-load-failed'/);
  assert.doesNotMatch(main, /Set the scope, rates, mileage and optional weekly schedule\./);
});

test('Rate preset manager uses branded delete confirmation and explicit retry state', () => {
  const manager = section('function openPresetRatesManager', 'async function openRatePresetModal');
  assert.match(manager, /kind: 'rate-preset-delete-confirm'/);
  assert.match(manager, /kind: 'rate-preset-delete-failed'/);
  assert.match(manager, /id="rp_retry"/);
  assert.match(manager, /new Intl\.DateTimeFormat\('en-GB'/);
  assert.match(manager, /hourCycle: 'h23'/);
  assert.doesNotMatch(manager, /\bconfirm\(|\balert\(/);
});

test('All rate preset modals receive the responsive modernisation family', () => {
  assert.match(modernisation, /kind === 'rate-presets-picker'/);
  assert.match(modernisation, /kind === 'rates-presets'/);
  assert.match(modernisation, /kind === 'rate-preset'/);
  assert.match(modernisation, /#ratePresetPicker, #ratePresetManager, #rp_form/);
  assert.match(css, /\.ctms-rate-preset-manager/);
  assert.match(css, /\.ctms-rate-preset-editor/);
  assert.match(css, /#ratesPresetsTable td::before/);
  assert.match(css, /scrollbar-color/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/modal-modernisation.css'), 'utf8');

test('Candidate Bookings uses a bounded five-column contract table without changing its actions', () => {
  assert.match(main, /class="candidate-contracts-table"/);
  for (const heading of ['Client', 'Job Title', 'Band', 'Start date', 'End Date']) {
    assert.match(main, new RegExp(`label: '${heading}'`));
  }
  assert.match(main, /data-act="filter">Show only/);
  assert.match(main, /data-act="open">Open/);
  assert.match(main, /row\.addEventListener\('dblclick'/);
  assert.match(css, /\.candidate-contracts-scroll\s*\{[\s\S]*?max-height:\s*350px/);
  assert.match(css, /\.candidate-contracts-scroll::\-webkit-scrollbar-thumb/);
});

test('every Candidate Bookings heading toggles ascending and descending sorting accessibly', () => {
  assert.match(main, /sortState\.direction === 'asc' \? 'desc' : 'asc'/);
  assert.match(main, /setAttribute\('aria-sort'/);
  assert.match(main, /localeCompare\([^)]*[\s\S]*?sensitivity:\s*'base'/);
  assert.match(main, /const dateSortValue = \(value\) =>/);
  assert.match(main, /data-sort="\$\{column\.key\}"/);
});

test('Candidate Bookings keeps the calendar independently visible below the bounded list', () => {
  assert.match(main, /class="tabc candidate-bookings-layout"/);
  assert.match(main, /id="__candCalScroll" class="candidate-calendar-scroll"/);
  assert.match(css, /\.candidate-calendar-scroll\s*\{[\s\S]*?height:\s*min\(46vh, 520px\)/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.candidate-contract-row\s*\{[\s\S]*?display:\s*grid/);
});

test('Candidate Bookings hydrates a fresh contract before either Open action launches the modal', () => {
  assert.match(main, /onDblClick:\s*async\s*\(cid\)\s*=>/);
  assert.match(main, /const fresh = \(typeof getContract === 'function'\)[\s\S]*?await getContract\(contractId\)/);
  assert.match(main, /if \(!fresh\) throw new Error\('Contract details could not be loaded\.'\)/);
  assert.match(main, /openContract\(fresh, \{ noParentGate: true \}\)/);
  assert.doesNotMatch(main, /openContract\(\{ id: String\(cid\) \}\)/);
});

test('Candidate calendar presents the approved simplified status vocabulary', () => {
  for (const label of [
    'Planned',
    'Needs Attention',
    'Awaiting Authorisation',
    'Authorised',
    'Invoiced',
    'Paid',
    'On Hold'
  ]) {
    assert.match(main, new RegExp(`>${label}<`));
  }

  assert.match(main, /function normalizeCalendarState\(state\)/);
  assert.match(main, /if \(s === 'READY' \|\| s === 'AUTHORIZED'\) return 'AUTHORISED'/);
  assert.match(main, /if \(s === 'PROCESSED_NOT_READY' \|\| s === 'PROCESSED'\) return 'NEEDS_ATTENTION'/);
  assert.doesNotMatch(main, />Processed \(not ready\)</);
  assert.doesNotMatch(main, />Ready</);
  assert.doesNotMatch(main, />Pay \+ invoice on hold</);
});

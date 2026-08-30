const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { build, ROOTS, GLOBALS } = require('../fixtures/generate-banking-detail-renderers.cjs');
const { parse, freeNames } = require('../fixtures/banking-detail-syntax.cjs');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const generatedPath = path.join(root, 'js/banking-pay-modal-v2-details-legacy.js');
const expected = build(source);
const fixture = require('../fixtures/banking-pay-v2-detail-page.cjs');
const digestContext = value => JSON.stringify(value, (_, item) => item instanceof Map ? [...item.entries()] : item instanceof Set ? [...item] : item);

test('bounded detail factory exists and matches complete current legacy declarations', () => {
  assert.equal(fs.readFileSync(generatedPath, 'utf8').replaceAll('\r\n', '\n'), expected.text);
});

test('detail factory has no undeclared application dependency or whole-modal call', () => {
  const generated = fs.readFileSync(generatedPath, 'utf8');
  const free = freeNames(parse(generated));
  assert.deepEqual(free.filter(name => !GLOBALS.has(name) && !['module', 'window', 'TypeError'].includes(name)), []);
  assert.doesNotMatch(generated, /renderPayNewBatchWizard\s*\(|bankingGetState\s*\(|fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/);
  assert.ok(!expected.inputs.includes('payload') && !expected.inputs.includes('resolutionFamily') && !expected.inputs.includes('displayLines'));
});

test('every extracted detail declaration carries exact source provenance', () => {
  const api = require(generatedPath);
  assert.equal(api.SOURCE_MANIFEST.length, expected.selected.length);
  for (const row of api.SOURCE_MANIFEST) {
    const original = expected.declarations.get(row.name).source;
    assert.equal(createHash('sha256').update(original).digest('hex'), row.sha256, row.name);
  }
  assert.deepEqual(api.REQUIRED_CONTEXT, expected.inputs);
  assert.throws(() => api.create({}), /Missing Banking detail context/);
});

// The actual existing declarations form the oracle. Do not call the full
// legacy modal and do not replace money/identity/action helpers with stubs.
function legacy(context) {
  const declarations = expected.selected.map(item => item.source).join('\n');
  return vm.runInNewContext(`(function(context){const {${expected.inputs.join(',')}}=context;
    ${declarations}\nreturn {${ROOTS.join(',')}};})(context)`, { context }, { timeout: 1000 });
}
test('complete Ready detail HTML and action attributes match for selected/mixed/empty and updating states', () => {
  const api = require(generatedPath);
  const rows=fixture.readyPage().rows;
  for(const selected of [[],[rows[0].preview_row_id],rows.map(row=>row.preview_row_id)]) {
    for(const open of [[],[`READY_TO_PAY|${fixture.id(1)}|${fixture.id(201)}`]]) {
      for(const state of [{},{pending:true},{failed:true}]) {
        const ctx=fixture.context({ready:rows,selected,open,...state});
        const before=digestContext(ctx);
        const original=legacy(ctx);const actual=api.create(ctx);
        const timesheets=rows.filter(row=>row.line_type==='TIMESHEET_PAYMENT');
        assert.equal(actual.renderReadyTimesheetGroupedRows(timesheets),original.renderReadyTimesheetGroupedRows(timesheets));
        assert.equal(actual.renderSimplePreviewRows([rows[3]],null,'READY_TO_PAY'),original.renderSimplePreviewRows([rows[3]],null,'READY_TO_PAY'));
        assert.equal(digestContext(ctx),before,'Rendering changed accepted context');
      }
    }
  }
});

test('Ready grouping retains exact row selection and expense/whole-timesheet controls', () => {
  const rows=fixture.readyPage().rows;
  const actual=require(generatedPath).create(fixture.context({ready:rows}));
  const html=actual.renderReadyTimesheetGroupedRows(rows.filter(row=>row.line_type==='TIMESHEET_PAYMENT'));
  for(const name of ['toggleTimesheetPreviewGroup','toggleTimesheetBreakdown','togglePreviewRow','viewRowTimesheets','openSnooze','snoozeAllExpenses']) {
    assert.ok(html.includes(`data-action="banking:pay:${name}"`),name);
  }
  assert.ok(html.includes('aria-checked="mixed"'));
  assert.ok(html.includes(fixture.id(1001))&&html.includes(fixture.id(1002))&&html.includes(fixture.id(1003)));
  assert.ok(html.includes('timesheet-expense:')&&html.includes('a'.repeat(32)));
  assert.ok(html.includes('data-component-key-type="TS_DAY"')||html.includes('27/08/2026'));
});

test('component and case detail retains every existing action and exact source basis', () => {
  const ctx=fixture.context();const actual=require(generatedPath).create(ctx);const original=legacy(ctx);
  for(const family of ['BUCKETED','NON_BUCKET','TAXABLE_CHANNEL_RESTRUCTURE']) {
    for(const resolved of [false,true]) {
      const entry=fixture.caseEntry({resolution_family:family,case_needs_resolution:!resolved,case_resolution_satisfied_now:resolved,
        components:[fixture.component(301,{has_operator_choice:resolved}),fixture.component(302,{resolution_state:'STALE'})]});
      for(const name of ['renderComponentRows','renderCaseActionButtons','renderCaseCard','renderTaxableFinanceCaseRestructureTeaser']) {
        assert.equal(actual[name](entry),original[name](entry),`${family}/${resolved}/${name}`);
      }
    }
  }
  const html=actual.renderComponentRows(fixture.caseEntry({components:[fixture.component(301,{has_operator_choice:true})]}));
  for(const action of ['componentUseSuggested','componentManualRate','componentManualAmount','componentClearResolution'])
    assert.ok(html.includes(`data-action="banking:pay:${action}"`),action);
  assert.ok(html.includes(`data-source-basis-fingerprint="${'b'.repeat(64)}"`));
  assert.ok(html.includes('data-source-basis-json="{&quot;fixture&quot;:true'));
});

test('Blocked detail and dated whole-timesheet unsnooze retain existing controls without selection', () => {
  const row=fixture.recovery(1101,{effective_section:'blocked_for_pay',presentation_section:'BLOCKED_FOR_PAY',
    line_type:'MANUAL_DEBT_RECOVERY',amount_ex_vat:'0.00',section_amount_ex_vat:'0.00',
    blocked_reason_codes:['NO_PAY_HEADROOM'],draftable:false,selection_allowed:false,is_ready_for_draft:false});
  const ctx=fixture.context({blocked:[row]});const actual=require(generatedPath).create(ctx);
  const html=actual.renderSimplePreviewRows([row],null,'BLOCKED_FOR_PAY');
  assert.equal(html,legacy(ctx).renderSimplePreviewRows([row],null,'BLOCKED_FOR_PAY'));
  assert.doesNotMatch(html,/type="checkbox"/);
  const timesheet=fixture.payment(1102,{snooze_id:fixture.id(600),snooze_until_date:'2026-09-04',snooze_state:'ACTIVE'});
  const child=actual.renderReadyTimesheetGroupedRows([timesheet]);
  assert.ok(child.includes('banking:finance:clearTimesheetSnooze'),'Preserve this cross-namespace nested handler too');
});

test('detail rendering escapes candidate, source and note content in preserved attributes', () => {
  const row=fixture.payment(1103,{display_name:'<img src=x onerror=evil()>',source_ref:'"><script>evil()</script>',note:'" onmouseover="evil()'});
  const ctx=fixture.context({ready:[row]});const html=require(generatedPath).create(ctx).renderReadyTimesheetGroupedRows([row]);
  assert.equal(html,legacy(ctx).renderReadyTimesheetGroupedRows([row]));
  assert.ok(html.includes('&lt;img'));
  assert.doesNotMatch(html,/<img|<script| onmouseover="evil/);
});

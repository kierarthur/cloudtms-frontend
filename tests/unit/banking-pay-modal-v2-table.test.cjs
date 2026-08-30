const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ui=require('../../js/banking-pay-modal-v2-table.js');
const fixture=require('../fixtures/banking-pay-v2-table-page.cjs');
test('currency formatting preserves decimal strings without floating-point arithmetic',()=>{
  assert.equal(ui.formatAmount('0.00'),'£0.00');
  assert.equal(ui.formatAmount('1234.50'),'£1,234.50');
  assert.equal(ui.formatAmount('-12.34'),'£-12.34');
  assert.equal(ui.formatAmount('9999999999999999.99'),'£9,999,999,999,999,999.99');
  for(const value of [10,NaN,Infinity,'1','-0.00','1.001','1e2',' 1.00']) assert.throws(()=>ui.formatAmount(value));
});
test('four cells, one physical row, selected-only deductions and disabled Timesheets',()=>{
  const html=ui.candidateRowMarkup(fixture.candidate());
  assert.equal((html.match(/<tr\b/g)||[]).length,1);
  assert.equal((html.match(/<td\b/g)||[]).length,4);
  assert.match(html,/>£0\.00<\/span>/); assert.match(html,/data-bpv2-deductions>—<\/td>/);
  assert.match(html,/aria-checked="false"/); assert.match(html,/class="bpv2-timesheet-icon banking-timesheet-shortcut"/);
  assert.match(html,/aria-label="Open selected Timesheets for Fixture candidate 001"/);
  assert.match(html,/candidate&#39;s selected payments\./); assert.match(html,/ disabled><svg/);
  assert.doesNotMatch(html,/<details|View breakdown|expand|aria-expanded/i);
});
test('half tick and selected deduction use authoritative fields only',()=>{
  const page=fixture.page();
  assert.match(ui.candidateRowMarkup(page.rows[0]),/aria-checked="mixed"/);
  assert.match(ui.candidateRowMarkup(page.rows[2]),/data-bpv2-deductions>Yes<\/td>/);
  const unusual={...page.rows[2],selected_display_amount:'15.00'};
  assert.match(ui.candidateRowMarkup(unusual),/data-bpv2-deductions>Yes<\/td>/);
});
test('names and references cannot inject HTML, event attributes or extra table cells',()=>{
  const html=ui.candidateRowMarkup({...fixture.candidate(),candidate_name:'<img src=x onerror="bad()">',candidate_reference:'</td><td>extra'});
  assert.doesNotMatch(html,/<img|<td>extra|onerror="/);
  assert.match(html,/&lt;img/); assert.equal((html.match(/<td\b/g)||[]).length,4);
});
test('headline is allowed to include candidates outside the visible page',()=>{
  const page=fixture.page();
  assert.equal(ui.validateSummary(page),page);
  assert.equal(page.global.selected_ready_display_amount,'220.00');
  assert.equal(page.rows.length,100); assert.equal(page.total_count,101);
});
for(const [name,mutate] of Object.entries({
  missingViewEvidence:p=>delete p.view_digest,
  invalidViewEvidence:p=>p.view_digest='not-a-digest',
  missingFactsEvidence:p=>delete p.rows[0].facts_digest,
  invalidFactsEvidence:p=>p.rows[0].facts_digest=null,
  tooManyRows:p=>p.rows.push(fixture.candidate(500)),
  duplicateCandidate:p=>p.rows[1]=p.rows[0],
  ineligibleCandidate:p=>p.rows[0].selectable_ready_count=0,
  wrongHalfTick:p=>p.rows[0].selection_state='ALL',
  unselectedAmount:p=>p.rows[3].selected_display_amount='10.00',
  unselectedDeduction:p=>p.rows[3].selected_deduction_exists=true,
  unselectedTimesheet:p=>p.rows[3].selected_timesheet_count=1,
  inlineOverflow:p=>Object.assign(p.rows[0],{selected_timesheet_count:26,selected_timesheet_scope_token:null}),
  invalidCurrency:p=>p.global.selected_ready_display_amount=220,
  badSort:p=>p.sort_key='TIMESHEETS',
  badPage:p=>p.rows=[],
  missingPageAnchor:p=>delete p.page_anchor,
  invalidPageAnchor:p=>p.page_anchor='../invalid',
  missingNextAnchor:p=>delete p.next_page_anchor,
  invalidNextAnchor:p=>p.next_page_anchor='../invalid',
  absentNextAnchor:p=>p.next_page_anchor=null,
  missingPreviousAnchor:p=>delete p.previous_page_anchor,
  unexpectedPreviousAnchor:p=>p.previous_page_anchor='previous',
  wrongPageNumber:p=>p.page_number=0,
  missingPageNumber:p=>delete p.page_number,
  missingPreviousFlag:p=>delete p.has_previous,
  wrongPreviousFlag:p=>p.has_previous=true,
  missingPreviousCursor:p=>delete p.previous_cursor,
  unexpectedPreviousCursor:p=>p.previous_cursor='previous',
  badGlobalState:p=>p.global.selection_state='ALL',
  wrongGlobalCount:p=>p.global.candidate_count=100,
  missingDraftAuthority:p=>delete p.global.draft
})) test(`invalid ${name} fails before rendering`,()=>{const page=fixture.page();mutate(page);assert.throws(()=>ui.validateSummary(page));});
test('main headers have exactly three sort keys; Include remains all-page selection',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../js/banking-pay-modal-v2-table.js'),'utf8');
  const table=source.slice(source.indexOf('const TABLE ='),source.indexOf('function createCandidateTable'));
  assert.equal((table.match(/<th\b/g)||[]).length,4);
  assert.deepEqual([...table.matchAll(/data-bpv2-sort="([^"]+)"/g)].map(match=>match[1]),['CANDIDATE','DEDUCTIONS','READY_TO_PAY']);
  assert.match(table,/data-bpv2-control="global"/);
  assert.doesNotMatch(source,/\.sort\(|\.reduce\(|parseFloat\(|fetch\(|XMLHttpRequest|toFixed\(/);
  assert.doesNotMatch(table,/<th[^>]*>Timesheets|search|expand/i);
});

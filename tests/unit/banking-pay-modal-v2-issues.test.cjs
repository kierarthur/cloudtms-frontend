const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../../js/banking-pay-modal-v2-issues.js');
const fixture=require('../fixtures/banking-pay-v2-detail-page.cjs');
function value(kind){
  const summary=fixture.snapshot().summary;
  Object.assign(summary.global,{action_required_count:101,blocked_count:101,updating_count:2});
  const page={...Object.fromEntries(['session_id','session_version','progress_counter_version','scope_hash'].map(key=>[key,summary[key]])),
    ok:true,contract:summary.contract,contract_version:1,search:'',sort_key:api.definitions[kind].columns[0][2],sort_direction:'ASC',
    total_count:101,scope_count:101,has_more:true,next_cursor:'next_page',page_number:1,has_previous:false,previous_cursor:null,updating_count:2,rows:[kind==='actions'
      ?{identity:'exact_case_key',issue_state:'ACTION_REQUIRED',title:'Rate decision required',affected_candidate_count:1,affected_payment_count:150,affected_payment_count_complete:true}
      :{identity:'exact_blocker_key',candidate_id:fixture.id(1),candidate_name:'Synthetic candidate',candidate_reference:'TEST',
        reason:'Insufficient funds to deduct',affected_display_amount:'15.00'}]};
  if(kind==='actions')Object.assign(page,{view:'ACTION_REQUIRED',updating_has_more:false,updating_next_cursor:null,
    updating:[1,2].map(n=>({identity:'updating_'+n,issue_state:'UPDATING',title:'Refreshing…',affected_candidate_count:1,
      affected_payment_count:null,affected_payment_count_complete:false}))});
  page.rows=Array.from({length:100},(_,n)=>({...page.rows[0],identity:page.rows[0].identity+'_'+n}));
  return {page,summary};
}
for(const kind of ['actions','blocked']){
  test(`${kind} accepts a bounded page while preserving complete counts`,()=>{
    const {page,summary}=value(kind);assert.equal(api.validate(page,summary,kind),page);
    const html=api.rowMarkup(page.rows[0],kind);assert.equal((html.match(/<td/g)||[]).length,kind==='actions'?4:3);
    assert.doesNotMatch(html,/checkbox|togglePreviewRow|toggleTimesheetBreakdown/);
  });
  for(const [label,change] of Object.entries({
    revision:v=>v.page.progress_counter_version++,scope:v=>v.page.scope_hash='b'.repeat(64),
    indefinite:v=>v.page.rows[0].indefinite_snooze=true,updating:v=>v.page.rows[0].updating=true,
    duplicate:v=>v.page.rows.push({...v.page.rows[0]}),overflow:v=>v.page.rows=Array.from({length:101},(_,i)=>({...v.page.rows[0],identity:`row_${i}`})),
    count:v=>v.page.scope_count=102,sort:v=>v.page.sort_key='INCLUDE',search:v=>v.page.search='x'.repeat(201),
    empty:v=>v.page.rows=[],cursor:v=>v.page.next_cursor=null,truncated:v=>v.page.rows.pop(),
    wrongPage:v=>v.page.page_number=2,missingPage:v=>delete v.page.page_number,
    wrongPrevious:v=>v.page.has_previous=true,missingPrevious:v=>delete v.page.previous_cursor
  }))test(`${kind} rejects ${label} before presentation`,()=>{
    const v=value(kind);change(v);assert.throws(()=>api.validate(v.page,v.summary,kind),/INVALID_RESPONSE/);
  });
  test(`${kind} search changes only matched list counts, not Banking totals`,()=>{
    const v=value(kind);v.page.search='unmatched';v.page.rows=[];v.page.total_count=0;v.page.has_more=false;v.page.next_cursor=null;v.page.page_number=0;
    assert.equal(api.validate(v.page,v.summary,kind).scope_count,101);
  });
}
for(const kind of ['actions','blocked'])test(kind+' final page must retain its exact remaining row and position',()=>{
 const v=value(kind);v.page.rows=[v.page.rows[0]];v.page.page_number=2;v.page.has_previous=true;
 v.page.has_more=false;v.page.next_cursor=null;
 assert.equal(api.validate(v.page,v.summary,kind,'previous_boundary'),v.page);
 assert.throws(()=>api.validate(v.page,v.summary,kind,null),/INVALID_RESPONSE/);
 v.page.rows.push({...v.page.rows[0],identity:'extra'});assert.throws(()=>api.validate(v.page,v.summary,kind,'previous_boundary'),/INVALID_RESPONSE/);
});
test('task counts are not inferred from loaded affected payments',()=>{
  const {page}=value('actions');assert.match(api.rowMarkup(page.rows[0],'actions'),/>150 payments<\/td>/);
});
test('a single action payment may show exact server-owned presentation without changing task aggregation',()=>{
  const {page}=value('actions');Object.assign(page.rows[0],{
    affected_candidate_count:1,affected_payment_count:1,candidate_name:'James Terwane',candidate_reference:'CCR-03726',
    payment_label:'Timesheet payment',payment_date:'2026-06-14',affected_display_amount:'200.00',linked_timesheet_id:fixture.id(30)
  });
  const html=api.rowMarkup(page.rows[0],'actions');
  assert.match(html,/James Terwane/);assert.match(html,/CCR-03726/);assert.match(html,/Timesheet payment/);
  assert.match(html,/14\/06\/2026/);assert.match(html,/£200\.00/);assert.match(html,/Open this Timesheet/);
});
for(const [label,change] of Object.entries({
  candidateOnMulti:r=>Object.assign(r,{candidate_name:'Invented',affected_candidate_count:2}),
  paymentOnMulti:r=>Object.assign(r,{payment_label:'Invented',affected_payment_count:2}),
  amountOnMulti:r=>Object.assign(r,{affected_display_amount:'30.00',affected_payment_count:2}),
  badDate:r=>Object.assign(r,{payment_label:'Payment',affected_payment_count:1,payment_date:'14/06/2026'}),
  badTimesheet:r=>Object.assign(r,{payment_label:'Payment',affected_payment_count:1,linked_timesheet_id:'not-a-uuid'})
}))test('action presentation rejects contradictory '+label,()=>{
  const v=value('actions');change(v.page.rows[0]);assert.throws(()=>api.validate(v.page,v.summary,'actions'),/INVALID_RESPONSE/);
});
test('list text is escaped and absent affected amount is not invented as zero',()=>{
  const {page}=value('blocked');page.rows[0].candidate_name='<img onerror="bad()">';page.rows[0].reason='<script>bad()</script>';
  page.rows[0].affected_display_amount=null;const html=api.rowMarkup(page.rows[0],'blocked');
  assert.doesNotMatch(html,/<img|<script|£0\.00/);assert.match(html,/&lt;script&gt;/);assert.match(html,/>—<\/td>/);
});
test('new issue controls have no independent network, financial or selection authority',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../js/banking-pay-modal-v2-issues.js'),'utf8');
  assert.doesNotMatch(source,/fetch\s*\(|bankingGetState\s*\(|\.sort\s*\(|selected_display_amount|togglePreviewRow/);
});
test('Blocked rejects malformed candidate identity even when it is 36 hexadecimal/hyphen characters',()=>{
  const {page,summary}=value('blocked');page.rows[0].candidate_id='-'.repeat(36);
  assert.throws(()=>api.validate(page,summary,'blocked'),/INVALID_RESPONSE/);
});
module.exports={value};
for(const [label,change] of Object.entries({
 sourceInventsPayment:r=>Object.assign(r,{source_kind:'SOURCE_PROGRESS',preview_row_id:fixture.id(3)}),
 wrongPhysicalReference:r=>Object.assign(r,{source_kind:'PREVIEW_ROW',preview_row_id:null})
}))test('Blocked refuses contradictory source reference '+label,()=>{
 const v=value('blocked');change(v.page.rows[0]);assert.throws(()=>api.validate(v.page,v.summary,'blocked'),/INVALID_RESPONSE/);
});

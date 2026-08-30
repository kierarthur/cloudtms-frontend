const assert=require('node:assert/strict');
const test=require('node:test');
const api=require('../../js/banking-pay-modal-v2-issues.js');
const {fixture}=require('../fixtures/banking-pay-v2-issue-detail-page.cjs');
const row=()=>({identity:'bank_issue',issue_state:'ACTION_REQUIRED',title:'Candidate bank details are missing.',affected_candidate_count:1,
 affected_payment_count:0,affected_payment_count_complete:true});
test('zero confirmed payments is not hidden or changed to one payment',()=>{
 assert.match(api.rowMarkup(row(),'actions'),/>0 payments<\/td>/);
});
test('an unconfirmed payment count uses a dash and an exact explanation, never zero',()=>{
 const html=api.rowMarkup({...row(),affected_payment_count:null,affected_payment_count_complete:false},'actions');
 assert.match(html,/>Payment count being checked<\/td>/);assert.match(html,/Payment count not yet confirmed\./);assert.doesNotMatch(html,/>0 payments<\/td>/);
});
for(const [label,changes] of Object.entries({missingCompleteness:{affected_payment_count_complete:undefined},
 unknownPretendsZero:{affected_payment_count:0,affected_payment_count_complete:false},
 knownButNull:{affected_payment_count:null},negative:{affected_payment_count:-1},fractional:{affected_payment_count:1.2}}))
 test(`reject contradictory payment count: ${label}`,()=>assert.throws(()=>api.rowMarkup({...row(),...changes},'actions'),/INVALID_RESPONSE/));
for(const kind of ['actions','blocked']){
 for(const n of [1,2])test(`${kind} retains complete105-member detail on page${n}`,()=>{
  const v=fixture(kind,n);assert.equal(api.validateDetail(v.page,v.summary,v.kind,v.identity,v.cursor,v.limit),v.page);
 });
 for(const [label,change] of Object.entries({
  wrongKey:v=>v.page[v.kind==='actions'?'task_key':'blocker_key']='other_issue',
  wrongRevision:v=>v.page.progress_counter_version++,wrongScope:v=>v.page.scope_hash='b'.repeat(64),
  falseEmpty:v=>v.page.rows=[],shortFirst:v=>v.page.rows.pop(),
  lastPageTruncation:v=>{v.page.total_count=90;v.page.has_more=false;v.page.next_cursor=null;},
  duplicate:v=>v.page.rows[1]={...v.page.rows[0]},oversized:v=>v.page.rows.push({...v.page.rows[0],identity:'extra'}),
  badCandidate:v=>v.page.rows[0].candidate_id='invalid',badPayment:v=>v.page.rows[0].preview_row_id='invalid',
  conflictingCandidate:v=>v.page.rows[0].payload.candidate_id='10000000-0000-4000-8000-000000009999',
  inventedSourcePayment:v=>v.page.rows[0].source_kind='STORED_PAYEE',
  missingPayload:v=>delete v.page.rows[0].payload,missingContext:v=>delete v.page.rows[0].context_only,
  noPrevious:v=>v.page.has_previous=true,wrongPage:v=>v.page.page_number=2,
  hidden:v=>v.page.rows[0].indefinite_snooze=true,tooLarge:v=>v.page.rows[0].payload.large='x'.repeat(256*1024)
 }))test(`${kind} rejects incomplete/cross-bound detail: ${label}`,()=>{
  const v=fixture(kind);change(v);assert.throws(()=>api.validateDetail(v.page,v.summary,v.kind,v.identity,v.cursor,v.limit),/INVALID_RESPONSE/);
 });
}
test('source-only detail has no payment identity and keeps an unknown count',()=>{
 const v=fixture('actions',1,1);Object.assign(v.page,{affected_payment_count:null,affected_payment_count_complete:false});
 Object.assign(v.page.rows[0],{preview_row_id:null,source_kind:'STORED_PAYEE',payload:{bank_account_issue:true}});
 assert.equal(api.validateDetail(v.page,v.summary,v.kind,v.identity,null,100),v.page);
});

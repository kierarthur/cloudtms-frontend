const assert=require('node:assert/strict');const test=require('node:test');
const fixture=require('../fixtures/banking-pay-v2-table-page.cjs');
const table=require('../../js/banking-pay-modal-v2-table.js');
const mutation=require('../../js/banking-pay-modal-v2-mutation.js');
const intent=()=>({kind:'candidate',candidate_id:fixture.id(1),action:'CLEAR_ALL_READY',request_id:fixture.id(9000),pay_channel_scope:'ALL'});
const previous=()=>({summary:fixture.page(),ui:{surface:'main'},ready:null,actions:null,blocked:null});

test('individual row dispatch binds exact rendered IDs and the current complete Ready page',()=>{
 const old=previous();old.ui.surface='candidate';old.ready={...old.summary,candidate_id:fixture.id(1),page_anchor:'ready_position',
  rows:[{identity:fixture.id(500),candidate_id:fixture.id(1)}]};
 const click={kind:'rows',candidate_id:fixture.id(1),preview_row_ids:[fixture.id(500)],selected:false,
  request_id:fixture.id(9000),pay_channel_scope:'ALL'};
 const result=mutation.rowSelectionRequest(old,click);
 assert.deepEqual(result,{...Object.fromEntries(Object.entries(request()).filter(([key])=>key!=='action')),
  preview_row_ids:[fixture.id(500)],selected:false,open_ready:{cursor:'ready_position',limit:25}});
 click.preview_row_ids[0]=fixture.id(501);assert.deepEqual(result.preview_row_ids,[fixture.id(500)]);
 assert.ok(Object.isFrozen(result.preview_row_ids));
 assert.throws(()=>mutation.rowSelectionRequest(old,click),/INVALID_RESPONSE/);
 old.ui.surface='main';assert.throws(()=>mutation.rowSelectionRequest(old,{...click,preview_row_ids:[fixture.id(500)]}),/INVALID_RESPONSE/);
});
test('exact row responses preserve original revision advancement and reject a false no-op',async()=>{
 const old=previous(),r=response(old);r.selection_scope='EXACT_READY_ROWS';r.progress_counter_version=5;
 const q={...Object.fromEntries(Object.entries(request()).filter(([key])=>key!=='action')),preview_row_ids:[fixture.id(500)],selected:false};
 const staged=await mutation.reconcileCandidateSelection(old,r,q,()=>{throw Error('UNNECESSARY_READ');});
 assert.equal(staged.summary.progress_counter_version,5);
 assert.equal(staged.summary.rows[1],old.summary.rows[1]);
 assert.throws(()=>mutation.retainedCandidateSummary(old,{...r,state_changed:false},q),/INVALID_RESPONSE/);
 assert.throws(()=>mutation.retainedCandidateSummary(old,{...r,progress_counter_version:3},q),/INVALID_RESPONSE/);
 assert.throws(()=>mutation.retainedCandidateSummary(old,{...r,selection_scope:'FILTERED_READY'},q),/INVALID_RESPONSE/);
});
const request=()=>({session_id:fixture.id(1000),expected_session_version:2,expected_progress_counter_version:3,
 scope_hash:'a'.repeat(64),pay_channel_scope:'ALL',candidate_id:fixture.id(1),action:'CLEAR_ALL_READY',
 request_id:fixture.id(9000),expected_view_digest:'c'.repeat(64)});
function response(before){
 return {ok:true,contract:table.CONTRACT,contract_version:1,session_id:before.summary.session_id,session_version:2,
 progress_counter_version:4,scope_hash:before.summary.scope_hash,request_id:fixture.id(9000),state_changed:true,
 candidate_id:fixture.id(1),candidate_absent:false,candidate:{...before.summary.rows[0],
  child_revision:'current4',facts_digest:'d'.repeat(64),selected_ready_count:0,selection_state:'NONE',
  selected_display_amount:'0.00',selected_timesheet_count:0,selected_timesheet_ids:[]},
 view_digest:'e'.repeat(64),retention:{before_view_digest:before.summary.view_digest,
  other_candidates_unchanged:true,membership_unchanged:true,candidate_sort_unchanged:true,
  amount_sort_unchanged:false,deduction_sort_unchanged:true},
 global:{...before.summary.global,selected_candidate_count:3,selected_ready_count:3,selected_ready_display_amount:'210.00'},
 movements:[],movements_complete:true,movement_count:0,movement_digest:'f'.repeat(64),
 invalidations:{scope:'ALL_PREVIOUS_DETAILS',ready:true,actions:true,updating:true,blocked:true}};
}
test('candidate request copies only current dispatch authority and the already-open Ready anchor',()=>{
 const old=previous(),click=intent();
 assert.deepEqual(mutation.candidateSelectionRequest(old,click),request());
 old.summary={...old.summary,progress_counter_version:8,view_digest:'8'.repeat(64)};
 const next=mutation.candidateSelectionRequest(old,click);
 assert.equal(next.expected_progress_counter_version,8);assert.equal(next.expected_view_digest,'8'.repeat(64));
 old.ui.surface='candidate';old.ready={candidate_id:fixture.id(1),page_anchor:'ready_position',
  session_id:old.summary.session_id,session_version:2,progress_counter_version:8,scope_hash:old.summary.scope_hash};
 assert.deepEqual(mutation.candidateSelectionRequest(old,click).open_ready,{cursor:'ready_position',limit:25});
 old.ready.progress_counter_version=7;
 assert.throws(()=>mutation.candidateSelectionRequest(old,click),/INVALID_RESPONSE/);
});
test('unchanged candidate order keeps all other row objects and opaque anchors without calculation or relabelling',async()=>{
 const old=previous(),reply=response(old),frozen=JSON.stringify(old);let reads=0;
 const next=await mutation.reconcileCandidateSelection(old,reply,request(),async()=>{reads++;throw Error('unexpected read');});
 assert.equal(reads,0);assert.equal(next.summary.rows[0],reply.candidate);
 assert.equal(next.summary.rows[99],old.summary.rows[99]);assert.equal(next.summary.global,reply.global);
 assert.equal(next.summary.rows[99].child_revision,'fixture-revision-3');
 assert.equal(next.summary.next_page_anchor,old.summary.next_page_anchor);assert.equal(next.summary.view_digest,reply.view_digest);
 assert.equal(JSON.stringify(old),frozen);assert.equal(next.actions,null);assert.equal(next.blocked,null);
});
for(const [sort,flag] of [['CANDIDATE','candidate_sort_unchanged'],['DEDUCTIONS','deduction_sort_unchanged'],['READY_TO_PAY','amount_sort_unchanged']])
 test('sort '+sort+' requires exact current-value proof before retaining a page',()=>{
  const old=previous();old.summary.sort_key=sort;const reply=response(old);reply.retention[flag]=true;
  assert.ok(mutation.retainedCandidateSummary(old,reply,request()));
  reply.retention[flag]=false;assert.equal(mutation.retainedCandidateSummary(old,reply,request()),null);
 });
for(const flag of ['other_candidates_unchanged','membership_unchanged'])
 test(flag+' false requires exactly one anchored current summary before adoption',async()=>{
  const old=previous(),reply=response(old);reply.retention[flag]=false;let calls=0;
  const refreshed={...old.summary,progress_counter_version:4,view_digest:reply.view_digest,global:reply.global,
   rows:old.summary.rows.map((r,n)=>n?{...r,child_revision:'current4'}:reply.candidate)};
  const next=await mutation.reconcileCandidateSelection(old,reply,request(),async args=>{
   calls++;assert.equal(args.cursor,old.summary.page_anchor);assert.equal(args.expected_progress_counter_version,4);
   assert.equal(args.limit,100);assert.equal(args.sort_key,'CANDIDATE');return refreshed;
  });
  assert.equal(calls,1);assert.equal(next.summary,refreshed);
 });
test('an off-page selected target can retain an unchanged visible page with full global authority',()=>{
 const old=previous(),reply=response(old),req={...request(),candidate_id:fixture.id(101)};
 reply.candidate={...fixture.candidate(101),facts_digest:'d'.repeat(64)};reply.candidate_id=req.candidate_id;
 const next=mutation.retainedCandidateSummary(old,reply,req);
 assert.equal(next.rows[0],old.summary.rows[0]);assert.equal(next.rows.length,100);assert.equal(next.global,reply.global);
});
for(const [name,change] of Object.entries({
 staleView:p=>p.retention.before_view_digest='0'.repeat(64),missingProof:p=>delete p.retention,
 oldProgress:p=>p.progress_counter_version=3,wrongRequest:p=>p.request_id=fixture.id(11),
 otherSession:p=>p.session_id=fixture.id(22),otherCandidate:p=>p.candidate.candidate_id=fixture.id(23),
 falseMembership:p=>p.global.candidate_count=102,missingCandidate:p=>delete p.candidate,
 futureVersion:p=>p.session_version=3
}))test('retention rejects '+name+' without publishing',()=>{
 const old=previous(),reply=response(old);change(reply);
 assert.throws(()=>mutation.retainedCandidateSummary(old,reply,request()),/INVALID_RESPONSE/);
});
for(const [name,change] of Object.entries({view:p=>p.view_digest='0'.repeat(64),global:p=>p.global={...p.global,selected_ready_display_amount:'211.00'},
 candidate:p=>p.rows[0]={...p.rows[0],facts_digest:'0'.repeat(64)},progress:p=>p.progress_counter_version=3,
 sort:p=>p.sort_direction='DESC'}))test('refreshed summary must match accepted mutation '+name,async()=>{
 const old=previous(),reply=response(old);reply.retention.other_candidates_unchanged=false;
 const page={...old.summary,progress_counter_version:4,view_digest:reply.view_digest,global:reply.global,
  rows:old.summary.rows.map((r,n)=>n?r:reply.candidate)};change(page);
 await assert.rejects(()=>mutation.reconcileCandidateSelection(old,reply,request(),async()=>page),/INVALID_RESPONSE/);
});
test('same candidate content permits only two renewed navigation fields and no added omitted or changed facts',()=>{
 const a=fixture.candidate(8),b={...a,child_revision:'new'};
 assert.equal(table.sameCandidateContent(a,b),true);
 Object.assign(a,{selected_ready_count:1,selection_state:'ALL',selected_timesheet_count:30,
  selected_timesheet_ids:[],selected_timesheet_scope_token:'old_scope'});
 Object.assign(b,a,{child_revision:'new',selected_timesheet_scope_token:'new_scope'});
 assert.equal(table.sameCandidateContent(a,b),true);
 for(const key of Object.keys(a).filter(k=>!['child_revision','selected_timesheet_scope_token'].includes(k))){
  const changed={...b,[key]:Array.isArray(b[key])?['changed']:typeof b[key]==='number'?b[key]+1:
    typeof b[key]==='boolean'?!b[key]:'changed'};
  assert.equal(table.sameCandidateContent(a,changed),false,key);
 }
 assert.equal(table.sameCandidateContent(a,{...b,new_financial_field:'new'}),false);
 const omitted={...b};delete omitted.candidate_sort_name;assert.equal(table.sameCandidateContent(a,omitted),false);
});
for(const [name,change] of Object.entries({truncated:p=>p.rows.pop(),falseLast:p=>{p.has_more=false;p.next_cursor=null;p.next_page_anchor=null;},
 inventedMore:p=>{p.total_count=100;p.global.candidate_count=100;}}))
 test('a100-row main page cannot silently accept '+name,()=>{
  const p=fixture.page();change(p);assert.throws(()=>table.validateSummary(p),/INVALID_RESPONSE/);
 });

test('global request uses complete current scope and never any candidate or child IDs',()=>{
 const old=previous(),globalIntent={...intent(),kind:'global'};delete globalIntent.candidate_id;
 const r=mutation.globalSelectionRequest(old,globalIntent),expected={...request()};delete expected.candidate_id;
 assert.deepEqual(r,expected);old.ui.surface='candidate';
 assert.throws(()=>mutation.globalSelectionRequest(old,globalIntent),/INVALID_RESPONSE/);
});
test('global settlement always adopts one complete current anchored page, never retained old rows',async()=>{
 const old=previous(),r={...request()};delete r.candidate_id;
 const p=response(old);delete p.candidate;delete p.candidate_id;delete p.candidate_absent;delete p.retention;
 Object.assign(p,{selection_scope:'FILTERED_READY',before_view_digest:old.summary.view_digest,requires_summary_refresh:true});
 const refreshed={...old.summary,progress_counter_version:4,view_digest:p.view_digest,global:p.global,
  rows:old.summary.rows.map((row,n)=>n?{...row,child_revision:'current4'}:{...fixture.candidate(1),selectable_ready_count:2,child_revision:'current4'})};
 let reads=0;
 const next=await mutation.reconcileGlobalSelection(old,p,r,async args=>{
  reads++;assert.equal(args.cursor,old.summary.page_anchor);assert.equal(args.limit,100);
  assert.equal(args.expected_progress_counter_version,4);return refreshed;
 });
 assert.equal(reads,1);assert.equal(next.summary,refreshed);assert.notEqual(next.summary.rows[99],old.summary.rows[99]);
 assert.equal(next.ready,null);assert.equal(next.actions,null);assert.equal(next.blocked,null);
 p.requires_summary_refresh=false;
 await assert.rejects(()=>mutation.reconcileGlobalSelection(old,p,r,async()=>refreshed),/INVALID_RESPONSE/);
});

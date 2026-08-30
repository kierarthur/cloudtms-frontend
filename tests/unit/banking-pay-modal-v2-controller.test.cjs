const assert=require('node:assert/strict');
const test=require('node:test');
const fixture=require('../fixtures/banking-pay-v2-table-page.cjs');
const load=()=>require('../../js/banking-pay-modal-v2.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const actionFields=()=>({view:'ACTION_REQUIRED',updating_count:1,updating_has_more:false,updating_next_cursor:null,
  updating:[{identity:'updating_1',issue_state:'UPDATING',title:'Refreshing…',affected_candidate_count:1,
    affected_payment_count:null,affected_payment_count_complete:false}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('queued individual selections capture exact IDs and bind the latest accepted child at dispatch',async()=>{
 const pending=deferred(),calls=[],reconciled=[];
 const s=setup({readPage:async(kind,args)=>{
   const p=ready(fixture.page(),args.candidate_id);
   return {...p,rows:[readyRow(20,args.candidate_id,true),readyRow(21,args.candidate_id,false)]};
  },performMutation:async(intent,authority,request)=>{
   calls.push(request);if(calls.length===1)await pending.promise;
   return {ok:true,request_id:intent.request_id,...authority,progress_counter_version:authority.progress_counter_version+1};
  },reconcileMutation:async({previous,result,rowRequest})=>{
   reconciled.push(rowRequest);return {...previous,summary:{...previous.summary,progress_counter_version:result.progress_counter_version,
    view_digest:String(result.progress_counter_version).repeat(64)},ready:{...previous.ready,progress_counter_version:result.progress_counter_version}};
  }});
 await s.controller.openCandidate(fixture.id(1));
 const first=s.controller.rowIntent({candidate_id:fixture.id(1),preview_row_ids:[fixture.id(20)],selected:false});
 const ids=[fixture.id(21)];const second=s.controller.rowIntent({candidate_id:fixture.id(1),preview_row_ids:ids,selected:true});
 ids[0]=fixture.id(999);pending.resolve();
 assert.equal((await first).state,'ADOPTED');assert.equal((await second).state,'ADOPTED');
 assert.equal(calls.length,2);assert.deepEqual(calls[1].preview_row_ids,[fixture.id(21)]);
 assert.equal(calls[0].expected_progress_counter_version,3);assert.equal(calls[1].expected_progress_counter_version,4);
 assert.equal(calls[1].expected_view_digest,'4'.repeat(64));assert.deepEqual(calls[1].open_ready,{cursor:'current_ready_anchor',limit:25});
 assert.equal(reconciled[0],calls[0]);assert.equal(reconciled[1],calls[1]);s.controller.close();
});
test('queued complete-group selection binds server group identity and never loaded row IDs',async()=>{
 const key=`READY_TO_PAY|${fixture.id(1)}|${fixture.id(201)}`,calls=[],reconciled=[];
 const s=setup({readPage:async(kind,args)=>{const p=ready(fixture.page(),args.candidate_id);
   Object.assign(p.rows[0],{selection_group_kind:'TIMESHEET',selection_group_key:key,selection_group_member_count:107,
    selection_group_selected_count:50,selection_group_state:'SOME',selection_group_display_amount:'1070.00',
    selection_group_selected_display_amount:'500.00'});return p;},
  performMutation:async(intent,authority,request)=>{calls.push(request);return {ok:true,request_id:intent.request_id,...authority,
    progress_counter_version:authority.progress_counter_version+1};},
  reconcileMutation:async({previous,result,groupRequest})=>{reconciled.push(groupRequest);return {...previous,
    summary:{...previous.summary,progress_counter_version:result.progress_counter_version,view_digest:'4'.repeat(64)},
    ready:{...previous.ready,progress_counter_version:result.progress_counter_version}};}});
 await s.controller.openCandidate(fixture.id(1));
 assert.equal((await s.controller.groupIntent({candidate_id:fixture.id(1),group_kind:'TIMESHEET',group_key:key,selected:true})).state,'ADOPTED');
 assert.equal(calls.length,1);assert.equal(calls[0].group_key,key);assert.equal(calls[0].group_kind,'TIMESHEET');
 assert.equal(Object.hasOwn(calls[0],'preview_row_ids'),false);assert.deepEqual(calls[0].open_ready,{cursor:'current_ready_anchor',limit:25});
 assert.equal(reconciled[0],calls[0]);s.controller.close();
});
function readyRow(n,candidateId=fixture.id(1),selected=n===20){return {identity:fixture.id(n),candidate_id:candidateId,
  effective_section:'canonical_preview_lines',selected,selection_group_kind:null,selection_group_key:null,
  selection_group_member_count:0,selection_group_selected_count:0,selection_group_state:null,
  selection_group_display_amount:null,selection_group_selected_display_amount:null};}
function ready(summary,candidateId=fixture.id(1)){
  return {ok:true,contract:summary.contract,contract_version:1,session_id:summary.session_id,
    session_version:summary.session_version,progress_counter_version:summary.progress_counter_version,scope_hash:summary.scope_hash,
    candidate_id:candidateId,candidate:summary.rows.find(row=>row.candidate_id===candidateId),
    rows:[20,21].map(n=>readyRow(n,candidateId)),
    total_count:2,has_more:false,next_cursor:null,page_number:1,has_previous:false,previous_cursor:null,page_anchor:'current_ready_anchor'};
}
function setup(overrides={}){
  const reads=[],writes=[],commits=[],failures=[],opened=[],statuses=[];
  let nextRequest=0;
  const options={initial:{summary:fixture.page()},payChannelScope:'ALL',newRequestId:()=>fixture.id(9000+(++nextRequest)),
    allowedLegacyActions:['banking:pay:togglePreviewRow'],
    readPage:async(kind,args)=>{reads.push({kind,args});return kind==='summary'?{...fixture.page(),sort_key:args.sort_key,sort_direction:args.sort_direction}
      :kind==='ready'?ready(fixture.page(),args.candidate_id):null;},
    performMutation:async(intent,authority)=>{writes.push({intent,authority});return {ok:true,request_id:intent.request_id,
      ...authority,progress_counter_version:authority.progress_counter_version+1};},
    reconcileMutation:async({previous,result})=>({summary:{...previous.summary,progress_counter_version:result.progress_counter_version}}),
    readBack:async({previous})=>({summary:{...previous.summary,progress_counter_version:previous.summary.progress_counter_version+1}}),
    prepareAdoption:(next,previous,{draftReview})=>()=>commits.push({next,previous,draftReview}),
    onStatus:value=>statuses.push(value),onFailure:value=>failures.push(value),openTimesheets:ids=>opened.push(ids),...overrides};
  return {options,reads,writes,commits,failures,opened,statuses,controller:load().createController(options)};
}

test('first open requests exactly one server summary with no invented scope hash',async()=>{
  const s=setup();const calls=[];
  const controller=await load().openController({...s.options,initial:undefined,
    session:{session_id:fixture.id(1000),session_version:2,progress_counter_version:3},
    readPage:async(kind,args)=>{calls.push({kind,args});return fixture.page();}});
  assert.equal(calls.length,1);assert.equal(calls[0].kind,'summary');
  assert.equal('scope_hash' in calls[0].args,false);assert.equal('cursor' in calls[0].args,false);
  assert.equal(calls[0].args.pay_channel_scope,'ALL');controller.close();
});
test('initial and later adoption hand the exact incomplete Draft review to the same synchronous commit',async()=>{
  const s=setup();await s.controller.sort({sort_key:'READY_TO_PAY',sort_direction:'DESC'});
  assert.equal(s.commits.length,2);
  for(const {next,draftReview} of s.commits){
    assert.equal(draftReview.progress_counter_version,next.summary.progress_counter_version);
    assert.deepEqual(draftReview.selected_preview_row_ids,[]);assert.equal(draftReview.selected_set_complete,false);
    assert.equal(draftReview.captured_from_rendered_workbench,true);assert.ok(Object.isFrozen(draftReview));
  }
  assert.equal(s.reads[0].args.cursor,null);assert.equal(s.reads[0].args.sort_key,'READY_TO_PAY');
});
test('main Next and Previous use only returned directed server anchors',async()=>{
  const s=setup();
  await s.controller.mainPage('next');assert.equal(s.reads[0].args.cursor,'fixture_next_anchor');
  const before=s.reads.length;assert.equal((await s.controller.mainPage('previous')).state,'NO_CHANGE');
  assert.equal(s.reads.length,before);
});

test('main Previous passes the server anchor unchanged and keeps the current request revision',async()=>{
  const page=fixture.page();Object.assign(page,{rows:[fixture.candidate(101)],has_more:false,next_cursor:null,
    page_number:2,has_previous:true,page_anchor:'current_second',next_page_anchor:null,previous_page_anchor:'exact_previous_anchor'});
  const s=setup({initial:{summary:page}});await s.controller.mainPage('previous');
  assert.equal(s.reads.length,1);assert.equal(s.reads[0].args.cursor,'exact_previous_anchor');
  assert.equal(s.reads[0].args.expected_progress_counter_version,page.progress_counter_version);
});
test('main sort rejects invented columns and search before a request',()=>{
  const s=setup();
  assert.throws(()=>s.controller.sort({sort_key:'GROSS',sort_direction:'ASC'}));
  assert.throws(()=>s.controller.sort({sort_key:'CANDIDATE',sort_direction:'ASC',search:'x'}));
  assert.equal(s.reads.length,0);
});
test('Candidate Banking open is one scoped Ready read; close preserves the same main page',async()=>{
  const s=setup(),before=s.controller.snapshot().summary;
  await s.controller.openCandidate(fixture.id(1));
  assert.equal(s.reads.length,1);assert.equal(s.reads[0].kind,'ready');
  assert.equal(s.reads[0].args.candidate_id,fixture.id(1));assert.equal(s.controller.snapshot().ready.candidate_id,fixture.id(1));
  assert.equal(s.reads[0].args.limit,25);
  await s.controller.closeCandidate();assert.equal(s.reads.length,1);
  assert.equal(s.controller.snapshot().summary,before);assert.equal(s.controller.snapshot().ready,null);
});
test('a Ready response for a different candidate cannot publish',async()=>{
  const s=setup({readPage:async()=>ready(fixture.page(),fixture.id(2))});
  assert.equal((await s.controller.openCandidate(fixture.id(1))).state,'FAILED_VISIBLE');
  assert.equal(s.commits.length,1);assert.equal(s.failures.length,1);
});

for(const [name,change] of Object.entries({
 falseEmpty:p=>p.rows=[], truncated:p=>p.rows.pop(), missingPageNumber:p=>delete p.page_number,
 wrongPrevious:p=>p.has_previous=true, missingPrevious:p=>delete p.has_previous,
 missingPreviousCursor:p=>delete p.previous_cursor, unexpectedPreviousCursor:p=>p.previous_cursor='old',
 missingAnchor:p=>delete p.page_anchor, invalidAnchor:p=>p.page_anchor='../invalid',
 duplicate:p=>p.rows[1]=p.rows[0], missingIdentity:p=>delete p.rows[0].identity,
 truncatedLater:p=>{p.page_number=2;p.has_previous=true;p.total_count=105;},
 firstReadReturnsLater:p=>{p.page_number=2;p.has_previous=true;p.total_count=102;},
 oversizedUtf8:p=>p.rows[0].breakdown_note='£'.repeat(262145)
}))test('candidate open retains accepted view on invalid Ready '+name,async()=>{
 const s=setup({readPage:async()=>{const p=ready(fixture.page());change(p);return p;}});
 const before=s.controller.snapshot();assert.equal((await s.controller.openCandidate(fixture.id(1))).state,'FAILED_VISIBLE');
 assert.equal(s.commits.length,1);assert.equal(s.controller.snapshot(),before);s.controller.close();
});
test('inline Timesheets come only from the currently accepted selected row',async()=>{
  const s=setup();await s.controller.viewSelectedTimesheets(fixture.id(1));
  assert.deepEqual(s.opened,[[fixture.id(2001)]]);assert.equal(s.reads.length,0);
  await s.controller.viewSelectedTimesheets(fixture.id(4));assert.equal(s.opened.length,1);
});
test('off-page or absent candidate cannot trigger broad Timesheet lookup',async()=>{
  const s=setup();await s.controller.viewSelectedTimesheets(fixture.id(999));
  assert.equal(s.opened.length,0);assert.equal(s.reads.length,0);
});
test('large selected Timesheet scope resolves once and never opens a partial response',async()=>{
  const page=fixture.page();Object.assign(page.rows[0],{selected_timesheet_count:30,selected_timesheet_ids:[],
    selected_timesheet_scope_token:'exact_selected_scope'});
  const calls=[];const s=setup({initial:{summary:page},readPage:async(kind,args)=>{
    calls.push({kind,args});return {...page,candidate_id:fixture.id(1),timesheet_count:29,
      timesheet_ids:Array.from({length:29},(_,i)=>fixture.id(5000+i))};}});
  assert.equal((await s.controller.viewSelectedTimesheets(fixture.id(1))).state,'FAILED_VISIBLE');
  assert.equal(calls.length,1);assert.equal(calls[0].kind,'timesheets');
  assert.equal(calls[0].args.scope_token,'exact_selected_scope');assert.equal(s.opened.length,0);
});
test('a Timesheet response after a mutation starts cannot open stale IDs',async()=>{
  const pending=deferred(),page=fixture.page();Object.assign(page.rows[0],{selected_timesheet_count:30,
    selected_timesheet_ids:[],selected_timesheet_scope_token:'exact_selected_scope'});
  const s=setup({initial:{summary:page},readPage:()=>pending.promise});
  const shortcut=s.controller.viewSelectedTimesheets(fixture.id(1));
  await s.controller.candidateIntent({candidate_id:fixture.id(1),action:'CLEAR_ALL_READY'});
  pending.resolve({...page,candidate_id:fixture.id(1),timesheet_count:30,timesheet_ids:Array.from({length:30},(_,i)=>fixture.id(5000+i))});
  assert.equal((await shortcut).state,'SUPERSEDED');assert.equal(s.opened.length,0);
});
test('candidate and legacy mutations use the same queue and latest accepted revision',async()=>{
  const s=setup();const first=s.controller.candidateIntent({candidate_id:fixture.id(1),action:'SELECT_ALL_READY'});
  const second=s.controller.legacyIntent({action:'banking:pay:togglePreviewRow',payload:{preview_row_id:fixture.id(20),selected:false}});
  await Promise.all([first,second]);assert.equal(s.writes.length,2);
  assert.deepEqual(s.writes.map(value=>value.authority.progress_counter_version),[3,4]);
  assert.equal(s.controller.snapshot().summary.progress_counter_version,5);
  assert.equal(s.controller.mayUseLegacyFallback(),false);
});
test('transport uncertainty reads current authority without repeating the mutation',async()=>{
  let writes=0,readbacks=0;
  const s=setup({performMutation:async()=>{writes++;throw new Error('lost response');},
    readBack:async({previous})=>{readbacks++;return {summary:{...previous.summary,progress_counter_version:4}};}});
  const outcome=await s.controller.candidateIntent({candidate_id:fixture.id(1),action:'CLEAR_ALL_READY'});
  assert.equal(outcome.state,'ADOPTED');assert.equal(writes,1);assert.equal(readbacks,1);
});
test('later navigation wins and closing suppresses pending publication',async()=>{
  const pending=deferred();const s=setup({readPage:()=>pending.promise});
  const open=s.controller.openCandidate(fixture.id(1));s.controller.close();pending.resolve(ready(fixture.page()));
  assert.equal((await open).state,'CLOSED');assert.equal(s.commits.length,1);
});
test('malformed mutation intents never reach an existing action adapter',()=>{
  const s=setup();
  assert.throws(()=>s.controller.candidateIntent({candidate_id:'not-id',action:'SELECT_ALL_READY'}));
  assert.throws(()=>s.controller.candidateIntent({candidate_id:fixture.id(1),action:'TOGGLE'}));
  assert.throws(()=>s.controller.globalIntent({action:'TOGGLE'}));
  assert.throws(()=>s.controller.legacyIntent({action:'delete everything',payload:{}}));
  assert.equal(s.writes.length,0);
});
test('Action-only search does not enter main filters, summary or Draft state',async()=>{
  const page=fixture.page(),requests=[];
  const s=setup({readPage:async(kind,args)=>{requests.push({kind,args});return {...page,rows:[],total_count:0,
    has_more:false,next_cursor:null,page_number:0,has_previous:false,previous_cursor:null,search:args.search,sort_key:args.sort_key,sort_direction:args.sort_direction,
    scope_count:2,...actionFields()};}});
  await s.controller.openIssues('actions',{search:'umbrella',sort_key:'PAYMENTS',sort_direction:'DESC'});
  assert.equal(requests.length,1);assert.equal(requests[0].kind,'actions');assert.equal(requests[0].args.search,'umbrella');
  assert.equal(s.controller.snapshot().summary.scope_hash,'a'.repeat(64));assert.equal('search' in s.controller.snapshot().summary,false);
  assert.equal(s.commits.at(-1).draftReview.selected_set_complete,false);
});
test('Updating is an explicit separate read and Back restores Action search and sort without changing Draft',async()=>{
 const summary=fixture.page(),reads=[];
 const s=setup({readPage:async(kind,args)=>{
  reads.push({kind,args});
  const updating=args.view==='UPDATING',fields=actionFields();
  return {...summary,...fields,view:args.view,search:args.search,sort_key:args.sort_key,sort_direction:args.sort_direction,
   rows:updating?fields.updating:[],total_count:updating?1:0,scope_count:updating?1:2,
   has_more:false,next_cursor:null,page_number:updating?1:0,has_previous:false,previous_cursor:null};
 }});
 const originalDraft=s.commits[0].draftReview;
 assert.equal((await s.controller.openIssues('actions',{search:'umbrella',sort_key:'PAYMENTS',sort_direction:'DESC'})).state,'ADOPTED');
 assert.equal((await s.controller.openUpdating()).state,'ADOPTED');
 assert.equal(reads.length,2);assert.equal(reads[1].kind,'actions');assert.equal(reads[1].args.view,'UPDATING');
 assert.equal(reads[1].args.search,'');assert.equal(reads[1].args.sort_key,'TITLE');assert.equal(reads[1].args.sort_direction,'ASC');
 assert.equal(s.controller.snapshot().actions.view,'UPDATING');
 assert.equal((await s.controller.closeUpdating()).state,'ADOPTED');
 assert.equal(reads.length,3);assert.equal(reads[2].args.view,'ACTION_REQUIRED');assert.equal(reads[2].args.search,'umbrella');
 assert.equal(reads[2].args.sort_key,'PAYMENTS');assert.equal(reads[2].args.sort_direction,'DESC');
 assert.deepEqual(s.commits.at(-1).draftReview,originalDraft);assert.equal(s.writes.length,0);
 s.controller.closeIssues();assert.equal(s.controller.snapshot().ui.action_return,null);
 assert.equal((await s.controller.openUpdating()).state,'ADOPTED');
 s.controller.closeUpdating();assert.equal(s.controller.snapshot().ui.surface,'main');assert.equal(reads.length,4);
});
test('Updating continuation and detail use exact current task identity; failure keeps the accepted page',async()=>{
 const summary=fixture.page();summary.global.updating_count=105;
 const items=Array.from({length:105},(_,n)=>({...actionFields().updating[0],identity:'updating_'+n}));let broken=false;
 const s=setup({initial:{summary},readPage:async(kind,args)=>{
  if(kind==='actionDetail'){
   const v=require('../fixtures/banking-pay-v2-issue-detail-page.cjs').fixture('actions',1,1).page;
   Object.assign(v,Object.fromEntries(fieldsForTest.map(k=>[k,summary[k]])),{task_key:args.identity});return v;
  }
  return {...summary,view:'UPDATING',search:'',sort_key:'TITLE',sort_direction:'ASC',
   total_count:105,scope_count:105,page_number:args.cursor?2:1,has_previous:Boolean(args.cursor),previous_cursor:null,
   has_more:!args.cursor,next_cursor:args.cursor?null:'exact_updating_next',
   rows:broken?[]:args.cursor?items.slice(100):items.slice(0,100),updating_count:105,updating:items.slice(0,100),
   updating_has_more:true,updating_next_cursor:'exact_updating_next'};
 }});
 assert.equal((await s.controller.openUpdating()).state,'ADOPTED');
 assert.equal((await s.controller.openUpdating('exact_updating_next')).state,'ADOPTED');
 assert.equal(s.controller.snapshot().actions.rows.length,5);
 assert.equal((await s.controller.openIssueDetail('actions','updating_104')).state,'ADOPTED');
 s.controller.closeIssueDetail('actions');const accepted=s.controller.snapshot();broken=true;
 assert.equal((await s.controller.openUpdating('exact_updating_next')).state,'FAILED_VISIBLE');
 assert.equal(s.controller.snapshot(),accepted);assert.equal(s.writes.length,0);
});
const fieldsForTest=['session_id','session_version','progress_counter_version','scope_hash'];

test('task detail is adopted only as a complete bounded page; malformed continuation preserves the accepted page',async()=>{
  const {fixture:detailFixture}=require('../fixtures/banking-pay-v2-issue-detail-page.cjs');
  const detail=detailFixture('actions').page;
  const summary=fixture.page();let broken=false;
  const authority=Object.fromEntries(['session_id','session_version','progress_counter_version','scope_hash'].map(k=>[k,summary[k]]));
  Object.assign(detail,authority);
  const s=setup({readPage:async(kind,args)=>kind==='actions'?{...summary,rows:[{identity:'current_issue',issue_state:'ACTION_REQUIRED',title:'Bank account review',
    affected_candidate_count:1,affected_payment_count:105,affected_payment_count_complete:true},
    {identity:'second_issue',issue_state:'ACTION_REQUIRED',title:'Rate decision required',affected_candidate_count:1,affected_payment_count:1,affected_payment_count_complete:true}],total_count:2,scope_count:2,
    has_more:false,next_cursor:null,search:args.search,sort_key:args.sort_key,sort_direction:args.sort_direction,...actionFields()}
    :broken?{...detail,rows:[]}:detail});
  assert.equal((await s.controller.openIssues('actions')).state,'ADOPTED');
  assert.equal((await s.controller.openIssueDetail('actions','current_issue')).state,'ADOPTED');
  assert.equal(s.controller.snapshot().actionDetail.rows.length,100);
  const accepted=s.controller.snapshot().actionDetail;broken=true;
  assert.equal((await s.controller.openIssueDetail('actions','current_issue','next_detail')).state,'FAILED_VISIBLE');
  assert.equal(s.controller.snapshot().actionDetail,accepted);assert.equal(s.writes.length,0);
});
test('a truncated issue-list refresh cannot replace the complete accepted list or its Draft review',async()=>{
 const summary=fixture.page();let truncate=false;
 const s=setup({readPage:async(kind,args)=>({...summary,
  rows:[{identity:'task_1',issue_state:'ACTION_REQUIRED',title:'Rate decision required',affected_candidate_count:1,affected_payment_count:1,affected_payment_count_complete:true},
    ...(!truncate?[{identity:'task_2',issue_state:'ACTION_REQUIRED',title:'Amount decision required',affected_candidate_count:1,affected_payment_count:1,affected_payment_count_complete:true}]:[])],
  total_count:2,scope_count:2,has_more:false,next_cursor:null,page_number:1,has_previous:false,previous_cursor:null,
  search:args.search,sort_key:args.sort_key,sort_direction:args.sort_direction,...actionFields()})});
 assert.equal((await s.controller.openIssues('actions')).state,'ADOPTED');
 const accepted=s.controller.snapshot(),commits=s.commits.length;truncate=true;
 assert.equal((await s.controller.openIssues('actions')).state,'FAILED_VISIBLE');
 assert.equal(s.controller.snapshot(),accepted);assert.equal(s.commits.length,commits);assert.equal(s.writes.length,0);
});
test('an adoption preparation failure never commits the new Draft review',async()=>{
  const s=setup();let prepared=0,committed=0;
  const controller=load().createController({...s.options,prepareAdoption:()=>{prepared++;if(prepared===2)throw new Error('render failed');
    return ()=>committed++;}});
  await controller.sort({sort_key:'DEDUCTIONS',sort_direction:'ASC'});
  assert.equal(committed,1);assert.equal(controller.snapshot().summary.sort_key,'CANDIDATE');
});

test('closing Candidate Banking during a mutation dismisses only the view and cannot reopen it',async()=>{
  const pending=deferred();
  const s=setup({performMutation:async(intent,authority)=>{const result=await pending.promise;return {...result,...authority,
    progress_counter_version:4,request_id:intent.request_id};},
    reconcileMutation:async({previous,result})=>({...previous,summary:{...previous.summary,progress_counter_version:result.progress_counter_version}})});
  await s.controller.openCandidate(fixture.id(1));
  const mutation=s.controller.candidateIntent({candidate_id:fixture.id(1),action:'CLEAR_ALL_READY'});
  assert.equal((await s.controller.closeCandidate()).state,'ADOPTED');
  assert.equal(s.controller.snapshot().ready,null);assert.equal(s.controller.isBusy(),true);
  pending.resolve({ok:true});assert.equal((await mutation).state,'ADOPTED');
  assert.equal(s.controller.snapshot().ready,null);assert.equal(s.controller.snapshot().summary.progress_counter_version,4);
});
test('closing a child during failed read-back does not clear the fail-closed state',async()=>{
  const s=setup({performMutation:async()=>{throw new Error('lost');},readBack:async()=>{throw new Error('offline');}});
  await s.controller.openCandidate(fixture.id(1));
  assert.equal((await s.controller.candidateIntent({candidate_id:fixture.id(1),action:'CLEAR_ALL_READY'})).state,'FAILED_VISIBLE');
  await s.controller.closeCandidate();
  assert.equal(s.controller.snapshot().ready,null);assert.equal(s.controller.isBusy(),true);
  assert.equal(s.controller.mayUseLegacyFallback(),false);
});
test('queued legacy payload is captured before the caller can change it',async()=>{
  const pending=deferred(),calls=[];
  const s=setup({performMutation:async(intent,authority)=>{calls.push(intent);if(calls.length===1)await pending.promise;
    return {ok:true,request_id:intent.request_id,...authority,progress_counter_version:authority.progress_counter_version+1};}});
  const first=s.controller.candidateIntent({candidate_id:fixture.id(1),action:'SELECT_ALL_READY'});
  const payload={preview_row_id:fixture.id(20),selected:false,nested:{reason:'original'}};
  const second=s.controller.legacyIntent({action:'banking:pay:togglePreviewRow',payload});
  payload.selected=true;payload.nested.reason='changed later';pending.resolve();await Promise.all([first,second]);
  assert.equal(calls[1].payload.selected,false);assert.equal(calls[1].payload.nested.reason,'original');
});

test('queued candidate requests bind the accepted view at dispatch, not the earlier click',async()=>{
  const pending=deferred(),calls=[],reconciled=[];
  const s=setup({performMutation:async(intent,authority,request)=>{
    calls.push(request);if(calls.length===1)await pending.promise;
    return {ok:true,request_id:intent.request_id,...authority,progress_counter_version:authority.progress_counter_version+1};
  },reconcileMutation:async({previous,result,candidateRequest})=>{
    reconciled.push(candidateRequest);
    return {...previous,summary:{...previous.summary,progress_counter_version:result.progress_counter_version,
      view_digest:String(result.progress_counter_version).repeat(64)}};
  }});
  const one=s.controller.candidateIntent({candidate_id:fixture.id(1),action:'CLEAR_ALL_READY'});
  const two=s.controller.candidateIntent({candidate_id:fixture.id(2),action:'SELECT_ALL_READY'});
  pending.resolve();assert.equal((await one).state,'ADOPTED');assert.equal((await two).state,'ADOPTED');
  assert.equal(calls[0].expected_view_digest,'c'.repeat(64));assert.equal(calls[1].expected_view_digest,'4'.repeat(64));
  assert.equal(calls[1].expected_progress_counter_version,4);assert.equal(reconciled[0],calls[0]);assert.equal(reconciled[1],calls[1]);
});

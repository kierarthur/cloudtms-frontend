const assert = require('node:assert/strict');
const test = require('node:test');
const { install, clone, ownerHash } = require('../fixtures/banking-pay-draft-owner-harness.cjs');
const { id, page: summaryFixture } = require('../fixtures/banking-pay-v2-table-page.cjs');
const { selectionReviewSnapshot } = require('../../js/banking-pay-modal-v2-draft-review.js');
const SESSION=id(1000), CANDIDATE=id(2000), CLIENT=id(3000), VERSION=2, PROGRESS=3;

function payment(index, patch={}) {
  return { id:id(10000+index), preview_row_id:id(10000+index), candidate_id:CANDIDATE, client_id:CLIENT,
    timesheet_id:id(20000+index), row_key:`fixture-payment-${index}`, line_id:`fixture-line-${index}`,
    key_type:'TS_DAY', key_value:'2026-08-23', pay_channel:'PAYE', section:'canonical_preview_lines',
    presentation_section:'READY_TO_PAY', selection_state:'SELECTED', selected:true, status:'READY',
    draftable:true, is_ready_for_draft:true, is_excluded_from_allocation:false,
    amount_ex_vat:'10.00', preview_contract:{ok:true,selection_allowed:true}, ...patch };
}
function recovery(index, patch={}) {
  const row=payment(index,{section:'blocked_for_pay',amount_ex_vat:'-1.00',line_type:'LOAN_REPAYMENT',
    preview_contract:{ok:true,selection_allowed:false}, ...patch});
  row.row_json={selection_allowed:true,selection_recovery_headroom_v1:{contract_version:1,candidate_id:row.candidate_id,
    pay_channel:row.pay_channel,physical_section:'blocked_for_pay',effective_section:'canonical_preview_lines',
    selected_positive_headroom_ex_vat:10,nominal_due_amount_ex_vat:15,recoverable_amount_ex_vat:1,
    static_recovery_eligible:true,overlay_digest:'a'.repeat(32),policy_x_authority_scope:'PRE_DRAFT_LIVE_TRUTH'}};
  return row;
}
function setup(rows,{mode='v2',progress=PROGRESS,version=VERSION,candidateFilter='',clientFilter='',transformPage}={}) {
  const selected=rows.filter(row=>row.selected).map(row=>row.preview_row_id);
  const wizard={workbench:{session_id:SESSION,session_version:VERSION,progress_counter_version:PROGRESS},decisions:{},
    preview:{first_page_applied:true,data:{session_id:SESSION,session_version:VERSION}}};
  const calls=[];
  const readPage=async (session,section,options)=>{
    assert.equal(session,SESSION);assert.equal(options.limit,100);assert.equal(options.force_current,true);
    assert.equal(options.bypass_cache,true);calls.push({section,cursor:options.cursor});
    const all=rows.filter(row=>row.section===section),offset=options.cursor?.offset||0;
    const chunk=clone(all.slice(offset,offset+options.limit));
    const more=offset+options.limit<all.length;
    const result={ok:true,session_id:SESSION,session_version:version,progress_counter_version:progress,
      session_signature:'synthetic-session-signature',section,resolved_section:section,rows:chunk,
      known_count:all.length,returned_count:chunk.length,has_more:more,next_cursor:more?{offset:offset+100}:null};
    return transformPage?transformPage(result,calls.length):result;
  };
  const api=install({wizard,readPage,candidateFilter,clientFilter});
  const snapshot=mode==='legacy'?{session_id:SESSION,session_version:VERSION,progress_counter_version:PROGRESS,
    selected_preview_row_ids:selected,selected_set_complete:true,captured_from_rendered_workbench:true}
    :selectionReviewSnapshot(summaryFixture());
  return {api,wizard,snapshot,calls,refresh:scope=>api.refresh(SESSION,snapshot.selected_preview_row_ids,'IMPLICIT_ALL',scope||'ALL',VERSION,snapshot)};
}
function comparable(result) {
  const value=clone(result);delete value.previous_selected_preview_row_ids;
  return value;
}

test('the existing complete Create Draft owner is unchanged by the redesign',()=>{
  assert.equal(ownerHash,'44769a01d72b56afc4e498a3a2c934f74c3e0971cf9f4975fa7f485543f997ab');
});
test('a candidate page produces a revision-bound incomplete review, never a fake complete payment list',()=>{
  const summary=summaryFixture(),before=clone(summary),review=selectionReviewSnapshot(summary);
  assert.deepEqual(summary,before);assert.equal(review.session_id,SESSION);
  assert.equal(review.progress_counter_version,PROGRESS);assert.equal(review.selected_set_complete,false);
  assert.deepEqual(review.selected_preview_row_ids,[]);assert.equal(review.captured_from_rendered_workbench,true);
  assert.ok(Object.isFrozen(review));assert.ok(Object.isFrozen(review.selected_preview_row_ids));
  for(const key of ['rows','candidate_ids','amount','selected_ready_display_amount','scope_hash']) assert.equal(key in review,false);
});
for(const bad of [value=>delete value.progress_counter_version,value=>value.progress_counter_version=-1,
  value=>value.progress_counter_version='3',value=>value.session_id='',value=>value.ok=false]) {
  test(`invalid summary cannot become Draft review authority: ${bad.toString()}`,()=>{
    const summary=summaryFixture();bad(summary);assert.throws(()=>selectionReviewSnapshot(summary));
  });
}
for(const [name,rows] of [
  ['one selected payment',[payment(1)]],
  ['some payments selected',[payment(1),payment(2,{selected:false,selection_state:'UNSELECTED'})]],
  ['105 selected payments across pages',Array.from({length:105},(_,i)=>payment(i+1))],
  ['promoted deduction stored in Blocked',[payment(1),recovery(2)]],
  ['unticked deduction ignored',[payment(1),recovery(2,{selected:false,selection_state:'UNSELECTED'})]],
  ['another candidate and pay channel',[payment(1),payment(2,{candidate_id:id(2001),pay_channel:'UMBRELLA'})]],
  ['separate expense and adjustment identities',[payment(1),payment(2,{key_type:'EXPENSE_CODE',key_value:'TRAVEL'}),
    payment(3,{key_type:'ADJUSTMENT_CODE',key_value:'FIXTURE_ADJUSTMENT'})]]
]) {
  test(`unchanged Draft recheck and request projection match legacy: ${name}`,async()=>{
    const legacy=setup(rows,{mode:'legacy'}),v2=setup(rows);
    const oldResult=await legacy.refresh(),newResult=await v2.refresh();
    assert.equal(oldResult.ok,true);assert.equal(newResult.ok,true);
    assert.deepEqual(comparable(newResult),comparable(oldResult));
    assert.deepEqual(clone(v2.api.projectRequest(newResult,'ALL')),clone(legacy.api.projectRequest(oldResult,'ALL')));
    assert.deepEqual(v2.calls,legacy.calls);
    assert.equal(newResult.selected_preview_row_ids.length,rows.filter(row=>row.selected).length);
    assert.equal(v2.wizard.workbench.server_selected_preview_row_ids_provided,true);
    assert.deepEqual(clone(v2.wizard.workbench.server_selected_preview_row_ids),clone(newResult.selected_preview_row_ids));
    assert.equal(v2.calls.at(-1).section,'blocked_for_pay');
  });
}
for(const scope of ['ALL','PAYE','UMBRELLA']) {
  test(`global reviewed selection is preserved while Draft subset uses ${scope}`,async()=>{
    const rows=[payment(1),payment(2,{pay_channel:'UMBRELLA'}),recovery(3)];
    const env=setup(rows),result=await env.refresh(scope),body=env.api.projectRequest(result,scope).request;
    assert.equal(result.ok,true);assert.equal(body.selected_preview_row_ids.length,3);
    assert.deepEqual(clone(body.selected_preview_row_ids),rows.map(row=>row.id));
    assert.equal(body.draft_selected_preview_row_ids.length,scope==='ALL'?3:scope==='PAYE'?2:1);
    assert.equal(body.selected_preview_row_contracts.length,3);assert.equal(body.selected_economic_keys.length,3);
    for(const contract of body.draft_selected_preview_row_contracts){
      assert.ok(scope==='ALL'||contract.pay_channel===scope);
      assert.equal(contract.policy_x_authority_scope,'PRE_DRAFT_LIVE_TRUTH');
      assert.equal(contract.key_type,'TS_DAY');assert.equal(contract.key_value,'2026-08-23');
    }
    assert.equal(body.preview_decisions_json.scope_counts.selected_ready_for_scope,body.draft_selected_preview_row_ids.length);
  });
}
for(const [name,options] of [['candidate',{candidateFilter:CANDIDATE}],['client',{clientFilter:CLIENT}],
  ['candidate and client',{candidateFilter:CANDIDATE,clientFilter:CLIENT}]]) {
  test(`existing ${name} filters keep the whole reviewed set but scope actual Draft membership`,async()=>{
    const rows=[payment(1),payment(2,{candidate_id:id(2001),client_id:id(3001)})];
    const env=setup(rows,options),result=await env.refresh(),body=env.api.projectRequest(result,'ALL').request;
    assert.equal(result.ok,true);assert.equal(body.selected_preview_row_ids.length,2);
    assert.deepEqual(clone(body.draft_selected_preview_row_ids),[rows[0].id]);
  });
}
test('none selected remains a no-Draft result, not an implicit selection of all candidates',async()=>{
  const env=setup([payment(1,{selected:false,selection_state:'UNSELECTED'})]);
  const result=await env.refresh();assert.equal(result.ok,false);assert.equal(result.code,'BANKING_PAY_CREATE_DRAFT_NO_ROWS_FOR_SCOPE');
});
test('promoted recovery keeps its signed amount, physical section and certificate in the existing Draft contract',async()=>{
  const env=setup([payment(1),recovery(2)]),result=await env.refresh();
  const contract=result.selected_preview_row_contracts[1];
  assert.equal(contract.amount_ex_vat,-1);assert.equal(contract.section,'canonical_preview_lines');
  assert.equal(contract.physical_section,'blocked_for_pay');
  assert.equal(contract.selection_recovery_headroom_overlay_digest,'a'.repeat(32));
});
test('request projection still strips displayed rows, case state and resolution mutations',async()=>{
  const env=setup([payment(1)]),result=await env.refresh();
  const body=env.api.projectRequest(result,'ALL',{case_resolutions:{unexpected:true},component_resolutions:{unexpected:true},
    ready_to_pay_now:[{candidate_id:CANDIDATE}],blocked_for_pay:[],case_resolution_states:[],candidate_rows:[{candidate_id:CANDIDATE}],
    selected_ready_display_amount:'999.99'}).request;
  for(const key of ['case_resolutions','component_resolutions','ready_to_pay_now','blocked_for_pay','case_resolution_states',
    'candidate_rows','selected_ready_display_amount']) assert.equal(key in body.preview_decisions_json,false);
});
for(const progress of [4,undefined]) {
  test(`bounded review rejects changed or missing progress authority: ${progress}`,async()=>{
    const env=setup([payment(1)],{transformPage:page=>({...page,progress_counter_version:progress})});
    const result=await env.refresh();assert.equal(result.ok,false);
    assert.equal(result.code,'WORKBENCH_SELECTION_CHANGED_REVIEW_REQUIRED');
    assert.equal(result.no_operation_started,true);assert.equal(result.no_batch_created,true);
  });
}
for(const [name,transformPage,code] of [
  ['wrong session',page=>({...page,session_id:id(9999)}),'BANKING_PAY_CURRENT_SELECTION_SESSION_MISMATCH'],
  ['wrong version',page=>({...page,session_version:3}),'BANKING_PAY_CURRENT_SELECTION_SESSION_VERSION_CHANGED'],
  ['wrong section',page=>({...page,resolved_section:'cases_resolutions'}),'BANKING_PAY_CURRENT_SELECTION_SECTION_MISMATCH'],
  ['missing continuation',page=>({...page,has_more:true,next_cursor:null}),'BANKING_PAY_CURRENT_SELECTION_NEXT_CURSOR_MISSING']
]) test(`the existing pre-submit rejection remains: ${name}`,async()=>{
  const result=await setup([payment(1)],{transformPage}).refresh();assert.equal(result.ok,false);assert.equal(result.error_code,code);
});
test('a first page is still required; a candidate summary cannot invent its approval flag',()=>{
  const env=setup([payment(1)]);assert.equal(env.api.canonicalPageCurrent(SESSION,VERSION),true);
  env.wizard.preview.first_page_applied=false;assert.equal(env.api.canonicalPageCurrent(SESSION,VERSION),false);
  selectionReviewSnapshot(summaryFixture());assert.equal(env.api.canonicalPageCurrent(SESSION,VERSION),false);
});
test('a stale cached physical page still blocks the original canonical-page gate',()=>{
  const env=setup([payment(1)]);env.wizard.workbench.preview_pages={canonical_preview_lines:{session_id:SESSION,session_version:1,rows:[]}};
  assert.equal(env.api.canonicalPageCurrent(SESSION,VERSION),false);
});

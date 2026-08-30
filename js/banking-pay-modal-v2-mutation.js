/* Selection-response validation/staging, with one injected summary read only
 * when complete server proof cannot retain the current page. No financial
 * calculation, mutation, DOM publication or ownership of the Draft workflow. */
(function(root){
 'use strict';
 const table=typeof module==='object'&&module.exports?require('./banking-pay-modal-v2-table.js'):root.CloudTMSBankingPayTableV2;
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const TOKEN=/^[A-Za-z0-9_-]{1,4096}$/;
 const CANDIDATE_READY_PAGE_LIMIT=25;
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const count=v=>Number.isSafeInteger(v)&&v>=0;
 const text=v=>typeof v==='string'&&v.length>0;
 function requireValue(v){if(!v){const e=new Error('BANKING_PAY_V2_INVALID_RESPONSE');e.code=e.message;throw e;}}
 function validateRetention(value,expectedViewDigest){
  const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  const flags=['other_candidates_unchanged','membership_unchanged','candidate_sort_unchanged',
   'amount_sort_unchanged','deduction_sort_unchanged'];
  requireValue(object(value)&&digest(expectedViewDigest)&&digest(value.view_digest)&&object(value.retention)
   &&Object.keys(value.retention).length===6&&value.retention.before_view_digest===expectedViewDigest
   &&flags.every(key=>typeof value.retention[key]==='boolean'));
  return value;
 }
 function validateMovements(value,candidateId=null){
  requireValue(object(value)&&typeof value.state_changed==='boolean'&&Array.isArray(value.movements)
   &&typeof value.movements_complete==='boolean'&&count(value.movement_count)
   &&typeof value.movement_digest==='string'&&/^[a-f0-9]{64}$/.test(value.movement_digest));
  const invalidations=value.invalidations;
  requireValue(object(invalidations)&&invalidations.scope==='ALL_PREVIOUS_DETAILS'
   &&['ready','actions','updating','blocked'].every(k=>invalidations[k]===true)
   &&Object.keys(invalidations).length===5);
  requireValue(value.movements_complete?value.movement_count===value.movements.length
   :value.movements.length===0&&value.movement_count>0);
  requireValue(value.state_changed||value.movement_count===0);
  requireValue(new TextEncoder().encode(JSON.stringify(value.movements)).byteLength<=8192);
  const ids=new Set();
  for(const row of value.movements){
   requireValue(object(row)&&text(row.identity)&&UUID.test(row.identity)&&text(row.candidate_id)&&UUID.test(row.candidate_id)
    &&(candidateId===null||row.candidate_id===candidateId)&&text(row.row_key)&&text(row.from)&&text(row.to)
    &&row.from!==row.to&&typeof row.selected==='boolean'&&!ids.has(row.identity.toLowerCase()));
   ids.add(row.identity.toLowerCase());
  }
  return value;
 }
 function validateRowSelectionProof(value,request){
  validateRetention(value,request.expected_view_digest);validateMovements(value);
  requireValue(value.ok===true&&value.contract===table.CONTRACT&&value.contract_version===1
   &&value.session_id===request.session_id&&value.session_version===request.expected_session_version
   &&value.scope_hash===request.scope_hash&&value.request_id===request.request_id
   &&value.state_changed===true&&value.selection_scope==='EXACT_READY_ROWS'
   &&count(value.progress_counter_version)&&value.progress_counter_version>request.expected_progress_counter_version);
  return value;
 }
 function validateGroupSelectionProof(value,request){
  validateRetention(value,request.expected_view_digest);validateMovements(value);
  requireValue(value.ok===true&&value.contract===table.CONTRACT&&value.contract_version===1
   &&value.session_id===request.session_id&&value.session_version===request.expected_session_version
   &&value.scope_hash===request.scope_hash&&value.request_id===request.request_id
   &&value.state_changed===true&&value.selection_scope==='COMPLETE_READY_GROUP'
   &&value.group_kind===request.group_kind&&value.group_key===request.group_key
   &&count(value.group_member_count)&&value.group_member_count>=1
   &&value.owner_call_count===1
   &&count(value.progress_counter_version)&&value.progress_counter_version>request.expected_progress_counter_version);
  return value;
 }
 function validateReadyReplacement(page,result,previous,request){
  requireValue(object(request)&&Number.isInteger(request.limit)&&request.limit>=1&&request.limit<=100
   &&(request.cursor===null||text(request.cursor)&&TOKEN.test(request.cursor)));
  requireValue(object(page)&&page.ok===true&&page.contract===table.CONTRACT&&page.contract_version===1
   &&['session_id','session_version','progress_counter_version','scope_hash'].every(k=>page[k]===result[k])
   &&text(page.candidate_id)&&UUID.test(page.candidate_id)
   &&(!previous.ready||page.candidate_id===previous.ready.candidate_id)
   &&Array.isArray(page.rows)&&page.rows.length<=request.limit&&count(page.total_count)&&count(page.page_number)
   &&typeof page.has_more==='boolean'&&typeof page.has_previous==='boolean'
   &&page.has_previous===(page.page_number>1)
   &&(page.page_number>2?text(page.previous_cursor)&&TOKEN.test(page.previous_cursor):page.previous_cursor===null)
   &&(page.has_more?text(page.next_cursor)&&TOKEN.test(page.next_cursor):page.next_cursor===null));
  if(page.candidate===null)requireValue(page.total_count===0&&page.rows.length===0&&page.page_number===0
   &&!page.has_more&&!page.has_previous&&page.page_anchor===null);
  else{
   table.validateRow(page.candidate);
   requireValue(page.candidate.candidate_id===page.candidate_id&&page.candidate.selectable_ready_count<=page.total_count
    &&page.page_number>=1&&page.page_number<=Math.ceil(page.total_count/request.limit)
    &&(request.cursor!==null||page.page_number===1)
    &&page.rows.length===Math.min(request.limit,page.total_count-(page.page_number-1)*request.limit)
    &&page.has_more===(page.page_number*request.limit<page.total_count)
    &&text(page.page_anchor)&&TOKEN.test(page.page_anchor));
  }
  requireValue(new Set(page.rows.map(row=>row?.identity)).size===page.rows.length
   &&page.rows.every(row=>object(row)&&text(row.identity)&&row.candidate_id===page.candidate_id
    &&row.effective_section==='canonical_preview_lines'&&typeof row.selected==='boolean'&&validReadyGroup(row)));
  requireValue(new TextEncoder().encode(JSON.stringify(page)).byteLength<=512*1024);
  return page;
 }
 function validReadyGroup(row){
  const keys=['selection_group_kind','selection_group_key','selection_group_member_count','selection_group_selected_count','selection_group_state',
   'selection_group_display_amount','selection_group_selected_display_amount'];
  if(!keys.every(key=>Object.hasOwn(row,key))||!count(row.selection_group_member_count)||!count(row.selection_group_selected_count)
    ||row.selection_group_selected_count>row.selection_group_member_count)return false;
  if(row.selection_group_kind===null)return row.selection_group_key===null&&row.selection_group_member_count===0
    &&row.selection_group_selected_count===0&&row.selection_group_state===null
    &&row.selection_group_display_amount===null&&row.selection_group_selected_display_amount===null;
  return ['TIMESHEET','OVERPAYMENT'].includes(row.selection_group_kind)&&text(row.selection_group_key)
   &&row.selection_group_key.length<=512&&!/[\u0000-\u001f\u007f]/u.test(row.selection_group_key)
   &&row.selection_group_member_count>=1&&/^-?(?:0|[1-9]\d{0,15})\.\d{2}$/.test(row.selection_group_display_amount)
   &&/^-?(?:0|[1-9]\d{0,15})\.\d{2}$/.test(row.selection_group_selected_display_amount)
   &&row.selection_group_display_amount!=='-0.00'&&row.selection_group_selected_display_amount!=='-0.00'
   &&['NONE','SOME','ALL'].includes(row.selection_group_state)
   &&row.selection_group_state===(row.selection_group_selected_count===0?'NONE'
    :row.selection_group_selected_count===row.selection_group_member_count?'ALL':'SOME');
 }
 function selectionDetailPages(previous,result,openReady=null){
  validateMovements(result);
  requireValue(object(previous)&&(!previous.ui?.surface||['main','candidate'].includes(previous.ui.surface)));
  if(openReady)validateReadyReplacement(result.ready_page,result,previous,openReady);
  else requireValue(result.ready_page===undefined||result.ready_page===null);
  // Replace, never patch, all prior pages. In particular an incomplete movement
  // array is not a reason to keep an apparently unaffected cached identity.
  return {ready:openReady?result.ready_page:null,actions:null,actionDetail:null,blocked:null,blockedDetail:null};
 }
 const authorityFields=['session_id','session_version','progress_counter_version','scope_hash'];
 const sameAuthority=(left,right)=>authorityFields.every(key=>left[key]===right[key]);
 function sameJson(left,right){
  if(left===right)return true;
  if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;
  const keys=Object.keys(left);
  return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&sameJson(left[key],right[key]));
 }
 function candidateSelectionRequest(previous,intent){
  table.validateSummary(previous?.summary);
  requireValue(object(intent)&&intent.kind==='candidate'&&text(intent.candidate_id)&&UUID.test(intent.candidate_id)
   &&text(intent.request_id)&&UUID.test(intent.request_id)&&['SELECT_ALL_READY','CLEAR_ALL_READY'].includes(intent.action)
   &&['ALL','PAYE','UMBRELLA'].includes(intent.pay_channel_scope)
   &&(!previous.ui?.surface||['main','candidate'].includes(previous.ui.surface)));
  const s=previous.summary,request={session_id:s.session_id,expected_session_version:s.session_version,
   expected_progress_counter_version:s.progress_counter_version,scope_hash:s.scope_hash,pay_channel_scope:intent.pay_channel_scope,
   candidate_id:intent.candidate_id,action:intent.action,request_id:intent.request_id,expected_view_digest:s.view_digest};
  if(previous.ui?.surface==='candidate'){
   const page=previous.ready;
   requireValue(object(page)&&page.candidate_id===intent.candidate_id&&sameAuthority(page,s)
    &&text(page.page_anchor)&&TOKEN.test(page.page_anchor));
   request.open_ready=Object.freeze({cursor:page.page_anchor,limit:CANDIDATE_READY_PAGE_LIMIT});
  }
  return Object.freeze(request);
 }
 function rowSelectionRequest(previous,intent){
  requireValue(object(intent)&&intent.kind==='rows'&&typeof intent.selected==='boolean'
   &&Array.isArray(intent.preview_row_ids)&&intent.preview_row_ids.length>=1&&intent.preview_row_ids.length<=100
   &&intent.preview_row_ids.every(id=>text(id)&&UUID.test(id))
   &&new Set(intent.preview_row_ids.map(id=>id.toLowerCase())).size===intent.preview_row_ids.length
   &&previous?.ui?.surface==='candidate'&&Array.isArray(previous.ready?.rows)
   &&intent.preview_row_ids.every(id=>previous.ready.rows.some(row=>row.identity===id&&row.candidate_id===intent.candidate_id)));
  const base=candidateSelectionRequest(previous,{...intent,kind:'candidate',action:intent.selected?'SELECT_ALL_READY':'CLEAR_ALL_READY'});
  const {action,...request}=base;
  return Object.freeze({...request,preview_row_ids:Object.freeze([...intent.preview_row_ids]),selected:intent.selected});
 }
 function groupSelectionRequest(previous,intent){
  requireValue(object(intent)&&intent.kind==='group'&&typeof intent.selected==='boolean'
   &&['TIMESHEET','OVERPAYMENT'].includes(intent.group_kind)&&text(intent.group_key)&&intent.group_key.length<=512
   &&!/[\u0000-\u001f\u007f]/u.test(intent.group_key)
   &&previous?.ui?.surface==='candidate'&&Array.isArray(previous.ready?.rows)
   &&previous.ready.rows.some(row=>row.candidate_id===intent.candidate_id
    &&row.selection_group_kind===intent.group_kind&&row.selection_group_key===intent.group_key));
  const base=candidateSelectionRequest(previous,{...intent,kind:'candidate',action:intent.selected?'SELECT_ALL_READY':'CLEAR_ALL_READY'});
  const {action,...request}=base;
  return Object.freeze({...request,group_kind:intent.group_kind,group_key:intent.group_key,selected:intent.selected});
 }
 function validateCandidateResult(previous,result,request){
  table.validateSummary(previous?.summary);const s=previous.summary;
  requireValue(object(request)&&request.expected_view_digest===s.view_digest
   &&request.session_id===s.session_id&&request.expected_session_version===s.session_version
   &&request.expected_progress_counter_version===s.progress_counter_version&&request.scope_hash===s.scope_hash
   &&text(request.candidate_id)&&UUID.test(request.candidate_id));
  const rowPatch=Object.hasOwn(request,'preview_row_ids'),groupPatch=Object.hasOwn(request,'group_key');
  if(rowPatch)validateRowSelectionProof(result,request);
  if(groupPatch)validateGroupSelectionProof(result,request);
  validateRetention(result,request.expected_view_digest);validateMovements(result,rowPatch||groupPatch?null:request.candidate_id);
  requireValue(result.ok===true&&result.contract===table.CONTRACT&&result.contract_version===1
   &&result.session_id===s.session_id&&result.session_version===s.session_version&&result.scope_hash===s.scope_hash
   &&result.request_id===request.request_id
   &&(rowPatch||groupPatch||result.progress_counter_version===s.progress_counter_version+(result.state_changed?1:0))
   &&typeof result.candidate_absent==='boolean');
  if(result.candidate_absent)requireValue(result.candidate===null);
  else{table.validateRow(result.candidate);requireValue(result.candidate.candidate_id===request.candidate_id);}
 }
 function retainedCandidateSummary(previous,result,request){
  validateCandidateResult(previous,result,request);
  const s=previous.summary,p=result.retention;
  const sortFlag={CANDIDATE:'candidate_sort_unchanged',DEDUCTIONS:'deduction_sort_unchanged',READY_TO_PAY:'amount_sort_unchanged'}[s.sort_key];
  if(!p.other_candidates_unchanged||!p.membership_unchanged||!p[sortFlag])return null;
  requireValue(!result.candidate_absent&&result.global?.candidate_count===s.total_count);
  const summary={...s,progress_counter_version:result.progress_counter_version,view_digest:result.view_digest,
   global:result.global,rail:result.rail,
   rows:s.rows.map(row=>row.candidate_id===request.candidate_id?result.candidate:row)};
  // Other row objects and their content remain untouched, under the explicit
  // complete-set proof. Old ordinary cursors are never used: directed anchors
  // renew reads under the independently current request authority.
  table.validateSummary(summary);
  return summary;
 }
 async function reconcileCandidateSelection(previous,result,request,readSummary){
  let summary=retainedCandidateSummary(previous,result,request);
  if(summary===null){
   requireValue(typeof readSummary==='function');
   const old=previous.summary;
   summary=await readSummary({session_id:result.session_id,expected_session_version:result.session_version,
    expected_progress_counter_version:result.progress_counter_version,scope_hash:result.scope_hash,
    pay_channel_scope:request.pay_channel_scope,sort_key:old.sort_key,sort_direction:old.sort_direction,
    cursor:old.page_anchor,limit:100});
   table.validateSummary(summary);
   requireValue(sameAuthority(summary,result)&&summary.view_digest===result.view_digest
    &&sameJson(summary.global,result.global)&&sameJson(summary.rail,result.rail)
    &&summary.sort_key===old.sort_key&&summary.sort_direction===old.sort_direction);
   const visible=summary.rows.find(row=>row.candidate_id===request.candidate_id);
   if(visible)requireValue(!result.candidate_absent&&sameJson(visible,result.candidate));
  }
  return {...previous,summary,...selectionDetailPages(previous,result,request.open_ready)};
 }
 function validateGlobalSelectionProof(value,expectedViewDigest){
  const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  requireValue(object(value)&&digest(expectedViewDigest)&&digest(value.view_digest)
   &&value.before_view_digest===expectedViewDigest&&value.selection_scope==='FILTERED_READY'
   &&value.requires_summary_refresh===true
   &&!['candidate','candidate_id','candidate_absent','ready_page','retention'].some(key=>Object.hasOwn(value,key))
   &&new TextEncoder().encode(JSON.stringify(value)).byteLength<=32*1024);
  validateMovements(value);
  return value;
 }
 function globalSelectionRequest(previous,intent){
  table.validateSummary(previous?.summary);
  requireValue(object(intent)&&intent.kind==='global'&&!Object.hasOwn(intent,'candidate_id')
   &&text(intent.request_id)&&UUID.test(intent.request_id)&&['SELECT_ALL_READY','CLEAR_ALL_READY'].includes(intent.action)
   &&['ALL','PAYE','UMBRELLA'].includes(intent.pay_channel_scope)&&(!previous.ui?.surface||previous.ui.surface==='main'));
  const s=previous.summary;
  return Object.freeze({session_id:s.session_id,expected_session_version:s.session_version,
   expected_progress_counter_version:s.progress_counter_version,scope_hash:s.scope_hash,pay_channel_scope:intent.pay_channel_scope,
   action:intent.action,request_id:intent.request_id,expected_view_digest:s.view_digest});
 }
 async function reconcileGlobalSelection(previous,result,request,readSummary){
  table.validateSummary(previous?.summary);const old=previous.summary;
  requireValue(object(request)&&request.expected_view_digest===old.view_digest&&request.session_id===old.session_id
   &&request.expected_session_version===old.session_version&&request.expected_progress_counter_version===old.progress_counter_version
   &&request.scope_hash===old.scope_hash&&typeof readSummary==='function'&&(!previous.ui?.surface||previous.ui.surface==='main'));
  validateGlobalSelectionProof(result,request.expected_view_digest);
  requireValue(result.ok===true&&result.contract===table.CONTRACT&&result.contract_version===1
   &&result.session_id===old.session_id&&result.session_version===old.session_version&&result.scope_hash===old.scope_hash
   &&result.request_id===request.request_id
   &&result.progress_counter_version===old.progress_counter_version+(result.state_changed?1:0));
  const summary=await readSummary({session_id:result.session_id,expected_session_version:result.session_version,
   expected_progress_counter_version:result.progress_counter_version,scope_hash:result.scope_hash,pay_channel_scope:request.pay_channel_scope,
   sort_key:old.sort_key,sort_direction:old.sort_direction,cursor:old.page_anchor,limit:100});
  table.validateSummary(summary);
  requireValue(sameAuthority(summary,result)&&summary.view_digest===result.view_digest&&sameJson(summary.global,result.global)
   &&sameJson(summary.rail,result.rail)&&summary.sort_key===old.sort_key&&summary.sort_direction===old.sort_direction);
  return {...previous,summary,...selectionDetailPages(previous,result,null)};
 }
 const api=Object.freeze({CANDIDATE_READY_PAGE_LIMIT,validateRetention,validateMovements,validateRowSelectionProof,validateGroupSelectionProof,validateReadyReplacement,selectionDetailPages,candidateSelectionRequest,rowSelectionRequest,groupSelectionRequest,
  retainedCandidateSummary,reconcileCandidateSelection,validateGlobalSelectionProof,globalSelectionRequest,reconcileGlobalSelection});
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CloudTMSBankingPayMutationV2=api;
})(typeof globalThis==='object'?globalThis:this);

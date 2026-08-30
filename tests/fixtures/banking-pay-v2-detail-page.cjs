// Explicitly synthetic UI/parity fixtures. No application, auth or bank data.
(function(root){
  const id = value => `00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
  function payment(number=1001, overrides={}) {
    return {identity:id(number),preview_row_id:id(number),candidate_id:id(1),timesheet_id:id(201),
      display_name:'Synthetic candidate — detail verification',tms_ref:'TEST-001',client_name:'Synthetic client',
      week_ending_date:'2026-08-30',line_type:'TIMESHEET_PAYMENT',key_type:'TS_DAY',key_value:'2026-08-27',
      effective_section:'canonical_preview_lines',presentation_section:'READY_TO_PAY',presentation_role:'CHILD',
      selection_allowed:true,is_ready_for_draft:true,draftable:true,selected:true,pay_channel:'PAYE',
      amount_ex_vat:'225.00',section_amount_ex_vat:'225.00',date:'2026-08-27',work_date:'2026-08-27',
      units:9,pay_rate:25,charge_rate:30,segment_id:id(501),segment_stable_key:'synthetic-segment-1',
      start_time:'08:00',end_time:'18:00',break_minutes:60,
      workbench_session_id:id(1000),workbench_session_version:2,progress_counter_version:3,
      ...overrides};
  }
  function expense(number=1003, overrides={}) {
    const fingerprint='a'.repeat(32);
    return payment(number,{line_type:'TIMESHEET_PAYMENT',item_type:'EXPENSE_DELTA',key_type:'EXPENSE_CODE',
      key_value:'TRAVEL',component_key_type:'EXPENSE_CODE',component_key_value:'TRAVEL',expense_code:'travel',
      expense_label:'Travel',segment_id:'',segment_stable_key:'',amount_ex_vat:'18.50',section_amount_ex_vat:'18.50',date:'',work_date:'',
      source_ref:`timesheet-expense:${id(201)}:travel:${fingerprint}`,source_basis_fingerprint:fingerprint,
      snooze_identity:{identity_type:'TIMESHEET_EXPENSE',timesheet_id:id(201),expense_code:'travel',
        source_basis_fingerprint:fingerprint,source_ref:`timesheet-expense:${id(201)}:travel:${fingerprint}`},...overrides});
  }
  function recovery(number=1004, overrides={}) {
    return payment(number,{line_type:'LOAN_REPAYMENT',key_type:'SOURCE_REF',key_value:'fixture-loan',
      source_ref:'fixture-loan',timesheet_id:'',segment_id:'',segment_stable_key:'',date:'',work_date:'',
      amount_ex_vat:'-15.00',section_amount_ex_vat:'-15.00',nominal_due_amount_ex_vat:'15.00',...overrides});
  }
  function component(number=301, overrides={}) {
    return {finance_component_id:id(number),key:'TS_DAY:2026-08-27',component_key_type:'TS_DAY',
      component_key_value:'2026-08-27',source_family_key:'fixture-family',classification:'TAXABLE',
      bucket_code:'DAY',source_basis_fingerprint:'b'.repeat(64),source_basis_json:{fixture:true,date:'2026-08-27'},
      source_units:9,source_rate:25,target_rate:27,source_charge_rate:30,source_amount:225,
      resolution_state:'REQUIRES_ACTION',needs_action:true,show_suggested_rate:true,suggested_available:true,
      show_manual_rate_control:true,show_manual_amount_control:true,has_operator_choice:false,...overrides};
  }
  function caseEntry(overrides={}) {
    return {candidate_id:id(1),finance_case_id:id(401),case_key:`finance:${id(401)}`,linked_timesheet_id:id(201),
      case_type:'UNDERPAYMENT',resolution_family:'BUCKETED',case_needs_resolution:true,case_resolution_satisfied_now:false,
      has_actionable_suggested_resolution:true,resolution_action_requires_actionable_components:false,
      display_name:'Synthetic candidate — detail verification',tms_ref:'TEST-001',components:[component()],...overrides};
  }
  function context({ready=[],blocked=[],open=[],selected=ready.filter(row=>row.selected).map(row=>row.preview_row_id),
    pending=false,failed=false}={}) {
    return {blockedPreviewLines:blocked,canonicalPreviewLines:[...ready,...blocked],readyPreviewLines:ready,hiddenPreviewLines:[],
      candidateMetaById:new Map(),candidateRefreshStateById:new Map(),failedCandidateStateById:new Map(),
      failedCandidateIds:failed?[id(1)]:[],failedCandidateRowById:new Map(),pendingCandidateIds:pending?[id(1)]:[],
      pendingCandidateRowById:new Map(),pendingCandidateJobById:new Map(),selectedPreviewRowSet:new Set(selected),
      openReadyTimesheetBreakdownKeys:new Set(open),railEnv:'TEST',railProvider:'TEST_PROVIDER',
      formatIsoToUk:undefined,getCurrentWorkbenchSessionId:()=>id(1000),getCurrentWorkbenchSessionVersion:()=>2,
      getBankingPayAdoptedPreviewRowSectionV1:line=>line.effective_section||'',
      enc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char])};
  }
  function readyPage() {
    const rows=[payment(),payment(1002,{amount_ex_vat:'187.50',section_amount_ex_vat:'187.50',date:'2026-08-28',work_date:'2026-08-28',key_value:'2026-08-28',
      selected:false,units:7.5,segment_id:id(502),segment_stable_key:'synthetic-segment-2'}),expense(),recovery()];
    const groupKey=`READY_TO_PAY|${id(1)}|${id(201)}`;
    for(const row of rows.slice(0,3))Object.assign(row,{selection_group_kind:'TIMESHEET',selection_group_key:groupKey,
      selection_group_member_count:3,selection_group_selected_count:2,selection_group_state:'SOME',
      selection_group_display_amount:'431.00',selection_group_selected_display_amount:'243.50'});
    Object.assign(rows[3],{selection_group_kind:null,selection_group_key:null,selection_group_member_count:0,
      selection_group_selected_count:0,selection_group_state:null,selection_group_display_amount:null,
      selection_group_selected_display_amount:null});
    return {ok:true,contract:'BANKING_PAY_MODAL_STRUCTURE_V2',contract_version:1,session_id:id(1000),candidate_id:id(1),
      session_version:2,progress_counter_version:3,scope_hash:'a'.repeat(64),
      rows,
      total_count:4,has_more:false,next_cursor:null};
  }
  function snapshot() {
    const page=readyPage();
    const candidate={candidate_id:id(1),candidate_name:'Synthetic candidate — detail verification',candidate_reference:'TEST-001',
      candidate_sort_name:'synthetic candidate',candidate_sort_reference:'test-001',child_revision:'2:3:fixture',facts_digest:'b'.repeat(64),
      selectable_ready_count:4,selected_ready_count:3,selection_state:'SOME',selected_display_amount:'228.50',
      selected_deduction_exists:true,selected_timesheet_count:1,selected_timesheet_ids:[id(201)],selected_timesheet_scope_token:null};
    page.candidate=candidate;
    const summary={ok:true,contract:page.contract,contract_version:1,session_id:page.session_id,session_version:2,
      progress_counter_version:3,scope_hash:page.scope_hash,view_digest:'c'.repeat(64),sort_key:'CANDIDATE',sort_direction:'ASC',rows:[candidate],
      total_count:1,has_more:false,next_cursor:null,page_number:1,has_previous:false,previous_cursor:null,page_anchor:'fixture_page_anchor',
      next_page_anchor:null,previous_page_anchor:null,global:{candidate_count:1,selected_candidate_count:1,
        selectable_ready_count:4,selected_ready_count:3,selection_state:'SOME',selected_ready_display_amount:'228.50',
        action_required_count:0,updating_count:0,blocked_count:0,draft:{can_create_draft:true,blocker_codes:[],
          session_ready:true,read_only:false,work_queued:false,display_ready:true,draft_safe:true,draft_block_reason_code:null,
          session_selected_row_count:3,session_selected_eligible_ready_row_count:3}}};
    return {summary,candidate,page,context:context({ready:page.rows})};
  }
  const api=Object.freeze({id,payment,expense,recovery,component,caseEntry,context,readyPage,snapshot});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BankingDetailFixture=api;
})(typeof window==='object'?window:this);

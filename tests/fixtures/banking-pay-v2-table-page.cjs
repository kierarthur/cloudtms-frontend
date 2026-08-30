// Synthetic presentation fixture only. Amounts are explicit server-style
// scalars, not a browser financial calculation or a hosted customer payload.
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
const candidate = (value=1) => ({ candidate_id:id(value),candidate_name:`Fixture candidate ${String(value).padStart(3,'0')}`,
  candidate_reference:`TEST-${value}`,candidate_sort_name:`fixture candidate ${value}`,candidate_sort_reference:`test-${value}`,
  child_revision:'fixture-revision-3',facts_digest:'b'.repeat(64),selectable_ready_count:1,selected_ready_count:0,selection_state:'NONE',
  selected_display_amount:'0.00',selected_deduction_exists:false,selected_timesheet_count:0,selected_timesheet_ids:[],selected_timesheet_scope_token:null });
function page() {
  const rows=Array.from({length:100},(_,index)=>candidate(index+1));
  Object.assign(rows[0],{candidate_name:'A long candidate name used to check one-line layout at narrow widths',selectable_ready_count:2,
    selected_ready_count:1,selection_state:'SOME',selected_display_amount:'10.00',selected_timesheet_count:1,selected_timesheet_ids:[id(2001)]});
  Object.assign(rows[1],{selected_ready_count:1,selection_state:'ALL',selected_display_amount:'15.00',selected_timesheet_count:1,selected_timesheet_ids:[id(2002)]});
  Object.assign(rows[2],{selected_ready_count:1,selection_state:'ALL',selected_display_amount:'-5.00',selected_deduction_exists:true});
  return {ok:true,contract:'BANKING_PAY_MODAL_STRUCTURE_V2',contract_version:1,session_id:id(1000),session_version:2,
    progress_counter_version:3,scope_hash:'a'.repeat(64),view_digest:'c'.repeat(64),sort_key:'CANDIDATE',sort_direction:'ASC',
    rows,total_count:101,has_more:true,next_cursor:'fixture_page_2',page_number:1,has_previous:false,previous_cursor:null,page_anchor:'fixture_page_anchor',
    next_page_anchor:'fixture_next_anchor',previous_page_anchor:null,global:{candidate_count:101,selected_candidate_count:4,
      selected_ready_count:4,selectable_ready_count:102,selection_state:'SOME',selected_ready_display_amount:'220.00',
      action_required_count:2,updating_count:1,blocked_count:3,draft:{can_create_draft:true,blocker_codes:[],
        session_ready:true,read_only:false,work_queued:false,display_ready:true,draft_safe:true,draft_block_reason_code:null,
        session_selected_row_count:4,session_selected_eligible_ready_row_count:4}}};
}
const api={id,candidate,page};
if(typeof module==='object'&&module.exports) module.exports=api;
else window.BankingTableFixture=api;

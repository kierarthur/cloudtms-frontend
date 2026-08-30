const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../../js/banking-pay-modal-v2-candidate.js');
const fixture=require('../fixtures/banking-pay-v2-detail-page.cjs');

test('Candidate Banking accepts only one exact revision and Ready candidate scope',()=>{
  const initial=fixture.snapshot();assert.equal(api.validate(initial).page,initial.page);
  for(const change of [
    value=>value.page.progress_counter_version++,value=>value.page.scope_hash='b'.repeat(64),
    value=>value.page.rows[0].effective_section='blocked_for_pay',value=>value.page.rows[0].candidate_id=fixture.id(2),
    value=>value.page.rows[0].selected='true',value=>value.page.rows.push({...value.page.rows[0]}),
    value=>value.context.selectedPreviewRowSet.clear(),value=>value.context.hiddenPreviewLines=[fixture.payment()],
    value=>value.context.canonicalPreviewLines.push(fixture.payment(999,{candidate_id:fixture.id(2)})),
    value=>value.candidate=null,value=>value.page.rows=Array.from({length:101},()=>fixture.payment())
  ]){const value=fixture.snapshot();change(value);assert.throws(()=>api.validate(value),/INVALID_RESPONSE/);}
});

test('Candidate Banking renders existing details without an application/global graph read',()=>{
  const value=fixture.snapshot();const html=api.rowMarkup(value,new Set());
  assert.ok(html.includes('banking:pay:toggleTimesheetBreakdown'));
  assert.ok(html.includes('banking:pay:togglePreviewRow'));
  assert.ok(html.includes('banking:pay:viewRowTimesheets'));
  assert.ok(html.includes('LOAN REPAYMENT'));
  const source=fs.readFileSync(path.resolve(__dirname,'../../js/banking-pay-modal-v2-candidate.js'),'utf8');
  assert.doesNotMatch(source,/fetch\s*\(|bankingGetState\s*\(|renderPayNewBatchWizard\s*\(|JSON\.parse\(JSON\.stringify/);
  assert.match(source,/table\.formatAmount\(candidate\.selected_display_amount\)/);
});
test('Candidate Banking binds grouped ticks to complete server group facts and removes loaded row IDs',()=>{
  const value=fixture.snapshot();const key=`READY_TO_PAY|${fixture.id(1)}|${fixture.id(201)}`;
  value.page.rows.slice(0,3).forEach(row=>Object.assign(row,{selection_group_member_count:107,
    selection_group_selected_count:50,selection_group_state:'SOME',selection_group_display_amount:'1070.00',
    selection_group_selected_display_amount:'500.00'}));
  value.context=fixture.context({ready:value.page.rows});
  const attrs=new Map([['data-preview-row-ids','["loaded-only"]']]);
  const made=[];const ownerDocument={createElement:tag=>{const node={tag,className:'',textContent:'',children:[],append(child){this.children.push(child);}};made.push(node);return node;}};
  const amountCell={ownerDocument,replaceChildren(...children){this.children=children;}};
  const mobileAmount={textContent:'W/E 24/08/2026 · £500.00'};
  const row={children:Array.from({length:7},(_,index)=>index===6?amountCell:{}),querySelector:selector=>selector==='.banking-ready-mobile-row-summary > span:last-child'?mobileAmount:null};
  const control={dataset:{timesheetGroupKey:key},checked:false,indeterminate:false,
    setAttribute:(name,item)=>attrs.set(name,String(item)),removeAttribute:name=>attrs.delete(name),closest:()=>row};
  api.bindCompleteGroupControls({querySelectorAll:()=>[control]},value);
  assert.equal(attrs.has('data-preview-row-ids'),false);
  assert.equal(control.dataset.selectionGroupKind,'TIMESHEET');assert.equal(control.dataset.selectionGroupKey,key);
  assert.equal(control.indeterminate,true);assert.equal(attrs.get('aria-checked'),'mixed');
  assert.equal(amountCell.children[0].children[0].textContent,'£1,070.00');
  assert.equal(amountCell.children[0].children[1].textContent,'(£500.00 selected)');
  assert.equal(mobileAmount.textContent,'W/E 24/08/2026 · £1,070.00');
  const source=fs.readFileSync(path.resolve(__dirname,'../../js/banking-pay-modal-v2-candidate.js'),'utf8');
  assert.match(source,/toggleTimesheetPreviewGroup[\s\S]*invoke\(onIntent,\{kind:'group'/);
  assert.doesNotMatch(source,/toggleTimesheetPreviewGroup[\s\S]{0,300}invoke\(onLegacyAction/);
});
for(const [name,change] of Object.entries({missing:r=>delete r.selection_group_key,partialNull:r=>r.selection_group_member_count=1,
 inconsistent:r=>Object.assign(r,{selection_group_member_count:3,selection_group_selected_count:1,selection_group_state:'ALL'})}))
 test('Candidate Banking rejects incomplete group fact '+name,()=>{const value=fixture.snapshot();change(value.page.rows[0]);
  assert.throws(()=>api.validate(value),/INVALID_RESPONSE/);});

test('Ready child may truthfully become empty after its last payment moves section',()=>{
  const value=fixture.snapshot();value.candidate=null;value.page.candidate=null;value.page.rows=[];value.page.total_count=0;
  value.summary.rows=[];value.summary.total_count=0;
  value.summary.page_number=0;value.summary.page_anchor=null;
  Object.assign(value.summary.global,{candidate_count:0,selected_candidate_count:0,selectable_ready_count:0,
    selected_ready_count:0,selection_state:'NONE',selected_ready_display_amount:'0.00',
    draft:{...value.summary.global.draft,can_create_draft:false,blocker_codes:['NO_SELECTED_ROWS'],
      session_selected_row_count:0,session_selected_eligible_ready_row_count:0}});
  value.context=fixture.context();
  assert.equal(api.rowMarkup(value,new Set()),'');
});

test('open candidate remains current after sorting moves it off the main page',()=>{
  const value=fixture.snapshot();
  // A complete100-row page excludes the open candidate, which now lies on
  // the next page. Its header still comes from its current scoped Ready read.
  value.summary.rows=Array.from({length:100},(_,n)=>({...value.candidate,candidate_id:fixture.id(n+2),candidate_name:'Other candidate '+n}));
  Object.assign(value.summary,{total_count:101,has_more:true,next_cursor:'next_current',next_page_anchor:'next_anchor'});
  Object.assign(value.summary.global,{candidate_count:101,selected_candidate_count:101,selectable_ready_count:404,
    selected_ready_count:303,selected_ready_display_amount:'457.00'});
  delete value.candidate;
  assert.equal(api.validate(value).candidate,value.page.candidate);
  assert.ok(api.rowMarkup(value,new Set()).includes('banking:pay:togglePreviewRow'));
});

for(const [name,change] of Object.entries({
  mismatchedFactsEvidence:value=>{value.page.candidate={...value.candidate,facts_digest:'c'.repeat(64)};},
  mismatchedVisibleFactsEvidence:value=>{delete value.candidate;value.summary.rows=[{...value.page.candidate,facts_digest:'c'.repeat(64)}];},
  mismatchedSortName:value=>{value.page.candidate={...value.candidate,candidate_sort_name:'different'};},
  missing:value=>{delete value.page.candidate;},
  staleAmount:value=>{value.page.candidate={...value.candidate,selected_display_amount:'999.00'};},
  wrongCandidate:value=>{value.page.candidate={...value.candidate,candidate_id:fixture.id(2)};},
  partialPageCount:value=>{value.page.candidate={...value.candidate,selectable_ready_count:5};},
  nullWithRows:value=>{value.page.candidate=null;delete value.candidate;},
  staleVisibleRow:value=>{delete value.candidate;value.summary.rows=[{...value.page.candidate,child_revision:'old',facts_digest:'0'.repeat(64)}];}
}))test(`child rejects ${name} candidate summary before changing either view`,()=>{
  const value=fixture.snapshot();change(value);assert.throws(()=>api.validate(value),/INVALID_RESPONSE/);
});

test('fresh Ready navigation metadata may renew while every retained candidate fact stays exact',()=>{
  const value=fixture.snapshot();delete value.candidate;
  value.summary.rows=[{...value.page.candidate,child_revision:'older_navigation'}];
  assert.equal(api.validate(value).candidate,value.page.candidate);
  value.candidate={...value.page.candidate,child_revision:'older_compatibility_alias'};
  assert.throws(()=>api.validate(value),/INVALID_RESPONSE/,'same-response aliases still match exactly');
});

test('closed child details are lazy templates and expanding affects only that child',()=>{
  const value=fixture.snapshot();const key=`READY_TO_PAY|${fixture.id(1)}|${fixture.id(201)}`;
  const closed=api.rowMarkup(value,new Set());const opened=api.rowMarkup(value,new Set([key]));
  assert.ok(closed.includes('<template data-banking-ready-breakdown-template="true">'));
  assert.ok(opened.includes('aria-expanded="true"'));
  assert.ok(!opened.includes('<template data-banking-ready-breakdown-template="true">'));
});

const assert=require('node:assert/strict');
const test=require('node:test');
const api=require('../../js/banking-pay-modal-v2-issue-detail.js');
const {fixture}=require('../fixtures/banking-pay-v2-issue-detail-page.cjs');

function blockedPayment(){
  const value=fixture('blocked',1,1);value.summary.global.blocked_count=1;
  const row=value.page.rows[0];row.task_meta={task_family:'PASSIVE_PAYMENT',state:'BLOCKED'};
  Object.assign(row.payload,{candidate_id:row.candidate_id,preview_row_id:row.preview_row_id,
    display_name:'Candidate with blocked payment',tms_ref:'TEST-001',client_name:'Test client',line_type:'LOAN_REPAYMENT',
    presentation_section:'BLOCKED_FOR_PAY',effective_section:'blocked_for_pay',amount_ex_vat:'-15.00',section_amount_ex_vat:'-15.00'});
  return value;
}

test('Blocked detail reuses the complete legacy payment renderer and keeps selection unavailable',()=>{
  const value=blockedPayment();const rendered=api.render(value.page,value.summary,'blocked',
    {formatIsoToUk:v=>v,railEnv:'TEST',railProvider:'CSV'},new Set());
  assert.match(rendered.tableRows,/Candidate with blocked payment/);
  assert.match(rendered.tableRows,/LOAN REPAYMENT/);
  assert.doesNotMatch(rendered.tableRows,/data-action="banking:pay:togglePreviewRow"/);
});

test('issue detail refuses an invented or missing action contract before rendering',()=>{
  const value=blockedPayment();delete value.page.rows[0].task_meta;
  assert.throws(()=>api.render(value.page,value.summary,'blocked',
    {formatIsoToUk:v=>v,railEnv:'TEST',railProvider:'CSV'},new Set()),/INVALID_RESPONSE/);
});

test('source-progress detail keeps the existing refresh action and no payment identity',()=>{
  const value=fixture('actions',1,1);value.summary.global.action_required_count=1;
  Object.assign(value.page,{affected_payment_count:null,affected_payment_count_complete:false});
  const row=value.page.rows[0];Object.assign(row,{preview_row_id:null,source_kind:'SOURCE_PROGRESS',context_only:true,
    task_meta:{task_family:'SOURCE_PROGRESS',title:'Candidate payment information needs refreshing.',action:'banking:pay:refreshAll'},
    payload:{candidate_id:row.candidate_id,display_name:'Candidate needing refresh',tms_ref:'TEST-002'}});
  const rendered=api.render(value.page,value.summary,'actions',
    {formatIsoToUk:v=>v,railEnv:'TEST',railProvider:'CSV'},new Set());
  assert.match(rendered.sourceRows,/Candidate payment information needs refreshing\./);
  assert.match(rendered.sourceRows,/data-action="banking:pay:refreshAll"/);
  assert.equal(rendered.tableRows,'');
});

const {snapshot,id}=require('./banking-pay-v2-detail-page.cjs');
function fixture(kind='actions',pageNumber=1,total=105){
 const summary=snapshot().summary;
 const start=(pageNumber-1)*100;
 const page={...Object.fromEntries(['session_id','session_version','progress_counter_version','scope_hash'].map(k=>[k,summary[k]])),
  ok:true,contract:summary.contract,contract_version:1,[kind==='actions'?'task_key':'blocker_key']:'current_issue',
  total_count:total,has_more:start+100<total,next_cursor:start+100<total?'next_detail':null,
  page_number:pageNumber,has_previous:pageNumber>1,previous_cursor:pageNumber>2?'previous_detail':null,
  affected_candidate_count:1,affected_payment_count:total,affected_payment_count_complete:true,
  rows:Array.from({length:Math.min(100,total-start)},(_,i)=>({identity:`member_${start+i+1}`,
    candidate_id:id(1),preview_row_id:id(10000+start+i),source_kind:'PREVIEW_ROW',context_only:false,
    payload:{candidate_id:id(1),preview_row_id:id(10000+start+i),section:'blocked_for_pay'}}))};
 return {summary,page,kind,identity:'current_issue',cursor:pageNumber===1?null:'current_detail',limit:100};
}
module.exports={fixture};

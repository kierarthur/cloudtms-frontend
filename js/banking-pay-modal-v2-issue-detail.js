/* Bounded Action Required / Blocked detail presentation. The complete payment
 * payloads and action metadata come from the server. Existing Banking Pay
 * renderers and delegated action owners are reused; this file creates no new
 * financial rule, selection owner or action implementation.
 */
(function(root){
  'use strict';
  const local=typeof module==='object'&&module.exports;
  const issues=local?require('./banking-pay-modal-v2-issues.js'):root.CloudTMSBankingPayIssuesV2;
  const details=local?require('./banking-pay-modal-v2-details-legacy.js'):root.CloudTMSBankingPayLegacyDetailsV2;
  const fields=['session_id','session_version','progress_counter_version','scope_hash'];
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function fail(){const error=new Error('BANKING_PAY_V2_INVALID_RESPONSE');error.code=error.message;throw error;}
  function payload(row){
    if(!object(row)||!object(row.payload)||!object(row.task_meta))fail();
    return {...row.payload,...(object(row.bank_row)?row.bank_row:{}),candidate_id:row.candidate_id,
      preview_row_id:row.preview_row_id,context_only:row.context_only,task_meta:row.task_meta};
  }
  function context(page,adapters,openKeys){
    if(!object(adapters)||typeof adapters.formatIsoToUk!=='function')throw new TypeError('Issue detail adapters required');
    const values=page.rows.map(payload);
    const ready=values.filter(row=>String(row.effective_section||row.presentation_section||'').toUpperCase()==='CANONICAL_PREVIEW_LINES');
    const blocked=values.filter(row=>!ready.includes(row));
    const candidateMeta=new Map();
    for(const row of values){
      const id=String(row.candidate_id||'');
      if(!id||candidateMeta.has(id))continue;
      candidateMeta.set(id,{candidate_id:id,display_name:String(row.candidate_name||row.display_name||''),
        tms_ref:String(row.candidate_reference||row.tms_ref||''),current_pay_method:String(row.pay_channel||'')});
    }
    return {
      blockedPreviewLines:blocked,candidateMetaById:candidateMeta,candidateRefreshStateById:new Map(),
      canonicalPreviewLines:values,enc:esc,failedCandidateIds:[],failedCandidateRowById:new Map(),failedCandidateStateById:new Map(),
      formatIsoToUk:adapters.formatIsoToUk,getBankingPayAdoptedPreviewRowSectionV1:row=>String(row?.effective_section||row?.presentation_section||''),
      getCurrentWorkbenchSessionId:()=>page.session_id,getCurrentWorkbenchSessionVersion:()=>page.session_version,
      hiddenPreviewLines:[],openReadyTimesheetBreakdownKeys:openKeys,pendingCandidateIds:[],pendingCandidateJobById:new Map(),
      pendingCandidateRowById:new Map(),railEnv:String(adapters.railEnv||''),railProvider:String(adapters.railProvider||''),
      readyPreviewLines:ready,selectedPreviewRowSet:new Set(values.filter(row=>row.selected===true).map(row=>String(row.preview_row_id||'')).filter(Boolean))
    };
  }
  function sourceCard(row){
    const data=payload(row),meta=row.task_meta;
    const name=String(data.candidate_name||data.display_name||'Candidate');
    const ref=String(data.candidate_reference||data.tms_ref||'');
    const title=String(meta.title||'Payment preview needs refreshing.');
    const action=String(meta.action||'');
    return `<article class="card bpv2-source-detail" data-bpv2-detail-member="${esc(row.identity)}">
      <div><strong>${esc(name)}</strong>${ref?`<span class="mini">${esc(ref)}</span>`:''}</div>
      <p>${esc(title)}</p>${action?`<button type="button" class="btn btn-outline" data-action="${esc(action)}">Refresh Banking Pay</button>`:''}
    </article>`;
  }
  function render(page,summary,kind,adapters,openKeys){
    issues.validateDetail(page,summary,kind,page[kind==='actions'?'task_key':'blocker_key'],undefined,100);
    const renderer=details.create(context(page,adapters,openKeys));
    const paymentRows=page.rows.filter(row=>row.source_kind!=='SOURCE_PROGRESS').map(payload);
    const timesheets=paymentRows.filter(row=>String(row.line_type||'').toUpperCase()==='TIMESHEET_PAYMENT');
    const other=paymentRows.filter(row=>String(row.line_type||'').toUpperCase()!=='TIMESHEET_PAYMENT');
    const section=kind==='actions'?'CASES_RESOLUTIONS':'BLOCKED_FOR_PAY';
    const tableRows=renderer.renderTimesheetParentRows(timesheets,section)
      +renderer.renderSimplePreviewRows(renderer.buildOverpaymentRecoveryDisplayLines(other),kind==='actions'?'Action required':'Blocked for pay',section);
    const sourceRows=page.rows.filter(row=>row.source_kind==='SOURCE_PROGRESS').map(sourceCard).join('');
    return {tableRows,sourceRows};
  }
  function create({document,kind,adapters,onPage,onClose,onLegacyAction,onFailure}){
    if(!['actions','blocked'].includes(kind))throw new TypeError('Unknown issue detail kind');
    for(const callback of [onPage,onClose,onLegacyAction,onFailure])if(typeof callback!=='function')throw new TypeError('Issue detail adapters required');
    const element=document.createElement('section');element.className='banking-pay-v2-issue-detail';
    element.innerHTML=`<header><div><h2>${kind==='actions'?'Action Required':'Blocked for Pay'}</h2><p class="mini" data-bpv2-detail-summary></p></div>
      <button type="button" class="btn btn-outline" data-bpv2-detail-command="close">Close</button></header>
      <p role="status" class="bpv2-detail-status" aria-live="polite" hidden></p>
      <div class="bpv2-detail-scroll"><div data-bpv2-source-rows></div><table class="grid banking-ready-preview-table"><thead><tr>
        <th>Include</th><th>Line type</th><th>Candidate</th><th>Client</th><th>Week / Date</th><th>Channel</th><th>Amount</th><th>State</th><th>Action</th>
      </tr></thead><tbody></tbody></table></div>
      <footer><span data-bpv2-detail-count></span><button type="button" class="btn btn-outline" data-bpv2-detail-command="previous">Previous</button>
      <button type="button" class="btn btn-outline" data-bpv2-detail-command="next">Next</button></footer>`;
    const body=element.querySelector('tbody'),sources=element.querySelector('[data-bpv2-source-rows]');
    const status=element.querySelector('[role="status"]'),scroll=element.querySelector('.bpv2-detail-scroll');
    const openKeys=new Set();let accepted=null,busy=false,destroyed=false;
    function controls(){for(const control of element.querySelectorAll('button,input')){
      if(control.dataset.bpv2DetailCommand==='close')continue;control.disabled=busy||!accepted;
    }
      element.querySelector('[data-bpv2-detail-command="previous"]').disabled=busy||!accepted||!accepted.has_previous;
      element.querySelector('[data-bpv2-detail-command="next"]').disabled=busy||!accepted||!accepted.has_more;
      element.setAttribute('aria-busy',String(busy));
    }
    function report(error){if(destroyed)return;status.textContent='This detail could not be updated. Refresh Banking Pay and try again.';
      status.hidden=false;onFailure({code:typeof error?.code==='string'?error.code:'BANKING_PAY_V2_UPDATE_FAILED'});}
    function invoke(callback,value){try{Promise.resolve(callback(value)).catch(report);}catch(error){report(error);}}
    function expand(control){
      const key=control.getAttribute('data-breakdown-key')||control.getAttribute('data-timesheet-group-key');
      const row=control.closest('tr')?.nextElementSibling;if(!key||row?.getAttribute('data-banking-ready-breakdown-detail')!==key)fail();
      const opening=!openKeys.has(key);if(opening){const template=row.querySelector('template[data-banking-ready-breakdown-template="true"]');
        if(template)template.replaceWith(template.content.cloneNode(true));openKeys.add(key);}else openKeys.delete(key);
      row.hidden=!opening;control.textContent=opening?'−':'+';control.setAttribute('aria-expanded',String(opening));
    }
    function event(event){
      const control=event.target?.closest?.('[data-bpv2-detail-command],[data-action]');if(!control||!element.contains(control))return;
      event.stopPropagation();const command=control.dataset.bpv2DetailCommand;
      if(command==='close'){invoke(onClose);return;}if(destroyed||busy||!accepted||control.disabled)return;
      if(command){invoke(onPage,{direction:command,authority:Object.fromEntries(fields.map(key=>[key,accepted[key]]))});return;}
      if(control.dataset.action==='banking:pay:toggleTimesheetBreakdown'){try{expand(control);}catch(error){report(error);}return;}
      invoke(onLegacyAction,{action:control.dataset.action,element:control,event_kind:event.type,
        authority:Object.fromEntries(fields.map(key=>[key,accepted[key]]))});
    }
    element.addEventListener('click',event);
    return Object.freeze({element,
      prepare(page,summary){
        if(destroyed)throw new Error('BANKING_PAY_V2_CLOSED');const markup=render(page,summary,kind,adapters,openKeys);
        const staged=document.createElement('tbody');staged.innerHTML=markup.tableRows;
        const stagedSources=document.createElement('div');stagedSources.innerHTML=markup.sourceRows;
        return ()=>{if(destroyed)return;const top=scroll.scrollTop,left=scroll.scrollLeft;accepted=page;
          body.replaceChildren(...Array.from(staged.childNodes));sources.replaceChildren(...Array.from(stagedSources.childNodes));
          element.querySelector('[data-bpv2-detail-summary]').textContent=`${page.affected_candidate_count} candidate${page.affected_candidate_count===1?'':'s'} affected`;
          element.querySelector('[data-bpv2-detail-count]').textContent=`${page.total_count} item${page.total_count===1?'':'s'}`;
          status.hidden=true;status.textContent='';controls();scroll.scrollTop=top;scroll.scrollLeft=left;};
      },
      setBusy(value){if(!destroyed){busy=Boolean(value);controls();}},
      showFailure(message){if(!destroyed){status.textContent=String(message);status.hidden=false;}},
      destroy(){destroyed=true;accepted=null;openKeys.clear();element.removeEventListener('click',event);element.remove();}
    });
  }
  const api=Object.freeze({payload,context,render,create});
  if(local)module.exports=api;else root.CloudTMSBankingPayIssueDetailV2=api;
})(typeof window==='object'?window:this);

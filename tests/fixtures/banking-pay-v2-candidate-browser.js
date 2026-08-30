// Local test entrypoint. Fixed response fixtures exercise the real presenters;
// no browser amount calculation, real RPC or secret/state access is available.
(() => {
  const fixture=window.BankingDetailFixture;
  const mainHost=document.getElementById('main-host'),childHost=document.getElementById('child-host');
  const result=document.getElementById('result');
  const commands=[];let current=fixture.snapshot(),child=null;
  const record=value=>{commands.push(value);result.textContent=JSON.stringify(value);};
  const main=window.CloudTMSBankingPayTableV2.createCandidateTable({document,
    onCandidateIntent:record,onGlobalIntent:record,onOpenCandidate:()=>open(),
    onTimesheets:record,onSort:record,onPage:record,onError:record});
  mainHost.append(main.element);main.publish(current.summary);
  const originalMainRow=main.element.querySelector('[data-banking-pay-v2-candidate-row]');
  function close(){child?.destroy();child=null;childHost.hidden=true;mainHost.hidden=false;result.textContent='Returned to the same mounted main candidate row.';}
  function open(){
    if(child)return;
    child=window.CloudTMSBankingPayCandidateV2.create({document,onClose:close,
      onIntent:value=>{commands.push(value);result.textContent=`Intent recorded; display unchanged until accepted: ${value.kind}`;},
      onLegacyAction:value=>{commands.push({action:value.action,selected:value.selected,kind:value.event_kind,attributes:{...value.element.dataset}});
        result.textContent=`Existing action recorded once: ${value.action}. No server operation was called.`;},
      onFailure:value=>{result.textContent=`Visible component failure: ${value.code}`;}});
    child.prepare(current)();childHost.append(child.element);childHost.hidden=false;mainHost.hidden=true;
  }
  function apply(){
    const next=fixture.snapshot();next.page.progress_counter_version=4;next.summary.progress_counter_version=4;
    next.page.rows.forEach(row=>row.selected=true);next.context=fixture.context({ready:next.page.rows});
    Object.assign(next.candidate,{selected_ready_count:4,selection_state:'ALL',selected_display_amount:'416.00',child_revision:'2:4:fixture'});
    Object.assign(next.summary.global,{selected_ready_count:4,selection_state:'ALL',selected_ready_display_amount:'416.00'});
    const commit=child?.prepare(next);main.publish(next.summary);commit?.();current=next;
    result.textContent='Fixed accepted fixture: £416.00. Main row retained; current candidate details updated.';
  }
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  function runChecks(){
    try{
      close();current=fixture.snapshot();main.publish(current.summary);open();commands.length=0;
      const view=child.element;const header=view.querySelector('[data-bpv2-child="include"]');
      check(header.indeterminate,'Candidate half tick missing');
      const mainBefore=originalMainRow.outerHTML;
      const group=view.querySelector('[data-action="banking:pay:toggleTimesheetPreviewGroup"]');
      check(group.indeterminate,'Timesheet group half tick missing');
      group.click();check(commands.length===1&&commands[0].selected===true,'Exactly one explicit selection intent');
      check(group.indeterminate&&group.checked===false,'Selection changed before server response');
      check(originalMainRow.outerHTML===mainBefore,'Child intent changed main amount prematurely');
      const expand=view.querySelector('[data-action="banking:pay:toggleTimesheetBreakdown"]');expand.click();
      check(expand.getAttribute('aria-expanded')==='true','Breakdown did not expand');
      check(!view.querySelector('template[data-banking-ready-breakdown-template]'),'Template did not materialise');
      check(commands.length===1,'Local expansion called a server action');
      const checkbox=view.querySelector('[data-action="banking:pay:togglePreviewRow"]');checkbox.focus();
      const rowId=checkbox.dataset.previewRowId;apply();
      check(view.querySelector('[data-bpv2-child="include"]').checked,'Accepted candidate selection did not update');
      check(view.querySelector('[aria-expanded="true"]'),'Expansion lost on accepted refresh');
      check(document.activeElement?.dataset.previewRowId===rowId,'Focused checkbox not restored');
      check(main.element.querySelector('[data-banking-pay-v2-candidate-row]')===originalMainRow,'Main row rebuilt');
      const before=view.innerHTML;const bad=fixture.snapshot();bad.page.rows[0].candidate_id=fixture.id(2);
      let rejected=false;try{child.prepare(bad)();}catch{rejected=true;}
      check(rejected&&view.innerHTML===before,'Invalid candidate page partly published');
      child.setBusy(true);const busyCommands=commands.length;
      const currentGroup=view.querySelector('[data-action="banking:pay:toggleTimesheetPreviewGroup"]');
      check(currentGroup.disabled,'Current group checkbox not disabled while busy');currentGroup.click();
      check(commands.length===busyCommands,'Busy view dispatched an action');child.setBusy(false);
      check(!view.querySelector('[data-bpv2-child="include"]').disabled,'Busy state remained stuck');
      const offPage=fixture.snapshot();delete offPage.candidate;
      offPage.summary.rows=[{...offPage.page.candidate,candidate_id:fixture.id(2),candidate_name:'Different main-page candidate'}];
      offPage.summary.total_count=2;
      Object.assign(offPage.summary.global,{candidate_count:2,selected_candidate_count:2,selectable_ready_count:8,
        selected_ready_count:6,selected_ready_display_amount:'457.00'});
      child.prepare(offPage)();
      check(view.querySelector('[data-bpv2-candidate-amount]').textContent==='Ready to pay £228.50','Off-page child lost its current amount');
      check(view.querySelector('[data-bpv2-child="include"]').indeterminate,'Off-page child lost its complete selection state');
      child.prepare(current)();
      close();check(!mainHost.hidden&&originalMainRow.isConnected,'Main view not retained on close');
      for(let i=0;i<20;i++){open();close();}open();commands.length=0;
      child.element.querySelector('[data-action="banking:pay:toggleTimesheetPreviewGroup"]').click();
      check(commands.length===1,'Duplicate handlers after reopen cycles');
      result.textContent='PASS — 13 component groups: candidate/group half tick; exact one intent; non-optimistic display; local expansion; accepted update; focus; main node retained; invalid-page rejection; busy controls; off-page candidate header; close restoration; 20 reopen cycles; one handler.';
    }catch(error){result.textContent=`FAIL — ${error.message}`;}
  }
  document.getElementById('open').addEventListener('click',open);
  document.getElementById('apply').addEventListener('click',apply);
  document.getElementById('invalid').addEventListener('click',()=>{open();const bad=fixture.snapshot();bad.page.progress_counter_version=99;
    try{child.prepare(bad)();result.textContent='FAIL — invalid page was accepted';}catch{child.showFailure('The payment list changed. Refresh Banking Pay before continuing.');result.textContent='PASS — invalid revision rejected; previous details retained.';}});
  document.getElementById('checks').addEventListener('click',runChecks);
})();

// Synthetic browser fixture. No application request or financial operation.
(function(){
  const host=document.getElementById('host');
  const result=document.getElementById('result');
  const fixture=window.BankingTableFixture;
  let table; let current; let firstNode; let events=[]; let parentDoubleClicks=0;
  host.addEventListener('dblclick',()=>{parentDoubleClicks++;});
  function record(type,value){events.push({type,...value});result.textContent=JSON.stringify({events,parentDoubleClicks});}
  function reset(){
    if(table) table.destroy();
    events=[];parentDoubleClicks=0;current=fixture.page();
    table=window.CloudTMSBankingPayTableV2.createCandidateTable({document,
      onCandidateIntent:value=>record('candidate',value),onGlobalIntent:value=>record('global',value),
      onTimesheets:value=>record('timesheets',value),onOpenCandidate:value=>record('open',value),
      onSort:value=>record('sort',value),onPage:value=>record('page',value),onError:()=>{result.textContent='Visible error';}});
    host.append(table.element);table.publish(current);firstNode=host.querySelector('tbody tr');result.textContent='Fixture ready';
  }
  document.getElementById('reset').addEventListener('click',reset);
  document.getElementById('apply').addEventListener('click',()=>{
    const position=table.capturePosition();
    current={...current,progress_counter_version:4,rows:current.rows.map((row,index)=>index?row:{...row,
      selected_ready_count:2,selection_state:'ALL',selected_display_amount:'25.00',selected_timesheet_count:2,
      selected_timesheet_ids:[fixture.id(2001),fixture.id(2003)],child_revision:'fixture-revision-4'}),
      global:{...current.global,selected_ready_count:5,selected_ready_display_amount:'235.00'}};
    table.publish(current);table.restorePosition(position);
    result.textContent=JSON.stringify({accepted:true,rowNodeRetained:firstNode===host.querySelector('tbody tr')});
  });
  document.getElementById('invalid').addEventListener('click',()=>{
    const before=host.innerHTML;
    try{table.publish({...current,global:{...current.global,selected_ready_display_amount:100}});result.textContent='ERROR: accepted invalid response';}
    catch{result.textContent=JSON.stringify({invalidRejected:true,unchanged:before===host.innerHTML});}
  });
  document.getElementById('narrow').addEventListener('click',()=>{host.style.width=host.style.width?'':'440px';});
  document.getElementById('large').addEventListener('click',()=>{
    current={...current,rows:current.rows.map((row,index)=>index?row:{...row,selected_display_amount:'9999999999999999.99'})};
    table.publish(current);
  });
  document.getElementById('cycles').addEventListener('click',()=>{
    for(let cycle=0;cycle<20;cycle++)reset();
    result.textContent=JSON.stringify({cycles:20,mountedTables:host.querySelectorAll('table').length,
      mountedRows:host.querySelectorAll('tbody tr').length});
  });
  document.getElementById('staging').addEventListener('click',()=>{
    const check=(condition,message)=>{if(!condition)throw Error(message);};
    const rejects=fn=>{try{fn();return false;}catch{return true;}};
    try{
      reset();const before=host.innerHTML;const next={...current,progress_counter_version:4,
        global:{...current.global,selected_ready_display_amount:'235.00'}};
      const commit=table.prepare(next);
      check(host.innerHTML===before,'Preparation touched accepted DOM');
      const invalid={...next,global:{...next.global,selected_ready_display_amount:123}};
      check(rejects(()=>table.prepare(invalid))&&host.innerHTML===before,'Invalid stage changed accepted DOM');
      commit();check(firstNode===host.querySelector('tbody tr'),'Accepted main row node was rebuilt');
      check(host.querySelector('[data-bpv2-headline]').textContent==='Ready to pay £235.00','Complete next headline missing');
      const after=host.innerHTML;check(rejects(commit)&&host.innerHTML===after,'A staged commit ran twice');
      const obsolete=table.prepare({...next,progress_counter_version:5});
      table.publish({...next,progress_counter_version:6,global:{...next.global,selected_ready_display_amount:'240.00'}});
      const newer=host.innerHTML;check(rejects(obsolete)&&host.innerHTML===newer,'An older stage overwrote the current table');
      const closing=table.prepare({...next,progress_counter_version:7});table.destroy();
      check(rejects(closing)&&host.querySelectorAll('table').length===0,'A closed table accepted a pending stage');
      reset();result.textContent='PASS — staged adoption: no preparation side effects; invalid input unchanged; existing row retained; exact headline; one-use commit; stale stage rejected; closed stage rejected.';
    }catch(error){result.textContent='FAIL — '+error.message;}
  });
  reset();
})();

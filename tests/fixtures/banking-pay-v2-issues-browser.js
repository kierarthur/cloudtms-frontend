// Explicit fixed-response fixtures. The real presenter is exercised here, not
// an imitation UI. All callbacks record intents; no service can be contacted.
(()=>{
  const api=window.CloudTMSBankingPayIssuesV2,fixture=window.BankingDetailFixture,copy=window.CloudTMSBankingPayCopyV2;
  const host=document.getElementById('host'),result=document.getElementById('result');
  const commands=[];let view=null,current=null;
  function data(kind){
    const summary=fixture.snapshot().summary;
    Object.assign(summary.global,{action_required_count:4,updating_count:2,blocked_count:3});
    const common={ok:true,contract:summary.contract,contract_version:1,session_id:summary.session_id,
      session_version:summary.session_version,progress_counter_version:summary.progress_counter_version,scope_hash:summary.scope_hash,
      search:'',sort_key:api.definitions[kind].columns[0][2]||api.definitions[kind].columns[0][0],sort_direction:'ASC',next_cursor:null,has_more:false,
      page_number:1,has_previous:false,previous_cursor:null};
    const rows=kind==='actions'?[
      {identity:'fixture_method',title:copy.message('MSG-044'),affected_candidate_count:1,affected_payment_count:2,affected_payment_count_complete:true},
      {identity:'fixture_rate',title:copy.message('MSG-045'),affected_candidate_count:1,affected_payment_count:3,affected_payment_count_complete:true},
      {identity:'fixture_name',title:copy.message('MSG-071'),affected_candidate_count:1,affected_payment_count:1,affected_payment_count_complete:true},
      {identity:'fixture_bank_details',title:copy.message('MSG-067'),affected_candidate_count:10,affected_payment_count:24,affected_payment_count_complete:true}
    ]:[
      {identity:'fixture_recovery',candidate_id:fixture.id(1),candidate_name:'Synthetic candidate A',candidate_reference:'TEST-001',reason:copy.message('MSG-030'),affected_display_amount:'75.00'},
      {identity:'fixture_recovery_2',candidate_id:fixture.id(2),candidate_name:'Synthetic candidate B',candidate_reference:'TEST-002',reason:copy.message('MSG-030'),affected_display_amount:'18.50'},
      {identity:'fixture_unknown',candidate_id:fixture.id(3),candidate_name:'Synthetic candidate C',candidate_reference:'TEST-003',reason:copy.message('MSG-090'),affected_display_amount:null}
    ];
    if(kind==='actions')rows.forEach(row=>row.issue_state='ACTION_REQUIRED');
    return {kind,summary,page:{...common,rows,total_count:rows.length,scope_count:rows.length,...(kind==='actions'?{
      view:'ACTION_REQUIRED',updating_count:2,updating_has_more:false,updating_next_cursor:null,
      updating:[1,2].map(n=>({identity:'updating_'+n,issue_state:'UPDATING',title:'Refreshing…',affected_candidate_count:1,
        affected_payment_count:null,affected_payment_count_complete:false}))}: {})}};
  }
  const record=value=>{commands.push(value);result.textContent='Recorded one component intent; no service was called.';};
  function close(){view?.destroy();view=null;result.textContent='Back to Banking Pay recorded.';}
  function open(kind){close();current=data(kind);view=api.create({document,kind,onIntent:record,onOpenDetail:record,
    onOpenUpdating:record,onViewTimesheets:record,onClose:close,onFailure:record});host.append(view.element);view.prepare(current.page,current.summary)();}
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  function run(){
    try{
      for(const kind of ['actions','blocked']){
        open(kind);const root=view.element;
        check(root.querySelectorAll('thead th').length===(kind==='actions'?4:3),'Issue column count changed');
        check(!root.querySelector('input[type="checkbox"]'),'Issue list acquired a payment checkbox');
        const first=root.querySelector('[data-bpv2-open]');commands.length=0;first.click();
        check(commands.length===1&&commands[0].key===current.page.rows[0].identity,'Exact detail key lost or duplicated');
        commands.length=0;root.querySelector('[data-bpv2-issue-sort]').click();
        check(commands.length===1&&commands[0].command==='sort'&&commands[0].sort_direction==='DESC','Sort intent lost');
        const search=root.querySelector('input');search.value='  Synthetic %_  ';commands.length=0;
        root.querySelector('form').requestSubmit();
        check(commands.length===1&&commands[0].search==='Synthetic %_'&&!Object.hasOwn(commands[0].authority,'search'),'Search changed payment authority');
        view.setBusy(true);const next=structuredClone(current);
        next.page.progress_counter_version++;next.summary.progress_counter_version++;
        view.prepare(next.page,next.summary)();view.setBusy(false);current=next;
        check(!search.disabled&&!root.querySelector('[data-bpv2-issue-sort]').disabled,'Controls stayed disabled after accepted update');
        check(root.querySelector('[data-bpv2-issue-command="next"]').disabled,'End-of-list Next incorrectly enabled');
        const html=root.innerHTML;const bad=structuredClone(current);bad.page.progress_counter_version--;
        try{view.prepare(bad.page,bad.summary);throw new Error('Invalid page accepted');}
        catch(error){check(error.message!=='Invalid page accepted','Invalid page accepted');}
        check(root.innerHTML===html,'Invalid response changed visible list');
        const focused=root.querySelector('[data-bpv2-open]');focused.focus();view.prepare(current.page,current.summary)();
        check(document.activeElement?.dataset?.bpv2Open===current.page.rows[0].identity,'Focused task lost after adoption');
        view.showFailure('Visible fixture retry state.');check(!root.querySelector('[role="status"]').hidden,'Failure hidden');
        const unmatched=structuredClone(current);Object.assign(unmatched.page,{search:'unmatched',rows:[],total_count:0,page_number:0});
        view.prepare(unmatched.page,unmatched.summary)();
        check(root.querySelector('[data-bpv2-issue-count]').textContent.includes('0 matching'),'Search empty state not explicit');
        check(unmatched.summary.global.selected_ready_display_amount==='228.50','List query changed payment headline');
        view.prepare(current.page,current.summary)();
        const updating=root.querySelector('[data-bpv2-issue-command="updating"]');
        check(updating.hidden===(kind!=='actions'),'Updating appeared in Blocked or disappeared from Action');
        if(kind==='actions'){
          commands.length=0;updating.click();check(commands.length===1,'Updating navigation not singular');
          const active=structuredClone(current);
          Object.assign(active.page,{view:'UPDATING',rows:active.page.updating,total_count:2,scope_count:2,
            sort_key:'TITLE',sort_direction:'ASC',search:'',page_number:1,has_previous:false,previous_cursor:null});
          view.prepare(active.page,active.summary,{returnToActions:true})();
          check(root.getAttribute('aria-label')==='Updating'&&root.querySelector('h2').textContent==='Updating','Updating not separately labelled');
          check(root.querySelector('form').hidden&&updating.hidden,'Updating gained search or recursive Updating control');
          check([...root.querySelectorAll('[data-bpv2-issue-sort]')].every(button=>button.disabled),'Updating acquired sorting controls');
          check(root.getAttribute('aria-label')==='Updating','Updating return location unclear');
          check(root.querySelectorAll('tbody tr').length===2,'Updating tasks disappeared');
          commands.length=0;root.querySelector('[data-bpv2-open]').click();check(commands.length===1&&commands[0].key==='updating_1','Updating exact detail lost');
          view.prepare(current.page,current.summary)();
          check(!root.querySelector('form').hidden&&!root.querySelector('[data-bpv2-issue-sort]').disabled,'Returning from Updating lost Action controls');
        }
        const width=host.style.width;host.style.width='380px';
        check(root.querySelector('table').scrollWidth>root.querySelector('.bpv2-issue-scroll').clientWidth,'Narrow table lost horizontal overflow');host.style.width=width;
        const oldButton=root.querySelector('[data-bpv2-open]');close();commands.length=0;oldButton.click();
        check(commands.length===0,'Destroyed view still dispatched an action');
      }
      for(let i=0;i<20;i++)open(i%2?'actions':'blocked');
      check(host.querySelectorAll('.banking-pay-v2-issues').length===1,'Reopen left duplicate list nodes');
      commands.length=0;view.element.querySelector('[data-bpv2-open]').click();check(commands.length===1,'Reopen duplicated handlers');
      open('actions');result.textContent='PASS — both issue-list components: exact detail/sort/search intents; accepted-update controls; page-end controls; invalid-response rejection; focus; visible failure; filtered empty state; unchanged payment headline; separate Updating; narrow overflow; teardown; 20 reopen cycles with one handler.';
    }catch(error){result.textContent=`FAIL — ${error.message}`;}
  }
  document.getElementById('actions').addEventListener('click',()=>open('actions'));
  document.getElementById('blocked').addEventListener('click',()=>open('blocked'));
  document.getElementById('checks').addEventListener('click',run);open('actions');
})();

(() => {
  if(location.hostname!=='127.0.0.1') throw new Error('Fixture must run locally');
  const clientId='70000000-0000-4000-8000-000000000001',candidateId='70000000-0000-4000-8000-000000000002';
  let client={id:clientId,name:'Northshire Community Health',primary_invoice_email:'accounts@example.invalid',invoice_address:'Finance department\n12 Station Road',ap_phone:'020 7000 0000',vat_chargeable:true,payment_terms_days:0,client_address:'12 Station Road',contact_forename:'Sam',contact_surname:'Taylor',ts_queries_email:'staffing@example.invalid',notes:'Existing client notes'};
  let settings={timezone_id:'Europe/London',day_start:'07:00',day_end:'19:00',night_start:'19:00',night_end:'07:00',sat_start:'00:00',sat_end:'00:00',sun_start:'00:00',sun_end:'00:00',bh_start:'00:00',bh_end:'00:00',week_ending_weekday:0,default_submission_mode:'ELECTRONIC',weekly_mode:'HEALTHROSTER',hr_weekly_behaviour:'VERIFY',requires_hr:true,autoprocess_hr:true,no_timesheet_required:false,invoice_consolidation_mode:'BY_WEEK',candidate_paper_submission_enabled:false,daily_calc_of_invoices:false};
  let candidate={id:candidateId,title:'Ms',first_name:'Alex',last_name:'Morgan',display_name:'Alex Morgan',email:'alex@example.invalid',phone:'07700000000',pay_method:'PAYE',address_line1:'14 Example Street',address_line2:'Flat 2',address_line3:'',town_city:'Reading',county:'Berkshire',postcode:'RG1 1AA',country:'UK',band:'6',ni_number:'AB123456C',date_of_birth:'1990-03-15',gender:'Female',prof_reg_number:'AB123',notes:'Existing notes',key_norm:'',opt_in_email:true,opt_in_sms:true,opt_in_whatsapp:true,roles:[],job_titles:[],account_holder:'Alex Morgan',bank_name:'Example bank',sort_code:'12-34-56',account_number:'12345678',remittance_overrides_enabled:false};
  let settingsVersion=1;
  let simulateConflict=location.search.includes('conflict-test');
  const nextSettingsVersion=()=>new Date(Date.UTC(2026,7,28,12,0,settingsVersion++)).toISOString();
  settings.updated_at=nextSettingsVersion();
  const writes=[],umbrellaReads=[];
  const pickerMode=new URLSearchParams(location.search).get('rate-clients');
  const pickerClients=Array.from({length:205},(_,i)=>({id:`71000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,name:`Client ${String(i+1).padStart(3,'0')}`}));
  pickerClients.push(client,
    {id:'72000000-0000-4000-8000-000000000001',name:'Zedland Integrated Care Partnership'},
    {id:'72000000-0000-4000-8000-000000000002',name:'Riverside Historic Care'});
  pickerClients.sort((a,b)=>a.name.localeCompare(b.name));
  const pickerRates=Array.from({length:500},(_,i)=>({
    id:`73000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,client_id:clientId,role:'Registered Nurse',band:'6',
    date_from:'2026-01-01',date_to:'2026-12-31',charge_day:60,charge_night:65,charge_sat:70,charge_sun:75,charge_bh:80
  }));
  pickerRates.push(
    {...pickerRates[0],id:'74000000-0000-4000-8000-000000000001',client_id:pickerClients.find(c=>c.name.startsWith('Zedland')).id,role:'Community Nurse',band:'7'},
    {...pickerRates[0],id:'74000000-0000-4000-8000-000000000002',client_id:pickerClients.find(c=>c.name.startsWith('Riverside')).id,disabled_at_utc:'2025-12-31T00:00:00Z',date_from:'2025-01-01',date_to:'2025-12-31'}
  );
  const pickerReads=[],candidateRates=[];
  let pickerFailed=false;
  const financeMode=new URLSearchParams(location.search).get('finance');
  let financeReads=0;
  const financeSummary={
    payment_advances_count:3, payment_advances_outstanding_total:1250.5,
    overpayments_count:2, overpayments_outstanding_total:45,
    underpayments_count:1, underpayments_outstanding_total:9.99,
    manual_debt_adjustments_count:4, manual_debt_adjustments_outstanding_total:1234567.89,
    manual_credit_adjustments_count:5, manual_credit_adjustments_total:30,
    mixed_finance_cases_count:2, unresolved_finance_cases_count:3, stale_finance_cases_count:4,
    snoozed_finance_cases_count:2, active_timesheet_snoozes_count:5
  };
  // Empty financial scope: exercise the unchanged confirmation/commit client
  // contract without any live Candidate, bank, Timesheet or provider operation.
  const routeProof=(newMethod,destinationPatch)=>({
    ok:true,candidate_id:candidateId,original_method:candidate.pay_method,
    expected_old_method:candidate.pay_method,new_method:newMethod,destination_patch:destinationPatch,
    coverage_basis:'CANONICAL_TIMESHEETS_WITH_RETAINED_FINANCE_AUTHORITY',
    coverage_complete:true,exact_scope:true,exact_target_scope:true,exact_set_equality:true,
    represented_timesheet_ids:[],authorised_timesheet_ids:[],active_advance_timesheet_ids:[],
    retained_finance_timesheet_ids:[],targeted_timesheet_ids:[],canonical_qualifying_timesheet_ids:[],
    expected_targeted_timesheet_ids:[],persisted_targeted_timesheet_ids:[],
    missing_targeted_timesheet_ids:[],extra_targeted_timesheet_ids:[],replaced_source_session_ids:[],
    authoritative_sessions:[],target_details:[],blockers:[],can_apply:true,
    authoritative_session_count:0,preview_row_count:0,represented_timesheet_count:0,
    authorised_timesheet_count:0,active_advance_timesheet_count:0,retained_finance_timesheet_count:0,
    targeted_timesheet_count:0,potential_case_resolution_timesheet_count:0,
    targeted_scope_is_empty:true,effective_duplicate_count:0,invalid_target_count:0,source_target_mismatch_count:0,
    preview_source_change_seq:1,source_change_seq:2,contracts_changed:0,contract_weeks_changed:0,
    timesheets_changed:0,rates_changed:0,tsfin_repricing_rows:0,
    prospective_only:true,source_records_mutated:false,policy_x_authority_scope:'PRE_DRAFT_LIVE_TRUTH',
    policy_x_dirtying_only:true,economic_truth_mutation_allowed:false
  });
  const jobTitles=[
    {id:'70000000-0000-4000-8000-000000000010',label:'Registered Nurse',is_role:true,active:true,requires_prof_reg:true,prof_reg_type:'NMC'},
    {id:'70000000-0000-4000-8000-000000000011',label:'Community Nurse',is_role:true,active:true,requires_prof_reg:true,prof_reg_type:'NMC'}
  ];
  candidate.job_titles=jobTitles.map((j,i)=>({job_title_id:j.id,is_primary:i===0}));
  candidate.prof_reg_type='NMC';
  const output=document.createElement('pre');output.id='fixture-results';output.style.cssText='white-space:pre-wrap;color:#dce5f7;padding:20px';
  const report=()=>{output.textContent=JSON.stringify({writes,umbrellaReads,pickerReads,candidateRates,client,settings,candidate},null,2);};
  const response=(json,status=200)=>Promise.resolve(new Response(JSON.stringify(json),{status,headers:{'Content-Type':'application/json'}}));
  const fixtureFetch=async(url,init={})=>{
    const pathname=new URL(String(url),location.origin).pathname,method=(init.method||'GET').toUpperCase();
    const body=init.body?JSON.parse(init.body):{};
    if(!['GET','HEAD'].includes(method)) {
      writes.push({path:pathname,method,body});
      if(pickerMode && pathname==='/api/rates/candidate-overrides' && method==='POST') {
        const row={...body,id:'75000000-0000-4000-8000-000000000001'};candidateRates.push(row);report();return response(row);
      }
      if(pathname===`/api/clients/${clientId}/printed-timesheet-policy`) {
        if(simulateConflict){simulateConflict=false;settings={...settings,updated_at:nextSettingsVersion()};}
        if (body.expected_settings_updated_at!==settings.updated_at) {report();return response({error:'Client settings changed. Reload and try again.',error_code:'CLIENT_SETTINGS_CONFLICT'},409);}
        settings={...settings,candidate_paper_submission_enabled:body.enabled,updated_at:nextSettingsVersion()};
        report();return response({ok:true,client_settings:settings});
      }
      if(pathname===`/api/candidates/${candidateId}/pay-method-change`) {
        const proof=routeProof(body.new_method,body.destination_patch);
        candidate={...candidate,pay_method:body.new_method,
          account_holder:null,bank_name:null,sort_code:null,account_number:null,umbrella_id:null,
          ...body.destination_patch};
        report();return response({...proof,candidate,operation_id:body.operation_id,
          current_method:body.new_method,operation_committed:true,operation_superseded_by_later_change:false,
          job_id:'70000000-0000-4000-8000-000000000030',job_status:'SUCCEEDED',
          refresh_accepted:true,durable_queue_retained:true,refresh_completed:true,refresh_pending:false,refreshing:false});
      }
      if(/^\/api\/clients(?:\/[^/]+)?$/.test(pathname)) {
        const { client_settings: initialSettings, ...clientFields } = body;
        if (method === 'POST') {
          client = { ...clientFields, id: clientId };
          settings = { candidate_paper_submission_enabled: false };
        }
        if(body.client_settings) {
          const settingsPatch = { ...initialSettings };
          // The real broad update route cannot alter the dedicated Printed QR policy.
          if (method !== 'POST') delete settingsPatch.candidate_paper_submission_enabled;
          settings={...settings,...settingsPatch};
          // Writes use the existing canonical flags, not the UI's mode aliases.
          settings.weekly_mode=settings.is_nhsp?'NHSP':settings.requires_hr?'HEALTHROSTER':'NONE';
          settings.hr_weekly_behaviour=settings.requires_hr&&settings.no_timesheet_required?'CREATE':'VERIFY';
          settings.updated_at=nextSettingsVersion();
        } else if (method !== 'POST') client={...client,...clientFields,id:clientId};
        report();return response({ok:true,client,client_settings:settings,id:clientId});
      }
      if(/^\/api\/candidates(?:\/[^/]+)?$/.test(pathname)) {candidate={...(method==='POST'?{}:candidate),...body,id:candidateId};report();return response({ok:true,candidate,id:candidateId});}
      report();return response({ok:true});
    }
    if(pathname.endsWith('/delete-eligibility'))return response({can_delete:false,reason:'Local fixture'});
    if(pathname===`/api/candidates/${candidateId}/advances/report`) {
      financeReads++;
      if(financeMode==='loading') await new Promise(resolve=>setTimeout(resolve,2500));
      if(financeMode==='error' || (financeMode==='retry' && financeReads===1)) return response({error:'Fixture unavailable'},503);
      return response({summary:financeMode==='populated'?financeSummary:{},finance_cases:[],timesheet_snoozes:[]});
    }
    if(pickerMode && pathname==='/api/rates/candidate-overrides') return response({items:candidateRates});
    if(pickerMode && (pathname==='/api/clients' || pathname==='/api/rates/client-defaults')) {
      const params=new URL(String(url),location.origin).searchParams;
      const offset=Number(params.get('offset')||0),limit=Number(params.get('limit')||(pathname==='/api/clients'?50:100));
      const selected=params.get('client_id'),active=params.get('active_on');
      const read={path:pathname,offset,limit,client:selected,completed:false};pickerReads.push(read);report();
      if(pickerMode==='retry' && pathname.endsWith('client-defaults') && offset===500 && !pickerFailed) {
        pickerFailed=true;read.completed=true;report();return response({error:'Fixture rate page unavailable'},503);
      }
      if(pickerMode==='slow' && selected===clientId) await new Promise(resolve=>setTimeout(resolve,1400));
      let rows=pathname==='/api/clients'?pickerClients:pickerRates;
      if(selected) rows=rows.filter(row=>row.client_id===selected);
      if(params.get('only_enabled')==='true') rows=rows.filter(row=>!row.disabled_at_utc);
      if(active) rows=rows.filter(row=>row.date_from<=active&&(!row.date_to||row.date_to>=active));
      read.completed=true;report();return response({items:rows.slice(offset,offset+limit)});
    }
    if(pathname===`/api/clients/${clientId}`)return response({client,client_settings:settings,has_e_history:false});
    if(pathname===`/api/candidates/${candidateId}`)return response({candidate,job_titles:candidate.job_titles.map((j,i)=>typeof j==='string'?{job_title_id:j,is_primary:i===0}:j),hr_aliases:[],has_e_history:false});
    if(pathname==='/api/job-titles')return response({items:jobTitles});
    if(pathname===`/api/candidates/${candidateId}/pay-method-change-preview`) {
      const params=new URL(String(url),location.origin).searchParams,newMethod=params.get('new_method');
      return response(routeProof(newMethod,newMethod==='UMBRELLA'?{umbrella_id:params.get('umbrella_id')}:{}));
    }
    if(pathname==='/api/search/umbrellas')return response({items:[
      {id:'70000000-0000-4000-8000-000000000020',name:'Example Umbrella'},
      {id:'70000000-0000-4000-8000-000000000021',name:'Second Umbrella'}
    ]});
    if(pathname==='/api/umbrellas/70000000-0000-4000-8000-000000000021') {
      return response({umbrella:{id:'70000000-0000-4000-8000-000000000021',name:'Second Umbrella',bank_name:'Second fixture bank',sort_code:'65-43-21',account_number:'87654321'}});
    }
    if(pathname==='/api/umbrellas/70000000-0000-4000-8000-000000000020') {
      // Exercise real async pay-tab mounting before its frame finishes changing tab.
      const read={completed:false};umbrellaReads.push(read);report();
      await new Promise(resolve=>setTimeout(resolve,location.search.includes('slow-umbrella')?1200:250));
      read.completed=true;report();
      return response({umbrella:{id:'70000000-0000-4000-8000-000000000020',name:'Example Umbrella',account_holder:'Example Umbrella',bank_name:'Fixture bank',sort_code:'20-30-40',account_number:'11223344'}});
    }
    if(pathname.includes('printed-timesheet')) return response({ok:true,candidate_paper_submission_enabled:settings.candidate_paper_submission_enabled});
    if(pathname.includes('/settings'))return response({settings:{},client_settings:settings});
    return response({ok:true,rows:[],items:[],clients:[],candidates:[],roles:[],job_titles:[],total:0});
  };
  // Only this local fixture replaces transports. No application code uses this.
  authFetch=fixtureFetch;
  window.fetch=fixtureFetch;
  const ready=()=>{
    for(const id of ['loginOverlay','tfaOverlay']){const el=document.getElementById(id);if(el)el.style.display='none';}
    const nav=document.createElement('div');nav.id='fixture-launchers';nav.style.cssText='position:relative;z-index:2;display:flex;flex-wrap:wrap;gap:12px;padding:24px;background:#0c172a';
    const actions=[['New candidate',()=>openCandidate({})],['Existing candidate',()=>openCandidate({id:candidateId})],['New client',()=>openClient({})],['Existing client',()=>openClient({id:clientId})]];
    actions.push(['Existing umbrella candidate',()=>{candidate.pay_method='UMBRELLA';candidate.umbrella_id='70000000-0000-4000-8000-000000000020';return openCandidate({id:candidateId});}]);
    for(const[label,action]of actions){const b=document.createElement('button');b.className='btn';b.textContent=label;b.onclick=async()=>{try{await action();}catch(error){output.textContent=JSON.stringify({fixtureError:String(error),stack:error.stack});}};nav.append(b);}
    document.body.prepend(nav);document.body.append(output);report();
  };
  setTimeout(ready,700);
})();

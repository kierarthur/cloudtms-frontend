(function managerAuthorisersModule(){
  'use strict';
  const cache=new Map();
  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalEmail=(value)=>String(value||'').trim().toLowerCase();
  const normalDomain=(value)=>String(value||'').trim().toLowerCase().replace(/^@+/, '');
  const emailRe=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const domainRe=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  async function request(path,method='GET',body=null){
    const response=await authFetch(API(path),{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(String(payload?.message||payload?.error||'The authoriser settings could not be loaded.'));
    return payload;
  }
  function contextFromDom(){
    const ctx=window.modalCtx||{};
    const entity=String(ctx.entity||'');
    const id=String(ctx.data?.id||'');
    if((entity==='clients'||entity==='contracts')&&id) return {kind:entity==='clients'?'CLIENT':'CONTRACT',id,name:String(ctx.data?.name||ctx.data?.client_name||ctx.data?.display_name||'').trim()};
    return null;
  }
  function keyOf(ctx){return `${ctx.kind}:${ctx.id}`;}
  function policyCounts(data,ctx){
    const p=ctx.kind==='CLIENT'?data.policy:data.effective_policy;
    return {emails:Array.isArray(p?.approved_emails)?p.approved_emails:[],domains:Array.isArray(p?.approved_domains)?p.approved_domains:[],allowOther:p?.allow_free_business_email===true};
  }
  function summaryCopy(data,ctx){
    const counts=policyCounts(data,ctx); const total=counts.emails.length+counts.domains.length;
    if(ctx.kind==='CLIENT') return {status:counts.allowOther?'Other permitted business emails allowed':'Restricted to approved authorisers',detail:`${counts.emails.length} approved address${counts.emails.length===1?'':'es'} · ${counts.domains.length} approved domain${counts.domains.length===1?'':'s'}`,total,counts};
    const mode=String(data.contract_policy?.mode||data.effective_policy?.source_mode||'INHERIT').toUpperCase();
    const additions=Number(data.contract_approved_count||0); const effective=Number(data.effective_approved_count||total);
    return {status:mode==='CONTRACT_ONLY'?`Uses only ${effective} Contract-approved authoriser${effective===1?'':'s'}`:`Uses Client authorisers · ${additions} Contract addition${additions===1?'':'s'}`,detail:`${effective} effective approved authoriser${effective===1?'':'s'}${counts.allowOther?' · Other permitted business emails allowed':''}`,total:effective,counts};
  }
  async function load(ctx,force=false){
    const key=keyOf(ctx); if(!force&&cache.has(key)) return cache.get(key);
    const path=ctx.kind==='CLIENT'?`/api/clients/${encodeURIComponent(ctx.id)}/manager-authorisers`:`/api/contracts/${encodeURIComponent(ctx.id)}/manager-authorisers`;
    const data=await request(path); cache.set(key,data); return data;
  }
  function withStagedContractPolicy(data,ctx){
    if(ctx.kind!=='CONTRACT')return data;
    const modal=window.modalCtx||{};
    const staged=String(modal.entity||'')==='contracts'&&String(modal.data?.id||'')===String(ctx.id)
      ? modal.__stagedManagerAuthoriserPolicy
      : null;
    if(!staged?.policy)return data;
    const policy=staged.policy;
    const contractCount=(policy.approved_emails?.length||0)+(policy.approved_domains?.length||0);
    const clientCount=Number(data.client_approved_count||0);
    const contractOnly=String(policy.mode||'INHERIT').toUpperCase()==='CONTRACT_ONLY';
    return {...data,contract_policy:policy,contract_approved_count:contractCount,effective_approved_count:contractOnly?contractCount:clientCount+contractCount,effective_policy:{...(data.effective_policy||{}),approved_emails:contractOnly?[...(policy.approved_emails||[])]:[...(data.client_policy?.approved_emails||[]),...(policy.approved_emails||[])],approved_domains:contractOnly?[...(policy.approved_domains||[])]:[...(data.client_policy?.approved_domains||[]),...(policy.approved_domains||[])],source_mode:policy.mode}};
  }
  function summaryHtml(data,ctx){
    data=withStagedContractPolicy(data,ctx);
    const s=summaryCopy(data,ctx); const preview=[...s.counts.emails,...s.counts.domains.map((d)=>`@${normalDomain(d)}`)];
    const frame=window.__getModalFrame?.();
    const canManage=ctx.kind==='CLIENT'||(frame?.kind==='contracts'&&frame?.mode==='edit');
    const staged=ctx.kind==='CONTRACT'&&!!window.modalCtx?.__stagedManagerAuthoriserPolicy;
    return `<div class="ma-summary__top"><div><h3>Timesheet authorisers${staged?' <span class="ma-chip">Prepared</span>':''}</h3><p><strong>${esc(s.status)}</strong><br>${esc(s.detail)}</p></div>${canManage?`<button type="button" class="btn btn-primary" data-ma-manage="${esc(ctx.kind)}" data-ma-id="${esc(ctx.id)}">Manage authorisers</button>`:''}</div><div class="ma-chips">${preview.slice(0,3).map((x)=>`<span class="ma-chip">${esc(x)}</span>`).join('')}${preview.length>3?`<span class="ma-chip">+${preview.length-3} more</span>`:''}</div>${ctx.kind==='CONTRACT'&&!canManage?'<p class="mini">Click Edit to change Contract authorisers.</p>':''}`;
  }
  async function inject(root,ctx,location){
    if(!root||root.querySelector(`.ma-summary[data-ma-location="${location}"]`))return;
    const panel=document.createElement('section'); panel.className='ma-summary'; panel.dataset.maLocation=location; panel.innerHTML='<p>Loading timesheet authorisers…</p>';
    root.insertBefore(panel,root.firstChild);
    try{const data=await load(ctx); if(panel.isConnected)panel.innerHTML=summaryHtml(data,ctx);}catch(error){if(panel.isConnected)panel.innerHTML=`<div class="ma-summary__top"><div><h3>Timesheet authorisers</h3><p>${esc(error.message)}</p></div><button type="button" class="btn btn-outline" data-ma-retry="1">Try again</button></div>`;}
  }
  function refreshParent(ctx){
    document.querySelectorAll('.ma-summary').forEach((node)=>node.remove());
    void scan();
  }
  async function scan(){
    const ctx=contextFromDom(); if(!ctx)return;
    const clientRoot=document.getElementById('clientSettingsForm'); if(ctx.kind==='CLIENT'&&clientRoot)await inject(clientRoot,ctx,'client-settings');
    const contractRoot=document.getElementById('contractForm'); if(ctx.kind==='CONTRACT'&&contractRoot)await inject(contractRoot,ctx,'contract-main');
  }
  function makeState(data,ctx){
    if(ctx.kind==='CLIENT')return {emails:[...(data.policy?.approved_emails||[])],domains:[...(data.policy?.approved_domains||[])],restricted:data.policy?.allow_free_business_email!==true,contractOnly:false,mode:'CLIENT',version:data.settings_updated_at,dirty:false,error:''};
    const p=data.contract_policy||{}; const mode=String(p.mode||'INHERIT').toUpperCase();
    return {emails:[...(p.approved_emails||[])],domains:[...(p.approved_domains||[])],restricted:true,contractOnly:mode==='CONTRACT_ONLY'||!['INHERIT','EXTEND'].includes(mode),mode,version:data.contract_updated_at,dirty:false,error:'',clientCount:Number(data.client_approved_count||0),effectiveCount:Number(data.effective_approved_count||0),clientEmails:[...(data.client_policy?.approved_emails||[])].map(normalEmail),clientDomains:[...(data.client_policy?.approved_domains||[])].map(normalDomain)};
  }
  function validate(state,ctx){
    state.emails=state.emails.map(normalEmail).filter(Boolean); state.domains=state.domains.map(normalDomain).filter(Boolean);
    if(state.emails.some((x)=>!emailRe.test(x)))return 'Enter each approved email address in full.';
    if(state.domains.some((x)=>!domainRe.test(x)))return 'Enter each domain in a format such as @berkshire.nhs.uk.';
    if(new Set(state.emails).size!==state.emails.length)return 'This address is already approved.';
    if(new Set(state.domains).size!==state.domains.length)return 'This domain is already approved.';
    if(ctx.kind==='CONTRACT'&&!state.contractOnly&&state.emails.some((value)=>state.clientEmails.includes(value)))return 'This address is already approved in Client settings.';
    if(ctx.kind==='CONTRACT'&&!state.contractOnly&&state.domains.some((value)=>state.clientDomains.includes(value)))return 'This domain is already approved in Client settings.';
    if(ctx.kind==='CLIENT'&&state.restricted&&!state.emails.length&&!state.domains.length)return 'Add at least one email address or domain before restricting authorisers.';
    if(ctx.kind==='CONTRACT'&&state.contractOnly&&!state.emails.length&&!state.domains.length)return 'Add at least one Contract email address or domain before excluding Client authorisers.';
    return '';
  }
  function renderManager(root,state,data,ctx){
    const effective=ctx.kind==='CLIENT'?state.emails.length+state.domains.length:(state.contractOnly?state.emails.length+state.domains.length:Number(data.client_approved_count||0)+state.emails.length+state.domains.length);
    const contractHeading=[data.client_name,ctx.name].map((value)=>String(value||'').trim()).filter(Boolean).join(' · ')||'Contract';
    root.innerHTML=`<div class="ma-modal">
      <div class="ma-lead"><div class="ma-modal__heading"><div><h3>${ctx.kind==='CLIENT'?`Approved timesheet authorisers — ${esc(data.client_name||ctx.name||'Client')}`:`Approved timesheet authorisers — ${esc(contractHeading)}`}</h3><p>Set the business email addresses a Candidate can use when requesting manager approval.</p></div></div>
      ${ctx.kind==='CLIENT'?`<label class="ma-toggle"><input type="checkbox" data-ma-field="restricted" ${state.restricted?'checked':''}><span><strong>Only allow approved authorisers</strong><span>When off, Candidates may also enter another permitted business email. Global barred-domain rules still apply.</span></span></label>`:`<label class="ma-toggle"><input type="checkbox" data-ma-field="contract-only" ${state.contractOnly?'checked':''}><span><strong>Use only this Contract’s approved authorisers</strong><span>Client-approved email addresses and domains will not be accepted for this Contract.</span></span></label>${state.contractOnly?'<div class="ma-client-excluded">Client rules excluded</div>':''}`}
      <div class="ma-effective"><div class="ma-metric"><strong>${ctx.kind==='CONTRACT'?Number(data.client_approved_count||0):state.emails.length}</strong><span>${ctx.kind==='CONTRACT'?'Client approved':'Email addresses'}</span></div><div class="ma-metric"><strong>${ctx.kind==='CONTRACT'?state.emails.length+state.domains.length:state.domains.length}</strong><span>${ctx.kind==='CONTRACT'?'Contract added':'Domains'}</span></div><div class="ma-metric"><strong>${effective}</strong><span>Effective choices</span></div></div></div>
      ${entrySection('Email addresses','Add email address','email',state.emails)}
      ${entrySection('Approved domains','Add domain','domain',state.domains)}
      <div class="ma-error ${state.error?'is-visible':''}" role="alert">${esc(state.error)}</div>
      <div class="ma-footer"><span class="ma-status">${state.dirty?'Unsaved changes':'All changes saved'}</span><button type="button" class="btn btn-outline" data-ma-action="cancel">Cancel</button><button type="button" class="btn btn-primary" data-ma-action="save" ${state.dirty?'':'disabled'}>Save authorisers</button></div>
    </div>`;
  }
  function entrySection(title,addLabel,type,items){
    return `<section class="ma-section"><div class="ma-section__heading"><div><h3>${esc(title)}</h3><p>${type==='domain'?'Candidates type only the part before the selected @domain.':'Candidates can choose any exact approved address.'}</p></div></div><div class="ma-entry-list">${items.length?items.map((value,index)=>`<div class="ma-entry"><input class="input" aria-label="${esc(title)} ${index+1}" data-ma-entry="${type}" data-ma-index="${index}" value="${esc(type==='domain'?`@${normalDomain(value)}`:normalEmail(value))}"><button type="button" class="btn btn-outline" data-ma-remove="${type}" data-ma-index="${index}" aria-label="Remove ${esc(value)}">Remove</button></div>`).join(''):`<div class="ma-empty">No ${type==='domain'?'domains':'email addresses'} added yet.</div>`}</div><div class="ma-add"><input class="input" data-ma-new="${type}" placeholder="${type==='domain'?'@berkshire.nhs.uk':'manager@organisation.nhs.uk'}" aria-label="${esc(addLabel)}"><button type="button" class="btn btn-outline" data-ma-add="${type}">${esc(addLabel)}</button></div></section>`;
  }
  async function openManager(ctx){
    const parentContractCtx=ctx.kind==='CONTRACT'?window.modalCtx:null;
    const parentFrame=ctx.kind==='CONTRACT'?window.__getModalFrame?.():null;
    if(ctx.kind==='CONTRACT'&&(!parentFrame||parentFrame.kind!=='contracts'||parentFrame.mode!=='edit')){window.__toast?.('Click Edit before changing Contract authorisers');return;}
    const loaded=await load(ctx,true); const data=withStagedContractPolicy(loaded,ctx); const state=makeState(data,ctx); const rootId=`ma_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let frame=null; let root=null; let allowClose=false;
    const currentRoot=()=>document.getElementById(rootId);
    const render=()=>{const liveRoot=currentRoot();if(liveRoot){root=liveRoot;renderManager(liveRoot,state,data,ctx);}};
    const onDismiss=()=>{document.removeEventListener('keydown',onEscape,true);document.removeEventListener('input',onInput,true);document.removeEventListener('change',onChange,true);document.removeEventListener('click',onClick,true);document.getElementById('btnCloseModal')?.removeEventListener('click',onHeaderClose,true);};
    showModal(ctx.kind==='CLIENT'?'Timesheet authorisers':'Contract timesheet authorisers',[{key:'main',label:'Authorisers'}],()=>`<div id="${rootId}" class="tabc"></div>`,null,true,null,{kind:'manager-authorisers',noParentGate:true,forceEdit:true,showSave:false,showApply:false,onDismiss});
    frame=window.__modalStack?.[window.__modalStack.length-1]||null;
    render(); root=document.getElementById(rootId); if(!root)return;
    const childBody=document.getElementById('modalBody'); if(childBody)childBody.scrollTop=0;
    const syncDirty=()=>{if(frame){frame.isDirty=!!state.dirty;frame._updateButtons?.();}};
    const confirmClose=async()=>{if(allowClose||!state.dirty){allowClose=true;document.getElementById('btnCloseModal')?.click();return;}if(typeof openUiConfirmModal!=='function'){state.error='Close confirmation is temporarily unavailable. Your changes are still here.';render();return;}const answer=await openUiConfirmModal({title:'Discard authoriser changes?',message:'Your unsaved authoriser changes will be lost.',confirm_label:'Discard changes',cancel_label:'Keep editing',confirm_class:'btn btn-warn',kind:'manager-authorisers-discard'});if(answer?.confirmed){state.dirty=false;syncDirty();allowClose=true;document.getElementById('btnCloseModal')?.click();}};
    const isManagerTop=()=>String(window.__modalStack?.[window.__modalStack.length-1]?.kind||'')==='manager-authorisers';
    const onHeaderClose=(event)=>{if(!isManagerTop()||allowClose||!state.dirty)return;event.preventDefault();event.stopImmediatePropagation();void confirmClose();};
    const onEscape=(event)=>{if(event.key!=='Escape'||!isManagerTop()||allowClose||!state.dirty)return;event.preventDefault();event.stopImmediatePropagation();void confirmClose();};
    document.getElementById('btnCloseModal')?.addEventListener('click',onHeaderClose,true);document.addEventListener('keydown',onEscape,true);
    const paintDirty=()=>{syncDirty();const liveRoot=currentRoot();if(!liveRoot)return;const save=liveRoot.querySelector('[data-ma-action="save"]');const status=liveRoot.querySelector('.ma-status');if(save)save.disabled=!state.dirty;if(status)status.textContent=state.dirty?'Unsaved changes':'All changes saved';const error=liveRoot.querySelector('.ma-error');if(error){error.textContent='';error.classList.remove('is-visible');}};
    const onInput=(event)=>{const liveRoot=currentRoot();const el=event.target;if(!liveRoot||!el||!liveRoot.contains(el))return;const type=el.dataset?.maEntry;const index=Number(el.dataset?.maIndex);if(type&&Number.isInteger(index)){state[type==='email'?'emails':'domains'][index]=el.value;state.dirty=true;state.error='';paintDirty();}};
    const onChange=(event)=>{const liveRoot=currentRoot();if(!liveRoot||!liveRoot.contains(event.target))return;const field=event.target?.dataset?.maField;if(field==='restricted'){state.restricted=!!event.target.checked;state.dirty=true;syncDirty();render();}if(field==='contract-only'){state.contractOnly=!!event.target.checked;state.dirty=true;syncDirty();render();}};
    const onClick=async(event)=>{const liveRoot=currentRoot();const button=event.target?.closest?.('button');if(!liveRoot||!button||!liveRoot.contains(button))return;
      if(button.dataset.maAdd){const type=button.dataset.maAdd;const input=root.querySelector(`[data-ma-new="${type}"]`);const value=type==='email'?normalEmail(input?.value):normalDomain(input?.value);if(!value)return;if((type==='email'&&!emailRe.test(value))||(type==='domain'&&!domainRe.test(value))){state.error=type==='email'?'Enter a valid business email address.':'Enter a valid domain, such as @berkshire.nhs.uk.';render();return;}const list=state[type==='email'?'emails':'domains'];if(list.map(type==='email'?normalEmail:normalDomain).includes(value)){state.error=type==='email'?'This address is already approved.':'This domain is already approved.';render();return;}const inherited=type==='email'?state.clientEmails:state.clientDomains;if(ctx.kind==='CONTRACT'&&!state.contractOnly&&inherited.includes(value)){state.error=type==='email'?'This address is already approved in Client settings.':'This domain is already approved in Client settings.';render();return;}list.push(value);state.dirty=true;state.error='';syncDirty();render();return;}
      if(button.dataset.maRemove){const type=button.dataset.maRemove;const index=Number(button.dataset.maIndex);const list=state[type==='email'?'emails':'domains'];const value=list[index];if(typeof openUiConfirmModal!=='function'){state.error='Confirmation is temporarily unavailable. Nothing was removed.';render();return;}const answer=await openUiConfirmModal({title:'Remove approved authoriser?',message:`Remove ${type==='domain'?'@':''}${normalDomain(value)} from the approved list?`,confirm_label:'Remove',confirm_class:'btn btn-warn',kind:'manager-authorisers-remove'});if(answer?.confirmed){list.splice(index,1);state.dirty=true;state.error='';render();}return;}
      if(button.dataset.maAction==='cancel'){await confirmClose();return;}
      if(button.dataset.maAction==='save'){state.error=validate(state,ctx);if(state.error){render();return;}button.disabled=true;try{const policy=ctx.kind==='CLIENT'?{approved_emails:state.emails,approved_domains:state.domains,allow_free_business_email:!state.restricted}:{mode:state.contractOnly?'CONTRACT_ONLY':(state.emails.length||state.domains.length?'EXTEND':'INHERIT'),approved_emails:state.emails,approved_domains:state.domains};if(ctx.kind==='CONTRACT'){parentContractCtx.__stagedManagerAuthoriserPolicy={policy,expected_contract_updated_at:state.version,request_key:`manager-authorisers:${crypto.randomUUID()}`};parentContractCtx.__nonCalendarDirty=true;parentContractCtx.__calendarOnly=false;if(parentFrame){parentFrame.isDirty=true;parentFrame._updateButtons?.();}state.dirty=false;syncDirty();allowClose=true;document.getElementById('btnCloseModal')?.click();setTimeout(()=>refreshParent(ctx),0);window.__toast?.('Authoriser changes prepared. Save the Contract to apply.');return;}const payload={expected_settings_updated_at:state.version,policy,request_key:`manager-authorisers:${crypto.randomUUID()}`};const path=`/api/clients/${encodeURIComponent(ctx.id)}/manager-authorisers`;const saved=await request(path,'PUT',payload);cache.set(keyOf(ctx),saved);state.dirty=false;syncDirty();allowClose=true;document.getElementById('btnCloseModal')?.click();setTimeout(()=>refreshParent(ctx),0);window.__toast?.('Timesheet authorisers saved');}catch(error){state.error=error.message||'The authoriser settings were not changed.';render();}}
    };
    document.addEventListener('input',onInput,true);document.addEventListener('change',onChange,true);document.addEventListener('click',onClick,true);
  }
  document.addEventListener('click',(event)=>{const manage=event.target?.closest?.('[data-ma-manage]');if(manage){const ctx=contextFromDom();if(ctx)void openManager(ctx).catch((error)=>window.__toast?.(error.message));return;}if(event.target?.closest?.('[data-ma-retry]')){const ctx=contextFromDom();if(ctx){cache.delete(keyOf(ctx));refreshParent(ctx);}}},true);
  const observer=new MutationObserver(()=>void scan()); observer.observe(document.documentElement,{childList:true,subtree:true});
  window.openManagerAuthorisers=openManager;
  window.__invalidateManagerAuthorisers=(kind,id)=>{cache.delete(`${String(kind||'').toUpperCase()}:${String(id||'')}`);};
  void scan();
})();

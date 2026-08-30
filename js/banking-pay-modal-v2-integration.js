/* Contained application seam for the Banking Pay Modal Structure Bible v2.
 * The existing modal/session/Create Draft/action owners remain in main.js.
 * This module activates only after the Worker and database capability agree.
 */
(function(root){
  'use strict';
  const local=typeof module==='object'&&module.exports;
  const controllerModule=local?require('./banking-pay-modal-v2.js'):root.CloudTMSBankingPayModalV2;
  const tableModule=local?require('./banking-pay-modal-v2-table.js'):root.CloudTMSBankingPayTableV2;
  const candidateModule=local?require('./banking-pay-modal-v2-candidate.js'):root.CloudTMSBankingPayCandidateV2;
  const issuesModule=local?require('./banking-pay-modal-v2-issues.js'):root.CloudTMSBankingPayIssuesV2;
  const issueDetailModule=local?require('./banking-pay-modal-v2-issue-detail.js'):root.CloudTMSBankingPayIssueDetailV2;
  const mutationModule=local?require('./banking-pay-modal-v2-mutation.js'):root.CloudTMSBankingPayMutationV2;
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const exactInt=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
  const shouldLockControls=value=>value?.busy===true&&value?.read_only_navigation!==true;
  let mounted=null;
  function scopeBadges(scope){
    return scope==='ALL'
      ? '<span class="bpv2-scope-badge bpv2-scope-badge--paye">PAYE</span><span class="bpv2-scope-badge bpv2-scope-badge--umbrella">Umbrella</span>'
      : scope==='PAYE'
        ? '<span class="bpv2-scope-badge bpv2-scope-badge--paye">PAYE</span>'
        : '<span class="bpv2-scope-badge bpv2-scope-badge--umbrella">Umbrella</span>';
  }
  function stateSlot(state){
    if(!object(state))return null;
    state.pay=object(state.pay)?state.pay:{};state.pay.draftWizard=object(state.pay.draftWizard)?state.pay.draftWizard:{};
    const wizard=state.pay.draftWizard;wizard.workbench_v2=object(wizard.workbench_v2)?wizard.workbench_v2:{};return wizard.workbench_v2;
  }
  function renderShell(model){
    if(!object(model)||model.enabled!==true)return null;
    if(!UUID.test(String(model.session_id||''))||exactInt(model.session_version)===null||exactInt(model.progress_counter_version)===null
      ||!['ALL','PAYE','UMBRELLA'].includes(model.pay_channel_scope))return null;
    const create=model.create_button;
    if(!object(create)||typeof create.label!=='string'||typeof create.title!=='string'||typeof create.ready_label!=='string'
      ||typeof create.ready_title!=='string'||typeof create.disabled!=='boolean'||typeof create.paye_guard_allows_create!=='boolean')return null;
    const badges=scopeBadges(model.pay_channel_scope);
    const summaryParts=String(model.filter_summary||'').split('•').map(value=>value.trim()).filter(Boolean);
    const conciseScope=summaryParts.filter((value,index)=>index>0&&!/^(both\s+)?paye\s*\+\s*umbrella$/i.test(value)).join('<span aria-hidden="true">·</span>');
    return `<section class="banking-pay-v2-shell" id="bankingPayNewBatchWizard"
      data-bpv2-shell="1" data-session-id="${esc(model.session_id)}" data-session-version="${exactInt(model.session_version)}"
      data-progress-counter-version="${exactInt(model.progress_counter_version)}" data-pay-channel-scope="${esc(model.pay_channel_scope)}">
      <div class="banking-pay-v2-shell-inner">
        <header class="banking-pay-v2-shell-header"><div><h2>Banking Pay</h2>
          <div class="banking-pay-scope-summary" aria-label="Current Banking Pay filters">${badges}${conciseScope||'<span>All candidates</span><span aria-hidden="true">·</span><span>All clients</span>'}</div></div>
          <div class="banking-pay-v2-shell-actions">
            <button type="button" class="btn btn-sm btn-outline" data-action="banking:pay:openFiltersModal" title="Open Banking Pay filters">Filters</button>
            <button type="button" class="btn btn-sm btn-outline" data-action="banking:pay:exportReadyToPayCsv" title="Export all current Ready to Pay payments">Export CSV</button>
            <button type="button" class="btn btn-sm btn-primary${create.disabled?' disabled':''}" data-action="banking:pay:createDraft"
              data-disabled="${create.disabled?'1':'0'}" aria-disabled="${create.disabled?'true':'false'}"${create.disabled?' disabled':''}
              data-bpv2-create-label="${esc(create.label)}" data-bpv2-create-title="${esc(create.title)}"
              data-bpv2-ready-label="${esc(create.ready_label)}" data-bpv2-ready-title="${esc(create.ready_title)}"
              data-bpv2-paye-guard-allows-create="${create.paye_guard_allows_create?'1':'0'}"
              title="${esc(create.title)}">${esc(create.label)}</button>
            ${model.has_active_filters?`<button type="button" class="btn btn-sm btn-outline bpv2-clear-filters" data-action="banking:pay:clearFilters"
              title="${esc(model.clear_filters_title||'Clear Banking Pay filters')}">Clear filters</button>`:''}
          </div></header>
        <div class="bpv2-notice-stack" data-bpv2-notice-stack>${String(model.prelude_html||'')}${String(model.progress_html||'')}</div>
        <nav class="banking-pay-v2-section-nav" aria-label="Banking Pay lists">
          <button type="button" data-bpv2-nav="main" aria-current="page">Ready to Pay</button>
          <button type="button" data-bpv2-nav="actions">Action Required <span data-bpv2-action-count>0</span></button>
          <button type="button" data-bpv2-nav="blocked">Blocked for Pay <span data-bpv2-blocked-count>0</span></button>
        </nav>
        <p class="bpv2-shell-status" role="status" aria-live="polite">Loading Ready to Pay…</p>
        <div class="banking-pay-v2-surface" data-bpv2-surface></div>
        <div class="banking-pay-v2-child-host" data-bpv2-child-host role="dialog" aria-modal="true" aria-label="Banking Pay detail" hidden></div>
      </div></section>`;
  }
  function renderBootstrapShell(model={}){
    if(model.enabled!==true)return null;
    const scope=['ALL','PAYE','UMBRELLA'].includes(model.pay_channel_scope)?model.pay_channel_scope:'ALL';
    const message=String(model.error_message||'').trim();
    const retryAction=String(model.retry_action||'').trim();
    const notice=message
      ? `<div class="bpv2-bootstrap-notice bpv2-bootstrap-notice--error" role="alert"><div><strong>Banking Pay could not refresh</strong><span>CloudTMS could not load the latest payment information. No Draft has been created.</span></div>${retryAction?`<button type="button" class="btn btn-sm btn-outline" data-action="${esc(retryAction)}">Try again</button>`:''}</div>`
      : '<div class="bpv2-bootstrap-notice" role="status" aria-live="polite"><span class="bpv2-bootstrap-spinner" aria-hidden="true"></span><div><strong>Loading Banking Pay</strong><span>Checking the latest payment information…</span></div></div>';
    return `<section class="banking-pay-v2-shell banking-pay-v2-bootstrap" id="bankingPayNewBatchWizard" data-bpv2-bootstrap="1" aria-busy="${message?'false':'true'}">
      <div class="banking-pay-v2-shell-inner">
        <header class="banking-pay-v2-shell-header"><div><h2>Banking Pay</h2>
          <div class="banking-pay-scope-summary" aria-label="Current Banking Pay filters">${scopeBadges(scope)}<span>All candidates</span><span aria-hidden="true">·</span><span>All clients</span></div></div>
          <div class="banking-pay-v2-shell-actions" aria-label="Banking Pay actions are available after loading">
            <button type="button" class="btn btn-sm btn-outline" disabled aria-disabled="true">Filters</button>
            <button type="button" class="btn btn-sm btn-outline" disabled aria-disabled="true">Export CSV</button>
            <button type="button" class="btn btn-sm btn-primary disabled" disabled aria-disabled="true">Create drafts</button>
          </div></header>
        <div class="bpv2-notice-stack">${notice}</div>
        <nav class="banking-pay-v2-section-nav" aria-label="Banking Pay lists">
          <button type="button" aria-current="page" disabled>Ready to Pay</button>
          <button type="button" disabled>Action Required</button>
          <button type="button" disabled>Blocked for Pay</button>
        </nav>
        <p class="bpv2-shell-status" role="status" aria-live="polite">${message?'Banking Pay is waiting to be refreshed.':'Loading Ready to Pay…'}</p>
        <div class="banking-pay-v2-surface" aria-hidden="true"></div>
      </div></section>`;
  }
  function readSessionFromShell(shell){
    const session={session_id:String(shell.dataset.sessionId||''),session_version:exactInt(shell.dataset.sessionVersion),
      progress_counter_version:exactInt(shell.dataset.progressCounterVersion)};
    if(!UUID.test(session.session_id)||session.session_version===null||session.progress_counter_version===null)throw new Error('BANKING_PAY_V2_INVALID_SESSION');
    return session;
  }
  function progressPayload(value){
    let current=value;
    for(let i=0;i<4&&object(current);i++){
      if(object(current.progress)){current=current.progress;continue;}
      if(object(current.data)){current=current.data;continue;}break;
    }
    return object(current)?current:null;
  }
  const staleMountCodes=new Set(['BANKING_PAY_V2_STALE_REVISION','BANKING_PAY_V2_STALE_VIEW','BANKING_PAY_V2_SCOPE_MISMATCH']);
  function errorCode(error){return String(error?.code||error?.message||'').trim().toUpperCase();}
  async function renewMountAuthority(shell,context,state){
    const current=readSessionFromShell(shell);
    const response=await context.authFetch(context.API(`/api/banking/pay/workbench/session/${encodeURIComponent(current.session_id)}/progress`),
      {method:'GET',cache:'no-store'});
    const raw=await response.json();if(!response.ok)return null;const progress=progressPayload(raw);
    const session={session_id:String(progress?.session_id||current.session_id),session_version:exactInt(progress?.session_version),
      progress_counter_version:exactInt(progress?.progress_counter_version)};
    if(session.session_id!==current.session_id||session.session_version===null||session.progress_counter_version===null)return null;
    const wizard=state?.pay?.draftWizard;if(!object(wizard))return null;
    wizard.workbench=object(wizard.workbench)?wizard.workbench:{};wizard.decisions=object(wizard.decisions)?wizard.decisions:{};
    for(const target of [wizard.workbench,wizard.decisions]){
      target.session_id=session.session_id;target.session_version=session.session_version;
      target.progress_counter_version=session.progress_counter_version;target.progress=progress;
    }
    if(object(wizard.selection_mutation_authority)){
      wizard.selection_mutation_authority.session_id=session.session_id;
      wizard.selection_mutation_authority.session_version=session.session_version;
      wizard.selection_mutation_authority.progress_counter_version=session.progress_counter_version;
    }
    shell.dataset.sessionVersion=String(session.session_version);
    shell.dataset.progressCounterVersion=String(session.progress_counter_version);
    return session;
  }
  function selectedContext(page,adapters={}){
    const rows=Array.isArray(page?.rows)?page.rows:[];
    const selected=new Set(rows.filter(row=>row.selected===true).map(row=>row.preview_row_id||row.identity).filter(Boolean));
    const values=rows.map(row=>object(row.payload)?{...row.payload,...row}:row);
    const candidateMeta=new Map();if(page?.candidate)candidateMeta.set(page.candidate_id,{candidate_id:page.candidate_id,
      display_name:page.candidate.candidate_name,tms_ref:page.candidate.candidate_reference});
    return {selectedPreviewRowSet:selected,readyPreviewLines:values,canonicalPreviewLines:values,blockedPreviewLines:[],hiddenPreviewLines:[],
      candidateMetaById:candidateMeta,candidateRefreshStateById:new Map(),failedCandidateIds:[],failedCandidateRowById:new Map(),
      failedCandidateStateById:new Map(),pendingCandidateIds:[],pendingCandidateJobById:new Map(),pendingCandidateRowById:new Map(),
      enc:esc,formatIsoToUk:adapters.formatIsoToUk,
      getCurrentWorkbenchSessionId:()=>page?.session_id||'',getCurrentWorkbenchSessionVersion:()=>exactInt(page?.session_version),
      getBankingPayAdoptedPreviewRowSectionV1:row=>String(row?.effective_section||''),
      railEnv:String(adapters.railEnv||''),railProvider:String(adapters.railProvider||'')};
  }
  function applyLegacyAuthority(state,next,draftReview){
    const wizard=state.pay.draftWizard,summary=next.summary,global=summary.global;
    wizard.workbench=object(wizard.workbench)?wizard.workbench:{};wizard.decisions=object(wizard.decisions)?wizard.decisions:{};
    for(const target of [wizard.workbench,wizard.decisions]){
      target.session_id=summary.session_id;target.session_version=summary.session_version;
      target.progress_counter_version=summary.progress_counter_version;target.selected_row_count=global.selected_ready_count;
      target.selected_eligible_ready_row_count=global.selected_ready_count;
    }
    wizard.selection_mutation_authority={session_id:summary.session_id,session_version:summary.session_version,
      progress_counter_version:summary.progress_counter_version,selected_row_count:global.selected_ready_count,
      selected_eligible_ready_row_count:global.selected_ready_count};
    wizard.workbench.selection_review_snapshot={...draftReview};
    wizard.workbench.selectionReviewSnapshot=wizard.workbench.selection_review_snapshot;
    // The unchanged Create Draft owner rereads every physical Ready/Blocked
    // page. Mark old pages unaccepted after any v2 adoption so stale row arrays
    // can never become its input.
    wizard.workbench.required_preview_sections_loaded={};wizard.workbench.requiredPreviewSectionsLoaded={};
  }
  async function checkCapability(context,state){
    const slot=stateSlot(state);if(!slot)return false;
    if(slot.available===true)return true;if(slot.checking===true)return false;
    slot.checking=true;
    try{
      const response=await context.authFetch(context.API('/api/banking/pay/workbench/v2/capability'),{method:'GET',cache:'no-store'});
      const value=await response.json();const capability=value?.banking_pay_workbench_v2;
      slot.available=response.ok&&capability?.available===true&&capability?.contract_version===1;
      slot.checked=true;slot.error='';return slot.available;
    }catch{slot.available=false;slot.checked=true;slot.error='BANKING_PAY_V2_UNAVAILABLE';return false;}
    finally{slot.checking=false;}
  }
  function createRuntime(shell,context,state){
    const document=shell.ownerDocument,surface=shell.querySelector('[data-bpv2-surface]'),childHost=shell.querySelector('[data-bpv2-child-host]'),status=shell.querySelector('[role="status"]');
    // A child is a separate viewport modal, not part of the Banking modal's
    // scrolling layout. Portalling it prevents child focus/size changes from
    // moving the accepted parent surface.
    document.body.appendChild(childHost);
    const transport=controllerModule.createTransport({API:context.API,authFetch:context.authFetch});
    const mutation=mutationModule;let controller=null,currentSurface=null,currentChild=null,returnFocus=null;
    const presenters={main:null,candidate:null,actions:null,blocked:null,detail:null};
    const detailAdapters={formatIsoToUk:context.formatIsoToUk,railEnv:context.railEnv,railProvider:context.railProvider};
    function showError(value){status.textContent=String(value||'Banking Pay could not be updated. Refresh and try again.');status.hidden=false;
      for(const presenter of Object.values(presenters))presenter?.showFailure?.(status.textContent);}
    function setBusy(value){for(const presenter of Object.values(presenters))presenter?.setBusy?.(value);
      const create=shell.querySelector('[data-action="banking:pay:createDraft"]');if(create){create.disabled=Boolean(value)||create.dataset.bpv2DraftAllowed!=='1';
        create.setAttribute('aria-busy',String(Boolean(value)));create.textContent=value?'Updating selection…':create.dataset.bpv2CreateLabel;}
      const exportControl=shell.querySelector('[data-action="banking:pay:exportReadyToPayCsv"]');if(exportControl)exportControl.disabled=Boolean(value);}
    async function runLegacy(value){
      controller?.close();setBusy(true);
      try{await context.invokeLegacy(value);}
      // A retained action is allowed to repaint the Pay tab itself. That
      // replaces this shell before the delegated promise settles, so testing
      // shell.isConnected here could strand the user in the legacy layout.
      // Re-run the normal Pay renderer unconditionally; it is already
      // modal-scoped and returns false when Banking is no longer open.
      finally{await context.rerender('pay');}
    }
    function ensureMain(){
      if(presenters.main)return presenters.main;
      presenters.main=tableModule.createCandidateTable({document,
        onCandidateIntent:value=>controller.candidateIntent({candidate_id:value.candidate_id,action:value.action}),
        onGlobalIntent:value=>controller.globalIntent({action:value.action}),onTimesheets:value=>controller.viewSelectedTimesheets(value.candidate_id),
        onOpenCandidate:value=>{returnFocus=document.activeElement;return controller.openCandidate(value.candidate_id);},onSort:value=>controller.sort(value),
        onPage:value=>controller.mainPage(value.direction),onError:error=>showError(error?.message)});return presenters.main;
    }
    function ensureCandidate(){
      if(presenters.candidate)return presenters.candidate;
      presenters.candidate=candidateModule.create({document,onIntent:value=>{
        if(value.kind==='include')return controller.candidateIntent({candidate_id:value.candidate_id,action:value.selected?'SELECT_ALL_READY':'CLEAR_ALL_READY'});
        if(value.kind==='next'||value.kind==='previous'){
          const page=controller.snapshot().ready;const cursor=value.kind==='next'?page.next_cursor:page.previous_cursor;return controller.candidatePage(cursor);
        }
        if(value.kind==='group')return controller.groupIntent({candidate_id:value.candidate_id,group_kind:value.group_kind,group_key:value.group_key,selected:value.selected});
        if(value.kind==='export-all')return runLegacy({action:'banking:pay:exportReadyToPayCsv',element:value.element,event_kind:'click'});
      },onLegacyAction:runLegacy,onClose:()=>controller.closeCandidate(),onFailure:value=>showError(value.code)});return presenters.candidate;
    }
    function ensureIssues(kind){
      if(presenters[kind])return presenters[kind];
      presenters[kind]=issuesModule.create({document,kind,onIntent:value=>{
        if(value.command==='next'||value.command==='previous'){
          const page=controller.snapshot()[kind];const cursor=value.command==='next'?page.next_cursor:page.previous_cursor;
          return controller.openIssues(kind,{search:page.search,sort_key:page.sort_key,sort_direction:page.sort_direction,cursor,...(kind==='actions'?{view:page.view}:{})});
        }
        if(value.command==='sort'||value.command==='search'){
          const page=controller.snapshot()[kind];return controller.openIssues(kind,{search:value.search??page.search,
            sort_key:value.sort_key??page.sort_key,sort_direction:value.sort_direction??page.sort_direction,cursor:null,...(kind==='actions'?{view:page.view}:{})});
        }
      },onOpenDetail:value=>{returnFocus=document.activeElement;return controller.openIssueDetail(kind,value.key);},onOpenUpdating:()=>controller.openUpdating(),
        onViewTimesheets:ids=>context.openTimesheets(ids),
        onClose:()=>kind==='actions'&&controller.snapshot().actions?.view==='UPDATING'?controller.closeUpdating():controller.closeIssues(),
        onFailure:value=>showError(value.code)});return presenters[kind];
    }
    function ensureDetail(kind){
      if(presenters.detail&&presenters.detail.kind===kind)return presenters.detail.value;
      presenters.detail?.value?.destroy?.();
      const value=issueDetailModule.create({document,kind,adapters:detailAdapters,onPage:request=>{
        const page=controller.snapshot()[kind==='actions'?'actionDetail':'blockedDetail'];
        return controller.openIssueDetail(kind,page[kind==='actions'?'task_key':'blocker_key'],request.direction==='next'?page.next_cursor:page.previous_cursor);
      },onClose:()=>controller.closeIssueDetail(kind),onLegacyAction:runLegacy,onFailure:value=>showError(value.code)});
      presenters.detail={kind,value};return value;
    }
    function stage(next){
      const name=next.ui?.surface||'main';let presenter,commit,parentPresenter,parentCommit;
      if(name==='main'){presenter=ensureMain();commit=presenter.prepare(next.summary);}
      else if(name==='candidate'){
        parentPresenter=ensureMain();parentCommit=parentPresenter.prepare(next.summary);
        presenter=ensureCandidate();commit=presenter.prepare({summary:next.summary,candidate:next.ready?.candidate,
          page:next.ready,context:selectedContext(next.ready,context)},{previousAvailable:next.ready?.has_previous===true});
      }
      else if(name==='actions'||name==='blocked'){presenter=ensureIssues(name);commit=presenter.prepare(next[name],next.summary,
        {previousAvailable:next[name]?.has_previous===true,returnToActions:name==='actions'&&next[name]?.view==='UPDATING'});}
      else if(name==='actionDetail'||name==='blockedDetail'){
        const kind=name==='actionDetail'?'actions':'blocked';
        parentPresenter=ensureIssues(kind);parentCommit=parentPresenter.prepare(next[kind],next.summary,
          {previousAvailable:next[kind]?.has_previous===true,returnToActions:kind==='actions'&&next[kind]?.view==='UPDATING'});
        presenter=ensureDetail(kind);commit=presenter.prepare(next[name],next.summary);
      }else throw new Error('BANKING_PAY_V2_INVALID_RESPONSE');
      return ()=>{
        const isChild=['candidate','actionDetail','blockedDetail'].includes(name);
        const visibleParent=isChild?parentPresenter:presenter;
        if(currentSurface!==visibleParent.element){surface.replaceChildren(visibleParent.element);currentSurface=visibleParent.element;}
        parentCommit?.();
        if(isChild){
          if(currentChild!==presenter.element){childHost.replaceChildren(presenter.element);currentChild=presenter.element;}
          commit();childHost.hidden=false;document.body?.classList?.add('bpv2-child-open');
          childHost.querySelector('[data-bpv2-child="close"],[data-bpv2-detail-command="close"]')?.focus?.({preventScroll:true});
        }else{
          commit();childHost.hidden=true;childHost.replaceChildren();currentChild=null;document.body?.classList?.remove('bpv2-child-open');
          if(returnFocus?.isConnected){returnFocus.focus?.({preventScroll:true});returnFocus=null;}
        }
        const actionCount=shell.querySelector('[data-bpv2-action-count]'),blockedCount=shell.querySelector('[data-bpv2-blocked-count]');
        actionCount.textContent=String(next.summary.global.action_required_count);blockedCount.textContent=String(next.summary.global.blocked_count);
        shell.querySelectorAll('[data-bpv2-nav]').forEach(button=>button.setAttribute('aria-current',button.dataset.bpv2Nav===(name==='main'||name==='candidate'?'main':name.startsWith('action')?'actions':'blocked')?'page':'false'));
        const create=shell.querySelector('[data-action="banking:pay:createDraft"]'),draft=next.summary.global.draft;
        const allowed=draft.can_create_draft===true&&create.dataset.bpv2PayeGuardAllowsCreate==='1';
        create.dataset.bpv2DraftAllowed=allowed?'1':'0';create.dataset.disabled=allowed?'0':'1';create.disabled=!allowed;
        create.classList.toggle('disabled',!allowed);create.setAttribute('aria-disabled',String(!allowed));
        const noSelection=next.summary.global.selected_ready_count===0;
        const createLabel=allowed?create.dataset.bpv2ReadyLabel:noSelection?'Select rows':draft.work_queued?'Preparing…':'Checking changes…';
        const createTitle=allowed?create.dataset.bpv2ReadyTitle:noSelection?'Select at least one current eligible Ready to Pay row.'
          :draft.work_queued?'Preparing / candidates refreshing. Draft creation re-enables when all candidate refresh work is complete.'
          :(create.dataset.bpv2PayeGuardAllowsCreate==='0'?create.dataset.bpv2CreateTitle:'Checking for recent Banking Pay changes. Existing rows remain available while this finishes.');
        create.dataset.bpv2CreateLabel=createLabel;create.dataset.bpv2CreateTitle=createTitle;create.textContent=createLabel;create.title=createTitle;
        status.hidden=true;status.textContent='';};
    }
    async function currentGraph(previous){
      const response=await context.authFetch(context.API(`/api/banking/pay/workbench/session/${encodeURIComponent(previous.summary.session_id)}/progress`),{method:'GET',cache:'no-store'});
      const raw=await response.json();if(!response.ok)throw new Error('BANKING_PAY_V2_UNAVAILABLE');const progress=progressPayload(raw);
      const version=exactInt(progress?.session_version),counter=exactInt(progress?.progress_counter_version);
      if(progress?.session_id!==previous.summary.session_id||version!==previous.summary.session_version||counter===null)throw new Error('BANKING_PAY_V2_STALE_REVISION');
      const args={session_id:previous.summary.session_id,expected_session_version:version,expected_progress_counter_version:counter,
        scope_hash:previous.summary.scope_hash,pay_channel_scope:shell.dataset.payChannelScope,sort_key:previous.summary.sort_key,
        sort_direction:previous.summary.sort_direction,limit:100};
      const surfaceName=previous.ui?.surface||'main';
      const common={session_id:args.session_id,expected_session_version:version,expected_progress_counter_version:counter,
        scope_hash:args.scope_hash,pay_channel_scope:args.pay_channel_scope};
      let ready=null,actions=null,actionDetail=null,blocked=null,blockedDetail=null;
      const summaryPromise=transport.readPage('summary',args);
      if(surfaceName==='candidate'&&previous.ready?.candidate_id){
        ready=await transport.readPage('ready',{...common,candidate_id:previous.ready.candidate_id,cursor:null,limit:100});
        if(ready.candidate===null)ready=null;
      }else if(surfaceName==='actions'||surfaceName==='actionDetail'){
        const page=previous.actions;
        if(page)actions=await transport.readPage('actions',{...common,search:page.search,sort_key:page.sort_key,
          sort_direction:page.sort_direction,cursor:null,limit:100,view:page.view});
        if(surfaceName==='actionDetail'&&actions&&previous.actionDetail?.task_key
          &&actions.rows.some(row=>row.identity===previous.actionDetail.task_key)){
          actionDetail=await transport.readPage('actionDetail',{...common,identity:previous.actionDetail.task_key,cursor:null,limit:100});
        }
      }else if(surfaceName==='blocked'||surfaceName==='blockedDetail'){
        const page=previous.blocked;
        if(page)blocked=await transport.readPage('blocked',{...common,search:page.search,sort_key:page.sort_key,
          sort_direction:page.sort_direction,cursor:null,limit:100});
        if(surfaceName==='blockedDetail'&&blocked&&previous.blockedDetail?.blocker_key
          &&blocked.rows.some(row=>row.identity===previous.blockedDetail.blocker_key)){
          blockedDetail=await transport.readPage('blockedDetail',{...common,identity:previous.blockedDetail.blocker_key,cursor:null,limit:100});
        }
      }
      const summary=await summaryPromise;
      const retainedSurface=ready?'candidate':actionDetail?'actionDetail':actions?'actions':blockedDetail?'blockedDetail':blocked?'blocked':'main';
      return {summary,ready,actions,actionDetail,blocked,blockedDetail,
        ui:{...previous.ui,surface:retainedSurface,ready_cursor:null,issue_cursor:null,detail_cursor:null}};
    }
    const callbacks={payChannelScope:shell.dataset.payChannelScope,readPage:transport.readPage,
      performMutation:(intent,authority,request)=>intent.kind==='candidate'?transport.mutateCandidate(request)
        :intent.kind==='global'?transport.mutateGlobal(request):intent.kind==='rows'?transport.mutateRows(request)
        :intent.kind==='group'?transport.mutateGroup(request):Promise.reject(new Error('BANKING_PAY_V2_INVALID_INPUT')),
      reconcileMutation:({previous,result,candidateRequest,globalRequest,rowRequest,groupRequest})=>globalRequest
        ?mutation.reconcileGlobalSelection(previous,result,globalRequest,args=>transport.readPage('summary',args))
        :mutation.reconcileCandidateSelection(previous,result,candidateRequest||rowRequest||groupRequest,args=>transport.readPage('summary',args)),
      readBack:({previous})=>currentGraph(previous),prepareAdoption:(next,previous,{draftReview})=>{
        const commit=stage(next);return ()=>{commit();applyLegacyAuthority(state,next,draftReview);};},
      onStatus:value=>setBusy(shouldLockControls(value)),onFailure:value=>showError(value.code),
      openTimesheets:context.openTimesheets,newRequestId:context.newRequestId,allowedLegacyActions:[]};
    shell.addEventListener('click',event=>{
      const button=event.target?.closest?.('[data-bpv2-nav]');if(!button||!shell.contains(button))return;
      event.stopPropagation();const key=button.dataset.bpv2Nav;if(key==='main')controller.closeIssues();
      else if(key==='actions')controller.openIssues('actions');else if(key==='blocked')controller.openIssues('blocked');
    });
    childHost.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||childHost.hidden||!controller)return;
      event.preventDefault();event.stopPropagation();const name=controller.snapshot()?.ui?.surface;
      if(name==='candidate')controller.closeCandidate();
      else if(name==='actionDetail')controller.closeIssueDetail('actions');
      else if(name==='blockedDetail')controller.closeIssueDetail('blocked');
    });
    return {shell,callbacks,setController:value=>{controller=value;},async refreshOpenSurface(){
      if(!controller)return false;
      // An opening child still reports the accepted main surface until its
      // bounded read adopts. Keep that in-flight navigation mounted so a
      // background legacy rerender cannot win the race and discard it.
      if(controller.snapshot()?.ui?.surface==='main'&&controller.isBusy())return true;
      const result=await controller.refreshCurrentAuthority();return result?.state!=='CLOSED';
    },close(){controller?.close();document.body?.classList?.remove('bpv2-child-open');childHost.remove();for(const presenter of Object.values(presenters))
      (presenter?.value||presenter)?.destroy?.();}};
  }
  async function mount(shell,context,state){
    if(mounted?.shell===shell)return;
    mounted?.close();const runtime=createRuntime(shell,context,state);mounted=runtime;
    let error=null;
    for(let attempt=0;attempt<4;attempt+=1){
      try{const controller=await controllerModule.openController({...runtime.callbacks,session:readSessionFromShell(shell)});
        if(mounted!==runtime){controller.close();return;}runtime.setController(controller);return;}
      catch(value){error=value;if(!staleMountCodes.has(errorCode(value))||attempt===3)break;
        try{if(!await renewMountAuthority(shell,context,state))break;}catch{break;}}
    }
    if(staleMountCodes.has(errorCode(error))){
      const slot=stateSlot(state);if(slot)slot.error=errorCode(error);
      runtime.shell.querySelector('[role="status"]').textContent='Banking Pay changed while this screen was loading. Select Refresh to load the current details.';
      return;
    }
    {
      runtime.shell.querySelector('[role="status"]').textContent='The new Banking Pay view could not be loaded. The existing view will be restored.';
      const slot=stateSlot(state);if(slot){slot.available=false;slot.error=String(error?.code||error?.message||'BANKING_PAY_V2_UNAVAILABLE');}
      runtime.close();if(mounted===runtime)mounted=null;await context.rerender('pay');}
  }
  async function afterRender(context){
    if(!object(context)||typeof context.API!=='function'||typeof context.authFetch!=='function'||typeof context.rerender!=='function'
      ||typeof context.invokeLegacy!=='function'||typeof context.openTimesheets!=='function'||typeof context.newRequestId!=='function')return false;
    const state=context.state,slot=stateSlot(state);if(!slot)return false;
    const shell=context.document?.querySelector?.('[data-bpv2-shell="1"]')||root.document?.querySelector?.('[data-bpv2-shell="1"]');
    const bootstrap=context.document?.querySelector?.('[data-bpv2-bootstrap="1"]')||root.document?.querySelector?.('[data-bpv2-bootstrap="1"]');
    if(shell){await mount(shell,context,state);return true;}
    if(mounted){mounted.close();mounted=null;}
    if(slot.available===true){if(!bootstrap)await context.rerender('pay');return true;}
    if(slot.checked===true)return false;
    if(await checkCapability(context,state)){if(!bootstrap)await context.rerender('pay');return true;}
    if(bootstrap)await context.rerender('pay');return false;
  }
  function reset(){mounted?.close();mounted=null;}
  async function refreshOpenSurface(){
    // A closed Banking modal can leave its controller alive until the owning
    // modal dismissal callback runs. It must never answer for a later modal or
    // suppress that modal's first authoritative render.
    if(mounted&&!mounted.shell?.isConnected){mounted.close();mounted=null;return false;}
    return Boolean(await mounted?.refreshOpenSurface?.());
  }
  const api=Object.freeze({renderShell,renderBootstrapShell,afterRender,refreshOpenSurface,reset,stateSlot,readSessionFromShell,applyLegacyAuthority,shouldLockControls});
  if(local)module.exports=api;else root.CloudTMSBankingPayModalV2Integration=api;
})(typeof window==='object'?window:this);

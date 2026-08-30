/* Contained Banking Pay screen coordination.
 * The existing session, mutation handlers and server remain authoritative.
 * This controller owns bounded read navigation and composes the one settlement
 * queue. Actual application/DOM/action adapters are required, not guessed.
 * Importing this module does not activate v2 or replace Create Draft.
 */
(function(root){
  'use strict';
  const local=typeof module==='object'&&module.exports;
  const table=local?require('./banking-pay-modal-v2-table.js'):root.CloudTMSBankingPayTableV2;
  const settlement=local?require('./banking-pay-modal-v2-settlement.js'):root.CloudTMSBankingPaySettlementV2;
  const draft=local?require('./banking-pay-modal-v2-draft-review.js'):root.CloudTMSBankingPayDraftReviewV2;
  const issues=local?require('./banking-pay-modal-v2-issues.js'):root.CloudTMSBankingPayIssuesV2;
  const mutation=local?require('./banking-pay-modal-v2-mutation.js'):root.CloudTMSBankingPayMutationV2;
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const TOKEN=/^[A-Za-z0-9_-]{1,4096}$/;
  // Candidate detail keeps the certified row payload intact. A 25-row child
  // page stays below the Workbench's bounded response ceiling for the real
  // high-detail recovery candidate while retaining every row through the
  // existing server cursor. The 100-row main candidate list is unchanged.
  const CANDIDATE_READY_PAGE_LIMIT=mutation.CANDIDATE_READY_PAGE_LIMIT;
  const fields=['session_id','session_version','progress_counter_version','scope_hash'];
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function fail(code='BANKING_PAY_V2_INVALID_INPUT'){const error=new Error(code);error.code=code;throw error;}
  function requireValue(value,code){if(!value)fail(code);}
  function exact(value,keys){requireValue(object(value)&&Object.keys(value).every(key=>keys.includes(key)));}
  const context=summary=>Object.fromEntries(fields.map(key=>[key,summary[key]]));
  const same=(left,right)=>fields.every(key=>left[key]===right[key]);
  function common(authority,channel){return {session_id:authority.session_id,expected_session_version:authority.session_version,
    expected_progress_counter_version:authority.progress_counter_version,scope_hash:authority.scope_hash,pay_channel_scope:channel};}
  function validateRead(page,authority){
    requireValue(object(page)&&page.ok===true&&page.contract===table.CONTRACT&&page.contract_version===1
      &&same(page,authority),'BANKING_PAY_V2_INVALID_RESPONSE');
    return page;
  }
  function paged(page,authority){
    validateRead(page,authority);
    requireValue(Array.isArray(page.rows)&&page.rows.length<=100
      &&Number.isSafeInteger(page.total_count)&&page.total_count>=page.rows.length
      &&typeof page.has_more==='boolean'
      &&(page.has_more?typeof page.next_cursor==='string'&&TOKEN.test(page.next_cursor):page.next_cursor===null),
    'BANKING_PAY_V2_INVALID_RESPONSE');
    return page;
  }
  function readyPage(page,authority,candidateId,summary,cursor){
    mutation.validateReadyReplacement(page,authority,{ready:{candidate_id:candidateId}},{cursor,limit:CANDIDATE_READY_PAGE_LIMIT});
    if(page.candidate!==null){
      const visible=summary.rows.find(row=>row.candidate_id===candidateId);
      if(visible)requireValue(table.sameCandidateContent(visible,page.candidate),
        'BANKING_PAY_V2_INVALID_RESPONSE');
    }
    return page;
  }
  function issueQuery(kind,value={}){
    requireValue(Object.hasOwn(issues.definitions,kind));exact(value,['search','sort_key','sort_direction','cursor',...(kind==='actions'?['view']:[])]);
    const updating=kind==='actions'&&value.view==='UPDATING';
    const result={search:value.search??'',sort_key:value.sort_key??(updating?'TITLE':issues.definitions[kind].columns[0][2]),
      sort_direction:value.sort_direction??'ASC',cursor:value.cursor??null,limit:100};
    requireValue(typeof result.search==='string'&&result.search.length<=200&&!/[\u0000-\u001f\u007f]/u.test(result.search)
      &&issues.definitions[kind].columns.some(([, ,sortKey])=>sortKey===result.sort_key)
      &&['ASC','DESC'].includes(result.sort_direction)&&(result.cursor===null||TOKEN.test(result.cursor)));
    result.search=result.search.trim();
    if(kind==='actions'){
      result.view=value.view??'ACTION_REQUIRED';
      requireValue(['ACTION_REQUIRED','UPDATING'].includes(result.view)
        &&(result.view!=='UPDATING'||result.search===''&&result.sort_key==='TITLE'&&result.sort_direction==='ASC'));
    }
    return result;
  }
  function capturePayload(value){
    // Existing adapters supply a JSON request, never a DOM node or the full
    // Workbench graph. Capture it now so a queued click cannot change later.
    let captured;
    try{captured=JSON.parse(JSON.stringify(value));}catch{fail();}
    requireValue(object(captured));
    const pending=[captured];
    while(pending.length){const item=pending.pop();for(const child of Object.values(item))
      if(child!==null&&typeof child==='object')pending.push(child);Object.freeze(item);}
    return captured;
  }
  function createController(options){
    const {initial,payChannelScope,readPage,performMutation,reconcileMutation,readBack,prepareAdoption,
      onStatus,onFailure,openTimesheets,newRequestId,allowedLegacyActions=[]}=options;
    requireValue(['ALL','PAYE','UMBRELLA'].includes(payChannelScope));
    for(const callback of [readPage,performMutation,reconcileMutation,readBack,prepareAdoption,onStatus,onFailure,openTimesheets,newRequestId])
      if(typeof callback!=='function')throw new TypeError('Every Banking Pay controller adapter is required');
    requireValue(Array.isArray(allowedLegacyActions)&&allowedLegacyActions.every(action=>typeof action==='string'
      &&action.startsWith('banking:pay:')&&action!=='banking:pay:createDraft'));
    const legacyActions=new Set(allowedLegacyActions);
    let closed=false;
    function prepare(next,previous){
      settlement.validateSnapshot(next);
      // The view and compatibility adapter must stage this exact review before
      // returning its synchronous commit. No loaded row list becomes Draft input.
      const draftReview=draft.selectionReviewSnapshot(next.summary);
      const commit=prepareAdoption(next,previous,{draftReview});
      requireValue(typeof commit==='function'&&commit.constructor?.name!=='AsyncFunction','BANKING_PAY_V2_INVALID_ADOPTION');
      return commit;
    }
    function retainCurrentViews(next){
      if(!object(next))return next;
      const current=queue.snapshot(),retained={...next,ui:current.ui};
      for(const key of ['ready','actions','actionDetail','blocked','blockedDetail'])
        if(current[key]===null||current[key]===undefined)retained[key]=null;
      return retained;
    }
    let candidateRequest=null,globalRequest=null,rowRequest=null,groupRequest=null;
    const queue=settlement.createSettlement({initial,perform:(intent,authority)=>{
      candidateRequest=intent.kind==='candidate'?mutation.candidateSelectionRequest(queue.snapshot(),intent):null;
      globalRequest=intent.kind==='global'?mutation.globalSelectionRequest(queue.snapshot(),intent):null;
      rowRequest=intent.kind==='rows'?mutation.rowSelectionRequest(queue.snapshot(),intent):null;
      groupRequest=intent.kind==='group'?mutation.groupSelectionRequest(queue.snapshot(),intent):null;
      return performMutation(intent,authority,candidateRequest||globalRequest||rowRequest||groupRequest);
    },
      reconcile:async value=>retainCurrentViews(await reconcileMutation({...value,previous:queue.snapshot(),candidateRequest,globalRequest,rowRequest,groupRequest})),
      readBack:async value=>retainCurrentViews(await readBack({...value,previous:queue.snapshot()})),
      prepareAdoption:prepare,onStatus,onFailure});
    const initialCommit=prepare(initial,null);
    const committed=initialCommit();
    requireValue(!committed||typeof committed.then!=='function','BANKING_PAY_V2_ASYNC_ADOPTION');
    const request=(kind,authority,args,signal)=>readPage(kind,{...common(authority,payChannelScope),...args},signal);
    function summaryRead(query){
      return queue.navigate(async(authority,signal,previous)=>{
        const summary=await request('summary',authority,{...query,limit:100},signal);
        validateRead(summary,authority);table.validateSummary(summary);
        requireValue(summary.sort_key===query.sort_key&&summary.sort_direction===query.sort_direction,'BANKING_PAY_V2_INVALID_RESPONSE');
        return {...previous,summary};
      });
    }
    function candidateRead(candidateId,cursor=null){
      requireValue(UUID.test(candidateId)&&(cursor===null||TOKEN.test(cursor)));
      return queue.navigate(async(authority,signal,previous)=>{
        const page=await request('ready',authority,{candidate_id:candidateId,cursor,limit:CANDIDATE_READY_PAGE_LIMIT},signal);
        readyPage(page,authority,candidateId,previous.summary,cursor);
        return {...previous,ready:page,actions:null,actionDetail:null,blocked:null,blockedDetail:null,
          ui:{...previous.ui,surface:'candidate',candidate_id:candidateId,ready_cursor:cursor,action_return:null}};
      });
    }
    function enqueue(value){
      const request_id=newRequestId();requireValue(UUID.test(request_id));
      return queue.enqueue({...value,request_id,pay_channel_scope:payChannelScope});
    }
    async function viewSelectedTimesheets(candidateId){
      requireValue(UUID.test(candidateId));
      const read=await queue.read(async(authority,signal)=>{
        const accepted=queue.snapshot(),row=accepted.summary.rows.find(item=>item.candidate_id===candidateId)
          ||(accepted.ready?.candidate_id===candidateId?accepted.ready.candidate:null);
        if(!row||row.selected_timesheet_count===0)return null;
        let ids=row.selected_timesheet_ids;
        if(row.selected_timesheet_scope_token){
          const result=await request('timesheets',authority,{candidate_id:candidateId,scope_token:row.selected_timesheet_scope_token},signal);
          validateRead(result,authority);
          requireValue(result.candidate_id===candidateId&&result.timesheet_count===row.selected_timesheet_count
            &&Array.isArray(result.timesheet_ids)&&result.timesheet_ids.length===result.timesheet_count
            &&result.timesheet_ids.every(id=>typeof id==='string'&&UUID.test(id))
            &&new Set(result.timesheet_ids).size===result.timesheet_ids.length,'BANKING_PAY_V2_INVALID_RESPONSE');
          ids=result.timesheet_ids;
        }
        return [...ids];
      });
      if(read.state!=='CURRENT'||!read.value)return read;
      if(closed)return {state:'CLOSED'};
      if(queue.isBusy()||!same(read.authority,context(queue.snapshot().summary)))return {state:'SUPERSEDED'};
      try{await openTimesheets(read.value);return read;}
      catch(error){onFailure({code:'BANKING_PAY_V2_TIMESHEETS_OPEN_FAILED',read_back_required:false});return {state:'FAILED_VISIBLE'};}
    }
    const api={
      snapshot:queue.snapshot,isBusy:queue.isBusy,mayUseLegacyFallback:queue.mayUseLegacyFallback,
      refreshAfterFailure:queue.refreshAfterFailure,refreshCurrentAuthority:queue.refreshAfterFailure,
      sort(value){exact(value,['sort_key','sort_direction']);requireValue(table.SORTS.includes(value.sort_key)&&['ASC','DESC'].includes(value.sort_direction));
        return summaryRead({...value,cursor:null});},
      mainPage(direction){
        requireValue(['next','previous'].includes(direction));const page=queue.snapshot().summary;
        if(direction==='next'?!page.has_more:!page.has_previous)return Promise.resolve({state:'NO_CHANGE'});
        return summaryRead({sort_key:page.sort_key,sort_direction:page.sort_direction,
          cursor:direction==='next'?page.next_page_anchor:page.previous_page_anchor});
      },
      openCandidate:candidateRead,
      candidatePage(cursor){const page=queue.snapshot().ready;requireValue(page);return candidateRead(page.candidate_id,cursor);},
      closeCandidate(){return queue.dismissViews(['ready'],{surface:'main',candidate_id:null,ready_cursor:null});},
      openIssues(kind,value={}){
        const query=issueQuery(kind,value);
        return queue.navigate(async(authority,signal,previous)=>{
          const page=await request(kind,authority,query,signal);issues.validate(page,previous.summary,kind,query.cursor,query.limit,query.view);
          requireValue(page.search===query.search&&page.sort_key===query.sort_key&&page.sort_direction===query.sort_direction,
            'BANKING_PAY_V2_INVALID_RESPONSE');
          return {...previous,ready:null,actions:null,actionDetail:null,blocked:null,blockedDetail:null,[kind]:page,
            ui:{...previous.ui,surface:kind,issue_cursor:query.cursor,action_return:null}};
        });
      },
      openUpdating(cursor=null){
        const previous=queue.snapshot();
        const actionReturn=previous.actions?.view==='ACTION_REQUIRED'
          ?{view:'ACTION_REQUIRED',search:previous.actions.search,sort_key:previous.actions.sort_key,
            sort_direction:previous.actions.sort_direction,cursor:previous.ui?.issue_cursor??null}
          :previous.ui?.action_return??null;
        const query=issueQuery('actions',{view:'UPDATING',cursor});
        return queue.navigate(async(authority,signal,current)=>{
          const page=await request('actions',authority,query,signal);
          issues.validate(page,current.summary,'actions',cursor,100,'UPDATING');
          return {...current,ready:null,actions:page,actionDetail:null,blocked:null,blockedDetail:null,
            ui:{...current.ui,surface:'actions',issue_cursor:cursor,action_return:actionReturn}};
        });
      },
      closeUpdating(){
        const back=queue.snapshot().ui?.action_return;
        return back?api.openIssues('actions',back):api.closeIssues();
      },
      openIssueDetail(kind,identity,cursor=null){
        requireValue(Object.hasOwn(issues.definitions,kind)&&TOKEN.test(identity)&&(cursor===null||TOKEN.test(cursor)));
        const key=kind==='actions'?'actionDetail':'blockedDetail';
        return queue.navigate(async(authority,signal,previous)=>{
          requireValue(previous[kind]?.rows.some(row=>row.identity===identity)
            ||previous.ui?.detail_identity===identity,'BANKING_PAY_V2_ITEM_NOT_CURRENT');
          const page=await request(key,authority,{identity,cursor,limit:100},signal);
          issues.validateDetail(page,previous.summary,kind,identity,cursor,100);
          return {...previous,[key]:page,ui:{...previous.ui,surface:key,detail_identity:identity,detail_cursor:cursor}};
        });
      },
      closeIssueDetail(kind){
        requireValue(Object.hasOwn(issues.definitions,kind));
        return queue.dismissViews(['actionDetail','blockedDetail'],{surface:kind,detail_identity:null,detail_cursor:null});
      },
      closeIssues(){return queue.dismissViews(['actions','actionDetail','blocked','blockedDetail'],
        {surface:'main',detail_identity:null,detail_cursor:null,issue_cursor:null,action_return:null});},
      viewSelectedTimesheets,
      candidateIntent(value){
        exact(value,['candidate_id','action']);requireValue(UUID.test(value.candidate_id)&&['SELECT_ALL_READY','CLEAR_ALL_READY'].includes(value.action));
        return enqueue({kind:'candidate',...value});
      },
      globalIntent(value){exact(value,['action']);requireValue(['SELECT_ALL_READY','CLEAR_ALL_READY'].includes(value.action));
        return enqueue({kind:'global',...value});},
      rowIntent(value){
        exact(value,['candidate_id','preview_row_ids','selected']);
        requireValue(UUID.test(value.candidate_id)&&typeof value.selected==='boolean'&&Array.isArray(value.preview_row_ids));
        return enqueue({kind:'rows',...capturePayload(value)});
      },
      groupIntent(value){
        exact(value,['candidate_id','group_kind','group_key','selected']);
        requireValue(UUID.test(value.candidate_id)&&['TIMESHEET','OVERPAYMENT'].includes(value.group_kind)
          &&typeof value.group_key==='string'&&value.group_key.length>=1&&value.group_key.length<=512
          &&typeof value.selected==='boolean');
        return enqueue({kind:'group',...capturePayload(value)});
      },
      legacyIntent(value){
        exact(value,['action','payload']);requireValue(legacyActions.has(value.action)&&object(value.payload));
        return enqueue({kind:'legacy',action:value.action,payload:capturePayload(value.payload)});
      },
      close(){if(!closed){closed=true;queue.close();}}
    };
    return Object.freeze(api);
  }
  async function openController(options){
    const {session,payChannelScope,readPage,signal}=options;
    requireValue(object(session)&&UUID.test(session.session_id)&&Number.isSafeInteger(session.session_version)
      &&session.session_version>=0&&Number.isSafeInteger(session.progress_counter_version)&&session.progress_counter_version>=0
      &&['ALL','PAYE','UMBRELLA'].includes(payChannelScope)&&typeof readPage==='function');
    const args={session_id:session.session_id,expected_session_version:session.session_version,
      expected_progress_counter_version:session.progress_counter_version,pay_channel_scope:payChannelScope,
      sort_key:'CANDIDATE',sort_direction:'ASC',limit:100};
    const summary=await readPage('summary',args,signal);
    if(signal?.aborted)fail('BANKING_PAY_V2_CLOSED');
    table.validateSummary(summary);
    requireValue(summary.session_id===session.session_id&&summary.session_version===session.session_version
      &&summary.progress_counter_version===session.progress_counter_version&&summary.sort_key==='CANDIDATE'
      &&summary.sort_direction==='ASC'&&summary.page_number<=1,'BANKING_PAY_V2_INVALID_RESPONSE');
    return createController({...options,initial:{summary,ui:{surface:'main'}}});
  }
  function createTransport({API,authFetch}){
    if(typeof API!=='function'||typeof authFetch!=='function')throw new TypeError('Use the existing authenticated application transport');
    const prefix='/api/banking/pay/workbench/v2/session/';
    const knownCodes=new Set(['BANKING_PAY_V2_STALE_REVISION','BANKING_PAY_V2_SCOPE_MISMATCH','BANKING_PAY_V2_STALE_CURSOR',
      'BANKING_PAY_V2_STALE_VIEW','BANKING_PAY_V2_SELECTION_TOO_LARGE','BANKING_PAY_V2_READY_TOO_LARGE',
      'BANKING_PAY_V2_ROW_NOT_SELECTABLE','BANKING_PAY_V2_GROUP_NOT_SELECTABLE',
      'BANKING_PAY_V2_INVALID_CURSOR','BANKING_PAY_V2_CANDIDATE_NOT_CURRENT','BANKING_PAY_V2_ITEM_NOT_CURRENT',
      'BANKING_PAY_V2_UNAUTHORISED','BANKING_PAY_V2_NOT_READY','BANKING_PAY_V2_INVALID_INPUT','BANKING_PAY_V2_INVALID_AMOUNT',
      'BANKING_PAY_V2_DEPENDENCY_UNAVAILABLE','BANKING_PAY_V2_INVALID_RESPONSE','BANKING_PAY_V2_UNAVAILABLE',
      'WORKBENCH_SESSION_NOT_FOUND','OBSOLETE_SESSION','WORKBENCH_STALE_SELECTION','WORKBENCH_SESSION_VERSION_MISMATCH',
      'WORKBENCH_PROGRESS_COUNTER_VERSION_MISMATCH']);
    const error=(code,outcome)=>Object.assign(new Error(code),{code,outcome});
    function validateArgs(kind,args){
      const keys={summary:['sort_key','sort_direction','cursor','limit'],ready:['candidate_id','cursor','limit'],
        actions:['search','sort_key','sort_direction','cursor','limit','view'],blocked:['search','sort_key','sort_direction','cursor','limit'],
        actionDetail:['identity','cursor','limit'],blockedDetail:['identity','cursor','limit'],
        timesheets:['candidate_id','scope_token'],selection:['candidate_id','action','request_id','expected_view_digest','open_ready'],
        globalSelection:['action','request_id','expected_view_digest'],
        rowSelection:['candidate_id','preview_row_ids','selected','request_id','expected_view_digest','open_ready'],
        groupSelection:['candidate_id','group_kind','group_key','selected','request_id','expected_view_digest','open_ready']};
      requireValue(Object.hasOwn(keys,kind));
      exact(args,['session_id','expected_session_version','expected_progress_counter_version','scope_hash','pay_channel_scope',...keys[kind]]);
      const initial=kind==='summary'&&args.scope_hash===undefined&&args.cursor===undefined;
      requireValue(typeof args.session_id==='string'&&UUID.test(args.session_id)
        &&Number.isSafeInteger(args.expected_session_version)&&args.expected_session_version>=0
        &&Number.isSafeInteger(args.expected_progress_counter_version)&&args.expected_progress_counter_version>=0
        &&['ALL','PAYE','UMBRELLA'].includes(args.pay_channel_scope)
        &&(initial||(typeof args.scope_hash==='string'&&/^[a-f0-9]{64}$/.test(args.scope_hash))));
      if(keys[kind].includes('candidate_id'))requireValue(typeof args.candidate_id==='string'&&UUID.test(args.candidate_id));
      if(keys[kind].includes('identity'))requireValue(typeof args.identity==='string'&&TOKEN.test(args.identity));
      if(keys[kind].includes('cursor'))requireValue(args.cursor===undefined||args.cursor===null
        ||(typeof args.cursor==='string'&&TOKEN.test(args.cursor)));
      if(keys[kind].includes('limit'))requireValue(args.limit===undefined||Number.isSafeInteger(args.limit)&&args.limit>=1&&args.limit<=100);
      if(kind==='summary')requireValue((args.sort_key===undefined||table.SORTS.includes(args.sort_key))
        &&(args.sort_direction===undefined||['ASC','DESC'].includes(args.sort_direction)));
      if(kind==='actions'||kind==='blocked')issueQuery(kind,Object.fromEntries(['search','sort_key','sort_direction','cursor',...(kind==='actions'?['view']:[])]
        .filter(key=>args[key]!==undefined).map(key=>[key,args[key]])));
      if(kind==='timesheets')requireValue(typeof args.scope_token==='string'&&TOKEN.test(args.scope_token));
      if(kind==='selection'||kind==='globalSelection')requireValue(['SELECT_ALL_READY','CLEAR_ALL_READY'].includes(args.action));
      if(kind==='rowSelection')requireValue(Array.isArray(args.preview_row_ids)&&args.preview_row_ids.length>=1&&args.preview_row_ids.length<=100
        &&args.preview_row_ids.every(id=>typeof id==='string'&&UUID.test(id))
        &&new Set(args.preview_row_ids.map(id=>id.toLowerCase())).size===args.preview_row_ids.length&&typeof args.selected==='boolean');
      if(kind==='groupSelection')requireValue(['TIMESHEET','OVERPAYMENT'].includes(args.group_kind)
        &&typeof args.group_key==='string'&&args.group_key.length>=1&&args.group_key.length<=512
        &&!/[\u0000-\u001f\u007f]/u.test(args.group_key)&&typeof args.selected==='boolean');
      if(['selection','globalSelection','rowSelection','groupSelection'].includes(kind))requireValue(typeof args.request_id==='string'&&UUID.test(args.request_id)
        &&typeof args.expected_view_digest==='string'&&/^[a-f0-9]{64}$/.test(args.expected_view_digest));
      if((kind==='selection'||kind==='rowSelection'||kind==='groupSelection')&&args.open_ready!==undefined&&args.open_ready!==null){
        exact(args.open_ready,['cursor','limit']);
        requireValue((args.open_ready.cursor===null||typeof args.open_ready.cursor==='string'&&TOKEN.test(args.open_ready.cursor))
          &&Number.isInteger(args.open_ready.limit)&&args.open_ready.limit>=1&&args.open_ready.limit<=100);
      }
    }
    async function send(path,options,mutation){
      let response,payload;
      try{response=await authFetch(API(path),options);payload=await response.json();}
      catch{throw error(mutation?'BANKING_PAY_V2_MUTATION_UNCERTAIN':'BANKING_PAY_V2_UNAVAILABLE',mutation?'UNCERTAIN':'NOT_SUBMITTED');}
      if(response.ok&&object(payload)&&payload.ok===true)return payload;
      if(object(payload)&&knownCodes.has(payload.code)){
        if(!mutation)throw error(payload.code,'NOT_SUBMITTED');
        if(payload.outcome==='REJECTED'&&response.status>=400&&response.status<500)throw error(payload.code,'REJECTED');
      }
      // Do not log/forward arbitrary SQL, provider errors, credentials or raw
      // bodies. A lost/invalid POST response is not proof that nothing changed.
      throw error(mutation?'BANKING_PAY_V2_MUTATION_UNCERTAIN':'BANKING_PAY_V2_INVALID_RESPONSE',mutation?'UNCERTAIN':'NOT_SUBMITTED');
    }
    return Object.freeze({
      async readPage(kind,args,signal){
        requireValue(!['selection','globalSelection','rowSelection','groupSelection'].includes(kind));validateArgs(kind,args);
        const suffix={summary:'candidates',ready:`candidate/${args.candidate_id}/ready`,
          timesheets:`candidate/${args.candidate_id}/selected-ready-timesheets`,actions:'action-required',blocked:'blocked',
          actionDetail:`action-required/${args.identity}`,blockedDetail:`blocked/${args.identity}`}[kind];
        const query=new URLSearchParams();
        for(const [key,value] of Object.entries(args))
          if(!['session_id','candidate_id','identity'].includes(key)&&value!==undefined&&value!==null)query.set(key,String(value));
        return send(`${prefix}${args.session_id}/${suffix}?${query}`,{method:'GET',cache:'no-store',signal},false);
      },
      async mutateCandidate(args){
        validateArgs('selection',args);
        const body=Object.fromEntries(Object.entries(args).filter(([key])=>!['session_id','candidate_id'].includes(key)));
        const result=await send(`${prefix}${args.session_id}/candidate/${args.candidate_id}/selection`,
          {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},true);
        try{mutation.validateRetention(result,args.expected_view_digest);}
        catch{throw error('BANKING_PAY_V2_MUTATION_UNCERTAIN','UNCERTAIN');}
        return result;
      },
      async mutateRows(args){
        validateArgs('rowSelection',args);
        const body=Object.fromEntries(Object.entries(args).filter(([key])=>!['session_id','candidate_id'].includes(key)));
        const result=await send(`${prefix}${args.session_id}/candidate/${args.candidate_id}/ready-selection`,
          {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},true);
        try{mutation.validateRowSelectionProof(result,args);}
        catch{throw error('BANKING_PAY_V2_MUTATION_UNCERTAIN','UNCERTAIN');}
        return result;
      },
      async mutateGroup(args){
        validateArgs('groupSelection',args);
        const body=Object.fromEntries(Object.entries(args).filter(([key])=>!['session_id','candidate_id'].includes(key)));
        const result=await send(`${prefix}${args.session_id}/candidate/${args.candidate_id}/group-selection`,
          {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},true);
        try{mutation.validateGroupSelectionProof(result,args);}
        catch{throw error('BANKING_PAY_V2_MUTATION_UNCERTAIN','UNCERTAIN');}
        return result;
      },
      async mutateGlobal(args){
        validateArgs('globalSelection',args);
        const body=Object.fromEntries(Object.entries(args).filter(([key])=>key!=='session_id'));
        const result=await send(`${prefix}${args.session_id}/selection`,
          {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},true);
        try{mutation.validateGlobalSelectionProof(result,args.expected_view_digest);}
        catch{throw error('BANKING_PAY_V2_MUTATION_UNCERTAIN','UNCERTAIN');}
        return result;
      }
    });
  }
  const api=Object.freeze({CANDIDATE_READY_PAGE_LIMIT,createController,openController,createTransport});
  if(local)module.exports=api;else root.CloudTMSBankingPayModalV2=api;
})(typeof window==='object'?window:this);

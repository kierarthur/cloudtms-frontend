/* One Banking Pay selection/update settlement owner. Transport and existing
 * action adapters are injected by the Banking controller, never replaced here.
 * No amount calculation, economic classification, retrying mutations or DOM
 * rebuilding is performed by this state machine.
 */
(function(root){
  'use strict';
  const table=typeof module==='object'&&module.exports?require('./banking-pay-modal-v2-table.js'):root.CloudTMSBankingPayTableV2;
  const PAGE_KEYS=Object.freeze(['ready','actions','actionDetail','blocked','blockedDetail']);
  const STALE_REJECTIONS=new Set(['BANKING_PAY_V2_STALE_REVISION','BANKING_PAY_V2_STALE_VIEW','BANKING_PAY_V2_SCOPE_MISMATCH','STALE_SESSION',
    'WORKBENCH_STALE_SELECTION','WORKBENCH_SESSION_VERSION_MISMATCH','WORKBENCH_PROGRESS_COUNTER_VERSION_MISMATCH',
    'WORKBENCH_SESSION_PROGRESS_CHANGED','OBSOLETE_SESSION']);
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function context(snapshot){const p=snapshot.summary;return {session_id:p.session_id,session_version:p.session_version,
    progress_counter_version:p.progress_counter_version,scope_hash:p.scope_hash};}
  function sameContext(left,right){return left.session_id===right.session_id&&left.session_version===right.session_version
    &&left.progress_counter_version===right.progress_counter_version&&left.scope_hash===right.scope_hash;}
  function validReceipt(result,intent,previous){
    const old=context(previous);
    return result.request_id===intent.request_id&&result.session_id===old.session_id
      &&Number.isSafeInteger(result.session_version)&&result.session_version>=old.session_version
      &&Number.isSafeInteger(result.progress_counter_version)&&result.progress_counter_version>=0
      &&typeof result.scope_hash==='string'&&/^[a-f0-9]{64}$/.test(result.scope_hash)
      &&(result.session_version!==old.session_version
        ||(result.progress_counter_version>=old.progress_counter_version&&result.scope_hash===old.scope_hash));
  }
  function fail(code){const error=new Error(code);error.code=code;throw error;}
  function paymentIdentity(row){
    const direct=row.preview_row_id,nested=row.payload?.preview_row_id;
    if(direct!==undefined&&nested!==undefined&&direct!==nested)fail('BANKING_PAY_V2_INVALID_RESPONSE');
    const physical=direct===undefined?nested:direct;
    if(physical!==undefined){
      if(physical!==null&&(typeof physical!=='string'||!physical))fail('BANKING_PAY_V2_INVALID_RESPONSE');
      return physical;
    }
    // Legacy pages already use the physical identity. Source-only members
    // have no payment; never turn their task identity into a payment ID.
    return ['STORED_PAYEE','SOURCE_PROGRESS'].includes(row.source_kind)?null:row.identity;
  }
  function validateSnapshot(snapshot){
    if(!object(snapshot))fail('BANKING_PAY_V2_INVALID_RESPONSE');
    table.validateSummary(snapshot.summary);
    const authority=context(snapshot);
    for(const key of PAGE_KEYS){
      const page=snapshot[key];
      if(page===null||page===undefined)continue;
      if(!object(page)||page.ok!==true||page.contract!==table.CONTRACT||page.contract_version!==1
        ||!sameContext(page,authority)||!Array.isArray(page.rows)||page.rows.length>100
        ||page.rows.some(row=>!object(row)||typeof row.identity!=='string'||!row.identity)
        ||new Set(page.rows.map(row=>row.identity)).size!==page.rows.length)fail('BANKING_PAY_V2_INVALID_RESPONSE');
      if(key==='ready'&&page.rows.some(row=>row.candidate_id!==page.candidate_id
        ||row.effective_section!=='canonical_preview_lines'))fail('BANKING_PAY_V2_INVALID_RESPONSE');
      if(['actions','blocked'].includes(key)&&page.rows.some(row=>row.indefinite_snooze===true||row.updating===true))fail('BANKING_PAY_V2_INVALID_RESPONSE');
    }
    const owners=new Map();
    for(const [key,owner] of [['ready','READY'],['actions','ACTION'],['actionDetail','ACTION'],
      ['blocked','BLOCKED'],['blockedDetail','BLOCKED']]){
      for(const row of snapshot[key]?.rows||[]){
        const physical=paymentIdentity(row);
        // A retained related line is detail context, not another effective
        // section. Validate its references above, but do not assign ownership.
        if(physical===null||(key.endsWith('Detail')&&row.context_only===true))continue;
        if(owners.has(physical)&&owners.get(physical)!==owner)fail('BANKING_PAY_V2_CROSS_SECTION_IDENTITY');
        owners.set(physical,owner);
      }
    }
    return snapshot;
  }
  function createSettlement({initial,perform,reconcile,readBack,prepareAdoption,onStatus,onFailure}){
    for(const callback of [perform,reconcile,readBack,prepareAdoption,onStatus,onFailure]){
      if(typeof callback!=='function')throw new TypeError('Every Banking Pay settlement adapter is required');
    }
    let accepted=validateSnapshot(initial);
    let active=null;
    let closed=false;
    let needsRefresh=false;
    let everDispatched=false;
    let epoch=0;
    let readerEpoch=0;
    let navigation=null;
    let lastFailure=null;
    const queue=[];
    const readers=new Set();
    function status(state,intent){onStatus({state,intent_id:intent?.request_id||null,
      busy:!!active||queue.length>0||needsRefresh||navigation!==null,
      read_only_navigation:navigation!==null&&!active&&queue.length===0&&!needsRefresh});}
    function invalidateReaders(){readerEpoch++;navigation=null;for(const reader of readers)reader.abort();readers.clear();}
    function notifyFailure(error,intent){
      lastFailure={code:typeof error?.code==='string'?error.code:'BANKING_PAY_V2_UPDATE_FAILED',
        intent_id:intent?.request_id||null,read_back_required:needsRefresh};
      try{onFailure(lastFailure);}catch{needsRefresh=true;lastFailure={...lastFailure,code:'BANKING_PAY_V2_ERROR_PRESENTATION_FAILED',read_back_required:true};}
    }
    function drainQueue(state){while(queue.length)queue.shift().resolve({state});}
    function validateNext(next,previous){
      validateSnapshot(next);
      const now=context(next);const old=context(previous);
      if(now.session_id!==old.session_id||now.session_version<old.session_version
        ||(now.session_version===old.session_version&&(now.progress_counter_version<old.progress_counter_version
          ||now.scope_hash!==old.scope_hash)))fail('BANKING_PAY_V2_STALE_REVISION');
    }
    function adopt(next,previous,intent,receipt=null){
      validateNext(next,previous);
      // A newer page is not automatically the page accepted by this mutation.
      // Every staged view must match its exact returned revision and scope.
      if(receipt&&!sameContext(context(next),receipt))fail('BANKING_PAY_V2_RECONCILIATION_REVISION_MISMATCH');
      status('VALIDATED',intent);
      // Prepare all open views/legacy aliases without publishing. A synchronous
      // commit is the sole financial display boundary; it must not await reads.
      const commit=prepareAdoption(next,previous);
      if(typeof commit!=='function'||commit.constructor?.name==='AsyncFunction')fail('BANKING_PAY_V2_INVALID_ADOPTION');
      if(closed)return false;
      const committed=commit();
      if(committed&&typeof committed.then==='function')fail('BANKING_PAY_V2_ASYNC_ADOPTION');
      accepted=next;
      needsRefresh=false;
      lastFailure=null;
      return true;
    }
    async function pump(){
      if(active||closed||needsRefresh||!queue.length)return;
      const entry=queue.shift();active=entry;
      const previous=accepted;
      const currentEpoch=++epoch;
      invalidateReaders();
      const intent=entry.intent;
      let state='FAILED_VISIBLE';
      try{
        status('DISPATCHED',intent);everDispatched=true;
        let result;
        let uncertain=false;let rejected=null;
        try{
          // Do not cancel a dispatched mutation when the modal closes. Its
          // result can be ignored locally but its server outcome remains real.
          result=await perform(intent,context(previous));
          if(!object(result))uncertain=true;
          else if(result.ok===false&&result.outcome==='REJECTED'){
            rejected=result;
          }else if(result.ok!==true||!validReceipt(result,intent,previous))uncertain=true;
        }catch(error){
          if(error?.outcome==='REJECTED')rejected=error;
          else uncertain=true;
        }
        if(closed){state='CLOSED';return;}
        if(currentEpoch!==epoch){state='SUPERSEDED';return;}
        if(rejected){
          if(STALE_REJECTIONS.has(rejected.code)){
            needsRefresh=true;status('RECONCILING',intent);
            const current=await readBack({intent,previous,reason:'STALE_REJECTION'});
            if(closed){state='CLOSED';return;}
            adopt(current,previous,intent);
          }
          state='REJECTED_TYPED';notifyFailure(rejected,intent);return;
        }
        let next;
        if(uncertain){
          needsRefresh=true;status('TRANSPORT_UNCERTAIN',intent);
          next=await readBack({intent,previous,reason:'TRANSPORT_UNCERTAIN'});
        }else{
          status('SERVER_ACCEPTED',intent);status('RECONCILING',intent);
          // The adapter returns one complete same-revision graph. Open Ready
          // and Blocked pages must reconcile together; closed views invalidate.
          next=await reconcile({intent,result,previous});
        }
        if(closed){state='CLOSED';return;}
        if(currentEpoch!==epoch){state='SUPERSEDED';return;}
        if(!adopt(next,previous,intent,uncertain?null:result)){state='CLOSED';return;}
        state='ADOPTED';
      }catch(error){
        if(closed)state='CLOSED';
        else{needsRefresh=true;state='FAILED_VISIBLE';drainQueue('FAILED_VISIBLE');notifyFailure(error,intent);}
      }finally{
        active=null;
        try{status(state,intent);}catch(error){needsRefresh=true;state='FAILED_VISIBLE';notifyFailure(error,intent);drainQueue(state);}
        entry.resolve({state,snapshot:accepted});
        if(!closed&&!needsRefresh)void pump();
      }
    }
    return Object.freeze({
      snapshot:()=>accepted,
      isBusy:()=>!!active||queue.length>0||needsRefresh||navigation!==null,
      mayUseLegacyFallback:()=>!everDispatched,
      lastFailure:()=>lastFailure,
      dismissViews(keys,ui={}){
        if(closed)return {state:'CLOSED'};
        if(!Array.isArray(keys)||keys.some(key=>!PAGE_KEYS.includes(key))||!object(ui))throw new TypeError('Only bounded view removal is allowed');
        // Closing a child is local presentation, even during a submitted or
        // uncertain mutation. Never cancel that mutation or clear its guard.
        invalidateReaders();
        const previous=accepted;
        const next={...previous,ui:{...previous.ui,...ui}};
        for(const key of keys)next[key]=null;
        const pendingRefresh=needsRefresh,previousFailure=lastFailure;
        try{
          adopt(next,previous,null,context(previous));
          needsRefresh=pendingRefresh;lastFailure=previousFailure;
          status(needsRefresh?'FAILED_VISIBLE':'ADOPTED',null);
          return {state:'ADOPTED',snapshot:accepted};
        }catch(error){
          needsRefresh=true;notifyFailure(error,null);drainQueue('FAILED_VISIBLE');
          return {state:'FAILED_VISIBLE',snapshot:accepted};
        }
      },
      enqueue(intent){
        if(closed)return Promise.resolve({state:'CLOSED'});
        if(needsRefresh)return Promise.resolve({state:'FAILED_VISIBLE'});
        if(!object(intent)||typeof intent.request_id!=='string'||!intent.request_id)throw new TypeError('An explicit Banking Pay intent ID is required');
        if(active?.intent.request_id===intent.request_id||queue.some(entry=>entry.intent.request_id===intent.request_id)){
          return Promise.resolve({state:'SUPERSEDED'});
        }
        const frozen=Object.freeze({...intent});
        return new Promise(resolve=>{
          queue.push({intent:frozen,resolve});
          try{status('QUEUED',frozen);void pump();}
          catch(error){needsRefresh=true;notifyFailure(error,frozen);drainQueue('FAILED_VISIBLE');}
        });
      },
      async read(readPage){
        if(closed)return {state:'CLOSED'};
        if(active||queue.length||needsRefresh)return {state:'SUPERSEDED'};
        const reader=new AbortController();readers.add(reader);
        const captured=readerEpoch;const authority=context(accepted);
        try{
          const value=await readPage(authority,reader.signal);
          if(closed)return {state:'CLOSED'};
          if(captured!==readerEpoch||!sameContext(authority,context(accepted)))return {state:'SUPERSEDED'};
          return {state:'CURRENT',value,authority};
        }catch(error){
          if(closed)return {state:'CLOSED'};
          if(reader.signal.aborted||captured!==readerEpoch)return {state:'SUPERSEDED'};
          notifyFailure(error,null);return {state:'FAILED_VISIBLE'};
        }finally{readers.delete(reader);}
      },
      async navigate(readGraph){
        if(closed)return {state:'CLOSED'};
        if(active||queue.length||needsRefresh)return {state:'SUPERSEDED'};
        if(typeof readGraph!=='function')throw new TypeError('A complete bounded navigation read is required');
        // A later requested view wins even when both responses have the same
        // financial revision. Arrival order must never restore an older sort,
        // child page or modal. A mutation invalidates this read immediately.
        invalidateReaders();
        const captured=readerEpoch;
        const reader=new AbortController();readers.add(reader);navigation=captured;
        const previous=accepted;const authority=context(previous);
        let adoptionStarted=false;
        try{
          status('READING',null);
          const next=await readGraph(authority,reader.signal,previous);
          if(closed)return {state:'CLOSED'};
          if(captured!==readerEpoch||active||queue.length||!sameContext(authority,context(accepted)))return {state:'SUPERSEDED'};
          // Navigation cannot quietly adopt a new financial version. Refresh
          // or mutation settlement must reconcile that version across views.
          if(!object(next)||!object(next.summary)||!sameContext(context(next),authority))fail('BANKING_PAY_V2_STALE_REVISION');
          adoptionStarted=true;
          if(!adopt(next,previous,null,authority))return {state:'CLOSED'};
          return {state:'ADOPTED',snapshot:accepted};
        }catch(error){
          if(closed)return {state:'CLOSED'};
          if(reader.signal.aborted||captured!==readerEpoch)return {state:'SUPERSEDED'};
          if(adoptionStarted||error?.code==='BANKING_PAY_V2_STALE_REVISION'||STALE_REJECTIONS.has(error?.code))needsRefresh=true;
          notifyFailure(error,null);return {state:'FAILED_VISIBLE'};
        }finally{
          readers.delete(reader);
          if(navigation===captured){
            navigation=null;
            try{status(needsRefresh||lastFailure?'FAILED_VISIBLE':'ADOPTED',null);}
            catch(error){needsRefresh=true;notifyFailure(error,null);}
          }
        }
      },
      async refreshAfterFailure(){
        if(closed)return {state:'CLOSED'};
        if(active||queue.length)return {state:'SUPERSEDED'};
        const previous=accepted;
        active={intent:null};invalidateReaders();
        try{
          status('RECONCILING',null);
          const next=await readBack({intent:null,previous,reason:'USER_READ_BACK'});
          if(closed)return {state:'CLOSED'};
          adopt(next,previous,null);return {state:'ADOPTED',snapshot:accepted};
        }catch(error){needsRefresh=true;notifyFailure(error,null);return {state:'FAILED_VISIBLE'};}
        finally{active=null;try{status(closed?'CLOSED':needsRefresh?'FAILED_VISIBLE':'ADOPTED',null);}catch(error){needsRefresh=true;notifyFailure(error,null);}}
      },
      close(){closed=true;epoch++;invalidateReaders();drainQueue('CLOSED');try{status('CLOSED',active?.intent);}catch(error){notifyFailure(error,active?.intent);}}
    });
  }
  const api=Object.freeze({validateSnapshot,createSettlement});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CloudTMSBankingPaySettlementV2=api;
})(typeof window==='object'?window:this);

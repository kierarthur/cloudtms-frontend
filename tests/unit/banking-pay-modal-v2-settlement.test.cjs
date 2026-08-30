const test=require('node:test');
const assert=require('node:assert/strict');
const {createSettlement,validateSnapshot}=require('../../js/banking-pay-modal-v2-settlement.js');
const fixture=require('../fixtures/banking-pay-v2-table-page.cjs');
const snapshot=(version=3)=>({summary:{...fixture.page(),progress_counter_version:version},ready:null,actions:null,blocked:null});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const intent=value=>({request_id:`fixture-intent-${value}`,candidate_id:fixture.id(value),action:'SELECT_ALL_READY'});
const receipt=(command,context)=>({ok:true,request_id:command.request_id,...context,progress_counter_version:context.progress_counter_version+1});
const receiptAt=(value,version=4)=>({ok:true,request_id:intent(value).request_id,session_id:fixture.id(1000),session_version:2,progress_counter_version:version,scope_hash:'a'.repeat(64)});
function setup(overrides={}){
  const states=[],commits=[],failures=[],performed=[];
  const initial=snapshot();
  const controller=createSettlement({initial,
    perform:async(command,context)=>{performed.push({command,context});return receipt(command,context);},
    reconcile:async({previous})=>snapshot(previous.summary.progress_counter_version+1),
    readBack:async()=>snapshot(4),prepareAdoption:next=>()=>{commits.push(next);},
    onStatus:value=>states.push(value),onFailure:value=>failures.push(value),...overrides});
  return {controller,initial,states,commits,failures,performed};
}
test('one mutation, one same-revision adoption and no optimistic summary',async()=>{
  const pending=deferred();const env=setup({perform:()=>pending.promise});
  const result=env.controller.enqueue(intent(1));
  assert.equal(env.controller.snapshot(),env.initial);assert.equal(env.controller.isBusy(),true);
  assert.equal(env.controller.mayUseLegacyFallback(),false);
  pending.resolve(receiptAt(1));assert.equal((await result).state,'ADOPTED');
  assert.equal(env.commits.length,1);assert.equal(env.controller.snapshot().summary.progress_counter_version,4);
  assert.deepEqual(env.states.map(x=>x.state),['QUEUED','DISPATCHED','SERVER_ACCEPTED','RECONCILING','VALIDATED','ADOPTED']);
  assert.equal(env.controller.isBusy(),false);
});
test('queued intents serialize and obtain the latest accepted revision at dispatch',async()=>{
  const first=deferred();const calls=[];
  const env=setup({perform:(command,context)=>{calls.push({command,context});return calls.length===1?first.promise:Promise.resolve(receipt(command,context));}});
  const one=env.controller.enqueue(intent(1));const two=env.controller.enqueue(intent(2));
  assert.equal(calls.length,1);first.resolve(receiptAt(1));
  assert.equal((await one).state,'ADOPTED');assert.equal((await two).state,'ADOPTED');
  assert.deepEqual(calls.map(x=>x.context.progress_counter_version),[3,4]);assert.equal(env.commits.length,2);
});
test('duplicate active intent never dispatches a second mutation',async()=>{
  const pending=deferred();let calls=0;
  const env=setup({perform:()=>{calls++;return pending.promise;}});
  const one=env.controller.enqueue(intent(1));assert.equal((await env.controller.enqueue(intent(1))).state,'SUPERSEDED');
  pending.resolve(receiptAt(1));await one;assert.equal(calls,1);
});
test('uncertain mutation performs one read-back and never resubmits',async()=>{
  let mutations=0,reads=0;
  const env=setup({perform:async()=>{mutations++;throw new Error('connection lost');},readBack:async()=>{reads++;return snapshot(4);}});
  assert.equal((await env.controller.enqueue(intent(1))).state,'ADOPTED');
  assert.equal(mutations,1);assert.equal(reads,1);assert.equal(env.commits.length,1);
  assert.ok(env.states.some(x=>x.state==='TRANSPORT_UNCERTAIN'));
});
test('failed read-back keeps Draft busy and requires explicit authoritative recovery',async()=>{
  let reads=0;const env=setup({perform:async()=>({ok:false,outcome:'UNCERTAIN'}),readBack:async()=>{if(++reads===1)throw new Error('offline');return snapshot(4);}});
  assert.equal((await env.controller.enqueue(intent(1))).state,'FAILED_VISIBLE');
  assert.equal(env.controller.isBusy(),true);assert.equal(env.controller.snapshot(),env.initial);assert.equal(env.commits.length,0);
  assert.equal((await env.controller.enqueue(intent(2))).state,'FAILED_VISIBLE');
  assert.equal((await env.controller.refreshAfterFailure()).state,'ADOPTED');assert.equal(env.controller.isBusy(),false);
});
test('typed rejection keeps the previous authority without pretending a write occurred',async()=>{
  const env=setup({perform:async()=>({ok:false,outcome:'REJECTED',code:'BANKING_PAY_V2_ITEM_NOT_CURRENT'})});
  assert.equal((await env.controller.enqueue(intent(1))).state,'REJECTED_TYPED');
  assert.equal(env.controller.snapshot(),env.initial);assert.equal(env.commits.length,0);
  assert.equal(env.controller.mayUseLegacyFallback(),false);
});
for(const staleCode of ['BANKING_PAY_V2_STALE_REVISION','BANKING_PAY_V2_STALE_VIEW'])
test('stale rejection '+staleCode+' reloads current authority before a queued intent may dispatch',async()=>{
  const contexts=[];let calls=0,reads=0;
  const env=setup({perform:async(command,context)=>{contexts.push(context);return ++calls===1
    ?{ok:false,outcome:'REJECTED',code:staleCode}:receipt(command,context);},
    readBack:async()=>{reads++;return snapshot(7);}});
  const first=env.controller.enqueue(intent(1));const second=env.controller.enqueue(intent(2));
  assert.equal((await first).state,'REJECTED_TYPED');assert.equal((await second).state,'ADOPTED');
  assert.equal(reads,1);assert.deepEqual(contexts.map(x=>x.progress_counter_version),[3,7]);
});
test('a failed stale read-back cannot let queued mutations use outdated authority',async()=>{
  let calls=0;const env=setup({perform:async()=>{calls++;return{ok:false,outcome:'REJECTED',code:'STALE_SESSION'};},
    readBack:async()=>{throw new Error('offline');}});
  const first=env.controller.enqueue(intent(1));const second=env.controller.enqueue(intent(2));
  assert.equal((await first).state,'FAILED_VISIBLE');assert.equal((await second).state,'FAILED_VISIBLE');
  assert.equal(calls,1);assert.equal(env.controller.snapshot(),env.initial);
});
for(const [name,change] of Object.entries({
  olderRevision:value=>value.summary.progress_counter_version=2,
  newerThanMutationReceipt:value=>value.summary.progress_counter_version=5,
  changedScopeSameVersion:value=>value.summary.scope_hash='b'.repeat(64),
  differentSession:value=>value.summary.session_id=fixture.id(1999),
  mixedReadyRevision:value=>value.ready={...value.summary,candidate_id:fixture.id(1),progress_counter_version:2,rows:[]},
  blockedInReady:value=>value.ready={...value.summary,candidate_id:fixture.id(1),rows:[{identity:'same',candidate_id:fixture.id(1),effective_section:'blocked_for_pay'}]},
  duplicateAcrossSections:value=>{value.ready={...value.summary,candidate_id:fixture.id(1),rows:[{identity:'same',candidate_id:fixture.id(1),effective_section:'canonical_preview_lines'}]};value.blocked={...value.summary,rows:[{identity:'same'}]};}
}))test(`invalid ${name} cannot partly adopt`,async()=>{
  const env=setup({reconcile:async()=>{const value=snapshot(4);change(value);return value;}});
  assert.equal((await env.controller.enqueue(intent(1))).state,'FAILED_VISIBLE');
  assert.equal(env.commits.length,0);assert.equal(env.controller.snapshot(),env.initial);assert.equal(env.controller.isBusy(),true);
});
test('closing during a dispatched mutation ignores its late result and queued intents',async()=>{
  const pending=deferred();const env=setup({perform:()=>pending.promise});
  const one=env.controller.enqueue(intent(1));const two=env.controller.enqueue(intent(2));
  env.controller.close();assert.equal((await two).state,'CLOSED');pending.resolve(receiptAt(1));
  assert.equal((await one).state,'CLOSED');assert.equal(env.commits.length,0);
});

for(const key of ['blocked','blockedDetail','actionDetail']){
  for(const location of ['wrapper','payload','both'])test(`physical payment duplicated in ${key} (${location}) cannot hide behind a task identity`,async()=>{
    const next=snapshot(4),previewId=fixture.id(800);
    next.ready={...next.summary,candidate_id:fixture.id(1),rows:[{identity:previewId,
      preview_row_id:previewId,candidate_id:fixture.id(1),effective_section:'canonical_preview_lines'}]};
    const issue={identity:'a'.repeat(64),candidate_id:fixture.id(1),context_only:false};
    if(location!=='payload')issue.preview_row_id=previewId;
    if(location!=='wrapper')issue.payload={preview_row_id:previewId};
    next[key]={...next.summary,rows:[issue]};
    const env=setup({reconcile:async()=>next});
    assert.equal((await env.controller.enqueue(intent(1))).state,'FAILED_VISIBLE');
    assert.equal(env.commits.length,0);assert.equal(env.controller.snapshot(),env.initial);
    assert.equal(env.failures.at(-1).code,'BANKING_PAY_V2_CROSS_SECTION_IDENTITY');
  });
}
for(const key of ['blockedDetail','actionDetail'])test(`Ready payment may remain explicit context in ${key}`,()=>{
  const next=snapshot(),previewId=fixture.id(800);
  next.ready={...next.summary,candidate_id:fixture.id(1),rows:[{identity:previewId,
    preview_row_id:previewId,candidate_id:fixture.id(1),effective_section:'canonical_preview_lines'}]};
  next[key]={...next.summary,rows:[{identity:'b'.repeat(64),candidate_id:fixture.id(1),
    preview_row_id:previewId,context_only:true,payload:{preview_row_id:previewId}}]};
  assert.equal(validateSnapshot(next),next);
});
test('conflicting physical references cannot conceal cross-section duplication',()=>{
  const next=snapshot();
  next.blockedDetail={...next.summary,rows:[{identity:'c'.repeat(64),preview_row_id:fixture.id(801),
    payload:{preview_row_id:fixture.id(800)},context_only:false}]};
  assert.throws(()=>validateSnapshot(next),/BANKING_PAY_V2_INVALID_RESPONSE/);
});
test('a read started before a mutation cannot publish after that mutation',async()=>{
  const pending=deferred();const env=setup();
  const read=env.controller.read(()=>pending.promise);await env.controller.enqueue(intent(1));
  pending.resolve({old:'page'});assert.equal((await read).state,'SUPERSEDED');
});
test('closing cancels local read signals but does not retry or cancel a mutation',async()=>{
  const env=setup();const pending=deferred();let signal;
  const read=env.controller.read((_,readerSignal)=>{signal=readerSignal;return pending.promise;});
  env.controller.close();assert.equal(signal.aborted,true);pending.resolve({});assert.equal((await read).state,'CLOSED');
});
test('a failed current read is visible and never converted to an empty page',async()=>{
  const env=setup();const result=await env.controller.read(async()=>{throw new Error('private transport payload');});
  assert.equal(result.state,'FAILED_VISIBLE');assert.equal(env.controller.snapshot(),env.initial);
  assert.equal(env.failures.length,1);assert.doesNotMatch(JSON.stringify(env.failures),/private transport/);
});
test('every open page is validated before the single adoption preparation',()=>{
  assert.equal(validateSnapshot(snapshot()).summary.contract,'BANKING_PAY_MODAL_STRUCTURE_V2');
  const value=snapshot();value.actions={...value.summary,rows:[{identity:'task',updating:true}]};
  assert.throws(()=>validateSnapshot(value));
});
test('a status-rendering failure cannot dispatch or leave an unresolved intent',async()=>{
  let calls=0;const env=setup({perform:async()=>{calls++;return{ok:true};},onStatus:()=>{throw new Error('render failed');}});
  assert.equal((await env.controller.enqueue(intent(1))).state,'FAILED_VISIBLE');
  assert.equal(calls,0);assert.equal(env.controller.snapshot(),env.initial);assert.ok(env.controller.lastFailure());
});
test('asynchronous adoption is rejected before its body can partly publish',async()=>{
  let commits=0;const env=setup({prepareAdoption:()=>async()=>{commits++;}});
  assert.equal((await env.controller.enqueue(intent(1))).state,'FAILED_VISIBLE');
  assert.equal(commits,0);assert.equal(env.controller.snapshot(),env.initial);
});

for(const [name,change] of Object.entries({
  bareSuccess:value=>({ok:true}),
  wrongIntent:value=>({...value,request_id:'other-intent'}),
  wrongSession:value=>({...value,session_id:fixture.id(2000)}),
  oldRevision:value=>({...value,progress_counter_version:2}),
  wrongScope:value=>({...value,scope_hash:'b'.repeat(64)}),
  stringVersion:value=>({...value,progress_counter_version:'4'})
}))test(`unproved accepted ${name} is read back, not trusted or retried`,async()=>{
  let mutations=0,reads=0,reconciles=0;
  const env=setup({perform:async()=>{mutations++;return change(receiptAt(1));},
    readBack:async()=>{reads++;return snapshot(4);},reconcile:async()=>{reconciles++;return snapshot(4);}});
  assert.equal((await env.controller.enqueue(intent(1))).state,'ADOPTED');
  assert.equal(mutations,1);assert.equal(reads,1);assert.equal(reconciles,0);
  assert.ok(env.states.some(row=>row.state==='TRANSPORT_UNCERTAIN'));
});

test('read-back cannot silently change filters inside the same session version',async()=>{
  const env=setup({perform:async()=>{throw new Error('lost response');},readBack:async()=>{
    const next=snapshot(4);next.summary.scope_hash='b'.repeat(64);return next;
  }});
  assert.equal((await env.controller.enqueue(intent(1))).state,'FAILED_VISIBLE');
  assert.equal(env.commits.length,0);assert.equal(env.controller.snapshot(),env.initial);
});

test('accepted navigation becomes the snapshot used by the next mutation',async()=>{
  let previousAtMutation;
  const env=setup({reconcile:async({previous})=>{previousAtMutation=previous;return snapshot(4);}});
  const sorted=snapshot();sorted.summary.sort_key='DEDUCTIONS';
  assert.equal((await env.controller.navigate(async()=>sorted)).state,'ADOPTED');
  assert.equal(env.controller.snapshot(),sorted);assert.equal(env.commits.length,1);
  assert.equal(env.controller.mayUseLegacyFallback(),true);
  await env.controller.enqueue(intent(1));assert.equal(previousAtMutation,sorted);
});

test('navigation status is explicitly read-only so presentation does not disable parent selection',async()=>{
  const pending=deferred();const env=setup();
  const read=env.controller.navigate(()=>pending.promise);
  assert.equal(env.states.at(-1).state,'READING');
  assert.equal(env.states.at(-1).busy,true);
  assert.equal(env.states.at(-1).read_only_navigation,true);
  pending.resolve(snapshot());
  assert.equal((await read).state,'ADOPTED');
  assert.ok(env.states.filter(value=>value.busy).every(value=>value.read_only_navigation===true));
});

test('later requested navigation wins when older same-revision results arrive last',async()=>{
  const first=deferred(),second=deferred();const env=setup();let firstSignal;
  const oldRead=env.controller.navigate((_,signal)=>{firstSignal=signal;return first.promise;});
  const newRead=env.controller.navigate(()=>second.promise);
  assert.equal(firstSignal.aborted,true);assert.equal(env.controller.isBusy(),true);
  const current=snapshot();current.summary.sort_key='READY_TO_PAY';second.resolve(current);
  assert.equal((await newRead).state,'ADOPTED');first.resolve(snapshot());
  assert.equal((await oldRead).state,'SUPERSEDED');assert.equal(env.controller.snapshot(),current);
  assert.equal(env.commits.length,1);assert.equal(env.controller.isBusy(),false);
});

test('mutation cancels pending navigation and its late result cannot reset the view',async()=>{
  const pending=deferred();const env=setup();let signal;
  const navigation=env.controller.navigate((_,readSignal)=>{signal=readSignal;return pending.promise;});
  assert.equal((await env.controller.enqueue(intent(1))).state,'ADOPTED');
  assert.equal(signal.aborted,true);pending.resolve(snapshot());
  assert.equal((await navigation).state,'SUPERSEDED');assert.equal(env.controller.snapshot().summary.progress_counter_version,4);
  assert.equal(env.commits.length,1);assert.equal(env.controller.isBusy(),false);
});

test('navigation cannot smuggle a newer financial revision into one open view',async()=>{
  const env=setup();
  assert.equal((await env.controller.navigate(async()=>snapshot(4))).state,'FAILED_VISIBLE');
  assert.equal(env.controller.snapshot(),env.initial);assert.equal(env.commits.length,0);
  assert.equal(env.controller.isBusy(),true);assert.equal((await env.controller.enqueue(intent(1))).state,'FAILED_VISIBLE');
  assert.equal((await env.controller.refreshAfterFailure()).state,'ADOPTED');
});

test('navigation rejects an invalid child without partial publication',async()=>{
  const env=setup();const next=snapshot();
  next.ready={...next.summary,candidate_id:fixture.id(1),rows:[{identity:'bad',candidate_id:fixture.id(2),effective_section:'canonical_preview_lines'}]};
  assert.equal((await env.controller.navigate(async()=>next)).state,'FAILED_VISIBLE');
  assert.equal(env.commits.length,0);assert.equal(env.controller.snapshot(),env.initial);assert.equal(env.controller.isBusy(),true);
});

test('failed navigation preserves old data and exposes a retryable page failure',async()=>{
  const env=setup();
  assert.equal((await env.controller.navigate(async()=>{throw new Error('transport detail');})).state,'FAILED_VISIBLE');
  assert.equal(env.controller.snapshot(),env.initial);assert.equal(env.commits.length,0);assert.equal(env.controller.isBusy(),false);
  assert.equal(env.failures.length,1);assert.doesNotMatch(JSON.stringify(env.failures),/transport detail/);
  assert.equal((await env.controller.navigate(async()=>snapshot())).state,'ADOPTED');
});

test('closing during navigation aborts readers and prevents adoption',async()=>{
  const pending=deferred();const env=setup();let signal;
  const navigation=env.controller.navigate((_,readSignal)=>{signal=readSignal;return pending.promise;});
  env.controller.close();assert.equal(signal.aborted,true);pending.resolve(snapshot());
  assert.equal((await navigation).state,'CLOSED');assert.equal(env.commits.length,0);
});

test('opening and closing a child changes only the accepted bounded graph',async()=>{
  const env=setup();const next=snapshot();
  next.ready={...next.summary,candidate_id:fixture.id(1),rows:[{identity:'ready-child',candidate_id:fixture.id(1),effective_section:'canonical_preview_lines'}]};
  await env.controller.navigate(async()=>next);
  assert.equal(env.controller.snapshot().ready.rows[0].identity,'ready-child');
  await env.controller.navigate(async(_,signal,previous)=>({...previous,ready:null}));
  assert.equal(env.controller.snapshot().ready,null);assert.equal(env.controller.snapshot().summary,next.summary);
  assert.equal(env.performed.length,0);assert.equal(env.commits.length,2);
});

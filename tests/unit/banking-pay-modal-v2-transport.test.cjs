const assert=require('node:assert/strict');
const test=require('node:test');
const controller=require('../../js/banking-pay-modal-v2.js');
const fixture=require('../fixtures/banking-pay-v2-table-page.cjs');
const context={session_id:fixture.id(1000),expected_session_version:2,expected_progress_counter_version:3,
  scope_hash:'a'.repeat(64),pay_channel_scope:'UMBRELLA'};
const selectionContext={...context,expected_view_digest:'c'.repeat(64)};
function transport(response={ok:true,view_digest:'d'.repeat(64),retention:{before_view_digest:'c'.repeat(64),
  other_candidates_unchanged:true,membership_unchanged:true,candidate_sort_unchanged:true,
  amount_sort_unchanged:false,deduction_sort_unchanged:true}}){
  const calls=[];
  const api=controller.createTransport({API:path=>`https://test.example.invalid${path}`,
    authFetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(response));}});
  return {api,calls};
}
test('summary transport preserves existing filters and exact one-request initial scope discovery',async()=>{
  const {api,calls}=transport(fixture.page());const initial={...context,sort_key:'CANDIDATE',sort_direction:'ASC',limit:100};delete initial.scope_hash;
  await api.readPage('summary',initial);
  assert.equal(calls.length,1);const url=new URL(calls[0].url);
  assert.equal(url.pathname,`/api/banking/pay/workbench/v2/session/${context.session_id}/candidates`);
  assert.equal(url.searchParams.has('scope_hash'),false);assert.equal(url.searchParams.get('pay_channel_scope'),'UMBRELLA');
  assert.equal(calls[0].options.method,'GET');
});
for(const [kind,path,params] of [
  ['ready',`candidate/${fixture.id(1)}/ready`,{candidate_id:fixture.id(1),cursor:null,limit:100}],
  ['timesheets',`candidate/${fixture.id(1)}/selected-ready-timesheets`,{candidate_id:fixture.id(1),scope_token:'only_selected'}],
  ['actions','action-required',{search:'A & B',sort_key:'TITLE',sort_direction:'ASC',cursor:null,limit:100}],
  ['actions','action-required',{view:'UPDATING',search:'',sort_key:'TITLE',sort_direction:'ASC',cursor:null,limit:100}],
  ['blocked','blocked',{search:'hold',sort_key:'AMOUNT',sort_direction:'DESC',cursor:null,limit:100}],
  ['actionDetail','action-required/exact_task',{identity:'exact_task',cursor:null,limit:100}],
  ['blockedDetail','blocked/exact_blocker',{identity:'exact_blocker',cursor:null,limit:100}]
]){
  test(`exact ${kind} route keeps path identities separate from the query`,async()=>{
    const {api,calls}=transport();const abort=new AbortController();await api.readPage(kind,{...context,...params},abort.signal);
    const url=new URL(calls[0].url);assert.equal(url.pathname,`/api/banking/pay/workbench/v2/session/${context.session_id}/${path}`);
    assert.equal(url.searchParams.has('candidate_id'),false);assert.equal(url.searchParams.has('identity'),false);
    assert.equal(url.searchParams.has('cursor'),false);assert.equal(calls[0].options.signal,abort.signal);
    if(params.search)assert.equal(url.searchParams.get('search'),params.search);
  });
}
for(const bad of [
  ['summary',{search:'new main search'}],['ready',{candidate_id:'../other'}],['actionDetail',{identity:'../other'}],
  ['summary',{sort_key:'GROSS'}],['summary',{scope_hash:null,cursor:'stale'}],['summary',{pay_channel_scope:'anything'}],
  ['actions',{view:'UPDATING',search:'no new search'}],['actions',{view:'UPDATING',sort_key:'PAYMENTS'}],
  ['actions',{view:'UPDATING',sort_direction:'DESC'}],['actions',{view:'invented'}],['blocked',{view:'UPDATING'}],
  ['timesheets',{candidate_id:fixture.id(1),scope_token:'contains spaces'}]
]){
  test(`reject invalid ${bad[0]} input before the authenticated transport`,async()=>{
    const {api,calls}=transport();await assert.rejects(()=>api.readPage(bad[0],{...context,...bad[1]}));
    assert.equal(calls.length,0);
  });
}
test('candidate mutation sends explicit intent once without a read abort signal or fake payment IDs',async()=>{
  const {api,calls}=transport();await api.mutateCandidate({...selectionContext,candidate_id:fixture.id(1),action:'CLEAR_ALL_READY',request_id:fixture.id(9000)});
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,'POST');assert.equal('signal' in calls[0].options,false);
  const body=JSON.parse(calls[0].options.body);assert.deepEqual(body,{expected_session_version:2,expected_progress_counter_version:3,
    scope_hash:'a'.repeat(64),pay_channel_scope:'UMBRELLA',action:'CLEAR_ALL_READY',request_id:fixture.id(9000),expected_view_digest:'c'.repeat(64)});
  assert.equal(calls[0].options.headers['content-type'],'application/json');
});
test('a lost mutation response is uncertain, is not retried and never exposes raw upstream detail',async()=>{
  let calls=0;const api=controller.createTransport({API:path=>path,authFetch:async()=>{calls++;throw new Error('unsafe upstream detail');}});
  await assert.rejects(()=>api.mutateCandidate({...selectionContext,candidate_id:fixture.id(1),action:'SELECT_ALL_READY',request_id:fixture.id(9000)}),
    error=>error.code==='BANKING_PAY_V2_MUTATION_UNCERTAIN'&&error.outcome==='UNCERTAIN'&&!error.message.includes('unsafe'));
  assert.equal(calls,1);
});

test('candidate selection carries only the already-open bounded Ready navigation in the same POST',async()=>{
  const {api,calls}=transport();
  await api.mutateCandidate({...selectionContext,candidate_id:fixture.id(1),action:'SELECT_ALL_READY',request_id:fixture.id(9000),
    open_ready:{cursor:'current_child_boundary',limit:100}});
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body).open_ready,{cursor:'current_child_boundary',limit:100});
  assert.equal('signal' in calls[0].options,false);
});
for(const open of [{limit:100},{cursor:null},{cursor:null,limit:101},{cursor:null,limit:'100'},
  {cursor:'../invalid',limit:100},{cursor:null,limit:100,candidate_id:fixture.id(2)},[]])
test(`invalid open Ready navigation cannot reach the authenticated transport ${JSON.stringify(open)}`,async()=>{
  const {api,calls}=transport();
  await assert.rejects(()=>api.mutateCandidate({...selectionContext,candidate_id:fixture.id(1),action:'SELECT_ALL_READY',
    request_id:fixture.id(9000),open_ready:open}));
  assert.equal(calls.length,0);
});
test('a confirmed stale rejection preserves its typed code and does not become an uncertain retry',async()=>{
  const api=controller.createTransport({API:path=>path,authFetch:async()=>new Response(JSON.stringify({ok:false,
    code:'BANKING_PAY_V2_STALE_REVISION',outcome:'REJECTED'}),{status:409})});
  await assert.rejects(()=>api.mutateCandidate({...selectionContext,candidate_id:fixture.id(1),action:'SELECT_ALL_READY',request_id:fixture.id(9000)}),
    error=>error.code==='BANKING_PAY_V2_STALE_REVISION'&&error.outcome==='REJECTED');
});
test('arbitrary remote text is not promoted to a user error or a false no-write promise',async()=>{
  const api=controller.createTransport({API:path=>path,authFetch:async()=>new Response(JSON.stringify({ok:false,
    code:'secret-like upstream value',outcome:'REJECTED'}),{status:503})});
  await assert.rejects(()=>api.mutateCandidate({...selectionContext,candidate_id:fixture.id(1),action:'SELECT_ALL_READY',request_id:fixture.id(9000)}),
    error=>error.code==='BANKING_PAY_V2_MUTATION_UNCERTAIN'&&error.outcome==='UNCERTAIN');
});

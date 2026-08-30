const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const main=fs.readFileSync(path.join(__dirname,'../../js/main.js'),'utf8');
const source=main.slice(main.indexOf('async function readCandidateRatePages('),main.indexOf('function wireCandidateRateClientSearch('));
function harness(fetch) {
  const context=vm.createContext({authFetch:fetch,API:p=>p,URLSearchParams});
  vm.runInContext(source,context);return context;
}
const ok=items=>({ok:true,json:async()=>({items})});
test('reads clients past both the old 50 cap and the API 200 cap',async()=>{
  const requests=[],rows=Array.from({length:413},(_,i)=>({id:String(i),name:'Client '+i}));
  const c=harness(async url=>{const q=new URL(url,'https://fixture.invalid').searchParams;requests.push(+q.get('offset'));return ok(rows.slice(+q.get('offset'),+q.get('offset')+(+q.get('limit'))));});
  assert.equal((await c.listCandidateRateClients()).length,413);
  assert.deepEqual(requests,[0,200,400]);
});
test('membership uses all defined rate windows, not just the first 500',async()=>{
  const clients=[{id:'a',name:'Alpha'},{id:'z',name:'Zedland'},{id:'h',name:'Historical'},{id:'n',name:'No rates'}];
  const rates=Array.from({length:500},(_,i)=>({id:String(i),client_id:'a'}));
  rates.push({id:'late',client_id:'z'},{id:'historical',client_id:'h',disabled_at_utc:'2025-12-31'});
  const c=harness(async url=>{const u=new URL(url,'https://fixture.invalid'),q=u.searchParams;const rows=u.pathname==='/api/clients'?clients:rates;return ok(rows.slice(+q.get('offset'),+q.get('offset')+(+q.get('limit'))));});
  const data=await c.loadCandidateRateClientChoices();
  assert.deepEqual(Array.from(data.eligible,x=>x.id),['a','h','z']);
  assert.equal(data.clients.length,4);
});
test('a later page failure rejects rather than offering an incomplete list',async()=>{
  const c=harness(async url=>new URL(url,'https://fixture.invalid').searchParams.get('offset')==='0'?ok(Array.from({length:200},(_,i)=>({id:String(i)}))):{ok:false});
  await assert.rejects(c.listCandidateRateClients(),/could not be loaded/);
});
test('ignored offsets cannot cause an infinite fetch loop',async()=>{
  let calls=0;
  const c=harness(async()=>{calls++;return ok(Array.from({length:200},(_,i)=>({id:String(i)})));});
  await assert.rejects(c.listCandidateRateClients(),/could not be loaded/);assert.equal(calls,2);
});
test('empty and malformed responses are distinguished',async()=>{
  assert.equal((await harness(async()=>ok([])).listCandidateRateClients()).length,0);
  await assert.rejects(harness(async()=>({ok:true,json:async()=>({})})).listCandidateRateClients());
});
test('picker is scoped to Candidate overrides and keeps Apply staging',()=>{
  const modal=main.slice(main.indexOf('async function openCandidateRateModal('),main.indexOf('// ---- Client modal',main.indexOf('async function openCandidateRateModal(')));
  assert.match(modal,/wireCandidateRateClientSearch/);
  assert.match(modal,/sequence !== rolesSequence/);
  assert.match(modal,/sequence === validationSequence/);
  assert.match(modal,/populateBands\(currentRole\)/);
  assert.match(modal,/O.stagedNew.push/);
  assert.doesNotMatch(modal,/method:\s*['"](?:POST|PATCH|PUT|DELETE)/);
  const shared=main.slice(main.indexOf('async function listClientsBasic()'),main.indexOf('async function readCandidateRatePages('));
  assert.match(shared,/authFetch\(API\('\/api\/clients'\)\)/);
});

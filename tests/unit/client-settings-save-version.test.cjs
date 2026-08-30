const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../../js/main.js'),'utf8');
const extract=name=>{
  const source=main.match(new RegExp('(?:async )?function '+name+'\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}'))?.[0];
  assert.ok(source,name);
  return source;
};
const setup=responses=>{
  const writes=[];
  const context={API:url=>url,authFetch:async(url,init)=>{
    writes.push({url,body:JSON.parse(init.body)});
    const result=responses.shift();
    return {ok:result.status!==409,status:result.status||200,json:async()=>result.body,
      text:async()=>JSON.stringify(result.body),headers:{get:()=>null}};
  }};
  vm.createContext(context);
  vm.runInContext(['upsertClient','upsertClientWithSettings','rememberClientSettingsWrite'].map(extract).join('\n'),context);
  return {context,writes};
};
test('legacy Client save callers retain the Client-only return shape',async()=>{
  const {context}=setup([{body:{client:{id:'client',name:'Example'},client_settings:{updated_at:'v1'}}}]);
  const result=await context.upsertClient({name:'Example'},'client');
  assert.equal(result.id,'client');assert.equal(result.client_settings,undefined);
});
test('consecutive own settings writes retain the latest exact response version and false values',async()=>{
  const {context}=setup([
    {body:{client:{id:'client'},client_settings:{updated_at:'v2',candidate_paper_submission_enabled:false}}},
    {body:{client:{id:'client'},client_settings:{updated_at:'v4',candidate_paper_submission_enabled:true}}}
  ]);
  const ctx={clientSettingsBaseline:{updated_at:'v1'},clientSettingsState:{weekly_mode:'NONE'}};
  for(const version of ['v2','v4']){
    const saved=await context.upsertClientWithSettings({client_settings:{auto_invoice_default:false}},'client');
    context.rememberClientSettingsWrite(ctx,saved.client_settings);
    assert.equal(ctx.clientSettingsBaseline.updated_at,version);
    assert.equal(ctx.clientSettingsState.updated_at,version);
    assert.equal(ctx.clientSettingsState.weekly_mode,'NONE');
    assert.equal(ctx.clientSettingsState.candidate_paper_submission_enabled,version==='v4');
  }
});
test('missing write representation invalidates rather than inventing the next concurrency token',()=>{
  const {context}=setup([]);
  const ctx={clientSettingsBaseline:{updated_at:'old'},clientSettingsState:{candidate_paper_submission_enabled:true}};
  context.rememberClientSettingsWrite(ctx,null);
  assert.equal(ctx.clientSettingsBaseline.updated_at,null);
  assert.equal(ctx.clientSettingsState.candidate_paper_submission_enabled,true);
});
test('a failed write throws and cannot supply a successful Client fallback',async()=>{
  const {context}=setup([{status:409,body:{error:'Conflict'}}]);
  await assert.rejects(context.upsertClientWithSettings({name:'Example'},'client'),/Conflict/);
});
test('policy version is checked before other writes; actual save errors use branded dialogs',()=>{
  const source=main.slice(main.indexOf('async function openClient(row)'),main.indexOf('function ensureSelectionStyles',main.indexOf('async function openClient(row)')));
  assert.ok(source.indexOf('await updateClientPrintedTimesheetPolicy(')<source.indexOf('await upsertClientWithSettings(payload, idForUpdate)'));
  assert.match(source,/rememberClientSettingsWrite\(window\.modalCtx, upd\.client_settings\)/);
  assert.match(source,/Client settings not saved/);
  assert.doesNotMatch(source,/alert\(`Failed to save (?:the Client printed-timesheet setting|Client settings)/);
  assert.doesNotMatch(source,/const clientId\s*=\s*idForUpdate \|\|/);
});

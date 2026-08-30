const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'../..');
const integration=require(path.join(root,'js','banking-pay-modal-v2-integration.js'));
const SESSION='00000000-0000-4000-8000-000000000001';

function model(overrides={}){
  return {enabled:true,session_id:SESSION,session_version:7,progress_counter_version:19,pay_channel_scope:'ALL',
    prelude_html:'<div class="warn">Preserved warning</div>',filter_summary:'Scope: All payment routes',has_active_filters:true,
    clear_filters_title:'Clear filters',create_button:{disabled:true,label:'Select rows',title:'Select at least one payment',
      ready_label:'Create drafts (override required)',ready_title:'Same-week PAYE override will require password, 2FA, and explicit continue confirmation.',
      paye_guard_allows_create:true},
    progress_html:'<div data-progress>Current progress</div>',...overrides};
}

test('the contained shell cannot render before capability agreement',()=>{
  assert.equal(integration.renderShell(model({enabled:false})),null);
  assert.equal(integration.renderShell(model({session_version:-1})),null);
});

test('the pre-session presentation is one v2-shaped loading surface and never the retired Banking views',()=>{
  assert.equal(integration.renderBootstrapShell({enabled:false,pay_channel_scope:'ALL'}),null);
  const html=integration.renderBootstrapShell({enabled:true,pay_channel_scope:'ALL'});
  assert.match(html,/data-bpv2-bootstrap="1"/);
  assert.match(html,/Loading Banking Pay/);
  assert.match(html,/Loading Ready to Pay/);
  assert.match(html,/Ready to Pay/);
  assert.match(html,/Action Required/);
  assert.match(html,/Blocked for Pay/);
  assert.doesNotMatch(html,/Create payment batch|Cases \/ Resolutions|Name check|Funding required|Not connected/);
  assert.doesNotMatch(html,/data-bpv2-shell="1"/);
});

test('the pre-session presentation exposes a contained retry state without enabling financial actions',()=>{
  const html=integration.renderBootstrapShell({enabled:true,pay_channel_scope:'PAYE',error_message:'transport detail',retry_action:'banking:pay:refreshAll'});
  assert.match(html,/Banking Pay could not refresh/);
  assert.match(html,/data-action="banking:pay:refreshAll"/);
  assert.match(html,/Create drafts<\/button>/);
  assert.doesNotMatch(html,/transport detail/);
  assert.equal((html.match(/disabled/g)||[]).length>=6,true);
});

test('the contained shell retains the original Draft, filter and export actions',()=>{
  const html=integration.renderShell(model());
  assert.match(html,/data-bpv2-shell="1"/);
  assert.match(html,/data-action="banking:pay:createDraft"/);
  assert.match(html,/data-action="banking:pay:openFiltersModal"/);
  assert.match(html,/data-action="banking:pay:clearFilters"/);
  assert.match(html,/data-action="banking:pay:exportReadyToPayCsv"/);
  assert.match(html,/Action Required/);
  assert.match(html,/Blocked for Pay/);
  assert.match(html,/Preserved warning/);
  assert.doesNotMatch(html,/candidate-search|View (?:breakdown|details)/i);
  assert.match(html,/data-bpv2-ready-label="Create drafts \(override required\)"/);
  assert.match(html,/data-bpv2-paye-guard-allows-create="1"/);
});

test('the contained shell carries the existing PAYE Draft guard without widening it',()=>{
  const html=integration.renderShell(model({create_button:{disabled:true,label:'Select rows',title:'A PAYE draft already exists. Cancel or delete it first.',
    ready_label:'Create drafts',ready_title:'Create draft batches from the selected current Ready to Pay rows',paye_guard_allows_create:false}}));
  assert.match(html,/data-bpv2-paye-guard-allows-create="0"/);
  assert.match(html,/title="A PAYE draft already exists\. Cancel or delete it first\."/);
});

test('v2 adoption updates compatibility authority but forces unchanged Create Draft to reread physical rows',()=>{
  const state={pay:{draftWizard:{workbench:{required_preview_sections_loaded:{canonical_preview_lines:true,blocked_for_pay:true}},
    decisions:{required_preview_sections_loaded:{canonical_preview_lines:true}}}}};
  const review={session_id:SESSION,session_version:8,progress_counter_version:20,
    selected_preview_row_ids:[],selected_set_complete:false,captured_from_rendered_workbench:true};
  const next={summary:{session_id:SESSION,session_version:8,progress_counter_version:20,
    global:{selected_ready_count:13}}};
  integration.applyLegacyAuthority(state,next,review);
  const wizard=state.pay.draftWizard;
  assert.deepEqual(wizard.workbench.selection_review_snapshot,review);
  assert.equal(wizard.workbench.selection_review_snapshot.selected_set_complete,false);
  assert.deepEqual(wizard.workbench.required_preview_sections_loaded,{});
  assert.deepEqual(wizard.workbench.requiredPreviewSectionsLoaded,{});
  assert.equal(wizard.workbench.session_id,SESSION);
  assert.equal(wizard.workbench.progress_counter_version,20);
  assert.equal(wizard.selection_mutation_authority.selected_eligible_ready_row_count,13);
});

test('source keeps uncertain settlement read-only and never replaces Create Draft',()=>{
  const source=fs.readFileSync(path.join(root,'js','banking-pay-modal-v2-integration.js'),'utf8');
  assert.match(source,/readBack:\(\{previous\}\)=>currentGraph\(previous\)/);
  assert.match(source,/required_preview_sections_loaded=\{\}/);
  assert.doesNotMatch(source,/mutateCandidate\([^)]*\).*mutateCandidate\(/s);
  assert.doesNotMatch(source,/runLegacy\(\{action:'banking:pay:createDraft'/);
});

test('read-only detail navigation never dims or locks accepted parent controls',()=>{
  assert.equal(integration.shouldLockControls({state:'READING',busy:true,read_only_navigation:true}),false);
  assert.equal(integration.shouldLockControls({state:'ADOPTED',busy:true,read_only_navigation:true}),false);
  assert.equal(integration.shouldLockControls({state:'RECONCILING',busy:true,read_only_navigation:false}),true);
  assert.equal(integration.shouldLockControls({state:'FAILED_VISIBLE',busy:true,read_only_navigation:false}),true);
});

test('detail host is portalled outside the parent Banking scroll layout and removed on teardown',()=>{
  const source=fs.readFileSync(path.join(root,'js','banking-pay-modal-v2-integration.js'),'utf8');
  assert.match(source,/document\.body\.appendChild\(childHost\)/);
  assert.match(source,/childHost\.remove\(\)/);
  assert.match(source,/onStatus:value=>setBusy\(shouldLockControls\(value\)\)/);
});

test('application seam creates only secure UUID request identities and fails closed when unavailable',()=>{
  const source=fs.readFileSync(path.join(root,'js','main.js'),'utf8');
  const start=source.indexOf('newRequestId: () => {',source.indexOf('CloudTMSBankingPayModalV2Integration'));
  const end=source.indexOf('formatIsoToUk:',start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const requestIdSource=source.slice(start,end);
  assert.match(requestIdSource,/crypto\.randomUUID/);
  assert.match(requestIdSource,/crypto\.getRandomValues/);
  assert.match(requestIdSource,/BANKING_PAY_V2_SECURE_REQUEST_ID_UNAVAILABLE/);
  assert.doesNotMatch(requestIdSource,/Math\.random|Date\.now/);
});

test('retained actions always remount v2 and navigation is not dropped by an older read',()=>{
  const source=fs.readFileSync(path.join(root,'js','banking-pay-modal-v2-integration.js'),'utf8');
  const legacyStart=source.indexOf('async function runLegacy');
  const legacyEnd=source.indexOf('function ensureMain',legacyStart);
  const legacySource=source.slice(legacyStart,legacyEnd);
  assert.match(legacySource,/finally\{await context\.rerender\('pay'\);\}/);
  assert.doesNotMatch(legacySource,/if\s*\(\s*shell\.isConnected\s*\)/);

  const navigationStart=source.indexOf("shell.addEventListener('click'");
  const navigationEnd=source.indexOf('return {shell,callbacks',navigationStart);
  const navigationSource=source.slice(navigationStart,navigationEnd);
  assert.doesNotMatch(navigationSource,/controller\?\.isBusy\(\)/);
  assert.match(navigationSource,/controller\.openIssues\('actions'\)/);
  assert.match(navigationSource,/controller\.openIssues\('blocked'\)/);
});

test('a moving revision renews authority instead of falling back to the legacy table',()=>{
  const source=fs.readFileSync(path.join(root,'js','banking-pay-modal-v2-integration.js'),'utf8').replace(/\r\n/g,'\n');
  assert.match(source,/const staleMountCodes=new Set\(\['BANKING_PAY_V2_STALE_REVISION','BANKING_PAY_V2_STALE_VIEW','BANKING_PAY_V2_SCOPE_MISMATCH'\]\)/);
  assert.match(source,/async function renewMountAuthority\(shell,context,state\)/);
  assert.match(source,/for\(let attempt=0;attempt<4;attempt\+=1\)/);
  const staleBranchStart=source.indexOf('if(staleMountCodes.has(errorCode(error)))');
  const ordinaryFailureStart=source.indexOf('\n    {\n      runtime.shell',staleBranchStart+1);
  const staleBranch=source.slice(staleBranchStart,ordinaryFailureStart);
  assert.match(staleBranch,/Banking Pay changed while this screen was loading/);
  assert.doesNotMatch(staleBranch,/available=false|context\.rerender/);
});

test('background Pay rerenders refresh an open v2 child in place',()=>{
  const integrationSource=fs.readFileSync(path.join(root,'js','banking-pay-modal-v2-integration.js'),'utf8');
  const controllerSource=fs.readFileSync(path.join(root,'js','banking-pay-modal-v2.js'),'utf8');
  const mainSource=fs.readFileSync(path.join(root,'js','main.js'),'utf8');
  assert.match(controllerSource,/refreshCurrentAuthority:queue\.refreshAfterFailure/);
  assert.match(integrationSource,/async refreshOpenSurface\(\)/);
  assert.match(integrationSource,/controller\.snapshot\(\)\?\.ui\?\.surface==='main'&&controller\.isBusy\(\)\)return true/);
  assert.match(integrationSource,/controller\.refreshCurrentAuthority\(\)/);
  assert.match(integrationSource,/surfaceName==='candidate'/);
  assert.match(integrationSource,/surfaceName==='actions'\|\|surfaceName==='actionDetail'/);
  assert.match(integrationSource,/surfaceName==='blocked'\|\|surfaceName==='blockedDetail'/);
  assert.match(mainSource,/CloudTMSBankingPayModalV2Integration\.refreshOpenSurface\(\)/);
  assert.match(mainSource,/if \(refreshedOpenSurface\)[\s\S]{0,260}return true;/);
});

test('a disconnected modal controller cannot suppress a later Banking Pay reopen',()=>{
  const source=fs.readFileSync(path.join(root,'js','banking-pay-modal-v2-integration.js'),'utf8');
  assert.match(source,/if\(mounted&&!mounted\.shell\?\.isConnected\)\{mounted\.close\(\);mounted=null;return false;\}/);
});

test('capability discovery keeps the bootstrap mounted until the existing Workbench session can render v2',()=>{
  const source=fs.readFileSync(path.join(root,'js','banking-pay-modal-v2-integration.js'),'utf8');
  assert.match(source,/const bootstrap=.*data-bpv2-bootstrap/);
  assert.match(source,/if\(slot\.available===true\)\{if\(!bootstrap\)await context\.rerender\('pay'\);return true;\}/);
  assert.match(source,/if\(bootstrap\)await context\.rerender\('pay'\);return false/);
});

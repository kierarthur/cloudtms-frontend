const test=require('node:test'),assert=require('node:assert/strict');
const layout=require('../../js/record-modal-layout.js');
const fs=require('node:fs'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../../js/main.js'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'../../js/record-modal-layout.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../../css/record-modal-layout.css'),'utf8');
test('new-client defaults are explicit and isolated per record',()=>{
 const a=layout.newClientSettings(),b=layout.newClientSettings();a.daily_calc_of_invoices=false;
 assert.equal(b.daily_calc_of_invoices,true);assert.equal(b.candidate_paper_submission_enabled,true);
 assert.equal(b.invoice_consolidation_mode,'NONE');assert.equal(b.week_ending_weekday,0);
 for(const key of layout.timeNames)assert.equal(b[key],'');
 for(const key of ['pay_reference_required','invoice_reference_required','reference_number_required_to_issue_invoice','auto_invoice_default'])assert.equal(b[key],false);
});

test('layout retains original controls and introduces no transport or business-rule implementation',()=>{
 assert.match(source,/form\.prepend\(method\)/);
 assert.match(source,/shiftBody\.append\(n\)/);
 assert.match(source,/data-client-billing/);
 assert.doesNotMatch(source,/\b(?:fetch|authFetch|showModal)\s*\(/);
 assert.match(source,/\.ma-summary/);
 assert.match(source,/append\(summary\)/);
});

test('Candidate enhancement follows rendered form identity during asynchronous tab mounting',()=>{
 const enhancer=fs.readFileSync(path.join(__dirname,'../../js/modal-modernisation.js'),'utf8');
 assert.match(source,/form\.dataset\.recordCandidateTab = tab/);
 assert.match(enhancer,/form\?\.dataset\.recordCandidateTab \|\| \(form\?\.id === 'tab-pay' \? 'pay' : tab\)/);
 for(const tab of ['main','work','pay']) assert.ok(enhancer.includes(`entity === 'candidates' && candidateTab === '${tab}'`));
});

test('moved candidate fields retain tab persistence, primary-role controls and validation',()=>{
 assert.match(main,/this\.entity === 'candidates' && this\.currentTabKey === 'pay' && byId\('tab-pay'\)/);
 assert.match(main,/fs\.pay = \{ \.\.\.\(fs\.pay \|\| \{\}\), \.\.\.c, __forMethod:/);
 assert.match(main,/\['main', 'work'\]\.includes\(fr\.currentTabKey\)/);
 assert.match(main,/validationTabs = fr\.entity === 'candidates' \? \['main', 'work', 'pay'\]/);
 assert.match(main,/'address_line1','address_line2','address_line3','town_city','county','postcode','country','notes'\]\.includes\(k\)/);
});

test('client billing and shift drafts are saved through existing parent save guards',()=>{
 assert.match(main,/CloudTMSRecordLayout\?\.captureBilling\(window\.modalCtx\)/);
 assert.match(main,/payment_terms_days \?\? 30/);
 assert.match(main,/enteredShiftCount > 0 && enteredShiftCount < shiftKeys\.length/);
 assert.match(main,/title: 'Complete the shift pattern'/);
 assert.match(source,/ui\.shiftDraft=inputs\.map\(el=>el\.value\)/);
 assert.match(source,/ui\.clientTab=key/);
 assert.match(source,/data-ctms-intentional-lock/);
 assert.match(source,/!\['edit','create'\]\.includes\(frame\.mode\)/);
});

test('switches have distinct visible thumbs and phone time-entry pairs retain usable width',()=>{
 assert.match(css,/record-switch::after[\s\S]*width:20px/);
 assert.match(css,/background:#17283e !important/);
 assert.match(css,/background:#5b51dc !important/);
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(125px,1fr\)\)/);
 assert.match(source,/ArrowLeft','ArrowRight','Home','End/);
});
test('special new workflows propose All; existing records and custom choices never reset',()=>{
 const plain=layout.newClientSettings();
 for(const patch of [{weekly_mode:'NHSP'},{weekly_mode:'HEALTHROSTER',hr_weekly_behaviour:'CREATE'},{self_bill_no_invoices_sent:true}]){
  const special={...plain,...patch,invoice_consolidation_mode:'BY_WEEK'};
  assert.equal(layout.defaultConsolidation(plain,special,true,false).invoice_consolidation_mode,'ANY_WEEK');
  assert.equal(layout.defaultConsolidation(plain,special,false,false).invoice_consolidation_mode,'BY_WEEK');
  assert.equal(layout.defaultConsolidation(plain,special,true,true).invoice_consolidation_mode,'BY_WEEK');
  assert.equal(layout.defaultConsolidation(special,plain,true,false).invoice_consolidation_mode,'NONE');
 }
 assert.equal(layout.specialConsolidation({...plain,weekly_mode:'HEALTHROSTER',hr_weekly_behaviour:'VERIFY'}),false);
});

test('client billing clears use the existing null contract without touching omitted values',async()=>{
 const vm=require('node:vm'),writes=[];
 const fn=main.match(/async function upsertClient\(payload, id\)\{[\s\S]*?\n\}/)?.[0]
   + '\n' + main.match(/async function upsertClientWithSettings\(payload, id\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(fn);
 const context={API:url=>url,authFetch:async(url,init)=>{
  const body=JSON.parse(init.body);writes.push(body);
  return {ok:true,status:200,json:async()=>({client:{id:'example',...body}})};
 }};
 vm.createContext(context);vm.runInContext(`${fn};this.save=upsertClient`,context);
 await context.save({invoice_address:'',primary_invoice_email:'',ap_phone:'',payment_terms_days:0,vat_chargeable:false},'example');
 assert.deepEqual(writes[0],{invoice_address:null,primary_invoice_email:null,ap_phone:null,payment_terms_days:0,vat_chargeable:false});
 await context.save({client_settings:{daily_calc_of_invoices:false}},'example');
 assert.deepEqual(writes[1],{client_settings:{daily_calc_of_invoices:false}});
 await context.save({invoice_address:'New address',primary_invoice_email:'billing@example.invalid',ap_phone:'020 7000 0000'},'example');
 assert.deepEqual(writes[2],{invoice_address:'New address',primary_invoice_email:'billing@example.invalid',ap_phone:'020 7000 0000'});
});

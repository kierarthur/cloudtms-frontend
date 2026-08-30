const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const main=fs.readFileSync(path.join(__dirname,'../../js/main.js'),'utf8');
const start=main.indexOf('function renderAdvancesSummary(summary)');
const end=main.indexOf('async function openCandidate(row)',start);
function harness(entry) {
  const summary={innerHTML:''};
  const context=vm.createContext({
    window:{appState:{candidateAdvances:{fixture:entry}}},
    document:{getElementById:id=>id==='candidateAdvancesSummary'?summary:null},
    escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  });
  vm.runInContext(main.slice(start,end),context);
  return {context,summary};
}
test('finance balances retain each existing source field, count and two-decimal formatting',()=>{
  const {context}=harness({});
  const data={
    payment_advances_count:'3',payment_advances_outstanding_total:1250.5,
    overpayments_count:2,overpayments_outstanding_total:45,
    underpayments_count:1,underpayments_outstanding_total:9.99,
    manual_debt_adjustments_count:4,manual_debt_adjustments_outstanding_total:1234567.89,
    manual_credit_adjustments_count:5,manual_credit_adjustments_total:30,
    mixed_finance_cases_count:2,unresolved_finance_cases_count:3,stale_finance_cases_count:4,
    snoozed_finance_cases_count:2,active_timesheet_snoozes_count:5
  };
  const original=JSON.stringify(data),html=context.renderAdvancesSummary(data);
  for(const amount of ['1250.50','45.00','9.99','1234567.89','30.00']) assert.ok(html.includes('£'+amount));
  assert.equal((html.match(/class="candidate-finance-balance"/g)||[]).length,5);
  assert.equal((html.match(/>Outstanding</g)||[]).length,4);
  assert.match(html,/Manual credit adjustments[\s\S]*£30\.00[\s\S]*>Total</);
  assert.match(html,/Snoozed \/ Deferred items<\/dt><dd>7<\/dd>/);
  assert.equal(JSON.stringify(data),original);
});
test('a loaded zero report keeps all five balances and four indicators',()=>{
  const {context}=harness({});
  const html=context.renderAdvancesSummary({});
  assert.equal((html.match(/£0\.00/g)||[]).length,5);
  assert.equal((html.match(/class="candidate-finance-indicator"/g)||[]).length,4);
});
for(const [name,entry,expected] of [
  ['loading',{loading:true,report:null},'Loading current candidate finance data'],
  ['unavailable',{error:'Finance unavailable',report:null},'Finance unavailable']
]) test(name+' does not substitute zero balances',()=>{
  const {context,summary}=harness(entry);
  context.updateCandidateAdvancesUI('fixture');
  assert.ok(summary.innerHTML.includes(expected));
  assert.doesNotMatch(summary.innerHTML,/candidate-finance-balances|£0\.00/);
  assert.match(summary.innerHTML,/id="candidateFinanceReportLaunchBtn"/);
});
test('failed refresh retains last-known amounts and the existing stale warning',()=>{
  const {context,summary}=harness({error:'Unavailable',report:{summary:{overpayments_outstanding_total:35}}});
  context.updateCandidateAdvancesUI('fixture');
  assert.match(summary.innerHTML,/£35\.00/);
  assert.match(summary.innerHTML,/last successful refresh and may be out of date/);
  assert.match(summary.innerHTML,/candidateFinanceReportRetryBtn/);
});
test('report and retry keep their original read-only actions',()=>{
  const source=main.slice(start,end);
  assert.match(source,/await openCandidateLoansOverpaymentsModal\(cid\)/);
  assert.match(source,/await fetchCandidateAdvances\(cid\)/);
  assert.doesNotMatch(source,/method:\s*['"](?:POST|PATCH|DELETE)|showModal\(/);
});

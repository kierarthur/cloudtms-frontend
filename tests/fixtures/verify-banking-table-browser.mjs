// Run with the authorised in-app browser's existing tab. All interactions use
// its Playwright API; evaluate only reads rendered DOM. This is NOT end-to-end
// application or database verification and does not call an application API.
import assert from 'node:assert/strict';
export async function verifyBankingTableBrowser(tab) {
  const read=async callback=>JSON.parse(JSON.stringify(await tab.playwright.evaluate(callback)));
  const result=()=>tab.playwright.evaluate(()=>document.getElementById('result').textContent);
  const reset=()=>tab.playwright.getByRole('button',{name:'Reset fixture',exact:true}).click();
  const first='A long candidate name used to check one-line layout at narrow widths';
  const checks=[];
  await reset();
  const geometry=await read(()=>({
    headers:[...document.querySelectorAll('th')].map(x=>x.innerText),
    rows:document.querySelectorAll('tbody tr').length,
    cells:[...new Set([...document.querySelectorAll('tbody tr')].map(x=>x.cells.length))],
    heights:[...new Set([...document.querySelectorAll('tbody tr')].map(x=>x.getBoundingClientRect().height))],
    headline:document.querySelector('[data-bpv2-headline]').textContent,
    halfTick:document.querySelector('tbody input').getAttribute('aria-checked')
  }));
  assert.deepEqual(geometry.headers,['Include','Candidate','Deductions','Ready to pay']);
  assert.equal(geometry.rows,100);assert.deepEqual(geometry.cells,[4]);assert.equal(geometry.heights.length,1);
  assert.equal(geometry.halfTick,'mixed');assert.equal(geometry.headline,'Ready to pay £220.00');
  checks.push('100 single-height four-cell candidate rows; whole-scope headline and half-tick');
  await tab.playwright.getByRole('button',{name:`Timesheets for ${first}`,exact:true}).dblclick();
  let events=JSON.parse(await result());
  assert.equal(events.events.length,1);assert.equal(events.events[0].type,'timesheets');
  assert.deepEqual(events.events[0].timesheet_ids,['00000000-0000-4000-8000-000000002001']);
  assert.equal(events.parentDoubleClicks,0);
  checks.push('Timesheets double-click dispatches once with selected IDs and no parent opening');
  await reset();
  await tab.playwright.getByRole('checkbox',{name:`Include ${first}`,exact:true}).click();
  events=JSON.parse(await result());
  assert.equal(events.events.length,1);assert.equal(events.events[0].action,'SELECT_ALL_READY');
  const pending=await read(()=>({
    headline:document.querySelector('[data-bpv2-headline]').textContent,
    amount:document.querySelector('tbody [data-bpv2-amount]').textContent,
    check:document.querySelector('tbody input').getAttribute('aria-checked'),
    disabled:document.querySelector('tbody input').disabled
  }));
  assert.deepEqual(pending,{headline:'Ready to pay £220.00',amount:'£10.00',check:'mixed',disabled:true});
  checks.push('selection stays non-optimistic and disables controls before server settlement');
  await tab.playwright.getByRole('button',{name:'Apply accepted selection',exact:true}).click();
  assert.deepEqual(JSON.parse(await result()),{accepted:true,rowNodeRetained:true});
  assert.equal(await tab.playwright.evaluate(()=>document.querySelector('[data-bpv2-headline]').textContent),'Ready to pay £235.00');
  checks.push('accepted update retains existing candidate DOM node and updates headline');
  await tab.playwright.getByRole('button',{name:'Attempt invalid response',exact:true}).click();
  assert.deepEqual(JSON.parse(await result()),{invalidRejected:true,unchanged:true});
  checks.push('invalid envelope changes no visible DOM');
  await reset();
  await tab.playwright.getByRole('cell',{name:'Fixture candidate 002TEST-2',exact:true}).dblclick();
  await tab.playwright.getByRole('button',{name:`Timesheets for ${first}`,exact:true}).click();
  events=JSON.parse(await result());
  assert.deepEqual(events.events.map(x=>x.type),['open','timesheets']);assert.equal(events.parentDoubleClicks,0);
  checks.push('non-interactive candidate double-click opens only the exact candidate');
  await reset();
  await tab.playwright.getByRole('button',{name:'Deductions',exact:true}).click();
  assert.deepEqual(JSON.parse(await result()).events,[{type:'sort',sort_key:'DEDUCTIONS',sort_direction:'ASC'}]);
  await tab.playwright.getByRole('button',{name:'Next',exact:true}).click();
  assert.equal(JSON.parse(await result()).events[1].direction,'next');
  checks.push('headers and paging emit server-navigation intent only');
  await reset();
  await tab.playwright.getByRole('checkbox',{name:'Include all eligible payments for every candidate',exact:true}).click();
  events=JSON.parse(await result());
  assert.equal(events.events.length,1);assert.equal(events.events[0].type,'global');
  assert.equal(events.events[0].action,'SELECT_ALL_READY');assert.equal(events.events[0].candidate_id,undefined);
  checks.push('Include header emits one full-scope intent, not 100 individual changes');
  await reset();
  await tab.playwright.getByRole('button',{name:'Narrow layout',exact:true}).click();
  await tab.playwright.getByRole('button',{name:'Largest display scalar',exact:true}).click();
  const narrow=await read(()=>({
    viewport:document.querySelector('[data-bpv2-scroll]').clientWidth,
    table:document.querySelector('table').getBoundingClientRect().width,
    heights:[...new Set([...document.querySelectorAll('tbody tr')].map(x=>x.getBoundingClientRect().height))],
    paymentWidth:document.querySelector('tbody tr').cells[3].clientWidth,
    paymentScroll:document.querySelector('tbody tr').cells[3].scrollWidth,
    amount:document.querySelector('tbody [data-bpv2-amount]').textContent
  }));
  assert.ok(narrow.table>narrow.viewport);assert.equal(narrow.heights.length,1);
  assert.equal(narrow.paymentWidth,narrow.paymentScroll);assert.equal(narrow.amount,'£9,999,999,999,999,999.99');
  checks.push('narrow view scrolls horizontally; large amount stays intact and rows never wrap');
  await tab.playwright.getByRole('button',{name:'Narrow layout',exact:true}).click();
  await tab.playwright.getByRole('button',{name:'20 mount/unmount cycles',exact:true}).click();
  assert.deepEqual(JSON.parse(await result()),{cycles:20,mountedTables:1,mountedRows:100});
  await tab.playwright.getByRole('button',{name:`Timesheets for ${first}`,exact:true}).click();
  assert.equal(JSON.parse(await result()).events.length,1);
  checks.push('20 mount/unmount cycles leave one table and no duplicate click dispatch');
  await reset();
  return {kind:'SYNTHETIC_COMPONENT_BROWSER_ONLY',pass:true,checks,geometry,narrow,
    exclusions:['Not a hosted Workbench test','No financial mutation or Draft execution','No complete modal memory/performance claim']};
}

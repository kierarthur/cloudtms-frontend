import { expect, test, type Page, type TestInfo } from '@playwright/test';

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const field = (page: Page, name: string) => page.locator(`#modal [name="${name}"]`);
async function result(page: Page) {
  return JSON.parse(await page.locator('#fixture-results').textContent() || '{}');
}
async function open(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('#modal')).toBeVisible();
}
async function screenshotAndFit(page: Page, info: TestInfo, name: string) {
  const metrics = await page.locator('#modal').evaluate(modal => {
    const r = modal.getBoundingClientRect();
    const b = document.getElementById('modalBody')!;
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: innerWidth,
      height: innerHeight, overflow: b.scrollWidth - b.clientWidth };
  });
  expect(metrics.x).toBeGreaterThanOrEqual(-2);
  expect(metrics.y).toBeGreaterThanOrEqual(-2);
  expect(metrics.right).toBeLessThanOrEqual(metrics.width + 2);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.height + 2);
  expect(metrics.overflow).toBeLessThanOrEqual(2);
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  const screenshotPath = info.outputPath(`${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
  await page.screenshot({ path: screenshotPath });
  await info.attach(name, { path: screenshotPath, contentType: 'image/png' });
}

test.beforeEach(async ({ page }) => {
  // Never allow this regression suite to send a request to TEST or LIVE.
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    return u.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  page.on('dialog', dialog => {
    void dialog.dismiss();
    throw new Error(`Unexpected native dialog: ${dialog.type()}`);
  });
});

async function openRatePicker(page: Page, mode = 'all') {
  await page.goto('/?rate-clients=' + mode);
  await page.getByRole('button', { name: 'Existing candidate', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Care Packages').click();
  await page.getByRole('button', { name: 'Add rate override', exact: true }).click();
  await expect(page.locator('#cr_client_search')).toBeVisible();
}
async function chooseRateClient(page: Page, name: string, info: TestInfo) {
  await page.locator('#cr_client_search').fill(name);
  const option=page.getByRole('option', { name, exact: true });
  await expect(option).toBeVisible();
  if(info.project.name==='desktop') await option.click(); else await option.tap();
}
async function ratePickerVisual(page: Page, info: TestInfo, name: string) {
  const geometry=await page.locator('#modal').evaluate(el=>{
    const r=el.getBoundingClientRect(),b=document.getElementById('modalBody')!;
    return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,overflow:b.scrollWidth-b.clientWidth};
  });
  expect(geometry.x).toBeGreaterThanOrEqual(-2);expect(geometry.y).toBeGreaterThanOrEqual(-2);
  expect(geometry.right).toBeLessThanOrEqual(geometry.w+2);expect(geometry.bottom).toBeLessThanOrEqual(geometry.h+2);
  expect(geometry.overflow).toBeLessThanOrEqual(2);
  await page.screenshot({path:info.outputPath(name+'.png')});
}

test('rate client picker searches every page and excludes clients without rates',async({page},info)=>{
  await openRatePicker(page);
  const search=page.locator('#cr_client_search'),list=page.getByRole('listbox',{name:'Eligible clients'});
  await search.click();
  await expect(list.getByRole('option')).toHaveText(['Northshire Community Health','Riverside Historic Care','Zedland Integrated Care Partnership']);
  await ratePickerVisual(page,info,'eligible-clients');
  await search.fill('Client 205');
  await expect(list.getByRole('option')).toHaveCount(0);
  await expect(list).toContainText('No matching clients with care package rates.');
  await search.fill('zEdLaNd');
  await expect(list.getByRole('option')).toHaveText(['Zedland Integrated Care Partnership']);
  await search.press('ArrowDown');await search.press('Enter');
  await expect(search).toHaveValue('Zedland Integrated Care Partnership');
  await expect(list).toBeHidden();
  await expect(page.locator('#cr_client_id')).toHaveValue('72000000-0000-4000-8000-000000000001');
  const reads=(await result(page)).pickerReads;
  expect(reads.some((r:any)=>r.path==='/api/clients'&&r.offset===200)).toBe(true);
  expect(reads.some((r:any)=>r.path.endsWith('client-defaults')&&r.offset===500&&!r.client)).toBe(true);
  expect((await result(page)).writes).toEqual([]);
});

test('rate client selection stages correct role band and amounts then survives parent Save',async({page},info)=>{
  await openRatePicker(page);
  await chooseRateClient(page,'Zedland Integrated Care Partnership',info);
  await expect(page.locator('#cr_role')).toBeEnabled();
  await page.locator('#cr_role').selectOption('Community Nurse');
  await expect(page.locator('#cr_band')).toHaveValue('7');
  await page.locator('#cr_date_from').fill('01/09/2026');await page.locator('#cr_date_from').press('Tab');
  await expect(page.locator('#pay_day')).toBeEnabled();
  await page.locator('#pay_day').fill('90');await page.locator('#pay_day').press('Tab');
  await expect(page.getByRole('button',{name:'Apply',exact:true})).toBeDisabled();
  await page.locator('#pay_day').fill('30');await page.locator('#pay_day').press('Tab');
  await expect(page.locator('#cr_m_day')).toHaveText('30.00');
  await page.locator('#modalTitle').click();
  await ratePickerVisual(page,info,'selected-client-rate');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('#modalTitle')).toHaveText('Edit Candidate');
  await expect(page.locator('#modalBody')).toContainText('Zedland Integrated Care Partnership');
  expect((await result(page)).writes).toEqual([]);
  await tab(page,'Main Details').click();await tab(page,'Care Packages').click();
  const row=page.getByRole('row').filter({hasText:'Zedland Integrated Care Partnership'});
  await row.dblclick();
  await expect(page.locator('#cr_client_search')).toHaveValue('Zedland Integrated Care Partnership');
  await expect(page.locator('#cr_role')).toHaveValue('Community Nurse');
  await expect(page.locator('#cr_band')).toHaveValue('7');
  await expect(page.locator('#pay_day')).toHaveValue('30.00');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('#modalTitle')).toHaveText('View Candidate');
  const saved=(await result(page)).candidateRates;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({client_id:'72000000-0000-4000-8000-000000000001',role:'Community Nurse',band:'7',rate_type:'PAYE',date_from:'2026-09-01',pay_day:30});
  await tab(page,'Care Packages').click();
  await expect(page.locator('#modalBody')).toContainText('Zedland Integrated Care Partnership');
  await expect(page.getByRole('button',{name:'Add rate override',exact:true})).toBeDisabled();
  await page.getByRole('row').filter({hasText:'Zedland Integrated Care Partnership'}).dblclick();
  await expect(page.locator('#cr_client_search')).toHaveCount(0);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('row').filter({hasText:'Zedland Integrated Care Partnership'}).dblclick();
  await expect(page.locator('#cr_client_search')).toHaveValue('Zedland Integrated Care Partnership');
  await expect(page.locator('#cr_role')).toHaveValue('Community Nurse');
  await expect(page.locator('#cr_band')).toHaveValue('7');
  await expect(page.locator('#pay_day')).toHaveValue('30.00');
});

test('rate client change ignores slow previous results and clears hidden selection while typing',async({page},info)=>{
  await openRatePicker(page,'slow');
  await chooseRateClient(page,'Northshire Community Health',info);
  await expect.poll(async()=>(await result(page)).pickerReads.some((r:any)=>r.client==='70000000-0000-4000-8000-000000000001'&&!r.completed)).toBe(true);
  await chooseRateClient(page,'Zedland Integrated Care Partnership',info);
  await expect(page.locator('#cr_role option')).toHaveText(['Select role…','Community Nurse']);
  await expect.poll(async()=>(await result(page)).pickerReads.filter((r:any)=>r.client==='70000000-0000-4000-8000-000000000001').every((r:any)=>r.completed)).toBe(true);
  await expect(page.locator('#cr_role option')).toHaveText(['Select role…','Community Nurse']);
  await page.locator('#cr_role').selectOption('Community Nurse');
  await page.locator('#cr_client_search').fill('No match');
  await expect(page.locator('#cr_client_id')).toHaveValue('');
  await expect(page.locator('#cr_role')).toBeDisabled();
  await expect(page.locator('#cr_band')).toBeDisabled();
  await expect(page.getByRole('button',{name:'Apply',exact:true})).toBeDisabled();
  expect((await result(page)).writes).toEqual([]);
});

test('rate client page failure is visible and Retry loads the complete eligible list',async({page},info)=>{
  await openRatePicker(page,'retry');
  await page.locator('#cr_client_search').click();
  await expect(page.getByRole('listbox')).toContainText('Clients could not be loaded.');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(0);
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(3);
  await chooseRateClient(page,'Riverside Historic Care',info);
  await expect(page.locator('#cr_role option')).toHaveText(['Select role…']);
  await expect(page.getByRole('button',{name:'Apply',exact:true})).toBeDisabled();
  expect((await result(page)).writes).toEqual([]);
});

for (const state of ['zero', 'populated']) {
  test(`Candidate finance ${state} is readable and the report returns to the same tab`, async ({ page }, info) => {
    await page.goto('/?finance=' + state);
    await page.getByRole('button', { name: 'Existing candidate', exact: true }).click();
    await tab(page, 'Payment details').click();
    const finance = page.locator('.candidate-finance-section');
    await expect(finance.locator('h3')).toHaveText('Candidate finance');
    await expect(finance.locator('.candidate-finance-balance')).toHaveCount(5);
    await expect(finance.locator('.candidate-finance-indicator')).toHaveCount(4);
    const amounts = state === 'zero'
      ? ['£0.00', '£0.00', '£0.00', '£0.00', '£0.00']
      : ['£1250.50', '£45.00', '£9.99', '£1234567.89', '£30.00'];
    await expect(finance.locator('.candidate-finance-balance dd strong')).toHaveText(amounts);
    await expect(finance.locator('.candidate-finance-count')).toHaveText(
      state === 'zero' ? Array(5).fill('0 items') : ['3 items', '2 items', '1 item', '4 items', '5 items']);
    await expect(finance.locator('.candidate-finance-indicator dd')).toHaveText(
      state === 'zero' ? ['0', '0', '0', '0'] : ['2', '3', '4', '7']);
    await expect(finance).not.toContainText('Read-only summary');
    const geometry = await finance.locator('.candidate-finance-balance').evaluateAll(rows => rows.map(row => {
      const label=row.querySelector('dt')!.getBoundingClientRect();
      const amount=row.querySelector('dd')!.getBoundingClientRect();
      return {gap:amount.left-label.right,overflow:row.scrollWidth-row.clientWidth};
    }));
    for (const row of geometry) { expect(row.gap).toBeGreaterThanOrEqual(8); expect(row.overflow).toBeLessThanOrEqual(1); }
    expect(await page.locator('#candidateFinanceReportLaunchBtn').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await finance.scrollIntoViewIfNeeded();
    await screenshotAndFit(page, info, 'Candidate finance - ' + state);
    await page.locator('#candidateFinanceReportLaunchBtn').click();
    await expect(page.locator('#modalTitle')).toHaveText('Candidate Finance Report');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(tab(page, 'Payment details')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.candidate-finance-balance dd strong')).toHaveText(amounts);
    await tab(page, 'Main Details').click();
    await tab(page, 'Payment details').click();
    await expect(page.locator('.candidate-finance-balance dd strong')).toHaveText(amounts);
    expect((await result(page)).writes).toEqual([]);
  });
}

test('Candidate finance unavailable data never looks like a zero balance and Retry recovers', async ({ page }, info) => {
  await page.goto('/?finance=retry');
  await page.getByRole('button', { name: 'Existing candidate', exact: true }).click();
  await tab(page, 'Payment details').click();
  const finance = page.locator('.candidate-finance-section');
  await expect(finance.getByRole('alert')).toContainText('could not be loaded');
  await expect(finance.locator('.candidate-finance-balance')).toHaveCount(0);
  await finance.scrollIntoViewIfNeeded();
  await screenshotAndFit(page, info, 'Candidate finance - unavailable');
  await page.locator('#candidateFinanceReportRetryBtn').click();
  await expect(finance.locator('.candidate-finance-balance')).toHaveCount(5);
  await expect(finance.getByRole('alert')).toHaveCount(0);
  expect((await result(page)).writes).toEqual([]);
});

test('Candidate finance loading does not flash zero amounts', async ({ page }) => {
  await page.goto('/?finance=loading');
  await page.getByRole('button', { name: 'Existing candidate', exact: true }).click();
  await tab(page, 'Payment details').click();
  const finance = page.locator('.candidate-finance-section');
  await expect(finance.getByRole('status')).toContainText('Loading current candidate finance data');
  await expect(finance.locator('.candidate-finance-balance')).toHaveCount(0);
  await expect(finance.locator('.candidate-finance-balance')).toHaveCount(5);
});

test('all seven redesigned sections fit and read-only navigation remains available', async ({ page }, info) => {
  await open(page, 'Existing candidate');
  for (const name of ['Main Details', 'Work & compliance', 'Payment details']) {
    await tab(page, name).click();
    const heading = name === 'Main Details' ? 'Candidate profile' : name === 'Payment details' ? 'Payment details' : name;
    await expect(page.locator('#modalBody h2')).toHaveText(heading);
    await screenshotAndFit(page, info, `Candidate - ${name}`);
  }
  await open(page, 'Existing client');
  await screenshotAndFit(page, info, 'Client - Main');
  await tab(page, 'Client settings').click();
  for (const name of ['Timesheets', 'Shift times', 'Invoicing']) {
    await tab(page, name).click();
    await screenshotAndFit(page, info, `Client - ${name}`);
    if (name === 'Shift times') {
      const widths = await page.locator('#modal input[type="time"]').evaluateAll(inputs =>
        inputs.map(input => input.getBoundingClientRect().width));
      expect(widths).toHaveLength(10);
      for (const width of widths) expect(width).toBeGreaterThanOrEqual(125);
    }
  }
  expect((await result(page)).writes).toEqual([]);
});

test('delayed Umbrella details cannot use the previous Candidate tab layout', async ({ page }, info) => {
  await open(page, 'Existing umbrella candidate');
  for (const previous of ['Work & compliance', 'Main Details']) {
    await tab(page, previous).click();
    await tab(page, 'Payment details').click();
    await expect(field(page, 'bank_name')).toHaveValue('Fixture bank');
    await expect(page.locator('#modalBody h2')).toHaveText('Payment details');
    await expect(page.locator('#tab-pay .ctms-section-title')).toHaveText([
      'Payment destination', 'Remittance preferences', 'Candidate finance'
    ]);
    await expect(field(page, 'pay_method')).toHaveValue('UMBRELLA');
    await expect(field(page, 'bank_name')).toBeDisabled();
    await screenshotAndFit(page, info, `Umbrella payment from ${previous}`);
  }
  await tab(page, 'Work & compliance').click();
  await expect(page.locator('#modalBody h2')).toHaveText('Work & compliance');
  await expect(field(page, 'band')).toHaveValue('6');
  await tab(page, 'Main Details').click();
  await expect(page.locator('#modalBody h2')).toHaveText('Candidate profile');
  await expect(field(page, 'address_line1')).toHaveValue('14 Example Street');
  expect((await result(page)).writes).toEqual([]);
});

test('switching PAYE to Umbrella wires selection immediately and clears bank fields on return', async ({ page }) => {
  await open(page, 'Existing candidate');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Payment details').click();
  await field(page, 'pay_method').selectOption('UMBRELLA');
  await expect(field(page, 'bank_name')).toHaveValue('');
  await expect(page.locator('#umbList option[value="Example Umbrella"]')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Umbrella company', exact: true }).fill('Example Umbrella');
  await expect(field(page, 'bank_name')).toHaveValue('Fixture bank');
  await page.getByRole('combobox', { name: 'Umbrella company', exact: true }).press('Tab');
  await expect(field(page, 'bank_name')).toHaveValue('Fixture bank');
  await expect(field(page, 'sort_code')).toHaveValue('20-30-40');
  await expect(field(page, 'account_number')).toHaveValue('11223344');
  await expect(field(page, 'bank_name')).toBeDisabled();
  await tab(page, 'Work & compliance').click();
  await tab(page, 'Payment details').click();
  await expect(field(page, 'bank_name')).toHaveValue('Fixture bank');
  for (const name of ['account_holder', 'bank_name', 'sort_code', 'account_number']) {
    await expect(field(page, name)).toBeDisabled();
  }
  for (const name of ['remittance_receive_enabled', 'remittances_detailed_breakdown', 'remittance_receive_when_umbrella_paid']) {
    await expect(field(page, name)).toBeDisabled();
  }
  await field(page, 'remittance_overrides_enabled').check();
  await expect(field(page, 'remittance_receive_enabled')).toBeEnabled();
  await field(page, 'remittance_overrides_enabled').uncheck();
  await field(page, 'pay_method').selectOption('PAYE');
  for (const name of ['account_holder', 'bank_name', 'sort_code', 'account_number']) {
    await expect(field(page, name)).toHaveValue('');
    await expect(field(page, name)).toBeEnabled();
  }
  await expect(page.locator('#umbrella_id')).toHaveValue('');
  expect((await result(page)).writes).toEqual([]);
});

test('PAYE and Umbrella changes use confirmation, save the exact destination and reopen correctly', async ({ page }, info) => {
  await open(page, 'Existing candidate');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Payment details').click();
  await field(page, 'pay_method').selectOption('UMBRELLA');
  const company = page.getByRole('combobox', { name: 'Umbrella company', exact: true });
  await company.fill('Second Umbrella');
  await company.press('Tab');
  await expect(field(page, 'bank_name')).toHaveValue('Second fixture bank');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm change', exact: true })).toBeVisible();
  expect((await result(page)).writes).toEqual([]);
  await page.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('View Candidate');
  await tab(page, 'Payment details').click();
  await expect(field(page, 'pay_method')).toHaveValue('UMBRELLA');
  await expect(field(page, 'bank_name')).toHaveValue('Second fixture bank');
  await screenshotAndFit(page, info, 'Saved Umbrella destination');
  let data = await result(page);
  const firstChange = data.writes.find((w: any) => w.path.endsWith('/pay-method-change'));
  expect(firstChange.body.destination_patch).toEqual({ umbrella_id: '70000000-0000-4000-8000-000000000021' });
  expect(data.candidate.bank_name).toBeNull();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Existing candidate', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Payment details').click();
  await field(page, 'pay_method').selectOption('PAYE');
  for (const name of ['account_holder', 'bank_name', 'sort_code', 'account_number']) {
    await expect(field(page, name)).toHaveValue('');
    await expect(field(page, name)).toBeEnabled();
  }
  await field(page, 'account_holder').fill('Alex Morgan');
  await field(page, 'bank_name').fill('Personal fixture bank');
  await field(page, 'sort_code').fill('112233');
  await field(page, 'account_number').fill('22334455');
  await tab(page, 'Main Details').click();
  await tab(page, 'Payment details').click();
  await expect(field(page, 'bank_name')).toHaveValue('Personal fixture bank');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('View Candidate');
  await tab(page, 'Payment details').click();
  await expect(field(page, 'bank_name')).toHaveValue('Personal fixture bank');
  await expect(field(page, 'account_number')).toHaveValue('22334455');
  await expect(field(page, 'sort_code')).toHaveValue('11-22-33');
  await screenshotAndFit(page, info, 'Saved PAYE destination');
  data = await result(page);
  const changes = data.writes.filter((w: any) => w.path.endsWith('/pay-method-change'));
  expect(changes).toHaveLength(2);
  expect(changes[1].body.destination_patch).toEqual({
    account_holder: 'Alex Morgan', bank_name: 'Personal fixture bank',
    sort_code: '11-22-33', account_number: '22334455'
  });
  expect(data.candidate.umbrella_id).toBeNull();
  for (const write of data.writes.filter((w: any) => w.method === 'PATCH' && w.path.endsWith(data.candidate.id))) {
    for (const key of ['pay_method', 'umbrella_id', 'bank_name', 'account_holder', 'sort_code', 'account_number']) {
      expect(write.body).not.toHaveProperty(key);
    }
  }
});

test('discard restores the saved Umbrella destination and no bank changes are committed', async ({ page }) => {
  await open(page, 'Existing umbrella candidate');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Payment details').click();
  await expect(field(page, 'bank_name')).toHaveValue('Fixture bank');
  await field(page, 'pay_method').selectOption('PAYE');
  await field(page, 'bank_name').fill('Unsaved personal bank');
  await tab(page, 'Main Details').click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator('#modalTitle')).toContainText('Discard');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('View Candidate');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Existing candidate', exact: true }).click();
  await tab(page, 'Payment details').click();
  await expect(field(page, 'pay_method')).toHaveValue('UMBRELLA');
  await expect(field(page, 'bank_name')).toHaveValue('Fixture bank');
  expect((await result(page)).writes).toEqual([]);
});

test('blank PAYE bank details stay blank through tab changes, confirmation and reopen', async ({ page }) => {
  await open(page, 'Existing umbrella candidate');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Payment details').click();
  await expect(field(page, 'bank_name')).toHaveValue('Fixture bank');
  await field(page, 'pay_method').selectOption('PAYE');
  await tab(page, 'Work & compliance').click();
  await tab(page, 'Payment details').click();
  for (const key of ['account_holder', 'bank_name', 'sort_code', 'account_number']) {
    await expect(field(page, key)).toHaveValue('');
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('View Candidate');
  await tab(page, 'Payment details').click();
  const data = await result(page);
  for (const key of ['account_holder', 'bank_name', 'sort_code', 'account_number']) {
    await expect(field(page, key)).toHaveValue('');
    expect(data.candidate[key]).toBeNull();
  }
  expect(data.candidate.umbrella_id).toBeNull();
});

test('clearing an existing Umbrella selection cannot silently save the previous company', async ({ page }) => {
  await open(page, 'Existing umbrella candidate');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Payment details').click();
  await expect(field(page, 'bank_name')).toHaveValue('Fixture bank');
  await page.getByRole('combobox', { name: 'Umbrella company', exact: true }).fill('');
  await page.getByRole('combobox', { name: 'Umbrella company', exact: true }).press('Tab');
  await expect(field(page, 'bank_name')).toHaveValue('');
  await tab(page, 'Main Details').click();
  await field(page, 'notes').fill('A separate edit must not restore the cleared umbrella');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('Select an umbrella company');
  expect((await result(page)).writes).toEqual([]);
});

test('late Umbrella responses cannot overwrite PAYE or a newer company selection', async ({ page }) => {
  await page.goto('/?slow-umbrella');
  await page.getByRole('button', { name: 'Existing candidate', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Payment details').click();
  const company = page.getByRole('combobox', { name: 'Umbrella company', exact: true });
  await field(page, 'pay_method').selectOption('UMBRELLA');
  await company.fill('Example Umbrella');
  await company.press('Tab');
  await expect.poll(async () => (await result(page)).umbrellaReads.length).toBe(1);
  await field(page, 'pay_method').selectOption('PAYE');
  await field(page, 'bank_name').fill('Personal bank survives late reply');
  await expect.poll(async () => (await result(page)).umbrellaReads.every((r: any) => r.completed)).toBe(true);
  await expect(field(page, 'bank_name')).toHaveValue('Personal bank survives late reply');
  await expect(page.locator('#umbrella_id')).toHaveValue('');
  await tab(page, 'Main Details').click();
  await tab(page, 'Payment details').click();
  await expect(field(page, 'bank_name')).toHaveValue('Personal bank survives late reply');
  await field(page, 'pay_method').selectOption('UMBRELLA');
  await company.fill('Example Umbrella');
  await company.press('Tab');
  await expect.poll(async () => (await result(page)).umbrellaReads.length).toBe(2);
  await company.fill('Second Umbrella');
  await company.press('Tab');
  await expect(field(page, 'bank_name')).toHaveValue('Second fixture bank');
  await expect.poll(async () => (await result(page)).umbrellaReads.every((r: any) => r.completed)).toBe(true);
  await expect(field(page, 'bank_name')).toHaveValue('Second fixture bank');
  await expect(field(page, 'account_number')).toHaveValue('87654321');
  await expect(page.locator('#umbrella_id')).toHaveValue('70000000-0000-4000-8000-000000000021');
  expect((await result(page)).writes).toEqual([]);
});

test('an Umbrella destination still loads after leaving and returning while its read is pending', async ({ page }) => {
  await page.goto('/?slow-umbrella');
  await page.getByRole('button', { name: 'Existing candidate', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Payment details').click();
  await field(page, 'pay_method').selectOption('UMBRELLA');
  await expect(page.locator('#umbList option[value="Example Umbrella"]')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Umbrella company', exact: true }).fill('Example Umbrella');
  await expect.poll(async () => (await result(page)).umbrellaReads.length).toBeGreaterThan(0);
  await tab(page, 'Main Details').click();
  await tab(page, 'Payment details').click();
  await expect(field(page, 'bank_name')).toHaveValue('Fixture bank');
  await expect(field(page, 'account_number')).toHaveValue('11223344');
  expect((await result(page)).writes).toEqual([]);
});

test('a different Umbrella can be selected while the saved destination is still loading', async ({ page }) => {
  await page.goto('/?slow-umbrella');
  await page.getByRole('button', { name: 'Existing umbrella candidate', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Payment details').click();
  await expect(page.locator('#umbList option[value="Second Umbrella"]')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Umbrella company', exact: true }).fill('Second Umbrella');
  await expect(field(page, 'bank_name')).toHaveValue('Second fixture bank');
  await expect.poll(async () => (await result(page)).umbrellaReads.every((r: any) => r.completed)).toBe(true);
  await expect(field(page, 'account_number')).toHaveValue('87654321');
  expect((await result(page)).writes).toEqual([]);
});

test('new-client defaults, workflow relevance and explicit consolidation choice', async ({ page }) => {
  await open(page, 'New client');
  await field(page, 'name').fill('Example new client');
  await tab(page, 'Client settings').click();
  await expect(field(page, 'default_submission_mode')).toHaveValue('ELECTRONIC');
  await expect(field(page, 'candidate_paper_submission_enabled')).toBeChecked();
  await expect(field(page, 'ts_queries_email')).toHaveCount(0);
  await tab(page, 'Shift times').click();
  await expect(page.getByRole('switch', { name: 'Use custom shift times' })).toHaveAttribute('aria-checked', 'false');
  await expect(field(page, 'day_start')).toBeHidden();
  await tab(page, 'Invoicing').click();
  await expect(field(page, 'payment_terms_days')).toHaveValue('30');
  await expect(field(page, 'vat_chargeable')).toHaveValue('Yes');
  await expect(field(page, 'daily_calc_of_invoices')).toBeChecked();
  await expect(page.getByRole('radio', { name: 'None', exact: true })).toBeChecked();
  await tab(page, 'Timesheets').click();
  await page.getByRole('radio', { name: 'Dedicated NHSP Weekly', exact: true }).check();
  await expect(field(page, 'default_submission_mode')).toBeHidden();
  await expect(field(page, 'candidate_paper_submission_enabled')).toBeHidden();
  await tab(page, 'Invoicing').click();
  const all = page.getByRole('radio', { name: 'All weeks (for client)', exact: true });
  await expect(all).toBeChecked();
  await expect(all).toBeDisabled();
  await page.getByRole('switch', { name: 'Edit consolidation' }).click();
  await expect(all).toBeEnabled();
  await page.getByRole('radio', { name: 'By week (per client)', exact: true }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('View Client');
  const data = await result(page);
  expect(data.client.name).toBe('Example new client');
  const settingsWrite = data.writes.find((w: any) => w.body.client_settings)?.body.client_settings;
  expect(settingsWrite.is_nhsp).toBe(true);
  expect(settingsWrite.requires_hr).toBe(false);
  expect(settingsWrite).not.toHaveProperty('weekly_mode');
  expect(data.settings.invoice_consolidation_mode).toBe('BY_WEEK');
  expect(data.settings.daily_calc_of_invoices).toBe(true);
});

test('new Client saves its Printed QR choice with initial settings and retains it after reopening', async ({ page }) => {
  for (const enabled of [true, false]) {
    await open(page, 'New client');
    await field(page, 'name').fill('Initial settings round-trip');
    await tab(page, 'Client settings').click();
    await expect(field(page, 'candidate_paper_submission_enabled')).toBeChecked();
    if (!enabled) await field(page, 'candidate_paper_submission_enabled').uncheck();
    await tab(page, 'Shift times').click();
    await tab(page, 'Invoicing').click();
    await tab(page, 'Main').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#modalTitle')).toHaveText('View Client');
    const data = await result(page);
    const creates = data.writes.filter((w: any) => w.method === 'POST' && w.path === '/api/clients');
    expect(creates).toHaveLength(1);
    expect(creates[0].body.client_settings.candidate_paper_submission_enabled).toBe(enabled);
    expect(data.writes.filter((w: any) => w.method === 'PUT')).toEqual([]);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Existing client', exact: true }).click();
    await tab(page, 'Client settings').click();
    await expect(field(page, 'candidate_paper_submission_enabled')).toBeChecked({ checked: enabled });
  }
});

test('repeated Client Printed QR saves retain their own latest version without reopening', async ({ page }) => {
  await open(page, 'Existing client');
  for (const enabled of [true, false, true]) {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await tab(page, 'Client settings').click();
    await field(page, 'candidate_paper_submission_enabled').setChecked(enabled);
    await tab(page, 'Main').click();
    await tab(page, 'Client settings').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#modalTitle')).toHaveText('View Client');
    await expect(field(page, 'candidate_paper_submission_enabled')).toBeChecked({ checked: enabled });
    expect((await result(page)).settings.candidate_paper_submission_enabled).toBe(enabled);
  }
  const data = await result(page);
  expect(data.writes.filter((w: any) => w.method === 'PATCH')).toHaveLength(3);
});

test('a stale Client policy leaves the draft open and stops later writes with a branded warning', async ({ page }) => {
  await page.goto('/?conflict-test');
  await page.getByRole('button', { name: 'Existing client', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Client settings').click();
  await field(page, 'candidate_paper_submission_enabled').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('Client settings not saved');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('Edit Client');
  await expect(field(page, 'candidate_paper_submission_enabled')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  const data = await result(page);
  expect(data.settings.candidate_paper_submission_enabled).toBe(false);
  expect(data.writes).toHaveLength(1);
  expect(data.writes[0].method).toBe('PATCH');
});

test('existing billing, zero terms, custom shifts and roster drafts survive tab changes and save', async ({ page }) => {
  await open(page, 'Existing client');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await tab(page, 'Client settings').click();
  await field(page, 'ts_queries_email').fill('changed@example.invalid');
  await page.getByRole('radio', { name: /^Import-authoritative roster/ }).check();
  await expect(field(page, 'ts_queries_email')).toHaveCount(0);
  await page.getByRole('radio', { name: /^Roster validation timesheets/ }).check();
  await expect(field(page, 'ts_queries_email')).toHaveValue('changed@example.invalid');
  await tab(page, 'Shift times').click();
  const custom = page.getByRole('switch', { name: 'Use custom shift times' });
  await custom.click();
  await expect(field(page, 'day_start')).toBeHidden();
  await custom.click();
  await expect(field(page, 'day_start')).toHaveValue('07:00');
  await tab(page, 'Invoicing').click();
  await expect(field(page, 'payment_terms_days')).toHaveValue('0');
  await expect(field(page, 'daily_calc_of_invoices')).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'By week (per client)', exact: true })).toBeChecked();
  await field(page, 'invoice_address').fill('');
  await field(page, 'ap_phone').fill('');
  await field(page, 'primary_invoice_email').fill('invoices@example.invalid');
  await tab(page, 'Main').click();
  await tab(page, 'Client settings').click();
  await tab(page, 'Invoicing').click();
  await expect(field(page, 'invoice_address')).toHaveValue('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('View Client');
  const data = await result(page);
  expect(data.client.primary_invoice_email).toBe('invoices@example.invalid');
  expect(data.client.invoice_address).toBeNull();
  expect(data.client.ap_phone).toBeNull();
  expect(data.client.payment_terms_days).toBe(0);
  expect(data.client.ts_queries_email).toBe('changed@example.invalid');
  expect(data.settings.invoice_consolidation_mode).toBe('BY_WEEK');
  expect(data.settings.daily_calc_of_invoices).toBe(false);
  expect(data.settings.candidate_paper_submission_enabled).toBe(false);
  expect(data.settings.day_start).toBe('07:00');
});

test('a partial shift draft is preserved but cannot be saved', async ({ page }) => {
  await open(page, 'New client');
  await field(page, 'name').fill('Incomplete shift fixture');
  await tab(page, 'Client settings').click();
  await tab(page, 'Shift times').click();
  await page.getByRole('switch', { name: 'Use custom shift times' }).click();
  await field(page, 'day_start').fill('08:00');
  await tab(page, 'Main').click();
  await tab(page, 'Client settings').click();
  await tab(page, 'Shift times').click();
  await expect(field(page, 'day_start')).toHaveValue('08:00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('Complete the shift pattern');
  expect((await result(page)).writes).toEqual([]);
});

test('moved Candidate work and payment fields and intentional address clears survive Save', async ({ page }) => {
  await open(page, 'Existing candidate');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await field(page, 'address_line2').fill('');
  await tab(page, 'Work & compliance').click();
  await field(page, 'band').fill('7');
  await tab(page, 'Payment details').click();
  await field(page, 'bank_name').fill('Updated example bank');
  await tab(page, 'Main Details').click();
  await expect(field(page, 'address_line2')).toHaveValue('');
  await tab(page, 'Payment details').click();
  await expect(field(page, 'bank_name')).toHaveValue('Updated example bank');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('View Candidate');
  const data = await result(page);
  expect(data.candidate.address_line2).toBe('');
  expect(data.candidate.band).toBe(7);
  expect(data.candidate.bank_name).toBe('Updated example bank');
  expect(data.candidate.pay_method).toBe('PAYE');
});

test('new Candidate keeps the existing defaults and can save from Payment details', async ({ page }) => {
  await open(page, 'New candidate');
  await field(page, 'first_name').fill('Taylor');
  await field(page, 'last_name').fill('Example');
  await field(page, 'email').fill('taylor@example.invalid');
  await field(page, 'phone').fill('07700000000');
  await field(page, 'gender').selectOption('Female');
  await tab(page, 'Payment details').click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#modalTitle')).toHaveText('View Candidate');
  const write = (await result(page)).writes.find((w: any) => w.path === '/api/candidates');
  expect(write.method).toBe('POST');
  expect(write.body.first_name).toBe('Taylor');
  expect(write.body.pay_method).toBeNull(); // Existing API representation of Unknown.
  expect(write.body.opt_in_email).toBe(true);
  expect(write.body.remittance_overrides_enabled).toBe(false);
});

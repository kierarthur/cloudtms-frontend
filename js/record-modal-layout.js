(function (global) {
  'use strict';
  const billingNames = ['invoice_address', 'primary_invoice_email', 'ap_phone', 'vat_chargeable', 'payment_terms_days'];
  const timeNames = ['day_start','day_end','night_start','night_end','sat_start','sat_end','sun_start','sun_end','bh_start','bh_end'];
  const workSelectors = ['[name="band"]','[name="ni_number"]','[name="prof_reg_number"]','[name="key_norm"]','#cand-alias-empty','#tms_ref_display'];
  const newClientSettings = () => ({
    timezone_id: 'Europe/London', week_ending_weekday: 0, default_submission_mode: 'ELECTRONIC',
    weekly_mode: 'NONE', hr_weekly_behaviour: 'VERIFY', candidate_paper_submission_enabled: true,
    invoice_consolidation_mode: 'NONE', pay_reference_required: false, invoice_reference_required: false,
    reference_number_required_to_issue_invoice: false, daily_calc_of_invoices: true,
    self_bill_no_invoices_sent: false, group_nightsat_sunbh: false, auto_invoice_default: false,
    send_manual_invoices_to_different_email: false, ...Object.fromEntries(timeNames.map(k => [k, '']))
  });
  const specialConsolidation = s => !!s.self_bill_no_invoices_sent || s.weekly_mode === 'NHSP' ||
    (s.weekly_mode === 'HEALTHROSTER' && s.hr_weekly_behaviour === 'CREATE');
  const defaultConsolidation = (previous, next, isNew, customised) => {
    if (!isNew || customised || specialConsolidation(previous) === specialConsolidation(next)) return next;
    return { ...next, invoice_consolidation_mode: specialConsolidation(next) ? 'ANY_WEEK' : 'NONE' };
  };
  const parse = html => { const t = document.createElement('template'); t.innerHTML = html; return t; };
  const rowFor = (root, selector) => {
    let node = root.querySelector(selector);
    while (node && node.parentElement !== root) node = node.parentElement;
    return node;
  };
  function candidate(tab, raw, mainRaw) {
    if (!['main','work','pay'].includes(tab)) return raw;
    const t = parse(raw), form = t.content.querySelector('#tab-main, #tab-pay');
    if (!form) return raw;
    form.dataset.recordCandidateTab = tab;
    if (tab === 'pay') {
      const main = parse(mainRaw).content.querySelector('#tab-main');
      const method = main && rowFor(main, '[name="pay_method"]');
      if (method) form.prepend(method);
    } else {
      const work = new Set(workSelectors.map(s => rowFor(form, s)).filter(Boolean));
      const method = rowFor(form, '[name="pay_method"]');
      Array.from(form.children).forEach(node => {
        if (node === method || (tab === 'work' ? !work.has(node) : work.has(node))) node.remove();
      });
    }
    return t.innerHTML;
  }
  function clientMain(raw) {
    const t = parse(raw), form = t.content.querySelector('#tab-main');
    if (form) billingNames.forEach(name => rowFor(form, `[name="${name}"]`)?.remove());
    return t.innerHTML;
  }
  function captureBilling(ctx, root = document.getElementById('clientSettingsForm')) {
    if (!root || ctx?.entity !== 'clients') return;
    const frame = global.__getModalFrame?.();
    if (frame && !['edit','create'].includes(frame.mode)) return;
    const values = {};
    root.querySelectorAll('[data-client-billing]').forEach(el => {
      if (el.disabled || el.readOnly) return;
      values[el.name] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) :
        el.name === 'vat_chargeable' ? el.value === 'Yes' : el.value;
    });
    ctx.formState.main = { ...ctx.formState.main, ...values };
  }
  const card = (title, nodes) => {
    const section = document.createElement('section'); section.className = 'record-settings-card';
    const h = document.createElement('h3'); h.textContent = title; section.append(h);
    nodes.filter(Boolean).forEach(n => section.append(n)); return section;
  };
  const toggle = (label, checked, action) => {
    const wrap = document.createElement('div'); wrap.className = 'record-toggle-row';
    const text = document.createElement('span'); text.textContent = label;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'record-switch';
    button.setAttribute('role','switch'); button.setAttribute('aria-label',label);
    button.setAttribute('aria-checked',String(checked)); button.dataset.recordUi = action;
    wrap.append(text, button); return wrap;
  };
  function refreshClient(root, ctx) {
    if (!root?.classList.contains('record-client-settings')) return;
    const s = ctx.clientSettingsState || {}, ui = ctx.recordLayout || {};
    const mode = s.weekly_mode || 'NONE', authoritative = mode === 'NHSP' || (mode === 'HEALTHROSTER' && s.hr_weekly_behaviour === 'CREATE');
    const submission = root.querySelector('[name="default_submission_mode"]')?.parentElement;
    if (submission) submission.hidden = authoritative;
    const paper = root.querySelector('.ctms-policy-card--paper'); if (paper) paper.hidden = authoritative;
    const inv = root.querySelector('#csInvModePanel');
    if (inv) {
      const special = specialConsolidation(s);
      let control = inv.querySelector('.record-toggle-row');
      if (!control) { control = toggle('Edit consolidation', !!ui.consolidationEditable, 'consolidation'); inv.prepend(control); }
      control.hidden = !special;
      control.querySelector('button').setAttribute('aria-checked',String(!!ui.consolidationEditable));
      inv.querySelectorAll('input').forEach(el => {
        const locked = special && !ui.consolidationEditable;
        el.setAttribute('data-ctms-intentional-lock',locked ? '1' : '0');
        const frame = global.__getModalFrame?.();
        el.disabled = locked || (frame && !['edit','create'].includes(frame.mode));
      });
    }
    // These labels have one meaning regardless of the workflow that paints them.
    const labels = { pay_reference_required: 'Reference required to pay', invoice_reference_required: 'Reference required to invoice' };
    Object.entries(labels).forEach(([name,label]) => {
      const input = root.querySelector(`[name="${name}"]`), text = input?.nextElementSibling;
      if (text) text.textContent = label;
    });
  }
  function mountClient(root, ctx, rawMain, sync) {
    if (!root || root.dataset.recordMounted) return;
    root.dataset.recordMounted = '1'; root.dataset.ctmsEnhanced = '1'; root.classList.add('record-client-settings');
    root.closest('#tab-settings')?.classList.add('record-client-settings-host');
    ctx.recordLayout ||= {};
    const ui = ctx.recordLayout;
    const s = ctx.clientSettingsState || {};
    if (ui.customTimes == null) ui.customTimes = timeNames.some(k => !!s[k]);
    const timeRows = ['day_start','night_start','sat_start','sun_start','bh_start'].map(name => root.querySelector(`[name="${name}"]`)?.closest('.row'));
    const zoneRow = root.querySelector('[name="timezone_id"]')?.closest('.row');
    const submissionRow = root.querySelector('[name="week_ending_weekday"]')?.closest('.row');
    const weekly = root.querySelector('#csWeeklyPanel'), breaks = root.querySelector('#csBreakEntryPanel');
    const paper = root.querySelector('.ctms-policy-card--paper');
    paper?.querySelector('.ctms-policy-card__heading p')?.remove();
    paper?.querySelector('.ctms-policy-toggle-row .mini')?.remove();
    const inv = root.querySelector('#csInvModePanel'), flags = root.querySelector('#csFlagsPanel');
    const shiftBody = document.createElement('div'); shiftBody.className = 'record-shift-grid'; shiftBody.hidden = !ui.customTimes;
    timeRows.filter(Boolean).forEach(n => shiftBody.append(n));
    const shiftToggle = toggle('Use custom shift times', ui.customTimes, 'shifts');
    const billing = parse(rawMain).content.querySelector('#tab-main');
    const billingRows = billingNames.map(name => rowFor(billing, `[name="${name}"]`)).filter(Boolean);
    billingRows.forEach(row => row.querySelectorAll('input,select,textarea').forEach(el => {
      el.dataset.noCollect = 'true'; el.dataset.clientBilling = '1';
    }));
    const panels = [
      ['timesheets','Timesheets',[card('Timesheet workflow',[weekly]), card('Submission',[submissionRow, breaks, paper])]],
      ['shifts','Shift times',[card('Shift pattern',[zoneRow,shiftToggle,shiftBody])]],
      ['invoicing','Invoicing',[card('Billing details',billingRows),card('Invoice consolidation',[inv]),card('Invoice rules',[flags])]]
    ];
    const nav = document.createElement('div'); nav.className = 'record-settings-tabs'; nav.setAttribute('role','tablist'); nav.setAttribute('aria-label','Client settings sections');
    const fragment = document.createDocumentFragment(); fragment.append(nav);
    panels.forEach(([key,label,cards]) => {
      const button = document.createElement('button'); button.type='button'; button.textContent=label; button.setAttribute('role','tab');
      button.dataset.recordTab=key; button.id=`client-section-${key}`; button.setAttribute('aria-controls',`client-panel-${key}`); nav.append(button);
      const panel=document.createElement('div'); panel.className='record-settings-panel'; panel.dataset.recordPanel=key; panel.id=`client-panel-${key}`;
      panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby',button.id); cards.forEach(c=>panel.append(c)); fragment.append(panel);
    });
    root.replaceChildren(fragment);
    // Preserve the existing independently saved authoriser controller and node;
    // only place its asynchronously mounted summary in the relevant section.
    const placeAuthorisers = () => {
      const summary = root.querySelector(':scope > .ma-summary');
      if (summary) root.querySelector('[data-record-panel="timesheets"]').append(summary);
    };
    new MutationObserver(placeAuthorisers).observe(root, { childList:true });
    placeAuthorisers();
    const invoicing = root.querySelector('[data-record-panel="invoicing"]');
    const rulesColumn = document.createElement('div'); rulesColumn.className = 'record-invoice-rules';
    Array.from(invoicing.children).slice(1).forEach(section => rulesColumn.append(section));
    invoicing.append(rulesColumn);
    const selectTab = key => {
      ui.clientTab=key;
      root.querySelectorAll('[data-record-tab]').forEach(b=> { const active=b.dataset.recordTab===key; b.setAttribute('aria-selected',String(active)); b.tabIndex=active?0:-1; });
      root.querySelectorAll('[data-record-panel]').forEach(p=>p.hidden=p.dataset.recordPanel!==key);
    };
    selectTab(ui.clientTab || 'timesheets');
    nav.addEventListener('click', e=>{ const b=e.target.closest('[data-record-tab]'); if(b) selectTab(b.dataset.recordTab); });
    nav.addEventListener('keydown', e=>{
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
      const buttons=[...nav.querySelectorAll('button')], index=buttons.indexOf(document.activeElement);
      if(index<0) return; e.preventDefault();
      const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
      selectTab(buttons[next].dataset.recordTab); buttons[next].focus();
    });
    root.addEventListener('click', e=>{
      const b=e.target.closest('[data-record-ui]'); if(!b || b.disabled) return;
      const frame=global.__getModalFrame?.(); if(frame && !['edit','create'].includes(frame.mode)) return;
      if(b.dataset.recordUi==='consolidation') {
        ui.consolidationEditable=!ui.consolidationEditable; refreshClient(root,ctx); return;
      }
      if(b.dataset.recordUi==='shifts') {
        const inputs=timeNames.map(k=>root.querySelector(`[name="${k}"]`));
        if(ui.customTimes) { ui.shiftDraft=inputs.map(el=>el.value); inputs.forEach(el=>el.value=''); }
        else if(ui.shiftDraft) inputs.forEach((el,i)=>el.value=ui.shiftDraft[i]);
        ui.customTimes=!ui.customTimes; shiftBody.hidden=!ui.customTimes; b.setAttribute('aria-checked',String(ui.customTimes)); sync();
      }
    });
    root.addEventListener('input',()=>captureBilling(ctx,root));
    root.addEventListener('change',e=>{
      captureBilling(ctx,root);
      if(e.target.name==='invoice_consolidation_mode') ui.consolidationCustomised=true;
    });
    refreshClient(root,ctx);
  }
  const api={candidate,clientMain,captureBilling,mountClient,refreshClient,newClientSettings,defaultConsolidation,specialConsolidation,billingNames,timeNames};
  global.CloudTMSRecordLayout=api;
  if(typeof module==='object' && module.exports) module.exports=api;
})(typeof window==='undefined'?globalThis:window);

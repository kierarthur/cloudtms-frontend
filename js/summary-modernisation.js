/* CloudTMS summary-sheet modernisation — preserves existing record handlers. */
(function installSummaryModernisation(global){
  'use strict';

  const targetSections = new Set(['candidates','clients','contracts','timesheets','invoices','umbrellas','outbox']);
  const text = (node) => String(node && node.textContent || '').trim();

  function currentSectionKey(){
    try { return String(global.currentSection || currentSection || '').trim().toLowerCase(); } catch { return ''; }
  }

  function decorateTools(){
    const tools = document.getElementById('tools');
    if (!tools) return;
    const heading = tools.querySelector('h3');
    if (heading && heading.textContent !== 'Actions & filters') heading.textContent = 'Actions & filters';
    const buttons = Array.from(tools.querySelectorAll('#toolButtons button'));
    const key = currentSectionKey();
    const addLabels = {candidates:'Add candidate',clients:'Add client',contracts:'Add contract',timesheets:'Create manual daily timesheet',invoices:'Add invoice',umbrellas:'Add umbrella'};
    buttons.forEach((button) => {
      if (/^create new record$/i.test(text(button)) && addLabels[key]) button.textContent = addLabels[key];
      if (/^search(?:\.\.\.|…)$/i.test(text(button))) button.textContent = 'Advanced search';
      button.classList.toggle('ctms-primary-tool', /^(add |create manual daily timesheet)/i.test(text(button)));
    });
    if (key === 'timesheets') {
      const byLabel = (label) => buttons.find((button) => text(button).toLowerCase() === label.toLowerCase()) || null;
      const imports = byLabel('Timesheet Imports');
      const orderedActions = [
        byLabel('Bulk Process'),
        byLabel('Bulk Authorise'),
        byLabel('Create manual daily timesheet'),
        byLabel('Send Manager Reminders')
      ].filter(Boolean);
      let insertionPoint = imports;
      if (insertionPoint) {
        orderedActions.forEach((button) => {
          insertionPoint.insertAdjacentElement('afterend', button);
          insertionPoint = button;
        });
      }
    }
    const note = tools.querySelector('.note');
    if (note) (note.closest('.group') || note).remove();
  }

  function decorateSummary(){
    const key = currentSectionKey();
    const active = targetSections.has(key);
    document.body.classList.toggle('ctms-summary-proposal', active);
    document.documentElement.classList.toggle('ctms-summary-proposal', active);
    if (!active) {
      delete document.body.dataset.summaryProposalSection;
      return;
    }
    document.body.dataset.summaryProposalSection = key;

    const content = document.getElementById('content');
    if (content) {
      const children = Array.from(content.children);
      const summaryBody = content.querySelector(':scope > .summary-body');
      children.forEach((child) => {
        if (child === summaryBody) return;
        if (child.classList.contains('pager')) child.classList.add('ctms-summary-footer');
        else if (child.matches('div') && child.querySelector('select,input,button')) child.classList.add('ctms-summary-controls');
      });
      content.querySelectorAll(':scope > .ctms-summary-controls').forEach((bar) => {
        const pageSize = Array.from(bar.querySelectorAll('.mini')).find((node) => /^page size:$/i.test(text(node)));
        if (pageSize) pageSize.textContent = 'Rows per page';
        bar.querySelectorAll('select option').forEach((option) => {
          if (/^first \d+$/i.test(text(option))) option.textContent = text(option).replace(/^First\s+/i,'');
        });
        Array.from(bar.querySelectorAll('button')).forEach((button) => {
          if (/^columns$/i.test(text(button))) button.classList.add('ctms-duplicate-columns');
        });
        if (key === 'outbox') {
          bar.classList.add('ctms-outbox-controls');

          const pageSizeControl = bar.querySelector('#outboxPageSize');
          const pageSizeLabel = Array.from(bar.querySelectorAll(':scope > .mini')).find((node) => /^rows per page$/i.test(text(node)));
          if (pageSizeControl && pageSizeLabel && !pageSizeControl.closest('.ctms-outbox-field--page-size')) {
            const field = document.createElement('div');
            field.className = 'ctms-outbox-field ctms-outbox-field--page-size';
            bar.insertBefore(field, pageSizeLabel);
            field.appendChild(pageSizeLabel);
            field.appendChild(pageSizeControl);
          }

          const markField = (id, className) => {
            const control = bar.querySelector(`#${id}`);
            const field = control?.parentElement;
            if (field && field !== bar) field.classList.add('ctms-outbox-field', className);
          };
          markField('outboxSearchText', 'ctms-outbox-field--search');
          markField('outboxFilterChannel', 'ctms-outbox-field--channel');
          markField('outboxFilterStatus', 'ctms-outbox-field--status');
          markField('outboxFilterQueueState', 'ctms-outbox-field--queue');
          markField('outboxSortKey', 'ctms-outbox-field--sort');
          markField('outboxSortDir', 'ctms-outbox-field--direction');
          bar.querySelector('#outboxApplyFiltersBtn')?.classList.add('ctms-outbox-apply');
          bar.querySelector('#outboxSelectedCount')?.parentElement?.classList.add('ctms-outbox-selected');
          bar.querySelector('#outboxClearSelectionBtn')?.classList.add('ctms-outbox-clear-selection');
        }
      });
    }

    document.querySelectorAll('.summary-body .grid').forEach((table) => {
      const compactSummary = matchMedia(key === 'outbox' ? '(max-width:900px)' : '(max-width:620px)').matches;
      const headers = Array.from(table.querySelectorAll('thead th')).map((th) => text(th).replace(/[▲▼]$/,'').trim());
      table.querySelectorAll('tbody tr').forEach((row) => {
        if (!row.hasAttribute('tabindex')) row.tabIndex = 0;
        Array.from(row.children).forEach((cell, index) => {
          cell.dataset.label = index === 0 ? 'Select' : (headers[index] || 'Details');
          const value = text(cell);
          if (/^£?-?\d[\d,]*\.\d{2}$/.test(value)) cell.dataset.money = 'true';
          const state = value.toUpperCase();
          if (/^(YES|PAID|ISSUED|AUTHORISED FOR INVOICING|SENT|READY|ACTIVE)$/.test(state)) cell.dataset.state = 'success';
          else if (/^(DRAFT|UNPROCESSED|NEEDS ATTENTION|ON HOLD|PROCESSING)$/.test(state)) cell.dataset.state = 'warning';
          else if (/^(FAILED|BLOCKED|CANCELLED|DISABLED)$/.test(state)) cell.dataset.state = 'danger';
          if (cell.dataset.state && !cell.querySelector('span,button,input,a')) {
            const badge = document.createElement('span');
            badge.textContent = value;
            cell.textContent = '';
            cell.appendChild(badge);
          }
        });
        const canAddMobileOpen = key === 'outbox' ? row.hasAttribute('data-outbox-key') : true;
        if (compactSummary && canAddMobileOpen && !row.querySelector('.ctms-mobile-open-cell')) {
          const actionCell = document.createElement('td');
          actionCell.className = 'ctms-mobile-open-cell';
          actionCell.dataset.label = '';
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'ctms-mobile-open';
          button.textContent = 'Open';
          const recordLabel = text(Array.from(row.querySelectorAll('td')).find((cell,index) => index > 0 && text(cell))) || 'record';
          button.setAttribute('aria-label', `Open ${recordLabel}`);
          button.addEventListener('click',(event) => {
            event.preventDefault();
            event.stopPropagation();
            row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:global}));
          });
          actionCell.appendChild(button);
          row.appendChild(actionCell);
        }
      });
    });
    document.querySelectorAll('.summary-body').forEach(wireSummaryInteractions);
    decorateTools();
  }

  function wireSummaryInteractions(body){
    if (!body || body.dataset.ctmsInteractionWired === 'true') return;
    body.dataset.ctmsInteractionWired = 'true';
    const rows = () => Array.from(body.querySelectorAll('tbody tr'));
    const rowFor = (target) => target && typeof target.closest === 'function' ? target.closest('tbody tr') : null;
    const checkboxFor = (row) => row?.querySelector('.row-select,.outbox-row-select');
    const syncChecked = (row) => {
      if (!row) return;
      const checked = !!checkboxFor(row)?.checked;
      row.classList.toggle('ctms-row-checked',checked);
      row.setAttribute('aria-selected',String(checked || row.classList.contains('ctms-active-row')));
    };
    const activate = (row) => {
      if (!row) return;
      rows().forEach((item) => {
        const active = item === row;
        item.classList.toggle('ctms-active-row',active);
        item.setAttribute('aria-selected',String(active || item.classList.contains('ctms-row-checked')));
      });
    };
    rows().forEach(syncChecked);
    body.addEventListener('click',(event) => {
      const row = rowFor(event.target);
      if (!row) return;
      if (event.target.closest('input[type="checkbox"]')) {
        requestAnimationFrame(() => syncChecked(row));
        return;
      }
      if (event.target.closest('button,a,select,input,textarea,label')) return;
      activate(row);
    });
    body.addEventListener('change',(event) => {
      if (!event.target.matches('input[type="checkbox"]')) return;
      const row = rowFor(event.target);
      if (row) syncChecked(row);
      else requestAnimationFrame(() => rows().forEach(syncChecked));
    });
    body.addEventListener('pointerdown',(event) => {
      const row = rowFor(event.target);
      if (row && !event.target.closest('button,a,select,input,textarea,label')) row.classList.add('ctms-row-pressed');
    });
    const clearPressed = () => rows().forEach((row) => row.classList.remove('ctms-row-pressed'));
    body.addEventListener('pointerup',clearPressed);
    body.addEventListener('pointercancel',clearPressed);
    body.addEventListener('keydown',(event) => {
      const row = rowFor(event.target);
      if (!row) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        activate(row);
        row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:global}));
      }
    });
    const outboxClearSelection = body.dataset.summarySection === 'outbox'
      ? document.getElementById('outboxClearSelectionBtn')
      : null;
    if (outboxClearSelection && outboxClearSelection.dataset.ctmsVisualSyncWired !== 'true') {
      outboxClearSelection.dataset.ctmsVisualSyncWired = 'true';
      outboxClearSelection.addEventListener('click',() => {
        requestAnimationFrame(() => rows().forEach(syncChecked));
      });
    }
  }

  function simplifyImports(){
    const shell = document.querySelector('.irv1-shell');
    if (!shell) {
      const modal = document.getElementById('modal');
      if (modal?.classList.contains('ctms-imports-modern-modal')) modal.classList.remove('ctms-imports-modern-modal');
      return;
    }
    shell.closest('#modal')?.classList.add('ctms-modern-modal','ctms-imports-modern-modal');
    const intro = shell.querySelector('.irv1-intro');
    if (intro && intro.dataset.copySimplified !== 'true') {
      const heading = intro.querySelector('h3');
      const paragraph = intro.querySelector('p');
      if (heading) heading.textContent = 'Import timesheets';
      if (paragraph) paragraph.textContent = 'Choose the source, upload the file, then review anything that needs your attention. You can close this window and continue later.';
      intro.querySelector('.irv1-contract')?.remove();
      intro.dataset.copySimplified = 'true';
    }
    const copy = new Map([
      ['Import an NHSP weekly export and review the server-classified changes.','Upload an NHSP weekly export, then review any changes.'],
      ['Create or validate weekly records for the selected HealthRoster client.','Upload weekly HealthRoster records for the selected client.'],
      ['Compare daily HealthRoster evidence with existing daily timesheets.','Compare a daily HealthRoster export with existing timesheets.'],
      ['Saved reviews resume with their selections and review position. Completed and abandoned reviews reopen read-only.','Continue unfinished imports or view earlier reviews.']
    ]);
    shell.querySelectorAll('p,.mini').forEach((node) => {
      const replacement = copy.get(text(node));
      if (replacement) node.textContent = replacement;
    });
    shell.querySelectorAll('.irv1-drop').forEach((drop) => {
      const strong = drop.querySelector('strong');
      const hint = drop.querySelector('span');
      const isPhone = matchMedia('(max-width:620px)').matches;
      if (strong) strong.textContent = isPhone ? 'Choose file' : 'Drop the file here';
      if (hint) hint.textContent = isPhone ? 'XLS, XLSX or CSV' : 'or click to browse (.xls, .xlsx or .csv)';
      drop.classList.toggle('ctms-mobile-file-picker',isPhone);
    });
  }

  let scheduled = false;
  function apply(){
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorateSummary();
      simplifyImports();
    });
  }

  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  global.addEventListener('resize',apply,{passive:true});
  global.__applyCloudTmsSummaryModernisation = apply;
  apply();
})(window);

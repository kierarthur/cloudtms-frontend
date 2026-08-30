/* Banking Pay v2 candidate-table presentation. No network, selection mutation,
 * payment arithmetic, filtering, regrouping or client-side sorting lives here.
 * The parent controller supplies an already validated, atomically adopted page.
 */
(function (root) {
  'use strict';
  const copy = typeof module === 'object' && module.exports ? require('./banking-pay-modal-v2-copy.js') : root.CloudTMSBankingPayCopyV2;
  if (!copy?.message) throw new Error('Banking Pay approved copy is unavailable');
  const CONTRACT = 'BANKING_PAY_MODAL_STRUCTURE_V2';
  const DECIMAL = /^-?(?:0|[1-9]\d{0,15})\.\d{2}$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const TOKEN = /^[A-Za-z0-9_-]{1,4096}$/;
  const SORTS = Object.freeze(['CANDIDATE', 'DEDUCTIONS', 'READY_TO_PAY']);
  const NO_TIMESHEETS = copy.message('MSG-020');
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const amount = value => typeof value === 'string' && DECIMAL.test(value) && value !== '-0.00';
  function requireValue(value) { if (!value) throw new Error('BANKING_PAY_V2_INVALID_RESPONSE'); }
  function escape(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  }
  function formatAmount(value) {
    requireValue(amount(value));
    // String-only formatting preserves all authoritative decimal digits,
    // including values above Number.MAX_SAFE_INTEGER. Never round or sum.
    const negative = value.startsWith('-');
    const [whole, pennies] = (negative ? value.slice(1) : value).split('.');
    return `£${negative ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${pennies}`;
  }
  function validateRow(row) {
    requireValue(object(row) && UUID.test(row.candidate_id)
      && typeof row.candidate_name === 'string' && typeof row.candidate_reference === 'string'
      && typeof row.candidate_sort_name === 'string' && typeof row.candidate_sort_reference === 'string'
      && typeof row.child_revision === 'string' && row.child_revision.length > 0
      && typeof row.facts_digest === 'string' && /^[a-f0-9]{64}$/.test(row.facts_digest)
      && count(row.selectable_ready_count) && row.selectable_ready_count > 0
      && count(row.selected_ready_count) && row.selected_ready_count <= row.selectable_ready_count
      && amount(row.selected_display_amount) && typeof row.selected_deduction_exists === 'boolean'
      && count(row.selected_timesheet_count) && Array.isArray(row.selected_timesheet_ids));
    const selection = row.selected_ready_count === 0 ? 'NONE'
      : row.selected_ready_count === row.selectable_ready_count ? 'ALL' : 'SOME';
    requireValue(row.selection_state === selection);
    if (selection === 'NONE') requireValue(row.selected_display_amount === '0.00'
      && !row.selected_deduction_exists && row.selected_timesheet_count === 0);
    if (row.selected_timesheet_count <= 25) {
      requireValue(row.selected_timesheet_scope_token === null
        && row.selected_timesheet_ids.length === row.selected_timesheet_count
        && row.selected_timesheet_ids.every(id => typeof id === 'string' && UUID.test(id))
        && new Set(row.selected_timesheet_ids).size === row.selected_timesheet_ids.length);
    } else requireValue(row.selected_timesheet_ids.length === 0
      && typeof row.selected_timesheet_scope_token === 'string' && TOKEN.test(row.selected_timesheet_scope_token));
  }
  function sameCandidateContent(left, right) {
    if (left === null || right === null) return left === right;
    try { validateRow(left); validateRow(right); } catch { return false; }
    // These two opaque fields may renew under a CURRENT read. Every content
    // field, including the server digest of the complete Timesheet set, must
    // still match. This never authorises reusing an old Ready payment page.
    const metadata = ['child_revision', 'selected_timesheet_scope_token'];
    const keys = Object.keys(left).filter(key => !metadata.includes(key));
    return keys.length === Object.keys(right).filter(key => !metadata.includes(key)).length
      && keys.every(key => Object.hasOwn(right, key) && JSON.stringify(left[key]) === JSON.stringify(right[key]));
  }
  function validateDraftGate(value) {
    requireValue(object(value)
      && ['can_create_draft','session_ready','read_only','work_queued','display_ready','draft_safe'].every(key => typeof value[key] === 'boolean')
      && (value.draft_block_reason_code === null || typeof value.draft_block_reason_code === 'string' && value.draft_block_reason_code.length > 0)
      && count(value.session_selected_row_count) && count(value.session_selected_eligible_ready_row_count)
      && Array.isArray(value.blocker_codes) && value.blocker_codes.every(code => typeof code === 'string' && code.length > 0)
      && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 2048);
    requireValue(!value.draft_safe || value.display_ready && value.draft_block_reason_code === null);
    requireValue(value.draft_safe || value.draft_block_reason_code === null || value.blocker_codes.includes(value.draft_block_reason_code));
    requireValue(!value.can_create_draft || value.session_ready && value.display_ready && value.draft_safe
      && !value.read_only && !value.work_queued && value.blocker_codes.length === 0
      && value.session_selected_row_count > 0 && value.session_selected_eligible_ready_row_count > 0);
    return value;
  }
  function validateSummary(page) {
    requireValue(object(page) && page.ok === true && page.contract === CONTRACT && page.contract_version === 1
      && UUID.test(page.session_id) && count(page.session_version) && count(page.progress_counter_version)
      && typeof page.scope_hash === 'string' && /^[a-f0-9]{64}$/.test(page.scope_hash)
      && typeof page.view_digest === 'string' && /^[a-f0-9]{64}$/.test(page.view_digest)
      && SORTS.includes(page.sort_key) && ['ASC', 'DESC'].includes(page.sort_direction)
      && Array.isArray(page.rows) && page.rows.length <= 100 && count(page.total_count)
      && typeof page.has_more === 'boolean'
      && (page.has_more ? typeof page.next_cursor === 'string' && TOKEN.test(page.next_cursor) : page.next_cursor === null));
    page.rows.forEach(validateRow);
    requireValue(new Set(page.rows.map(row => row.candidate_id)).size === page.rows.length);
    const global = page.global;
    requireValue(object(global) && amount(global.selected_ready_display_amount)
      && ['candidate_count','selected_candidate_count','selected_ready_count','selectable_ready_count',
        'action_required_count','updating_count','blocked_count'].every(key => count(global[key]))
      && global.candidate_count === page.total_count && global.candidate_count >= page.rows.length
      && global.selected_ready_count <= global.selectable_ready_count
      && global.selected_candidate_count <= global.candidate_count
      && global.selected_candidate_count <= global.selected_ready_count
      && global.candidate_count <= global.selectable_ready_count);
    validateDraftGate(global.draft);
    requireValue((page.rows.length > 0 || page.total_count === 0) && (!page.has_more || page.rows.length > 0));
    requireValue(count(page.page_number) && typeof page.has_previous === 'boolean'
      && page.has_previous === (page.page_number > 1)
      && (page.has_more ? typeof page.next_page_anchor === 'string' && TOKEN.test(page.next_page_anchor) : page.next_page_anchor === null)
      && (page.has_previous ? typeof page.previous_page_anchor === 'string' && TOKEN.test(page.previous_page_anchor) : page.previous_page_anchor === null)
      && (page.page_number > 2 ? typeof page.previous_cursor === 'string' && TOKEN.test(page.previous_cursor) : page.previous_cursor === null)
      && (page.rows.length === 0 ? page.page_number === 0 && page.page_anchor === null
        : page.page_number > 0 && page.page_number <= Math.ceil(page.total_count / 100)
          && typeof page.page_anchor === 'string' && TOKEN.test(page.page_anchor)));
    requireValue(page.total_count === 0
      ? page.rows.length === 0 && !page.has_more
      : page.rows.length === Math.min(100, page.total_count - (page.page_number - 1) * 100)
        && page.has_more === (page.page_number * 100 < page.total_count));
    requireValue(global.selection_state === (global.selected_ready_count === 0 ? 'NONE'
      : global.selected_ready_count === global.selectable_ready_count ? 'ALL' : 'SOME'));
    if (global.selected_ready_count === 0) requireValue(global.selected_candidate_count === 0
      && global.selected_ready_display_amount === '0.00' && !global.draft.can_create_draft);
    else requireValue(global.selected_candidate_count > 0);
    page.rows.forEach(row => requireValue(row.selected_ready_count <= global.selected_ready_count
      && row.selectable_ready_count <= global.selectable_ready_count
      && (global.selection_state !== 'NONE' || row.selection_state === 'NONE')
      && (global.selection_state !== 'ALL' || row.selection_state === 'ALL')));
    return page;
  }
  function candidateRowMarkup(row) {
    validateRow(row);
    const selected = row.selection_state;
    const aria = selected === 'SOME' ? 'mixed' : selected === 'ALL' ? 'true' : 'false';
    return `<tr data-banking-pay-v2-candidate-row="${escape(row.candidate_id)}">
      <td class="bpv2-include"><input type="checkbox" data-bpv2-control="candidate" aria-label="Include ${escape(row.candidate_name)}" aria-checked="${aria}"${selected === 'ALL' ? ' checked' : ''}></td>
      <td class="bpv2-candidate"><span data-bpv2-name>${escape(row.candidate_name)}</span><span class="bpv2-reference" data-bpv2-reference>${escape(row.candidate_reference)}</span></td>
      <td class="bpv2-deductions" data-bpv2-deductions>${row.selected_deduction_exists?copy.message('MSG-018'):'—'}</td>
      <td class="bpv2-payment"><span data-bpv2-amount>${formatAmount(row.selected_display_amount)}</span><button type="button" class="bpv2-timesheet-icon banking-timesheet-shortcut" data-bpv2-control="timesheets" aria-label="Open selected Timesheets for ${escape(row.candidate_name)}" title="${escape(row.selected_timesheet_count ? 'Open selected Timesheets' : NO_TIMESHEETS)}"${row.selected_timesheet_count ? '' : ' disabled'}><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M7 3v3M17 3v3M4.5 8.5h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm2 7h3m2 0h3m-8 4h3m2 0h3"/></svg></button></td>
    </tr>`;
  }
  const TABLE = `<section class="banking-pay-v2-table" aria-label="Ready to pay">
    <div class="bpv2-summary"><strong data-bpv2-headline></strong><span data-bpv2-included></span></div>
    <div class="bpv2-scroll" data-bpv2-scroll>
      <table class="grid"><colgroup><col class="bpv2-include-col"><col><col class="bpv2-deductions-col"><col class="bpv2-payment-col"></colgroup>
        <thead><tr>
          <th scope="col"><label class="bpv2-global"><input type="checkbox" data-bpv2-control="global">Include</label></th>
          <th scope="col" data-bpv2-sort-header="CANDIDATE"><button type="button" data-bpv2-sort="CANDIDATE">Candidate</button></th>
          <th scope="col" data-bpv2-sort-header="DEDUCTIONS"><button type="button" data-bpv2-sort="DEDUCTIONS">Deductions</button></th>
          <th scope="col" data-bpv2-sort-header="READY_TO_PAY"><button type="button" data-bpv2-sort="READY_TO_PAY">Ready to pay</button></th>
        </tr></thead><tbody></tbody>
      </table>
    </div>
    <p data-bpv2-empty hidden></p>
    <div class="bpv2-pagination"><button type="button" class="btn btn-xs btn-outline" data-bpv2-page="previous">Previous</button><span data-bpv2-page-label></span><button type="button" class="btn btn-xs btn-outline" data-bpv2-page="next">Next</button></div>
  </section>`;

  function createCandidateTable({ document, onCandidateIntent, onGlobalIntent, onTimesheets, onOpenCandidate, onSort, onPage, onError }) {
    for (const callback of [onCandidateIntent, onGlobalIntent, onTimesheets, onOpenCandidate, onSort, onPage, onError]) {
      if (typeof callback !== 'function') throw new TypeError('Banking Pay table requires every controller callback');
    }
    if (!document?.createElement) throw new TypeError('Banking Pay table requires a document');
    const template = document.createElement('template');
    template.innerHTML = TABLE;
    const element = template.content.firstElementChild;
    const tbody = element.querySelector('tbody');
    const globalInput = element.querySelector('[data-bpv2-control="global"]');
    const scroll = element.querySelector('[data-bpv2-scroll]');
    const nodes = new Map();
    let accepted = null;
    let busy = true;
    let destroyed = false;
    let previousAvailable = false;
    let publicationEpoch = 0;

    function context() {
      return { session_id:accepted.session_id, expected_session_version:accepted.session_version,
        expected_progress_counter_version:accepted.progress_counter_version, scope_hash:accepted.scope_hash };
    }
    function checkbox(input, selection, disabled) {
      input.checked = selection === 'ALL';
      input.indeterminate = selection === 'SOME';
      input.setAttribute('aria-checked', selection === 'SOME' ? 'mixed' : selection === 'ALL' ? 'true' : 'false');
      input.disabled = disabled;
    }
    function applyBusy() {
      element.setAttribute('aria-busy', String(busy));
      globalInput.disabled = busy || !accepted || accepted.global.selectable_ready_count === 0;
      element.querySelectorAll('[data-bpv2-sort]').forEach(button => { button.disabled = busy || !accepted; });
      element.querySelector('[data-bpv2-page="previous"]').disabled = busy || !previousAvailable;
      element.querySelector('[data-bpv2-page="next"]').disabled = busy || !accepted?.has_more;
      for (const node of nodes.values()) {
        node.querySelector('[data-bpv2-control="candidate"]').disabled = busy;
        const row = accepted.rows.find(row => row.candidate_id === node.dataset.bankingPayV2CandidateRow);
        node.querySelector('[data-bpv2-control="timesheets"]').disabled = busy || row.selected_timesheet_count === 0;
      }
    }
    function prepare(page, { unsettled = false, filtered = false } = {}) {
      if (destroyed) throw new Error('BANKING_PAY_V2_CLOSED');
      validateSummary(page); // Complete validation before any visible adoption.
      if (accepted) requireValue(page.session_id === accepted.session_id && page.session_version >= accepted.session_version
        && (page.session_version !== accepted.session_version || page.progress_counter_version >= accepted.progress_counter_version));
      // Keep only this bounded page, not the whole Workbench or hidden child pages.
      const next = Object.freeze({ ...page, global:Object.freeze({ ...page.global, draft:Object.freeze({ ...page.global.draft,
        blocker_codes:Object.freeze([...page.global.draft.blocker_codes]) }) }), rows:Object.freeze(page.rows.map(row => Object.freeze({ ...row,
        selected_timesheet_ids:Object.freeze([...row.selected_timesheet_ids]) }))) });
      const expectedEpoch = publicationEpoch;
      let used = false;
      // Stage new nodes and every formatted value off-screen. Existing rows
      // retain their DOM identity and receive no changes until the commit.
      const updates = next.rows.map(row => {
        let node = nodes.get(row.candidate_id);
        if (!node) {
          const rowTemplate = document.createElement('template');
          rowTemplate.innerHTML = candidateRowMarkup(row);
          node = rowTemplate.content.firstElementChild;
        }
        return { row, node, amount:formatAmount(row.selected_display_amount),
          deduction:row.selected_deduction_exists?copy.message('MSG-018'):'—' };
      });
      const headline = `${copy.message('MSG-006')} ${formatAmount(next.global.selected_ready_display_amount)}`;
      const included = copy.message('MSG-008',{number:next.global.selected_candidate_count});
      const globalLabel = copy.message(next.global.selection_state === 'ALL' ? 'MSG-011' : 'MSG-010');
      const emptyText = copy.message(filtered ? 'MSG-014' : 'MSG-012');
      return () => {
      if (destroyed) throw new Error('BANKING_PAY_V2_CLOSED');
      if (used || publicationEpoch !== expectedEpoch) throw new Error('BANKING_PAY_V2_STALE_ADOPTION');
      used = true;
      publicationEpoch++;
      accepted = next;
      busy = unsettled;
      previousAvailable = next.has_previous;
      const currentIds = new Set(accepted.rows.map(row => row.candidate_id));
      for (const [id, node] of nodes) if (!currentIds.has(id)) { node.remove(); nodes.delete(id); }
      let position = tbody.firstElementChild;
      for (const {row,node,amount,deduction} of updates) {
        nodes.set(row.candidate_id, node);
        if (node !== position) tbody.insertBefore(node, position);
        position = node.nextElementSibling;
        const input = node.querySelector('[data-bpv2-control="candidate"]');
        input.setAttribute('aria-label', `Include ${row.candidate_name}`);
        checkbox(input, row.selection_state, busy);
        node.querySelector('[data-bpv2-name]').textContent = row.candidate_name;
        node.querySelector('[data-bpv2-reference]').textContent = row.candidate_reference;
        node.querySelector('.bpv2-candidate').title = `${row.candidate_name}${row.candidate_reference ? ` · ${row.candidate_reference}` : ''}`;
        node.querySelector('[data-bpv2-deductions]').textContent = deduction;
        node.querySelector('[data-bpv2-amount]').textContent = amount;
        const timesheets = node.querySelector('[data-bpv2-control="timesheets"]');
        timesheets.title = row.selected_timesheet_count ? 'Open selected Timesheets' : NO_TIMESHEETS;
        timesheets.setAttribute('aria-label', `Open selected Timesheets for ${row.candidate_name}`);
      }
      checkbox(globalInput, accepted.global.selection_state, busy);
      globalInput.setAttribute('aria-label', globalLabel);
      element.querySelector('[data-bpv2-headline]').textContent = headline;
      element.querySelector('[data-bpv2-included]').textContent = included;
      element.querySelectorAll('[data-bpv2-sort-header]').forEach(header => {
        const active = header.dataset.bpv2SortHeader === accepted.sort_key;
        header.setAttribute('aria-sort', active ? accepted.sort_direction === 'ASC' ? 'ascending' : 'descending' : 'none');
      });
      element.querySelector('[data-bpv2-page-label]').textContent = `Page ${accepted.page_number || 1} · ${accepted.total_count} candidates`;
      const empty = element.querySelector('[data-bpv2-empty]');
      empty.hidden = accepted.rows.length !== 0;
      empty.textContent = emptyText;
      applyBusy();
      };
    }
    function publish(page, options) { return prepare(page, options)(); }
    function dispatch(callback, value) {
      try { Promise.resolve(callback(value)).catch(error => { if (!destroyed) onError(error); }); }
      catch (error) { if (!destroyed) onError(error); }
    }
    function interactive(target) { return target?.closest?.('button,input,label,a,select,textarea,[contenteditable="true"]'); }
    function stopInteractive(event) { if (interactive(event.target)) event.stopPropagation(); }
    function click(event) {
      const target = event.target?.closest?.('button,input');
      if (!target || !element.contains(target)) return;
      event.stopPropagation();
      if (busy || !accepted || target.disabled || event.detail > 1) return;
      const id = target.closest('[data-banking-pay-v2-candidate-row]')?.dataset.bankingPayV2CandidateRow;
      const row = id && accepted.rows.find(row => row.candidate_id === id);
      if (target.dataset.bpv2Control === 'candidate' && row) {
        // Native clicks toggle immediately; restore the last accepted tick.
        // Only a new accepted server envelope may change the displayed state.
        checkbox(target, row.selection_state, false);
        busy = true; applyBusy();
        dispatch(onCandidateIntent, { ...context(), candidate_id:id,
          action:row.selection_state === 'ALL' ? 'CLEAR_ALL_READY' : 'SELECT_ALL_READY' });
      } else if (target.dataset.bpv2Control === 'global') {
        checkbox(target, accepted.global.selection_state, false);
        busy = true; applyBusy();
        dispatch(onGlobalIntent, { ...context(), action:accepted.global.selection_state === 'ALL' ? 'CLEAR_ALL_READY' : 'SELECT_ALL_READY' });
      } else if (target.dataset.bpv2Control === 'timesheets' && row && row.selected_timesheet_count > 0) {
        dispatch(onTimesheets, { ...context(), candidate_id:id, count:row.selected_timesheet_count,
          timesheet_ids:row.selected_timesheet_ids, scope_token:row.selected_timesheet_scope_token });
      } else if (target.dataset.bpv2Sort) {
        dispatch(onSort, { sort_key:target.dataset.bpv2Sort,
          sort_direction:accepted.sort_key === target.dataset.bpv2Sort && accepted.sort_direction === 'ASC' ? 'DESC' : 'ASC' });
      } else if (target.dataset.bpv2Page) dispatch(onPage, { direction:target.dataset.bpv2Page });
    }
    function doubleClick(event) {
      if (interactive(event.target)) { event.stopPropagation(); return; }
      if (busy || !accepted) return;
      const id = event.target.closest?.('[data-banking-pay-v2-candidate-row]')?.dataset.bankingPayV2CandidateRow;
      if (id && nodes.has(id)) { event.stopPropagation(); dispatch(onOpenCandidate, { ...context(), candidate_id:id }); }
    }
    element.addEventListener('click', click);
    element.addEventListener('pointerdown', stopInteractive);
    element.addEventListener('dblclick', doubleClick);
    applyBusy();
    return Object.freeze({ element, publish, prepare,
      setBusy(value) { if (!destroyed) { busy = Boolean(value); applyBusy(); } },
      capturePosition() {
        const focused = element.contains(document.activeElement) ? document.activeElement : null;
        return { top:scroll.scrollTop, left:scroll.scrollLeft,
          candidate_id:focused?.closest('[data-banking-pay-v2-candidate-row]')?.dataset.bankingPayV2CandidateRow || null,
          control:focused?.dataset.bpv2Control || null };
      },
      restorePosition(position) {
        if (destroyed || !position) return;
        scroll.scrollTop = position.top; scroll.scrollLeft = position.left;
        const node = nodes.get(position.candidate_id);
        if (node && ['candidate','timesheets'].includes(position.control)) node.querySelector(`[data-bpv2-control="${position.control}"]`).focus({ preventScroll:true });
      },
      destroy() {
        destroyed = true; accepted = null; nodes.clear();
        element.removeEventListener('click', click);
        element.removeEventListener('pointerdown', stopInteractive);
        element.removeEventListener('dblclick', doubleClick);
        element.remove();
      }
    });
  }
  const api = Object.freeze({ CONTRACT, SORTS, NO_TIMESHEETS, formatAmount, validateDraftGate, validateSummary, validateRow, sameCandidateContent, candidateRowMarkup, createCandidateTable });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CloudTMSBankingPayTableV2 = api;
})(typeof window === 'object' ? window : this);

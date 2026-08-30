(() => {
  'use strict';

  const ROOT_ID = 'candidateManagerReminderWorkspace';
  const MODAL_KIND = 'candidate-manager-reminder-workspace';
  const PAGE_SIZE = 25;
  const RECOVERY_STORAGE_KEY = 'cloudtms.candidateOffice.managerReminderRecovery.v1';
  const RECOVERY_PHASE = Object.freeze({
    EXECUTING: 'EXECUTING',
    STATUS_PROBE: 'STATUS_PROBE',
    EXACT_RETRY_IN_PROGRESS: 'EXACT_RETRY_IN_PROGRESS',
    UNCERTAIN_STATUS_ONLY: 'UNCERTAIN_STATUS_ONLY'
  });
  let unresolvedBatch = null;
  const enc = value => String(value == null ? '' : value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const formatDateTime = value => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Not available';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const currentFrame = () => window.__getModalFrame?.() || null;
  const closeWorkspace = () => document.getElementById('btnCloseModal')?.click();
  const capabilityAllowsWorkspace = () => {
    const capabilities = window.CloudTMSCandidateOfficeBridge?.capabilities;
    return capabilities?.authority_applies === true
      && capabilities?.surfaces?.timesheet_summary === true
      && capabilities?.permissions?.send_manager_reminder_batch === true;
  };
  const currentOfficeUserId = () => String(
    window.__USER_ID || window.__auth?.user?.id || window.SESSION?.user?.id || ''
  ).trim().toLowerCase();
  const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  const freezeBatch = batch => Object.freeze({
    selection: Object.freeze({
      mode: String(batch?.selection?.mode || ''),
      included_row_keys: Object.freeze([...(batch?.selection?.included_row_keys || [])]),
      excluded_row_keys: Object.freeze([...(batch?.selection?.excluded_row_keys || [])])
    }),
    catalogueRevision: String(batch?.catalogueRevision || ''),
    preview: Object.freeze({
      ...batch.preview,
      selected_rows: Object.freeze([...(batch?.preview?.selected_rows || [])].map(row => Object.freeze({ ...row })))
    }),
    batchId: String(batch.batchId || ''),
    idempotencyKey: String(batch.idempotencyKey || ''),
    ownerUserId: String(batch.ownerUserId || currentOfficeUserId()),
    phase: String(batch.phase || RECOVERY_PHASE.EXECUTING),
    exactRetryConsumed: batch.exactRetryConsumed === true
  });
  const validStoredBatch = batch => {
    const owner = currentOfficeUserId();
    return !!owner
      && String(batch?.ownerUserId || '').toLowerCase() === owner
      && isUuid(batch?.batchId)
      && batch.batchId === batch.idempotencyKey
      && ['EXPLICIT', 'ALL_ELIGIBLE'].includes(String(batch?.selection?.mode || ''))
      && Array.isArray(batch?.preview?.selected_rows)
      && Number(batch?.preview?.selected_count || 0) > 0;
  };
  function persistUnresolvedBatch(batch) {
    unresolvedBatch = batch || null;
    try {
      if (batch) window.sessionStorage?.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(batch));
      else window.sessionStorage?.removeItem(RECOVERY_STORAGE_KEY);
    } catch {}
  }
  function restoredUnresolvedBatch() {
    if (validStoredBatch(unresolvedBatch)) return unresolvedBatch;
    try {
      const parsed = JSON.parse(window.sessionStorage?.getItem(RECOVERY_STORAGE_KEY) || 'null');
      if (validStoredBatch(parsed)) {
        unresolvedBatch = freezeBatch(parsed);
        return unresolvedBatch;
      }
    } catch {}
    persistUnresolvedBatch(null);
    return null;
  }
  function setActiveBatch(state, batch) {
    const frozen = freezeBatch(batch);
    state.activeBatch = frozen;
    persistUnresolvedBatch(frozen);
    syncModalDismissalLock(state);
    return frozen;
  }
  function clearActiveBatch(state) {
    state.activeBatch = null;
    persistUnresolvedBatch(null);
    syncModalDismissalLock(state);
  }
  function syncModalDismissalLock(state) {
    if (!isLive(state)) return;
    const close = document.getElementById('btnCloseModal');
    if (!close) return;
    const locked = !!state.activeBatch && !state.result;
    close.disabled = locked;
    close.hidden = locked;
    close.setAttribute('aria-disabled', locked ? 'true' : 'false');
    close.title = locked
      ? 'CloudTMS is retaining this reminder batch until its durable result is known.'
      : '';
  }

  function createState() {
    return {
      page: 1,
      pageSize: PAGE_SIZE,
      pageCount: 0,
      totalItems: 0,
      catalogueTotalItems: 0,
      catalogueRevision: null,
      items: [],
      matchingSelectionKeys: [],
      searchQuery: '',
      sortBy: 'CANDIDATE_SURNAME',
      sortDirection: 'ASC',
      selectionMode: 'EXPLICIT',
      included: new Set(),
      excluded: new Set(),
      loading: true,
      sending: false,
      error: null,
      result: null,
      activeBatch: null,
      controller: null,
      searchTimer: null
    };
  }

  const isLive = state => currentFrame()?.kind === MODAL_KIND
    && document.getElementById(ROOT_ID)?.dataset.workspaceInstance === state.instance;
  const isSelected = (state, key) => state.selectionMode === 'ALL_ELIGIBLE'
    ? !state.excluded.has(key)
    : state.included.has(key);
  const selectedCount = state => state.selectionMode === 'ALL_ELIGIBLE'
    ? Math.max(0, state.catalogueTotalItems - state.excluded.size)
    : state.included.size;
  const matchingSelectedCount = state => state.matchingSelectionKeys
    .reduce((count, key) => count + (isSelected(state, key) ? 1 : 0), 0);
  const selectionBody = state => state.selectionMode === 'ALL_ELIGIBLE'
    ? { mode: 'ALL_ELIGIBLE', included_row_keys: [], excluded_row_keys: [...state.excluded].sort() }
    : { mode: 'EXPLICIT', included_row_keys: [...state.included].sort(), excluded_row_keys: [] };

  function renderResult(state) {
    const result = state.result;
    const tone = result.status === 'COMPLETED' ? 'ok' : (result.status === 'PARTIAL' ? 'warn' : 'fail');
    const title = result.status === 'COMPLETED'
      ? 'Manager reminders sent'
      : (result.status === 'PARTIAL' ? 'Some reminders could not be sent' : 'Manager reminders were not sent');
    return `
      <section class="candidate-reminder-result candidate-reminder-result--${tone}" aria-live="polite">
        <h3>${enc(title)}</h3>
        <div class="candidate-reminder-result__counts">
          <span><strong>${Number(result.success_count || 0)}</strong> sent</span>
          <span><strong>${Number(result.skipped_count || 0)}</strong> no longer eligible</span>
          <span><strong>${Number(result.failure_count || 0)}</strong> failed</span>
        </div>
        <p>Eligibility was checked again by CloudTMS immediately before sending.</p>
      </section>
      <div class="candidate-reminder-workspace__actions">
        <button type="button" class="btn" data-reminder-close>Close</button>
      </div>`;
  }

  function renderRecovery(state) {
    const checking = state.sending === true;
    return `
      <section class="candidate-reminder-result candidate-reminder-result--warn" data-reminder-recovery-only aria-live="polite">
        <h3>Reminder result pending</h3>
        <p>CloudTMS is retaining the exact original reminder batch while it checks the durable result. No new reminder batch can be started from this workspace.</p>
        <div class="candidate-reminder-result__counts">
          <span><strong>${Number(state.activeBatch?.preview?.selected_count || 0)}</strong> selected</span>
          <span><strong>1</strong> retained batch</span>
          <span><strong>Protected</strong> recovery state</span>
        </div>
        ${state.error ? `<p role="alert">${enc(state.error.message)}</p>` : '<p>CloudTMS is checking this batch without changing its identity or selection.</p>'}
      </section>
      <div class="candidate-reminder-workspace__actions">
        <button type="button" class="btn primary" data-reminder-refresh ${checking ? 'disabled' : ''}>${checking ? 'Checking current state…' : 'Refresh current state'}</button>
      </div>`;
  }

  function renderWorkspace(state, { focusSearch = false } = {}) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (state.result) {
      root.innerHTML = renderResult(state);
      bindWorkspace(state);
      return;
    }
    if (state.activeBatch) {
      root.innerHTML = renderRecovery(state);
      bindWorkspace(state);
      syncModalDismissalLock(state);
      return;
    }
    const count = selectedCount(state);
    const selectedMatching = matchingSelectedCount(state);
    const allSelected = state.matchingSelectionKeys.length > 0 && selectedMatching === state.matchingSelectionKeys.length;
    const partlySelected = selectedMatching > 0 && !allSelected;
    const sortIndicator = key => state.sortBy === key ? (state.sortDirection === 'ASC' ? '▲' : '▼') : '↕';
    const ariaSort = key => state.sortBy === key ? (state.sortDirection === 'ASC' ? 'ascending' : 'descending') : 'none';
    const rows = state.items.map(item => `
      <tr>
        <td class="candidate-reminder-table__select">
          <input type="checkbox" data-reminder-row="${enc(item.selection_key)}" aria-label="Select ${enc(item.candidate_name)}" ${isSelected(state, item.selection_key) ? 'checked' : ''} ${state.sending ? 'disabled' : ''}>
        </td>
        <td data-label="Candidate name"><strong>${enc(item.candidate_name)}</strong></td>
        <td data-label="Last request or reminder sent">${enc(formatDateTime(item.last_manager_email_at_utc))}</td>
      </tr>`).join('');
    const empty = !state.loading && !state.error && state.totalItems === 0;
    root.innerHTML = `
      <div class="candidate-reminder-workspace__intro">
        <p>Only timesheets currently eligible for a manager approval reminder are shown. CloudTMS checks eligibility again before sending.</p>
        <div class="candidate-reminder-workspace__selection" aria-live="polite"><strong>${count}</strong> of ${state.catalogueTotalItems} selected</div>
      </div>
      <div class="candidate-reminder-workspace__toolbar">
        <label for="candidateReminderSurnameSearch">Search by Candidate surname</label>
        <input id="candidateReminderSurnameSearch" type="search" maxlength="100" autocomplete="off" placeholder="Start typing a surname…" value="${enc(state.searchQuery)}" data-reminder-search ${state.sending ? 'disabled' : ''}>
        <span class="candidate-reminder-workspace__matches" aria-live="polite">${state.searchQuery ? `${state.totalItems} matching` : `${state.catalogueTotalItems} eligible`}</span>
      </div>
      ${state.error ? `<div class="candidate-reminder-workspace__error" role="alert">
        <span>${enc(state.error.message)}</span>
        ${state.error.stale ? '<button type="button" class="btn" data-reminder-refresh>Refresh current state</button>' : ''}
      </div>` : ''}
      ${state.loading ? '<div class="candidate-reminder-workspace__loading" role="status">Loading eligible timesheets…</div>' : ''}
      ${empty ? `<div class="candidate-reminder-workspace__empty">${state.searchQuery ? 'No eligible timesheets match that Candidate surname.' : 'There are no timesheets currently eligible for a manager reminder.'}</div>` : ''}
      ${!state.loading && state.totalItems > 0 ? `
        <div class="candidate-reminder-table-wrap" tabindex="0" aria-label="Eligible manager reminders">
          <table class="candidate-reminder-table">
            <thead><tr>
              <th class="candidate-reminder-table__select">
                <input type="checkbox" data-reminder-select-all aria-label="Select or clear every eligible timesheet across all pages" ${allSelected ? 'checked' : ''} ${state.sending ? 'disabled' : ''}>
              </th>
              <th aria-sort="${ariaSort('CANDIDATE_SURNAME')}"><button type="button" class="candidate-reminder-sort" data-reminder-sort="CANDIDATE_SURNAME">Candidate name <span aria-hidden="true">${sortIndicator('CANDIDATE_SURNAME')}</span></button></th>
              <th aria-sort="${ariaSort('LAST_MANAGER_EMAIL')}"><button type="button" class="candidate-reminder-sort" data-reminder-sort="LAST_MANAGER_EMAIL">Last request or reminder sent <span aria-hidden="true">${sortIndicator('LAST_MANAGER_EMAIL')}</span></button></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <nav class="candidate-reminder-pagination" aria-label="Eligible manager reminder pages">
          <button type="button" class="btn" data-reminder-page="previous" ${state.page <= 1 || state.sending ? 'disabled' : ''}>Previous</button>
          <span>Page ${state.page} of ${state.pageCount}</span>
          <button type="button" class="btn" data-reminder-page="next" ${state.page >= state.pageCount || state.sending ? 'disabled' : ''}>Next</button>
        </nav>` : ''}
      <div class="candidate-reminder-workspace__actions">
        <button type="button" class="btn" data-reminder-cancel ${state.sending ? 'disabled' : ''}>Cancel</button>
        <button type="button" class="btn primary" data-reminder-send ${count < 1 || state.loading || state.sending ? 'disabled' : ''}>${state.sending ? 'Sending reminders…' : 'Send Reminders'}</button>
      </div>`;
    const selectAll = root.querySelector('[data-reminder-select-all]');
    if (selectAll) selectAll.indeterminate = partlySelected;
    bindWorkspace(state);
    if (focusSearch) {
      const search = root.querySelector('[data-reminder-search]');
      search?.focus({ preventScroll: true });
      search?.setSelectionRange?.(search.value.length, search.value.length);
    }
  }

  async function loadPage(state, requestedPage, { resetRevision = false, focusSearch = false } = {}) {
    if (state.activeBatch || restoredUnresolvedBatch()) {
      if (!state.activeBatch) state.activeBatch = restoredUnresolvedBatch();
      state.loading = false;
      renderWorkspace(state);
      return;
    }
    state.controller?.abort();
    state.controller = new AbortController();
    state.loading = true;
    state.error = null;
    if (resetRevision) {
      state.catalogueRevision = null;
      state.selectionMode = 'EXPLICIT';
      state.included.clear();
      state.excluded.clear();
    }
    renderWorkspace(state, { focusSearch });
    try {
      const result = await window.CloudTMSCandidateOfficeApi.fetchManagerReminderEligibility({
        page: requestedPage,
        pageSize: state.pageSize,
        catalogueRevision: state.catalogueRevision,
        surnameQuery: state.searchQuery,
        sortBy: state.sortBy,
        sortDirection: state.sortDirection,
        signal: state.controller.signal
      });
      if (!isLive(state)) return;
      if (state.catalogueRevision && result.catalogue_revision !== state.catalogueRevision) {
        throw Object.assign(new Error('The eligible reminder list changed. Refresh it before selecting managers.'), { code: 'CANDIDATE_REMINDER_BATCH_SELECTION_CHANGED' });
      }
      state.catalogueRevision = result.catalogue_revision;
      state.page = result.page;
      state.pageCount = result.page_count;
      state.totalItems = result.total_items;
      state.catalogueTotalItems = result.catalogue_total_items;
      state.matchingSelectionKeys = [...result.matching_selection_keys];
      state.searchQuery = result.surname_query;
      state.sortBy = result.sort_by;
      state.sortDirection = result.sort_direction;
      state.items = [...result.items];
    } catch (error) {
      if (error?.name === 'AbortError' || !isLive(state)) return;
      state.error = window.CloudTMSCandidateOfficeContract.normalizeCandidateOfficeError(error);
      state.items = [];
    } finally {
      if (isLive(state)) {
        state.loading = false;
        renderWorkspace(state, { focusSearch });
      }
    }
  }

  async function sendReminders(state) {
    const retained = state.activeBatch || restoredUnresolvedBatch();
    if (retained) {
      state.activeBatch = retained;
      state.error = Object.freeze({
        stale: true,
        message: 'CloudTMS is retaining the original reminder batch. Refresh current state to recover its durable result.'
      });
      renderWorkspace(state);
      return;
    }
    const count = selectedCount(state);
    if (!count || state.sending) return;
    const trigger = document.querySelector(`#${ROOT_ID} [data-reminder-send]`);
    state.sending = true;
    state.error = null;
    renderWorkspace(state);
    const batchId = crypto.randomUUID();
    const selection = selectionBody(state);
    try {
      const preview = await window.CloudTMSCandidateOfficeApi.previewManagerReminderSelection({
        selection,
        catalogueRevision: state.catalogueRevision
      });
      if (preview.selected_count !== count) throw Object.assign(new Error('The eligible reminder list changed. Review the current selection before sending.'), { code: 'CANDIDATE_REMINDER_BATCH_SELECTION_CHANGED' });
      const confirmation = await window.CloudTMSCandidateOfficeModals.openCandidateReminderBatchModal({
        preview,
        trigger
      });
      if (!confirmation?.confirmed) return;
      setActiveBatch(state, {
        selection,
        catalogueRevision: state.catalogueRevision,
        preview,
        batchId,
        idempotencyKey: batchId,
        ownerUserId: currentOfficeUserId(),
        phase: RECOVERY_PHASE.EXECUTING,
        exactRetryConsumed: false
      });
      const result = await executeOrRecoverReminderBatch(state);
      if (!isLive(state)) return;
      state.result = result;
      clearActiveBatch(state);
    } catch (error) {
      if (!isLive(state)) return;
      const normalized = window.CloudTMSCandidateOfficeContract.normalizeCandidateOfficeError(error);
      state.error = error?.reminderBatchOutcomeUncertain === true
        ? Object.freeze({
            ...normalized,
            stale: true,
            message: 'CloudTMS could not confirm the reminder result. Refresh current state to recover this same batch safely; do not start another batch.'
          })
        : normalized;
      if (error?.reminderBatchOutcomeUncertain !== true) clearActiveBatch(state);
    } finally {
      if (isLive(state)) {
        state.sending = false;
        renderWorkspace(state);
      }
    }
  }

  const isUncertainBatchError = error => {
    const status = Number(error?.status || error?.payload?.status || 0);
    const code = String(error?.code || '').toUpperCase();
    return !status || status >= 500 || ['CANDIDATE_OFFICE_NETWORK_ERROR', 'CANDIDATE_OFFICE_TRANSPORT_UNAVAILABLE'].includes(code);
  };
  const isBatchNotFound = error => Number(error?.status || 0) === 404
    || String(error?.code || '').toUpperCase() === 'CANDIDATE_REMINDER_BATCH_NOT_FOUND';

  async function executeExactReminderBatch(activeBatch) {
    return window.CloudTMSCandidateOfficeApi.executeManagerReminderSelection(activeBatch);
  }

  async function recoverReminderBatch(activeBatch, { onBatchUpdate = () => {} } = {}) {
    let frozenBatch = activeBatch;
    try {
      return await window.CloudTMSCandidateOfficeApi.fetchManagerReminderBatch({ batchId: frozenBatch.batchId });
    } catch (statusError) {
      if (!isBatchNotFound(statusError)) {
        // Once execution may already have reached the server, every status-read
        // failure other than the exact authoritative not-found result leaves the
        // batch outcome unresolved. A 4xx such as 403 or 429 describes the
        // lookup request; it does not prove that the original batch was absent.
        throw Object.assign(statusError, { reminderBatchOutcomeUncertain: true });
      }
    }

    if (frozenBatch.exactRetryConsumed === true) {
      const error = Object.assign(new Error('CloudTMS has not yet published the durable reminder result.'), {
        status: 404,
        code: 'CANDIDATE_REMINDER_BATCH_NOT_FOUND',
        reminderBatchOutcomeUncertain: true
      });
      throw error;
    }

    // No durable result exists: retry the exact frozen request and key. This is
    // safe whether the first request never reached the server or lost its reply.
    frozenBatch = freezeBatch({
      ...frozenBatch,
      phase: RECOVERY_PHASE.EXACT_RETRY_IN_PROGRESS,
      exactRetryConsumed: true
    });
    onBatchUpdate(frozenBatch);
    try {
      return await executeExactReminderBatch(frozenBatch);
    } catch (retryError) {
      if (!isUncertainBatchError(retryError)) throw retryError;
      try {
        return await window.CloudTMSCandidateOfficeApi.fetchManagerReminderBatch({ batchId: frozenBatch.batchId });
      } catch (finalError) {
        throw Object.assign(finalError, { reminderBatchOutcomeUncertain: true });
      }
    }
  }

  async function executeOrRecoverReminderBatch(state) {
    const activeBatch = state.activeBatch;
    if (!activeBatch) throw new Error('The manager reminder batch is unavailable.');
    try {
      return await executeExactReminderBatch(activeBatch);
    } catch (error) {
      if (!isUncertainBatchError(error)) throw error;
      setActiveBatch(state, { ...activeBatch, phase: RECOVERY_PHASE.STATUS_PROBE });
      return recoverReminderBatch(state.activeBatch, {
        onBatchUpdate: batch => setActiveBatch(state, batch)
      });
    }
  }

  async function refreshCurrentState(state) {
    if (!state.activeBatch) {
      await loadPage(state, 1, { resetRevision: true });
      return;
    }
    if (state.sending) return;
    state.sending = true;
    state.error = null;
    renderWorkspace(state);
    try {
      state.result = await recoverReminderBatch(state.activeBatch, {
        onBatchUpdate: batch => setActiveBatch(state, batch)
      });
      clearActiveBatch(state);
    } catch (error) {
      setActiveBatch(state, {
        ...state.activeBatch,
        phase: RECOVERY_PHASE.UNCERTAIN_STATUS_ONLY
      });
      const normalized = window.CloudTMSCandidateOfficeContract.normalizeCandidateOfficeError(error);
      state.error = Object.freeze({
        ...normalized,
        stale: true,
        message: 'CloudTMS still cannot confirm the reminder result. Use Refresh current state again; the exact original batch identity and selection are being preserved.'
      });
    } finally {
      if (isLive(state)) {
        state.sending = false;
        renderWorkspace(state);
      }
    }
  }

  function bindWorkspace(state) {
    const root = document.getElementById(ROOT_ID);
    if (!root || root.dataset.workspaceInstance !== state.instance) return;
    root.querySelector('[data-reminder-close]')?.addEventListener('click', closeWorkspace);
    root.querySelector('[data-reminder-cancel]')?.addEventListener('click', closeWorkspace);
    root.querySelector('[data-reminder-send]')?.addEventListener('click', () => sendReminders(state));
    root.querySelector('[data-reminder-refresh]')?.addEventListener('click', () => refreshCurrentState(state));
    root.querySelector('[data-reminder-select-all]')?.addEventListener('change', event => {
      const keys = state.matchingSelectionKeys;
      if (state.selectionMode === 'ALL_ELIGIBLE') {
        keys.forEach(key => event.target.checked ? state.excluded.delete(key) : state.excluded.add(key));
      } else {
        keys.forEach(key => event.target.checked ? state.included.add(key) : state.included.delete(key));
        if (event.target.checked && keys.length === state.catalogueTotalItems) {
          state.selectionMode = 'ALL_ELIGIBLE';
          state.included.clear();
          state.excluded.clear();
        }
      }
      renderWorkspace(state);
    });
    root.querySelectorAll('[data-reminder-row]').forEach(control => control.addEventListener('change', event => {
      const key = String(event.target.dataset.reminderRow || '');
      if (state.selectionMode === 'ALL_ELIGIBLE') {
        if (event.target.checked) state.excluded.delete(key);
        else state.excluded.add(key);
      } else if (event.target.checked) state.included.add(key);
      else state.included.delete(key);
      renderWorkspace(state);
    }));
    root.querySelector('[data-reminder-page="previous"]')?.addEventListener('click', () => loadPage(state, state.page - 1));
    root.querySelector('[data-reminder-page="next"]')?.addEventListener('click', () => loadPage(state, state.page + 1));
    root.querySelector('[data-reminder-search]')?.addEventListener('input', event => {
      state.searchQuery = String(event.target.value || '');
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => loadPage(state, 1, { focusSearch: true }), 120);
    });
    root.querySelectorAll('[data-reminder-sort]').forEach(control => control.addEventListener('click', () => {
      const nextSort = String(control.dataset.reminderSort || '');
      state.sortDirection = state.sortBy === nextSort && state.sortDirection === 'ASC' ? 'DESC' : 'ASC';
      state.sortBy = nextSort;
      loadPage(state, 1);
    }));
  }

  async function openCandidateManagerReminderWorkspace() {
    if (!capabilityAllowsWorkspace()) {
      const error = new Error('Manager reminder batching is not available for this Office session.');
      error.code = 'CANDIDATE_OFFICE_PERMISSION_DENIED';
      throw error;
    }
    if (typeof window.showModal !== 'function') throw new Error('The CloudTMS modal service is unavailable.');
    const state = createState();
    state.instance = crypto.randomUUID();
    state.activeBatch = restoredUnresolvedBatch();
    state.loading = !state.activeBatch;
    if (state.activeBatch) {
      state.error = Object.freeze({
        stale: true,
        message: 'CloudTMS is retaining an unresolved reminder batch from this Office session. Refresh current state to recover its durable result.'
      });
    }
    window.showModal(
      'Send Manager Reminders',
      [{ key: 'main', label: 'Eligible Timesheets' }],
      () => `<div class="tabc"><div id="${ROOT_ID}" class="candidate-reminder-workspace" data-workspace-instance="${enc(state.instance)}"></div></div>`,
      null,
      false,
      () => renderWorkspace(state),
      {
        kind: MODAL_KIND,
        noParentGate: true,
        showSave: false,
        showApply: false,
        runOnRender: true,
        onDismiss: () => {
          clearTimeout(state.searchTimer);
          state.controller?.abort();
        }
      }
    );
    renderWorkspace(state);
    syncModalDismissalLock(state);
    if (!state.activeBatch) await loadPage(state, 1, { resetRevision: true });
  }

  window.addEventListener?.('cloudtms:office-session-cleared', () => persistUnresolvedBatch(null));
  window.addEventListener?.('cloudtms:office-session-ready', () => {
    if (unresolvedBatch && !validStoredBatch(unresolvedBatch)) persistUnresolvedBatch(null);
  });

  Object.assign(window, {
    CloudTMSCandidateOfficeReminderWorkspace: Object.freeze({
      open: openCandidateManagerReminderWorkspace,
      selectionBody,
      selectedCount,
      matchingSelectedCount,
      isSelected,
      formatDateTime,
      renderResult,
      renderRecovery,
      recoverReminderBatch,
      restoredUnresolvedBatch
    }),
    openCandidateManagerReminderWorkspace
  });
})();

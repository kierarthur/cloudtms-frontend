(function installCloudTmsImportReviewV1(global) {
  'use strict';

  const CONTRACT = Object.freeze({
    schema: 'IMPORT_REVIEW_DB_V1',
    apply: 'IMPORT_REVIEW_APPLY_V1',
    operation: 'IMPORT_APPLY_OPERATION_V2',
    correction: 'IMPORT_CORRECTION_OPERATION_V2',
    followUp: 'IMPORT_REVIEW_FOLLOW_UP_COMPONENT_V1',
    tsfinSettlement: 'IMPORT_REVIEW_TSFIN_SETTLEMENT_V1',
    incrementalApply: 'IMPORT_REVIEW_INCREMENTAL_APPLY_V1',
    ui: 'IMPORT_REVIEW_UI_V6',
    emailGrouping: 'TIMESHEET_QUERY_RECIPIENT_EMAIL_V1',
    canonicalCorrectionCarrier:
      'BANKING_PAY_CANONICAL_CORRECTION_CARRIER_V1'
  });
  const PAGE_SIZES = Object.freeze([25, 50, 75, 100]);
  const ACTIVE_VIEWS = Object.freeze(['PENDING', 'READY', 'EMAIL', 'NO_ACTION']);
  const TERMINAL = new Set(['APPLYING', 'APPLIED', 'ABANDONED', 'SUPERSEDED']);
  const state = {
    contract: null,
    contractError: '',
    home: {
      reviews: [], clients: [], busy: '', error: '', statusClass: 'ACTIVE', pageSize: 25,
      page: 1, cursorStack: [null], nextCursor: null, selectedClients: {}, zeroShifts: null
    },
    coverage: null,
    review: null,
    saveTimer: null,
    documentPollTimer: null,
    reviewEpoch: 0,
    closeBypass: false
  };

  const esc = (value) => (typeof global.escapeHtml === 'function')
    ? global.escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const apiUrl = (path) => {
    if (typeof global.API === 'function') return global.API(path);
    const base = String(global.BROKER_BASE_URL || '').replace(/\/$/, '');
    if (!base) throw new Error('The CloudTMS API address is unavailable.');
    return `${base}${path}`;
  };
  const makeUuid = () => (global.crypto && typeof global.crypto.randomUUID === 'function')
    ? global.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
  function opaqueUiToken(value) {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (const ch of String(value || '')) {
      const code = ch.codePointAt(0);
      left = Math.imul(left ^ code, 0x01000193) >>> 0;
      right = Math.imul(right ^ (code + 0x7f4a7c15), 0x85ebca6b) >>> 0;
    }
    return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
  }
  const recoveryKey = (importId) => `cloudtms:import-review:v3:apply:${importId}`;
  function recoveryFor(importId) {
    try { return JSON.parse(global.sessionStorage.getItem(recoveryKey(importId)) || 'null'); } catch { return null; }
  }
  function storeRecovery(importId, value) {
    try {
      if (value) global.sessionStorage.setItem(recoveryKey(importId), JSON.stringify(value));
      else global.sessionStorage.removeItem(recoveryKey(importId));
    } catch {}
  }

  async function request(path, options = {}) {
    if (typeof global.authFetch !== 'function') throw new Error('The signed-in API helper is unavailable.');
    const { timeoutMs: requestedTimeoutMs = 0, ...requestOptions } = options || {};
    const method = String(requestOptions.method || 'GET').toUpperCase();
    const maxAttempts = method === 'GET' ? 2 : 1;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const timeoutMs = Number(requestedTimeoutMs || 0);
      const timeoutController = timeoutMs > 0 && typeof global.AbortController === 'function'
        ? new global.AbortController()
        : null;
      const timeoutId = timeoutController
        ? global.setTimeout(() => timeoutController.abort(), timeoutMs)
        : null;
      try {
        const fetchOptions = timeoutController
          ? { ...requestOptions, signal: timeoutController.signal }
          : requestOptions;
        const response = await global.authFetch(
          apiUrl(path),
          method === 'GET'
            ? { ...fetchOptions, cache: fetchOptions.cache || 'no-store' }
            : fetchOptions
        );
        const text = await response.text().catch(() => '');
        let payload = null;
        try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
        if (!response.ok || payload?.ok === false) {
          const message = payload?.error?.message || payload?.message || payload?.error_message || `Request failed (${response.status})`;
          const error = new Error(message);
          error.status = response.status;
          error.code = payload?.error?.code || payload?.error_code || 'REQUEST_FAILED';
          error.action = payload?.error?.action || null;
          error.payload = payload;
          throw error;
        }
        return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
      } catch (error) {
        if (timeoutController?.signal?.aborted && String(error?.name || '') === 'AbortError') {
          error.code = 'REQUEST_TIMEOUT';
          error.action = 'CHECK_APPLY_STATUS';
          error.message = 'The server response timed out. The saved operation will be checked before any further action.';
        }
        lastError = error;
        const status = Number(error?.status || 0);
        const transient = status === 0 || status === 408 || status === 500 || status === 502 || status === 503 || status === 504;
        if (attempt >= maxAttempts || !transient) throw error;
        await new Promise((resolve) => global.setTimeout(resolve, 250));
      } finally {
        if (timeoutId !== null) global.clearTimeout(timeoutId);
      }
    }
    throw lastError;
  }

  function shouldRecoverApplyOutcome(error) {
    const status = Number(error?.status || 0);
    return error?.action === 'CHECK_APPLY_STATUS'
      || error?.code === 'REQUEST_TIMEOUT'
      || String(error?.name || '') === 'AbortError'
      || status === 0
      || status === 202
      || status === 408
      || status === 500
      || status === 502
      || status === 503
      || status === 504;
  }

  const IMPORT_SCREEN_KINDS = new Set(['imports-v1', 'import-coverage-v1', 'import-review-v1', 'import-review-confirm-v1']);

  function notify(message) {
    const text = String(message || '').trim();
    if (!text) return;
    if (typeof global.__toast === 'function') global.__toast(text);
    else if (global.console && typeof global.console.warn === 'function') global.console.warn(text);
  }

  async function importUiConfirm({ title, messageHtml, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
    if (typeof global.openUiConfirmModal !== 'function') {
      notify('The CloudTMS confirmation window is unavailable. Refresh the page and try again.');
      return false;
    }
    const result = await global.openUiConfirmModal({
      title: String(title || 'Please confirm'),
      message_html: String(messageHtml || ''),
      confirm_label: String(confirmLabel || 'Confirm'),
      cancel_label: String(cancelLabel || 'Cancel'),
      confirm_class: danger ? 'btn btn-warn' : 'btn btn-primary',
      cancel_class: 'btn btn-outline'
    });
    return !!(result && result.confirmed === true);
  }

  function confirmCoverageDiscard() {
    return importUiConfirm({
      title: 'Discard staged import?',
      messageHtml: '<div style="font-size:14px;font-weight:700;margin-bottom:6px;">Discard this staged import?</div><div class="mini">The review has not been created. You can upload the source file again later to start from the beginning.</div>',
      confirmLabel: 'Discard import',
      cancelLabel: 'Keep reviewing',
      danger: true
    });
  }

  function currentImportFrame() {
    const frames = Array.isArray(global.__modalStack) ? global.__modalStack : [];
    let top = frames[frames.length - 1] || null;
    if (!top && typeof global.__getModalFrame === 'function') {
      try { top = global.__getModalFrame(); } catch { top = null; }
    }
    return top && IMPORT_SCREEN_KINDS.has(String(top.kind || '')) ? top : null;
  }

  function currentImportScreenIsVisible() {
    if (currentImportFrame()) return true;
    const root = document.getElementById('irv1Review');
    return !!(root && root.isConnected);
  }

  function repaintImportFrame(title, render, kind) {
    const frame = currentImportFrame();
    if (!frame) {
      // Some modal-host refreshes can briefly lose the JS frame while leaving
      // the live Import Review DOM mounted. Repaint that mounted screen rather
      // than opening a duplicate dialog or stopping document-ready polling.
      const existingRoot = document.getElementById('irv1Review');
      const body = document.getElementById('modalBody');
      if (!existingRoot || !existingRoot.isConnected || !body) return false;
      const titleNode = document.getElementById('modalTitle');
      if (titleNode) titleNode.textContent = title;
      const tabNode = document.querySelector('#modalTabs button');
      if (tabNode) tabNode.textContent = title;
      body.innerHTML = render();
      return true;
    }
    const changedScreen = String(frame.kind || '') !== String(kind || '');
    frame.title = title;
    frame.kind = kind;
    frame.entity = kind;
    frame.currentTabKey = 'main';
    frame.renderTab = (key) => key === 'main' ? render() : '';
    frame._ctxRef = global.modalCtx;
    frame.mode = 'edit';
    frame.noParentGate = true;
    frame.dirtyClosePolicy = 'close';
    frame._closing = false;
    if (changedScreen) {
      frame.isDirty = false;
      frame._snapshot = null;
    }
    const titleNode = document.getElementById('modalTitle');
    if (titleNode) titleNode.textContent = title;
    const tabNode = document.querySelector('#modalTabs button');
    if (tabNode) tabNode.textContent = title;
    const body = document.getElementById('modalBody');
    if (body) body.innerHTML = render();
    if (typeof frame._updateButtons === 'function') frame._updateButtons();
    return true;
  }

  function showScreen(title, render, kind) {
    global.modalCtx = { entity: kind, data: {}, importsState: state };
    if (repaintImportFrame(title, render, kind)) return;
    global.showModal(
      title,
      [{ key: 'main', label: title }],
      (key) => key === 'main' ? render() : '',
      null,
      false,
      null,
      { kind, noParentGate: true, forceEdit: true, dirtyClosePolicy: 'close', showSave: false, stayOpenOnSave: true }
    );
  }

  function cancelDocumentPreparationPoll() {
    if (state.documentPollTimer !== null) {
      global.clearTimeout(state.documentPollTimer);
      state.documentPollTimer = null;
    }
  }

  function pageNeedsDocumentPreparationPoll(review) {
    const items = Array.isArray(review?.pageData?.items) ? review.pageData.items : [];
    return items.some((item) => {
      try {
        return JSON.stringify(item || {}).toUpperCase().includes('TIMESHEET_EVIDENCE_PREPARING');
      } catch {
        return false;
      }
    });
  }

  function scheduleDocumentPreparationPoll(review) {
    cancelDocumentPreparationPoll();
    if (!review || state.review !== review || !pageNeedsDocumentPreparationPoll(review)) return;
    const importId = review.importId;
    const epoch = review.epoch;
    state.documentPollTimer = global.setTimeout(async () => {
      state.documentPollTimer = null;
      const current = state.review;
      if (!current || current !== review || current.importId !== importId || current.epoch !== epoch) return;
      if (!currentImportScreenIsVisible() || current.screen !== 'review') return;
      if (current.pendingSave || current.dirty?.size) {
        scheduleDocumentPreparationPoll(current);
        return;
      }
      try {
        await openReview(importId, { preserveLocal: true, documentPoll: true });
      } catch (error) {
        if (state.review === current) {
          current.error = `Timesheet evidence is still being prepared. CloudTMS will check again automatically. ${error?.message || ''}`.trim();
          showScreen('Import review', renderReview, 'import-review-v1');
          scheduleDocumentPreparationPoll(current);
        }
      }
    }, 1800);
  }

  function formatDate(value) {
    const raw = String(value || '').slice(0, 10);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return raw || '—';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZone: 'Europe/London'
    }).format(date).replace(',', '');
  }

  function displayReviewStatus(status, partialApplication = false) {
    const normalized = String(status || '').trim().toUpperCase();
    if (partialApplication && normalized !== 'APPLIED') return 'PARTIALLY APPLIED';
    if (normalized === 'BLOCKED') return 'NEEDS ATTENTION';
    return normalized || 'IN REVIEW';
  }

  function contractIsValid(contract) {
    return contract?.ok === true
      && contract.schema_contract_version === CONTRACT.schema
      && contract.apply_envelope_version === CONTRACT.apply
      && contract.apply_operation_version === CONTRACT.operation
      && contract.correction_operation_version === CONTRACT.correction
      && contract.follow_up_component_version === CONTRACT.followUp
      && contract.tsfin_follow_up_settlement_version === CONTRACT.tsfinSettlement
      && contract.incremental_apply_version === CONTRACT.incrementalApply
      && contract.review_ui_contract_version === CONTRACT.ui
      && contract.email_grouping_version === CONTRACT.emailGrouping
      && contract.canonical_correction_carrier_version
        === CONTRACT.canonicalCorrectionCarrier
      && contract.legacy_contracts_supported === false;
  }

  async function ensureContract(force = false) {
    if (state.contract && !force) return state.contract;
    const contract = await request('/api/import-review/contract');
    if (!contractIsValid(contract)) throw new Error('The installed import-review contract is not the approved frontend contract.');
    state.contract = contract;
    return contract;
  }

  function reviewListPath() {
    const home = state.home;
    const params = new URLSearchParams({ status_class: home.statusClass, page_size: String(home.pageSize) });
    const cursor = home.cursorStack[home.page - 1];
    if (cursor?.updated_at_utc && cursor?.import_id) {
      params.set('cursor_updated_at', cursor.updated_at_utc);
      params.set('cursor_import_id', cursor.import_id);
    }
    return `/api/import-reviews?${params.toString()}`;
  }

  async function loadHome({ resetPaging = false } = {}) {
    state.home.error = '';
    state.contractError = '';
    if (resetPaging) Object.assign(state.home, { page: 1, cursorStack: [null], nextCursor: null });
    const contract = await ensureContract(true);
    const [reviewList, clients] = await Promise.all([
      request(reviewListPath()),
      request('/api/healthroster/autoprocess/clients', { method: 'GET', cache: 'no-store' }).catch(() => ({ items: [] }))
    ]);
    state.contract = contract;
    state.home.reviews = Array.isArray(reviewList?.items) ? reviewList.items : [];
    state.home.clients = Array.isArray(clients?.items) ? clients.items : [];
    state.home.nextCursor = reviewList?.next_cursor || null;
  }

  function invalidateClientEligibility() {
    state.home.clients = [];
  }

  function clientOptions(selectedId = '') {
    return state.home.clients.map((client) => {
      const id = String(client.client_id || client.id || '');
      const name = client.client_name || client.name || id;
      return `<option value="${esc(id)}" ${String(selectedId) === id ? 'selected' : ''}>${esc(name)}</option>`;
    }).join('');
  }

  function importTile(kind, icon, title, description, needsClient, options = {}) {
    const selectedClient = String(state.home.selectedClients?.[kind] || '');
    const clientPrompt = options.clientPrompt || 'Choose a Roster Client';
    const dropPrompt = options.dropPrompt || 'Drop the file here';
    return `<article class="irv1-tile" tabindex="0" data-ir-drop="${esc(kind)}" aria-label="${esc(title)} file upload">
      <div class="irv1-tile-icon" aria-hidden="true">${esc(icon)}</div>
      <div><h4>${esc(title)}</h4><p>${esc(description)}</p></div>
      ${needsClient ? `<label class="mini">Client<select class="input irv1-client-select" data-ir-client="${esc(kind)}"><option value="">${esc(clientPrompt)}</option>${clientOptions(selectedClient)}</select></label>` : ''}
      <div class="irv1-drop"><strong>${esc(dropPrompt)}</strong><span>or click to browse (.xls, .xlsx or .csv)</span></div>
      ${options.secondaryAction ? `<button type="button" class="irv1-btn irv1-secondary-action" data-ir-action="${esc(options.secondaryAction.action)}">${esc(options.secondaryAction.label)}</button>` : ''}
      <input class="irv1-file" type="file" accept=".xls,.xlsx,.csv" data-ir-file="${esc(kind)}" />
    </article>`;
  }

  function zeroShiftsDialogHtml() {
    const dialog = state.home.zeroShifts;
    if (!dialog) return '';
    return `<div class="irv1-dialog-backdrop" data-ir-zero-backdrop>
      <section class="irv1-dialog" role="dialog" aria-modal="true" aria-labelledby="irv1ZeroTitle" aria-describedby="irv1ZeroHelp">
        <div class="irv1-dialog-head"><div><span class="irv1-dialog-kicker">Daily Validation</span><h3 id="irv1ZeroTitle">No shifts in roster yet</h3></div><button type="button" class="irv1-dialog-close" data-ir-action="zero-shifts-cancel" aria-label="Close">×</button></div>
        <p id="irv1ZeroHelp">Choose the Daily Client and exact period with no roster shifts. CloudTMS will open a normal validation review and treat any existing Daily timesheets in that period as missing from the roster. Nothing is applied until the review is approved.</p>
        ${dialog.error ? `<div class="irv1-alert error" role="alert">${esc(dialog.error)}</div>` : ''}
        <div class="irv1-dialog-fields">
          <label>Daily Client<select class="input" data-ir-zero-client ${dialog.busy ? 'disabled' : ''}><option value="">Choose a Daily Client</option>${clientOptions(dialog.clientId)}</select></label>
          <div class="irv1-dialog-date-grid"><label>Start date<input class="input" type="date" data-ir-zero-start value="${esc(dialog.startDate || '')}" ${dialog.busy ? 'disabled' : ''}/></label><label>End date<input class="input" type="date" data-ir-zero-end value="${esc(dialog.endDate || '')}" ${dialog.busy ? 'disabled' : ''}/></label></div>
        </div>
        <div class="mini">The period may be up to 366 days, including both the start and end date.</div>
        <div class="irv1-review-actions"><button type="button" class="irv1-btn" data-ir-action="zero-shifts-cancel" ${dialog.busy ? 'disabled' : ''}>Cancel</button><button type="button" class="irv1-btn primary" data-ir-action="zero-shifts-submit" ${dialog.busy ? 'disabled' : ''}>${dialog.busy ? 'Creating review…' : 'Create Daily Validation review'}</button></div>
      </section>
    </div>`;
  }

  function focusZeroShiftsDialog() {
    global.requestAnimationFrame(() => {
      const target = document.querySelector('[data-ir-zero-client]');
      try { target?.focus({ preventScroll: true }); } catch { try { target?.focus(); } catch {} }
    });
  }

  function renderHome() {
    if (!contractIsValid(state.contract)) {
      return `<div class="irv1-shell"><div class="irv1-alert error"><strong>Import review is unavailable.</strong><br/>${esc(state.contractError || state.home.error || 'The approved database and Worker contract could not be verified. Upload and review controls are disabled.')}</div><div class="irv1-review-actions"><button type="button" class="irv1-btn" data-ir-action="reload-home">Retry contract check</button></div></div>`;
    }
    const rows = state.home.reviews.length ? state.home.reviews.map((item) => `<div class="irv1-history-row">
      <div><strong>${esc(item.filename || 'Import')}</strong><small>${esc(item.source_route || item.source_system || '')}</small></div>
      <div>${esc(formatDate(item.coverage_start_date))} – ${esc(formatDate(item.coverage_end_date))}</div>
      <div><span class="irv1-status ${String(item.display_status || '').toUpperCase() === 'SUCCESS' ? 'is-success' : ''}">${esc(displayReviewStatus(item.display_status || item.status, item.partial_application === true))}</span><small>Updated ${esc(formatDateTime(item.updated_at_utc))}</small></div>
      <button type="button" class="irv1-btn" data-ir-action="continue" data-import-id="${esc(item.import_id)}">Continue</button>
    </div>`).join('') : '<div class="irv1-empty">There are no unfinished import reviews.</div>';
    const busy = state.home.busy ? `<div class="irv1-alert">${esc(state.home.busy)}</div>` : '';
    const error = state.home.error ? `<div class="irv1-alert error">${esc(state.home.error)}</div>` : '';
    return `<div class="irv1-shell" id="irv1Home">
      <section class="irv1-intro"><div><h3>Import and review timesheets</h3><p>Upload a source file, confirm exactly what it covers, then resolve only the items that need attention. You can close this window and continue later.</p></div><span class="irv1-contract">✓ Approved contract ${esc(CONTRACT.ui)}</span></section>
      ${busy}${error}
      <section class="irv1-tiles">
        ${importTile('NHSP', 'N', 'NHSP Weekly', 'Import a dedicated NHSP Weekly export and review the server-classified changes.', false)}
        ${importTile('HR_WEEKLY', 'W', 'Weekly Roster Import', 'Create or validate weekly records for the selected Roster Client.', true, { clientPrompt: 'Choose a Weekly Roster Client' })}
        ${importTile('HR_DAILY', 'D', 'Daily Validation', 'Compare a supported daily roster file with existing Daily timesheets.', true, { clientPrompt: 'Choose a Daily Client', dropPrompt: 'Drop the daily roster file here', secondaryAction: { action: 'zero-shifts-open', label: 'No shifts in roster yet' } })}
      </section>
      <section class="irv1-history"><div class="irv1-history-head"><div><strong>${state.home.statusClass === 'ACTIVE' ? 'Continue an import' : 'Import review history'}</strong><div class="mini">Saved reviews resume with their selections and review position. Completed and abandoned reviews reopen read-only.</div></div><div class="irv1-toolbar-group"><label>Status <select class="input" data-ir-home-status>${['ACTIVE','ALL','COMPLETED','ABANDONED','SUPERSEDED'].map((value) => `<option value="${value}" ${state.home.statusClass === value ? 'selected' : ''}>${value.toLowerCase().replace('_',' ')}</option>`).join('')}</select></label><label>Rows <select class="input" data-ir-home-page-size>${PAGE_SIZES.map((size) => `<option value="${size}" ${state.home.pageSize === size ? 'selected' : ''}>${size}</option>`).join('')}</select></label><button type="button" class="irv1-btn" data-ir-action="reload-home">Refresh</button></div></div><div class="irv1-history-list">${rows}</div><div class="irv1-pager irv1-history-pager"><button class="irv1-btn" data-ir-action="home-page" data-page="${state.home.page - 1}" ${state.home.page > 1 ? '' : 'disabled="disabled" aria-disabled="true"'}>Previous</button><span>Page ${state.home.page}</span><button class="irv1-btn" data-ir-action="home-page" data-page="${state.home.page + 1}" ${state.home.nextCursor ? '' : 'disabled="disabled" aria-disabled="true"'}>Next</button></div></section>
      ${zeroShiftsDialogHtml()}
    </div>`;
  }

  async function openImportsModalV1() {
    try {
      await loadHome();
    } catch (error) {
      state.contract = null;
      state.contractError = error.message || 'The approved import-review contract could not be verified.';
      state.home.error = error.message || 'Import review is unavailable.';
    }
    showScreen('Imports', renderHome, 'imports-v1');
  }

  async function handleStageFile(kind, file) {
    if (!file) return;
    await ensureContract(true);
    const allowed = /\.(xlsx?|csv)$/i.test(file.name || '');
    if (!allowed) throw new Error('Choose an .xls, .xlsx or .csv file.');
    let clientId = null;
    if (kind !== 'NHSP') {
      clientId = String(document.querySelector(`[data-ir-client="${kind}"]`)?.value || '').trim();
      if (!clientId) throw new Error(kind === 'HR_DAILY'
        ? 'Choose the Daily Client before uploading the file.'
        : 'Choose the Weekly Roster Client before uploading the file.');
      state.home.selectedClients[kind] = clientId;
    }
    state.home.busy = `Uploading ${file.name}…`;
    state.home.error = '';
    showScreen('Imports', renderHome, 'imports-v1');
    try {
      const uploaded = await global.uploadImportFileToR2(file);
      const route = kind === 'NHSP' ? '/api/nhsp/import'
        : kind === 'HR_WEEKLY' ? '/api/healthroster/autoprocess/import'
          : '/api/imports/hr-rota/parse';
      const body = kind === 'HR_DAILY'
        ? { file_r2_key: uploaded.fileKey, original_name: uploaded.filename, client_id: clientId, tz_assumption: 'Europe/London' }
        : { file_key: uploaded.fileKey, original_name: uploaded.filename, ...(clientId ? { client_id: clientId } : {}), tz_assumption: 'Europe/London' };
      state.home.busy = 'The file is uploaded. The server is parsing its rows and fixing the review scope…';
      showScreen('Imports', renderHome, 'imports-v1');
      const staged = await request(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const importId = staged?.import_id || staged?.id;
      if (!importId) throw new Error('The staged import did not return an import ID.');
      state.home.busy = '';
      await openCoverage(importId);
    } catch (error) {
      state.home.busy = '';
      state.home.error = error.message || 'The file could not be staged.';
      showScreen('Imports', renderHome, 'imports-v1');
    }
  }

  async function submitZeroShiftsDeclaration() {
    const dialog = state.home.zeroShifts;
    if (!dialog || dialog.busy) return;
    const clientId = String(document.querySelector('[data-ir-zero-client]')?.value || '').trim();
    const startDate = String(document.querySelector('[data-ir-zero-start]')?.value || '').trim();
    const endDate = String(document.querySelector('[data-ir-zero-end]')?.value || '').trim();
    Object.assign(dialog, { clientId, startDate, endDate, error: '' });
    if (!clientId) dialog.error = 'Choose a Daily Client.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) dialog.error = 'Choose both the start date and end date.';
    else {
      const startMs = Date.parse(`${startDate}T00:00:00Z`);
      const endMs = Date.parse(`${endDate}T00:00:00Z`);
      const inclusiveDays = Math.floor((endMs - startMs) / 86400000) + 1;
      if (!Number.isFinite(inclusiveDays) || inclusiveDays < 1) dialog.error = 'The end date must be on or after the start date.';
      else if (inclusiveDays > 366) dialog.error = 'Choose a period of no more than 366 days.';
    }
    if (dialog.error) {
      showScreen('Imports', renderHome, 'imports-v1');
      focusZeroShiftsDialog();
      return;
    }
    state.home.selectedClients.HR_DAILY = clientId;
    dialog.busy = true;
    showScreen('Imports', renderHome, 'imports-v1');
    try {
      const created = await request('/api/imports/daily-validation/zero-shifts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, coverage_start_date: startDate, coverage_end_date: endDate })
      });
      const importId = created?.import_id || created?.id;
      if (!importId) throw new Error('The Daily Validation review did not return an import ID.');
      state.home.zeroShifts = null;
      await openReview(importId);
    } catch (error) {
      dialog.busy = false;
      dialog.error = error.message || 'The Daily Validation review could not be created.';
      showScreen('Imports', renderHome, 'imports-v1');
      focusZeroShiftsDialog();
    }
  }

  async function fetchScope(importId, page = 1, size = 25) {
    return request(`/api/import-reviews/staged/${encodeURIComponent(importId)}/scope?candidate_page=${page}&candidate_page_size=${size}`);
  }

  function scopeIsResolved(item, idField) {
    return item?.resolved === true || !!String(item?.[idField] || '').trim();
  }

  function clientScopeRequest(item) {
    return {
      source_client_key: String(item?.source_client_key || '').trim(),
      source_display_label: item?.source_display_label == null ? null : String(item.source_display_label),
      client_id: item?.client_id || null
    };
  }

  function candidateScopeRequest(item) {
    return {
      source_candidate_key: String(item?.source_candidate_key || '').trim(),
      source_display_label: item?.source_display_label == null ? null : String(item.source_display_label),
      candidate_id: item?.candidate_id || null
    };
  }

  function coverageCopy(scope) {
    const authority = String(scope?.authority_mode || scope?.authority_summary?.mode || 'UNRESOLVED').toUpperCase();
    if (authority === 'VALIDATION_ONLY') return {
      authority,
      banner: '<strong>Validation-only import.</strong> The existing timesheet remains authoritative. This import can create validation, reference-review and email items, but it will not change timesheet hours or financial values.',
      completeAll: {
        title: 'Complete validation file – all candidates',
        body: 'Check every covered candidate. Missing or mismatched shifts can become validation, reference-review and email items. No timesheet hours or financial values will be changed.'
      },
      completeSelected: {
        title: 'Complete validation file – selected candidates',
        body: 'Apply the same validation checks only to the candidates you select. Everyone else is outside scope. No timesheet hours or financial values will be changed.'
      },
      partial: {
        title: 'Partial validation file',
        body: 'Validate only rows present in the file. Missing rows create no missing-shift, reference or email issue. No timesheet hours or financial values will be changed.'
      }
    };
    if (authority === 'AUTHORITATIVE') return {
      authority,
      banner: '<strong>Import-authoritative file.</strong> Your coverage choice controls which imported shifts can be added or amended and whether omitted shifts can be reversed or cancelled after review.',
      completeAll: {
        title: 'Complete authoritative file – all candidates',
        body: 'Treat this as the complete shift record for every covered candidate and date. Imported shifts may be added or amended in CloudTMS, and omitted import-authoritative shifts may be reversed or cancelled after review. Timesheet and financial outcomes may change, subject to protected-financial and Banking Pay controls.'
      },
      completeSelected: {
        title: 'Complete authoritative file – selected candidates',
        body: 'Apply authoritative processing only to the candidates you select. Their imported shifts may be added or amended in CloudTMS, and their omitted import-authoritative shifts may be reversed or cancelled after review. Other candidates are outside scope and will not be changed because they are absent. Timesheet and financial outcomes may change, subject to protected-financial and Banking Pay controls.'
      },
      partial: {
        title: 'Partial authoritative file',
        body: 'Process only shifts present in this file. Missing shifts will not be reversed or cancelled, and no omission-based reference or missing-shift issue will be created.'
      }
    };
    if (authority === 'MIXED') return {
      authority,
      banner: '<strong>Mixed-authority HealthRoster file.</strong> Import-authoritative contract rows may change shifts and financial outcomes. Timesheet-required contract rows remain validation-only and cannot replace timesheet hours or financial values.',
      completeAll: {
        title: 'Complete mixed file – all candidates',
        body: 'Check every covered candidate. Authoritative rows may be added or amended and omitted authoritative shifts may be reversed or cancelled after review. Timesheet-required rows create validation, reference-review and email items only.'
      },
      completeSelected: {
        title: 'Complete mixed file – selected candidates',
        body: 'Apply each contract’s server-resolved authority only to the candidates you select. Other candidates are outside scope and will not be changed because they are absent.'
      },
      partial: {
        title: 'Partial mixed file',
        body: 'Process or validate only rows present in the file according to each contract’s authority. Missing rows create no cancellation, reversal, reference or missing-shift email action.'
      }
    };
    return {
      authority,
      banner: '<strong>Authority will be confirmed by the server.</strong> Unresolved mappings must be fixed before anything can be applied. No browser choice can grant financial authority.',
      completeAll: { title: 'Complete file – all candidates', body: 'Treat omissions as meaningful for every covered candidate after the server resolves each row’s authority.' },
      completeSelected: { title: 'Complete file – selected candidates', body: 'Treat omissions as meaningful only for the selected candidates after the server resolves each row’s authority.' },
      partial: { title: 'Partial file', body: 'Process only rows present in the file. Missing rows create no cancellation, reference or missing-shift email action.' }
    };
  }

  function dailyInputFormatLabel(source) {
    const route = String(source?.source_route || source?.source_system || '').toUpperCase();
    if (route !== 'HR_DAILY' && route !== 'HEALTHROSTER_DAILY') return '';
    const summary = source?.parse_summary || source?.parse_summary_json || {};
    const parser = String(source?.parser_version || '').toUpperCase();
    const inputFormat = String(summary?.input_format || '').toUpperCase();
    if (summary?.declared_zero_shifts === true || inputFormat === 'ZERO_SHIFTS' || parser.includes('ZERO_SHIFTS') || parser.includes('ZERO_DECLARATION')) return 'No shifts declared';
    if (inputFormat === 'NHSP' || parser.includes('NHSP_ADAPTER')) return 'NHSP import';
    return 'HealthRoster import';
  }

  async function openCoverage(importId) {
    const scope = await fetchScope(importId, 1, 25);
    if (scope.review_already_created) return openReview(importId);
    state.coverage = {
      importId,
      scope,
      mode: null,
      selectedCandidates: new Set(),
      candidatePage: 1,
      candidatePageSize: 25,
      overlapChoice: null,
      selectedOverlapId: (scope.overlapping_unfinished_reviews || [])[0]?.import_id || null,
      createOperationKey: `import-review-create-ui-v4:${importId}:${scope.source_file_sha256}`,
      error: '',
      busy: false
    };
    showScreen('Confirm import coverage', renderCoverage, 'import-coverage-v1');
  }

  function renderCoverageCandidates() {
    const coverage = state.coverage;
    if (!coverage || !coverage.mode) return '';
    const selectable = coverage.mode === 'COMPLETE_SELECTED_CANDIDATES';
    const items = Array.isArray(coverage.scope.candidate_options) ? coverage.scope.candidate_options : [];
    const rows = items.map((item) => {
      const key = String(item.source_candidate_key || '');
      const checked = coverage.selectedCandidates.has(key);
      const resolved = scopeIsResolved(item, 'candidate_id');
      const status = resolved ? 'matched' : 'unmatched';
      const selector = selectable
        ? `<input type="checkbox" data-ir-coverage-candidate="${esc(key)}" ${checked ? 'checked' : ''}/>`
        : `<span class="irv1-candidate-marker" aria-hidden="true">${resolved ? '✓' : '!'}</span>`;
      const content = `${selector}<span>${esc(item.source_display_label || 'Unnamed candidate')}</span><small>${resolved ? `Matched to ${esc(item.resolved_display_name || 'candidate')}` : 'Mapping unresolved — review will be blocked until fixed'}</small>`;
      return selectable
        ? `<label class="irv1-candidate-row is-${status}" data-mapping-status="${status}">${content}</label>`
        : `<div class="irv1-candidate-row is-${status}" data-mapping-status="${status}">${content}</div>`;
    }).join('');
    const heading = selectable
      ? 'Select the candidates covered by this file'
      : coverage.mode === 'COMPLETE_ALL'
        ? 'Candidates covered by all shifts for this period'
        : 'Candidates found in this partial file';
    const help = selectable
      ? 'Selections remain selected while you move between pages.'
      : coverage.mode === 'COMPLETE_ALL'
        ? 'Every listed candidate is in scope. Mapping status is shown for review; this list is read-only.'
        : 'Mapping status is shown for review; this list is read-only and omitted shifts have no meaning.';
    const count = selectable ? `${coverage.selectedCandidates.size} selected` : `${Number(coverage.scope.candidate_total || items.length)} candidate${Number(coverage.scope.candidate_total || items.length) === 1 ? '' : 's'}`;
    return `<section><div class="irv1-history-head"><div><strong>${heading}</strong><div class="mini">${help}</div></div><span class="irv1-chip">${count}</span></div>
      <div class="irv1-candidate-picker">${rows || '<div class="irv1-empty">No candidates were found.</div>'}</div>
      <div class="irv1-pager"><button class="irv1-btn" data-ir-action="coverage-page" data-page="${coverage.candidatePage - 1}" ${coverage.scope.candidate_has_previous ? '' : 'disabled="disabled" aria-disabled="true"'}>Previous</button><span>Page ${coverage.candidatePage} of ${coverage.scope.candidate_total_pages || 1}</span><button class="irv1-btn" data-ir-action="coverage-page" data-page="${coverage.candidatePage + 1}" ${coverage.scope.candidate_has_next ? '' : 'disabled="disabled" aria-disabled="true"'}>Next</button></div>
    </section>`;
  }

  function renderCoverage() {
    const c = state.coverage;
    if (!c) return '<div class="irv1-empty">No staged import is open.</div>';
    const error = c.error ? `<div class="irv1-alert error">${esc(c.error)}</div>` : '';
    const clients = (c.scope.scope_clients || []).map((client) => {
      const resolved = scopeIsResolved(client, 'client_id');
      const status = resolved ? 'matched' : 'unmatched';
      const label = client.resolved_display_name || client.source_display_label || 'Unresolved client';
      return `<span class="irv1-chip irv1-scope-chip is-${status}" data-mapping-status="${status}" aria-label="${resolved ? 'Matched' : 'Unmatched'} client: ${esc(label)}"><span aria-hidden="true">${resolved ? '✓' : '!'}</span>${esc(label)}</span>`;
    }).join('');
    const overlaps = Array.isArray(c.scope.overlapping_unfinished_reviews) ? c.scope.overlapping_unfinished_reviews : [];
    const selectedOverlap = overlaps.find((item) => String(item.import_id) === String(c.selectedOverlapId || ''));
    const replaceAllowed = overlaps.length === 1 && selectedOverlap && String(selectedOverlap.status || '').toUpperCase() !== 'APPLYING';
    const overlapHtml = overlaps.length ? `<section class="irv1-overlap"><div class="irv1-alert"><strong>An unfinished review already covers this ${String(c.scope.source_route || '').toUpperCase() === 'NHSP' ? 'NHSP period' : 'client and some of these dates'}.</strong><br/>Continue the existing review, or replace it atomically with this new file. Two overlapping active reviews are not permitted.</div><div class="irv1-overlap-list">${overlaps.map((item) => `<label class="irv1-choice"><input type="radio" name="irOverlapTarget" value="${esc(item.import_id)}" ${c.selectedOverlapId === item.import_id ? 'checked' : ''}/><span><strong>${esc(item.filename || 'Earlier import')}</strong><span>${esc(formatDate(item.coverage_start_date))} to ${esc(formatDate(item.coverage_end_date))} · ${esc(displayReviewStatus(item.status, item.partial_application === true))}</span></span></label>`).join('')}</div><div class="irv1-overlap-actions"><button class="irv1-btn" data-ir-action="overlap-resume">Continue existing review</button><button class="irv1-btn danger" data-ir-action="overlap-replace" ${replaceAllowed ? '' : 'disabled="disabled" aria-disabled="true"'} ${c.overlapChoice === 'SUPERSEDE' ? 'aria-pressed="true"' : ''}>Replace existing review</button><button class="irv1-btn" data-ir-action="overlap-cancel">Cancel new import</button></div><div class="mini">Replacement is one database transaction: the new review is created only if the selected existing review can be marked superseded at the same time.${overlaps.length > 1 ? ' Resolve the existing overlapping reviews before replacing this file.' : String(selectedOverlap?.status || '').toUpperCase() === 'APPLYING' ? ' An applying review cannot be replaced; continue it and check its outcome.' : ''}</div></section>` : '';
    const copy = coverageCopy(c.scope);
    const coverageChosen = !!c.mode;
    const overlapChosen = overlaps.length === 0 || (c.overlapChoice === 'SUPERSEDE' && replaceAllowed);
    return `<div class="irv1-shell" id="irv1Coverage" data-coverage-mode="${esc(c.mode || '')}" data-authority-mode="${esc(copy.authority)}" data-overlap-choice="${esc(c.overlapChoice || '')}">
      <section class="irv1-intro"><div><h3>${esc(c.scope.filename || 'Staged import')}</h3><p>${esc(formatDate(c.scope.coverage_start_date))} to ${esc(formatDate(c.scope.coverage_end_date))} · ${Number(c.scope.staged_row_count || 0)} parsed rows. Coverage becomes immutable when the review is created.</p></div><span class="irv1-contract">${esc(dailyInputFormatLabel(c.scope) || c.scope.source_route || '')}</span></section>
      ${error}
      <div class="irv1-scope-summary">${clients || '<span class="irv1-chip">Client mapping will be reviewed</span>'}</div>
      ${overlapHtml}
      <div class="irv1-alert">${copy.banner}<br/>No option is preselected because this choice controls whether omitted shifts are meaningful.</div>
      <section class="irv1-coverage-options">
        <label class="irv1-choice"><input type="radio" name="irCoverage" value="COMPLETE_ALL" ${c.mode === 'COMPLETE_ALL' ? 'checked' : ''}/><span><strong>${esc(copy.completeAll.title)}</strong><span>${esc(copy.completeAll.body)}</span></span></label>
        <label class="irv1-choice"><input type="radio" name="irCoverage" value="COMPLETE_SELECTED_CANDIDATES" ${c.mode === 'COMPLETE_SELECTED_CANDIDATES' ? 'checked' : ''}/><span><strong>${esc(copy.completeSelected.title)}</strong><span>${esc(copy.completeSelected.body)}</span></span></label>
        <label class="irv1-choice"><input type="radio" name="irCoverage" value="PARTIAL" ${c.mode === 'PARTIAL' ? 'checked' : ''}/><span><strong>${esc(copy.partial.title)}</strong><span>${esc(copy.partial.body)}</span></span></label>
      </section>
      ${renderCoverageCandidates()}
      <div class="irv1-review-actions"><button class="irv1-btn" data-ir-action="coverage-cancel">Back</button><button class="irv1-btn primary" data-ir-action="coverage-create" ${c.busy || !coverageChosen || !overlapChosen ? 'disabled="disabled" aria-disabled="true"' : 'aria-disabled="false"'}>${c.busy ? 'Creating review…' : overlaps.length ? 'Replace and create review' : 'Create review'}</button></div>
    </div>`;
  }

  async function loadCoveragePage(page) {
    const c = state.coverage;
    if (!c || page < 1) return;
    c.scope = await fetchScope(c.importId, page, c.candidatePageSize);
    c.candidatePage = page;
    showScreen('Confirm import coverage', renderCoverage, 'import-coverage-v1');
  }

  async function createReviewFromCoverage() {
    const c = state.coverage;
    if (!c || c.busy) return;
    if (!c.mode) {
      c.error = 'Choose exactly what the file covers before creating the review.';
      showScreen('Confirm import coverage', renderCoverage, 'import-coverage-v1');
      return;
    }
    const overlaps = Array.isArray(c.scope.overlapping_unfinished_reviews) ? c.scope.overlapping_unfinished_reviews : [];
    if (overlaps.length && c.overlapChoice !== 'SUPERSEDE') {
      c.error = 'Continue the existing review, replace it, or cancel this new import.';
      showScreen('Confirm import coverage', renderCoverage, 'import-coverage-v1');
      return;
    }
    if (c.mode === 'COMPLETE_SELECTED_CANDIDATES' && c.selectedCandidates.size === 0) {
      c.error = 'Select at least one candidate, or choose a different coverage option.';
      showScreen('Confirm import coverage', renderCoverage, 'import-coverage-v1');
      return;
    }
    c.busy = true;
    c.error = '';
    showScreen('Confirm import coverage', renderCoverage, 'import-coverage-v1');
    let reviewCreated = false;
    try {
      const allScope = await fetchScope(c.importId, 1, 100);
      const candidates = [];
      let pageScope = allScope;
      for (;;) {
        for (const item of (pageScope.candidate_options || [])) {
          if (c.selectedCandidates.has(String(item.source_candidate_key || ''))) candidates.push(item);
        }
        if (!pageScope.candidate_has_next) break;
        pageScope = await fetchScope(c.importId, Number(pageScope.candidate_page || 1) + 1, 100);
      }
      const createPayload = {
          import_id: c.importId,
          coverage_mode: c.mode,
          coverage_start_date: allScope.coverage_start_date,
          coverage_end_date: allScope.coverage_end_date,
          scope_clients: (allScope.scope_clients || []).map(clientScopeRequest),
          scope_candidates: c.mode === 'COMPLETE_SELECTED_CANDIDATES' ? candidates.map(candidateScopeRequest) : [],
          expected_source_file_sha256: allScope.source_file_sha256,
          expected_parser_version: allScope.parser_version,
          operation_key: c.createOperationKey
      };
      if (c.overlapChoice === 'SUPERSEDE') {
        const freshOverlaps = Array.isArray(allScope.overlapping_unfinished_reviews) ? allScope.overlapping_unfinished_reviews : [];
        const targetId = String(c.selectedOverlapId || '');
        const target = freshOverlaps.find((item) => String(item.import_id) === targetId);
        if (freshOverlaps.length !== 1 || !target) throw new Error('The overlapping review changed. Continue it or reopen this file before replacing.');
        if (String(target.status || '').toUpperCase() === 'APPLYING') throw new Error('An applying review cannot be replaced. Continue it and check its outcome.');
        createPayload.supersede_import_id = targetId;
        createPayload.expected_supersede_state_version = Number(target.state_version);
      }
      await request('/api/import-reviews', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(createPayload)
      });
      reviewCreated = true;
      await openReview(c.importId, { skipAutoRecheck: true });
    } catch (error) {
      if (reviewCreated) {
        state.coverage = null;
        state.review = null;
        try { await loadHome({ resetPaging: true }); } catch {}
        state.home.error = `The review was created, but its next screen could not be loaded safely. Open it from the unfinished reviews list and choose Recheck. ${error.message || ''}`.trim();
        showScreen('Imports', renderHome, 'imports-v1');
        return;
      }
      c.busy = false;
      c.error = error.message || 'The review could not be created.';
      showScreen('Confirm import coverage', renderCoverage, 'import-coverage-v1');
    }
  }

  async function fetchReviewHeader(importId) {
    return request(`/api/import-reviews/${encodeURIComponent(importId)}?action_limit=1&event_limit=25`);
  }

  async function fetchActionPage(review) {
    const params = new URLSearchParams({
      page: String(review.page), page_size: String(review.pageSize), sort_by: review.sortBy,
      sort_direction: review.sortDirection, view: review.view
    });
    return request(`/api/import-reviews/${encodeURIComponent(review.importId)}/actions?${params.toString()}`);
  }

  async function openReview(importId, options = {}) {
    cancelDocumentPreparationPoll();
    const epoch = ++state.reviewEpoch;
    let header = await fetchReviewHeader(importId);
    if (epoch !== state.reviewEpoch) return;
    let autoRecheckWarning = '';
    const canRefresh = Array.isArray(header?.state?.editability?.allowed_commands)
      && header.state.editability.allowed_commands.includes('REFRESH');
    if (options.skipAutoRecheck !== true && canRefresh) {
      try {
        await request(`/api/import-reviews/${encodeURIComponent(importId)}/refresh`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
            expected_state_version: header.state.state_version,
            max_actions: 5000
          })
        });
        header = await fetchReviewHeader(importId);
      } catch (error) {
        // Reopening must remain recoverable if evidence refresh is temporarily
        // unavailable. The saved snapshot is shown explicitly as stale and the
        // normal Recheck control remains available; nothing is ever applied.
        header = await fetchReviewHeader(importId).catch(() => header);
        autoRecheckWarning = `Current records could not be rechecked automatically. This saved view may be out of date; choose Recheck before continuing. ${error?.message || ''}`.trim();
      }
    }
    const saved = header?.state?.ui_state || {};
    const prior = options.preserveLocal === true && state.review && state.review.importId === importId ? state.review : null;
    const savedView = ACTIVE_VIEWS.includes(String(saved.active_section || '').toUpperCase()) ? String(saved.active_section).toUpperCase() : 'PENDING';
    const pageSize = PAGE_SIZES.includes(Number(saved.page_size)) ? Number(saved.page_size) : 25;
    state.review = {
      importId,
      header,
      view: options.view || prior?.view || savedView,
      page: options.page || prior?.page || Number(saved.page_number || 1),
      pageSize: prior?.pageSize || pageSize,
      sortBy: prior?.sortBy || String(saved.sort_by || 'CANDIDATE').toUpperCase(),
      sortDirection: prior?.sortDirection || String(saved.sort_direction || 'ASC').toUpperCase(),
      pageData: null,
      scope: null,
      dirty: prior?.dirty || new Map(),
      // A newly opened review starts fully collapsed so the large recursive
      // expand control is immediately available.  Deliberate branch choices
      // are still retained while the same review remains open (paging/sort
      // changes use the existing review state via preserveLocal).
      expanded: prior?.expanded || new Set(),
      saveChain: prior?.saveChain || Promise.resolve(true),
      pendingSave: prior?.pendingSave || null,
      conflictBuffer: prior?.conflictBuffer || null,
      operationId: recoveryFor(importId)?.operation_id || null,
      requestHash: recoveryFor(importId)?.request_hash || null,
      confirmation: null,
      confirmAcknowledged: false,
      saveState: '', error: options.message || autoRecheckWarning || '', busy: false, screen: 'review', epoch
    };
    if (isSingleClientHealthRoster(state.review) && state.review.sortBy === 'CLIENT') state.review.sortBy = 'CANDIDATE';
    state.review.scope = await fetchScope(importId, 1, 25).catch(() => null);
    state.review.pageData = await fetchActionPage(state.review);
    if (epoch !== state.reviewEpoch) return;
    showScreen('Import review', renderReview, 'import-review-v1');
    scheduleDocumentPreparationPoll(state.review);
  }

  function reviewUiState(review) {
    const values = Array.from(review.expanded).slice(0, 500);
    return {
      expanded_candidates: values.filter((key) => key.startsWith('candidate:')),
      expanded_clients: values.filter((key) => key.startsWith('client:')),
      expanded_weeks: values.filter((key) => key.startsWith('week:')),
      expanded_shifts: values.filter((key) => key.startsWith('shift:')),
      active_section: review.view,
      scroll_anchor: null,
      show_no_action: review.view === 'NO_ACTION',
      show_automatic: review.view === 'NO_ACTION',
      page_number: review.page,
      page_size: review.pageSize,
      sort_by: review.sortBy,
      sort_direction: review.sortDirection
    };
  }

  async function performSelectionFlush(review, { quiet = false } = {}) {
    if (!review || state.review !== review) return false;
    if (review.dirty.size === 0 && !review.pendingSave) return true;
    clearTimeout(state.saveTimer);
    const pending = review.pendingSave || {
      requestId: makeUuid(),
      changes: Array.from(review.dirty, ([action_id, selected]) => ({ action_id, selected }))
    };
    review.pendingSave = pending;
    const changes = pending.changes;
    review.saveState = 'Saving selections…';
    if (!quiet) showScreen('Import review', renderReview, 'import-review-v1');
    try {
      const result = await request(`/api/import-reviews/${encodeURIComponent(review.importId)}/selections`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          expected_state_version: review.header.state.state_version,
          expected_preview_generation: review.header.state.preview_generation,
          expected_preview_fingerprint: review.header.state.preview_fingerprint,
          action_changes: changes,
          ui_state: reviewUiState(review),
          request_id: pending.requestId
        })
      });
      if (state.review !== review) return true;
      for (const change of changes) {
        const currentItem = (review.pageData?.items || []).find(
          (item) => String(item.action_id) === String(change.action_id)
        );
        if (currentItem) currentItem.selected = change.selected === true;
        if (review.dirty.get(change.action_id) === change.selected) review.dirty.delete(change.action_id);
      }
      review.pendingSave = null;
      review.conflictBuffer = null;
      const freshHeader = await fetchReviewHeader(review.importId).catch(() => null);
      if (state.review !== review) return true;
      if (freshHeader?.state) {
        review.header = freshHeader;
      } else {
        review.header.state.state_version = result.state_version;
        review.header.state.status = result.status;
        if (result.preview_generation != null) review.header.state.preview_generation = result.preview_generation;
        if (result.preview_fingerprint) review.header.state.preview_fingerprint = result.preview_fingerprint;
      }
      review.error = '';
      review.saveState = 'Selections saved';
      if (!quiet) showScreen('Import review', renderReview, 'import-review-v1');
      return true;
    } catch (error) {
      if (state.review !== review) return false;
      review.saveState = '';
      review.error = error.message || 'Selections were not saved.';
      if (error.status === 409) {
        review.pendingSave = null;
        review.conflictBuffer = changes;
        const freshHeader = await fetchReviewHeader(review.importId);
        if (state.review !== review) return false;
        review.header = freshHeader;
        review.pageData = await fetchActionPage(review);
        review.error = 'The review changed on the server. Your unsaved choices are still buffered. Check the refreshed rows, then save the buffered choices or discard them.';
      }
      showScreen('Import review', renderReview, 'import-review-v1');
      return false;
    }
  }

  function flushSelections(options = {}) {
    const review = state.review;
    if (!review) return Promise.resolve(true);
    review.saveChain = Promise.resolve(review.saveChain).catch(() => false).then(() => performSelectionFlush(review, options));
    return review.saveChain;
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { void flushSelections(); }, 650);
  }

  function reasonText(code) {
    const labels = {
      CANDIDATE_UNRESOLVED: 'This imported worker is not linked. Link an existing candidate here, or leave the review to create the missing candidate, then choose Recheck.',
      CLIENT_UNRESOLVED: 'This imported organisation is not linked. Link an existing client here, or leave the review to create the missing client, then choose Recheck.',
      CONTRACT_MISSING: 'No matching contract exists for this worker and date. Create or correct the contract outside this review, then return and recheck.',
      CONTRACT_OUT_OF_SCOPE: 'The mapped contract is not active or eligible for this worker, client, route and date. Correct the mapping or contract, then choose Recheck.',
      CONTRACT_AMBIGUOUS: 'More than one contract matches this worker and date. Correct the contracts outside this review, then return and recheck.',
      CONTRACT_RATES_INCOMPLETE: 'The selected contract is missing required pay or charge rates. Amend the contract outside this review, then choose Recheck; rates cannot be edited here.',
      TIMESHEET_OCCUPIED_BY_EXPENSES: 'Remove the expenses from this timesheet, save or recalculate it, then choose Recheck. Expenses must be invoiced on a separate timesheet for import-authoritative work.',
      GRADE_MAPPING_REQUIRED: 'The imported grade is not mapped. Choose one of the eligible existing records shown here; if none is suitable, correct the underlying records and choose Recheck.',
      TIMESHEET_NOT_FOUND: 'No eligible existing daily timesheet was found. Correct the timesheet records outside this review, then return and recheck.',
      WEEKLY_TIMESHEET_NOT_SUBMITTED: 'Request timesheet from candidate. The candidate has not submitted an eligible weekly timesheet for this client and week. Ask them to submit one containing this shift, then choose Recheck.',
      DAILY_TIMESHEET_NOT_SUBMITTED: 'Request timesheet from candidate. The candidate has not submitted an eligible Daily timesheet for this client and date. Ask them to submit one containing this shift, then choose Recheck.',
      WEEKLY_SHIFT_ABSENT_FROM_TIMESHEET: 'HealthRoster contains this shift, but the submitted Weekly candidate timesheet does not. Confirm “candidate did not work” only if that omission is correct. This validation exception does not alter hours, financials or HealthRoster evidence.',
      CANDIDATE_DID_NOT_WORK_CONFIRMED: 'Confirmed: the candidate did not work this HealthRoster shift. The remaining submitted Weekly shifts can pass validation; no hours or financial records were changed.',
      DAILY_SHIFT_ABSENT_FROM_TIMESHEET: 'Candidate timesheet states they did not work this shift. HealthRoster contains the shift, but the submitted candidate Daily timesheet does not. The HealthRoster record likely needs correcting or removing. This item is not included in the client query email.',
      TIMESHEET_AMBIGUOUS: 'Choose the existing timesheet that this HealthRoster row validates.',
      ACTUAL_HOURS_MISMATCH: 'Imported worked hours differ from the current CloudTMS timesheet. Review both sides before continuing.',
      START_END_MISMATCH: 'Imported start or end time differs from the current CloudTMS timesheet. Review both sides before continuing.',
      BREAK_MINUTES_MISMATCH: 'Imported break minutes differ from the current CloudTMS timesheet. Review both sides before continuing.',
      HEALTHROSTER_WEEKLY: 'The HealthRoster weekly evidence differs from the current timesheet. Review the day comparisons and select the required query.',
      MISSING_FROM_IMPORT: 'This current CloudTMS shift is absent from a complete import. Review the shift, email and reference choices separately.',
      MISSING_FROM_COMPLETE_IMPORT: 'This current shift is absent from the complete import and is proposed for cancellation.',
      REFERENCE_ON_SHIFT_MISSING_FROM_COMPLETE_IMPORT: 'This current shift is absent from the complete import and has a stored reference. Clearing it is a separate explicit choice.',
      REFERENCE_ON_SHIFT_MISSING_OR_MISMATCHED_IN_COMPLETE_IMPORT: 'The stored reference is missing or differs in the complete import. Clearing it is a separate explicit choice.',
      QUERY_RECIPIENT_EMAIL_MISSING_OR_INVALID: 'No valid query recipient is configured. Correct the client or contract query email outside this review, then choose Recheck.',
      BLOCKED_ACTIVE_PAY_DRAFT: 'An active Banking Pay draft protects this timesheet. Resolve the draft outside the import, then choose Recheck.',
      TIMESHEET_PRESENT_BUT_INVOICED: 'Timesheet present but invoiced. Remove it from the invoice (and unissue first if required), then choose Recheck before validating it.',
      TIMESHEET_EVIDENCE_INCOMPLETE: 'Timesheet evidence incomplete. The submitted timesheet must contain its hours and all required signatures or manual/QR evidence before a correction email can be sent.',
      TIMESHEET_EVIDENCE_PREPARING: 'Preparing timesheet evidence. CloudTMS has queued the current timesheet PDF for immediate asynchronous generation and will refresh this review automatically when it is ready.',
      IMPORT_REVIEW_CORRECTION_PAIR_PLACEMENT_INCOMPLETE: 'This correction pair is temporarily split while one member is being moved between invoices. Attach the outstanding member to a compatible invoice, then choose Recheck.',
      IMPORT_REVIEW_CORRECTION_GENERATION_PARTIALLY_INVOICED: 'The current correction generation is only partly invoiced. CloudTMS cannot safely amend it or create a further correction generation while one member remains uninvoiced. Resolve the invoice state through the existing invoice process, then choose Recheck.',
      IMPORT_REVIEW_ARCHIVED_GENERATION_ACTIVE_MEMBER_CONFLICT: 'An inactive Archived correction record has an active partner still outstanding. CloudTMS will not restore or reuse the Archived generation. Resolve the active record through the normal timesheet lifecycle, then choose Recheck.',
      IMPORT_REVIEW_ARCHIVED_INVOICE_STATE_CONFLICT: 'An Archived timesheet also has frozen invoice evidence, which is not a supported lifecycle state. Nothing was selected. Resolve the conflicting historical state, then choose Recheck.',
      IMPORT_REVIEW_INVOICE_ACTIVITY_IN_PROGRESS: 'An invoice, issue, unissue or credit operation is changing the financial position for this shift. Nothing was changed. Choose Recheck when that operation has finished.',
      IMPORT_REVIEW_INVOICE_COMPONENT_SCOPE_UNPROVABLE: 'CloudTMS found frozen invoice value but could not prove which part belongs to this exact imported shift. Nothing was selected. Resolve the historical source evidence, then choose Recheck.',
      IMPORT_REVIEW_EFFECTIVE_POSITION_NOT_STANDARD_REPRESENTABLE: 'The complete frozen invoice position is valid, but it cannot be represented by the standard NHSP or HealthRoster correction timesheet shape. Nothing was selected. Refer the source for financial lifecycle review.',
      IMPORT_REVIEW_PAID_MUTABLE_GENERATION_ROLLOVER_UNAVAILABLE: 'The active correction generation has been paid but is not fully invoiced. Payment is not invoice evidence, and the existing paid-timesheet rollover cannot safely transition this correction unit. Resolve the normal financial lifecycle, then choose Recheck.',
      IMPORT_REVIEW_ZERO_EFFECTIVE_POSITION_HAS_ACTIVE_CORRECTION_GENERATION: 'The frozen invoice position is zero but an active correction generation remains outstanding. CloudTMS cannot create a false zero reversal. Resolve the active generation, then choose Recheck.',
      IMPORT_REVIEW_EFFECTIVE_ZERO_NO_ACTIVE_SOURCE: 'The frozen invoice position is zero and there is no active ordinary source timesheet that can safely carry the authoritative shift. Nothing was selected.',
      IMPORT_REVIEW_SELECTED_ACTION_STALE: 'The source, invoice or correction state changed after this review was prepared. Nothing was changed. Recheck and approve the refreshed action.',
      IMPORT_REVIEW_RECONCILIATION_BALANCE_MISMATCH: 'The recalculated timesheets do not match the approved frozen reconciliation. Nothing was authorised. Recheck the affected source.',
      IMPORT_REVIEW_SOURCE_LIMIT_EXCEEDED: 'The historical evidence for this source exceeds the safe automatic-review limit. Nothing was selected. Refer the source for bounded financial-history review.',
      IMPORT_REVIEW_INVOICE_LINE_EVIDENCE_LIMIT_EXCEEDED: 'The historical evidence for this source exceeds the safe automatic-review limit. Nothing was selected. Refer the source for bounded financial-history review.',
      IMPORT_REVIEW_AUDIT_EVIDENCE_LIMIT_EXCEEDED: 'The historical evidence for this source exceeds the safe automatic-review limit. Nothing was selected. Refer the source for bounded financial-history review.',
      IMPORT_REVIEW_OPERATION_EVIDENCE_LIMIT_EXCEEDED: 'The historical evidence for this source exceeds the safe automatic-review limit. Nothing was selected. Refer the source for bounded financial-history review.'
    };
    return labels[String(code || '').toUpperCase()] || 'This item needs review. Check the imported and current evidence, resolve the underlying record if necessary, then choose Recheck.';
  }

  function excludedReasonText(code) {
    const labels = {
      PREVIOUS_OR_LEGACY_HISTORY_REQUIRES_EXPLICIT_REMINDER: 'Previously recorded issue: deferred by default. Tick it only when you deliberately want to send a reminder.',
      REFERENCE_INVALIDATION_REQUIRES_EXPLICIT_SELECTION: 'Reference clearing is deferred by default and happens only when explicitly selected.',
      QUERY_RECIPIENT_EMAIL_MISSING_OR_INVALID: 'Deferred because the client or contract has no valid query recipient email.',
      BLOCKED_ACTIVE_PAY_DRAFT: 'Deferred because an active Banking Pay draft protects this timesheet.',
      TIMESHEET_PRESENT_BUT_INVOICED: 'This validation is unavailable while the timesheet is attached to an invoice.',
      TIMESHEET_EVIDENCE_INCOMPLETE: 'The correction email cannot be selected until the timesheet evidence is complete.',
      TIMESHEET_EVIDENCE_PREPARING: 'The correction email will become available automatically when the queued timesheet PDF is ready.'
    };
    return labels[String(code || '').toUpperCase()] || '';
  }

  function timeText(value) {
    const raw = String(value || '');
    const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const timestamp = hasExplicitZone ? Date.parse(raw) : NaN;
    if (Number.isFinite(timestamp)) {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).format(new Date(timestamp));
    }
    const match = raw.match(/(\d{2}:\d{2})/);
    return match ? match[1] : raw || '—';
  }

  function workedHoursForDisplay(evidence) {
    if (!evidence || typeof evidence !== 'object') return null;
    const suppliedHours = evidence.worked_hours == null ? null : Number(evidence.worked_hours);
    if (Number.isFinite(suppliedHours)) return suppliedHours;
    const suppliedMinutes = evidence.worked_minutes == null ? null : Number(evidence.worked_minutes);
    if (Number.isFinite(suppliedMinutes)) return Math.round(suppliedMinutes / 60 * 100) / 100;

    const startRaw = String(evidence.start || '');
    const endRaw = String(evidence.end || '');
    const startTimestamp = Date.parse(startRaw);
    const endTimestamp = Date.parse(endRaw);
    let grossMinutes = Number.isFinite(startTimestamp) && Number.isFinite(endTimestamp)
      ? Math.round((endTimestamp - startTimestamp) / 60000)
      : null;
    if (!Number.isFinite(grossMinutes) || grossMinutes <= 0) {
      const startMatch = startRaw.match(/(\d{2}):(\d{2})/);
      const endMatch = endRaw.match(/(\d{2}):(\d{2})/);
      if (!startMatch || !endMatch) return null;
      const startMinutes = Number(startMatch[1]) * 60 + Number(startMatch[2]);
      const endMinutes = Number(endMatch[1]) * 60 + Number(endMatch[2]);
      grossMinutes = endMinutes - startMinutes;
      if (grossMinutes <= 0) grossMinutes += 24 * 60;
    }
    const breakMinutes = evidence.break_minutes == null ? 0 : Number(evidence.break_minutes);
    if (!Number.isFinite(breakMinutes)) return null;
    const workedMinutes = grossMinutes - breakMinutes;
    if (workedMinutes < 0 || workedMinutes > 24 * 60) return null;
    return Math.round(workedMinutes / 60 * 100) / 100;
  }

  function selectedFor(item, review) {
    return review.dirty.has(item.action_id) ? review.dirty.get(item.action_id) : item.selected === true;
  }

  function reviewCan(review, command) {
    const commands = review?.header?.state?.editability?.allowed_commands;
    return Array.isArray(commands) && commands.includes(command);
  }

  function dailySelect(item, review) {
    const options = Array.isArray(item.daily_timesheet_options) ? item.daily_timesheet_options : [];
    const current = item.timesheet_id || '';
    const disabled = reviewCan(review, 'RESOLVE_DAILY_TIMESHEET') ? '' : 'disabled="disabled" aria-disabled="true"';
    return `<div class="irv1-resolution"><select class="input" ${disabled} data-ir-daily-resolution="${esc(item.action_id)}" data-hr-row-id="${esc(item.hr_row_id || '')}" data-evidence="${esc(item.evidence_fingerprint || '')}"><option value="">${current ? 'Saved timesheet choice' : 'Choose an existing timesheet'}</option>${options.map((option) => {
      const label = option.display_label || `${formatDate(option.worked_start_iso)} · ${timeText(option.worked_start_iso)}–${timeText(option.worked_end_iso)} · ${Math.round(Number(option.worked_minutes || 0) / 60 * 100) / 100} hours${option.role ? ` · ${option.role}` : ''}${option.band ? ` · ${option.band}` : ''}${option.site ? ` · ${option.site}` : ''}${option.reference_number ? ` · ref ${option.reference_number}` : ''}`;
      return `<option value="${esc(option.timesheet_id)}" ${String(option.timesheet_id) === String(current) ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('')}</select>${current ? `<button type="button" class="irv1-btn" ${disabled} data-ir-action="daily-clear" data-action-id="${esc(item.action_id)}">Clear saved choice</button>` : ''}</div>`;
  }

  function evidenceHtml(evidence) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return '<span class="mini">—</span>';
    const hours = workedHoursForDisplay(evidence);
    return `<dl class="irv1-evidence-list">
      <div><dt>Date</dt><dd>${esc(formatDate(evidence.work_date))}</dd></div>
      <div><dt>Time</dt><dd>${esc(timeText(evidence.start))}–${esc(timeText(evidence.end))}</dd></div>
      <div><dt>Break</dt><dd>${esc(evidence.break_minutes == null ? '—' : `${evidence.break_minutes} min`)}</dd></div>
      <div><dt>Hours</dt><dd>${esc(Number.isFinite(hours) ? hours : '—')}</dd></div>
      <div><dt>Role / band</dt><dd>${esc([evidence.role, evidence.band].filter(Boolean).join(' · ') || '—')}</dd></div>
      <div><dt>Reference</dt><dd>${esc(evidence.reference || '—')}</dd></div>
    </dl>`;
  }

  function differenceHtml(item) {
    const codes = Array.isArray(item.difference_codes) ? item.difference_codes : [];
    const labels = {
      NEW_SHIFT: 'Imported shift is not currently in CloudTMS', TIMESHEET_SELECTION_REQUIRED: 'Timesheet choice required',
      START_TIME: 'Start differs', END_TIME: 'End differs', START_END_MISMATCH: 'Start/end differs',
      BREAK_MINUTES: 'Break differs', BREAK_MINUTES_MISMATCH: 'Break differs', WORKED_HOURS: 'Hours differ',
      ACTUAL_HOURS_MISMATCH: 'Hours differ', MISSING_FROM_IMPORT: 'Missing from complete import',
      MISSING_FROM_COMPLETE_IMPORT: 'Missing from complete import', UNMATCHED: 'Timesheet shift is missing from the import',
      HR_ONLY: 'Imported shift is missing from the timesheet', AMBIGUOUS: 'Shift pairing is ambiguous',
      MISMATCH: 'Start, end or break differs', REFERENCE: 'Reference differs',
      CONFIRMED_EXCEPTION: 'Candidate did not work this HealthRoster shift'
    };
    return codes.length ? `<ul class="irv1-differences">${codes.map((code) => `<li>${esc(labels[String(code).toUpperCase()] || 'Evidence differs')}</li>`).join('')}</ul>` : '<span class="mini">No difference</span>';
  }

  function evidenceCell(item, field) {
    const rows = Array.isArray(item.evidence_rows) ? item.evidence_rows : [];
    if (!rows.length) return evidenceHtml(item[field]);
    return `<div class="irv1-evidence-rows">${rows.map((row, index) => `<section><span class="irv1-evidence-row-label">Shift ${index + 1}</span>${evidenceHtml(row?.[field])}</section>`).join('')}</div>`;
  }

  function differenceCell(item) {
    const rows = Array.isArray(item.evidence_rows) ? item.evidence_rows : [];
    if (!rows.length) return differenceHtml(item);
    return `<div class="irv1-evidence-rows">${rows.map((row, index) => `<section><span class="irv1-evidence-row-label">Shift ${index + 1}</span>${differenceHtml({ difference_codes: row?.difference_codes || [] })}</section>`).join('')}</div>`;
  }

  function gradeResolutionControl(item, editable) {
    const options = Array.isArray(item.resolution_options) ? item.resolution_options : [];
    const usable = options.filter((option) => option && option.selectable !== false);
    if (!editable) return '';
    if (!options.length) return '<span class="irv1-advisory">No eligible existing option is available. Correct the underlying records, then choose Recheck.</span>';
    const disabledReason = (option) => option.disabled_reason_code === 'CONTRACT_NOT_ELIGIBLE' ? 'contract is not currently eligible'
      : option.disabled_reason_code === 'CONTRACT_RATES_INCOMPLETE' ? 'rates are incomplete for authoritative processing'
        : option.selectable === false ? 'not eligible for this row and date' : '';
    return `<div class="irv1-resolution"><select class="input" data-ir-grade-option="${esc(item.action_id)}">
      <option value="">Choose an existing option</option>${options.map((option) => `<option value="${esc(option.option_id || '')}" ${option.selectable === false ? 'disabled="disabled"' : ''}>${esc(option.display_label || [option.role, option.band, option.site].filter(Boolean).join(' · ') || 'Existing option')}${disabledReason(option) ? ` · unavailable: ${esc(disabledReason(option))}` : ''}</option>`).join('')}
      </select><button type="button" class="irv1-btn" data-ir-action="resolve-mapping" data-resolution="GRADE" data-action-id="${esc(item.action_id)}" ${usable.length ? '' : 'disabled="disabled" aria-disabled="true"'}>Save mapping</button></div>`;
  }

  function shiftRow(item, review) {
    const summary = item.summary || {};
    const reasonCode = String(summary.reason_code || '').toUpperCase();
    const reason = summary.reason_code ? `<span class="irv1-reason">${esc(reasonText(summary.reason_code))}</span>` : '';
    const excluded = excludedReasonText(item.default_excluded_reason || summary.default_excluded_reason);
    const inlineResolution = ['CANDIDATE_UNRESOLVED','CLIENT_UNRESOLVED','GRADE_MAPPING_REQUIRED',
      'WEEKLY_SHIFT_ABSENT_FROM_TIMESHEET','CANDIDATE_DID_NOT_WORK_CONFIRMED'].includes(reasonCode);
    const advice = item.action_kind === 'ADVISORY' && !inlineResolution ? '<span class="irv1-advisory">This is an advisory. Use Save & close, fix it in the relevant record, then reopen and choose Recheck.</span>' : '';
    const editable = reviewCan(review, 'SAVE_SELECTIONS');
    const checkbox = item.selectable
      ? `<input type="checkbox" data-ir-select="${esc(item.action_id)}" ${selectedFor(item, review) ? 'checked' : ''} ${editable ? '' : 'disabled="disabled" aria-disabled="true"'} aria-label="Include ${esc(item.action_kind)}"/>`
      : item.action_kind === 'DAILY_TIMESHEET_RESOLUTION' ? dailySelect(item, review) : '';
    const resolution = reasonCode === 'CANDIDATE_UNRESOLVED' && editable
      ? `<button type="button" class="irv1-btn" data-ir-action="resolve-mapping" data-resolution="CANDIDATE" data-action-id="${esc(item.action_id)}">Link candidate</button>`
      : reasonCode === 'CLIENT_UNRESOLVED' && editable
        ? `<button type="button" class="irv1-btn" data-ir-action="resolve-mapping" data-resolution="CLIENT" data-action-id="${esc(item.action_id)}">Link client</button>`
        : reasonCode === 'GRADE_MAPPING_REQUIRED' ? gradeResolutionControl(item, editable)
          : reasonCode === 'WEEKLY_SHIFT_ABSENT_FROM_TIMESHEET' && editable
            ? `<button type="button" class="irv1-btn primary" data-ir-action="weekly-candidate-not-worked" data-action-id="${esc(item.action_id)}" data-confirmed="true">Confirm candidate did not work this shift</button>`
            : reasonCode === 'CANDIDATE_DID_NOT_WORK_CONFIRMED' && editable
              ? `<button type="button" class="irv1-btn" data-ir-action="weekly-candidate-not-worked" data-action-id="${esc(item.action_id)}" data-confirmed="false">Undo confirmation</button>`
              : '';
    const deliveryStatus = ['EMAIL_ISSUE','EMAIL_REMINDER'].includes(item.action_kind)
      || Number(summary.sent_count || 0) > 0
      ? `<span class="irv1-advisory">${Number(summary.sent_count || 0)>0
          ? `Previously sent ${Number(summary.sent_count)} time${Number(summary.sent_count)===1?'':'s'} · ${esc(String(summary.delivery_history_status || 'SENT_VERIFIED').replaceAll('_',' ').toLowerCase())}`
          : 'Not previously sent. A reminder is never selected automatically.'}</span>`
      : '';
    return `<tr data-action-id="${esc(item.action_id)}"><td>${checkbox}</td><td>${evidenceCell(item, 'imported_evidence')}</td><td>${evidenceCell(item, 'current_evidence')}</td><td>${differenceCell(item)}</td><td><strong>${esc(item.outcome_label || 'Review item')}</strong>${reason}${deliveryStatus}${excluded ? `<span class="irv1-advisory">${esc(excluded)}</span>` : ''}${advice}${resolution}</td></tr>`;
  }

  function reviewRoute(review) {
    return String(review?.header?.import?.source_route || review?.header?.import?.source_system || '').toUpperCase();
  }

  function isSingleClientHealthRoster(review) {
    const route = reviewRoute(review);
    return route.includes('HR') || route.includes('HEALTHROSTER') ? !route.includes('NHSP') : false;
  }

  function itemDimension(item, type) {
    const summary = item.summary || {};
    if (type === 'candidate') return {
      id: String(item.candidate_branch_key || item.candidate_id || `source:${String(item.candidate_name || summary.candidate_name || item.source_identity || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '')}:${item.client_id || summary.client_name || ''}`),
      label: item.candidate_name || summary.candidate_name || 'Unknown candidate',
      badges: Array.isArray(item.branch_badges) ? item.branch_badges : []
    };
    if (type === 'client') return { id: String(item.client_id || summary.client_name || 'unknown'), label: item.client_name || summary.client_name || 'Unknown client' };
    if (type === 'week') {
      const value = item.week_ending_date || summary.week_ending_date || item.work_date || summary.work_date || 'unknown';
      return {
        id: String(value),
        label: value === 'unknown' ? 'Unknown week' : `Week ending ${formatDate(value)}`,
        badges: Array.isArray(item.week_validation_badges) ? item.week_validation_badges : []
      };
    }
    if (type === 'date') {
      const value = item.work_date || summary.work_date || 'unknown';
      return { id: String(value), label: value === 'unknown' ? 'Unknown date' : formatDate(value) };
    }
    if (type === 'action') return { id: String(item.action_kind || 'UNKNOWN'), label: item.outcome_label || 'Review item' };
    return { id: String(item.action_category || 'UNKNOWN'), label: String(item.action_category || 'Unknown status').toLowerCase().replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()) };
  }

  function branchBadgesHtml(badges) {
    const unique = new Map();
    for (const badge of (badges || [])) if (badge?.code && !unique.has(badge.code)) unique.set(badge.code, badge);
    return unique.size ? `<span class="irv1-branch-badges">${Array.from(unique.values()).map((badge) => {
      const tone = String(badge.tone || 'ISSUE').toLowerCase();
      return `<span class="irv1-branch-badge is-${esc(tone)}" title="${esc(badge.label || badge.code)}">${esc(badge.label || badge.code)}${Number(badge.count || 0) > 1 ? ` ×${Number(badge.count)}` : ''}</span>`;
    }).join('')}</span>` : '';
  }

  function groupItems(items, review) {
    const singleClient = isSingleClientHealthRoster(review);
    const primary = String(review.sortBy || 'CANDIDATE').toUpperCase();
    const dimensions = primary === 'CLIENT' && !singleClient ? ['client', 'candidate', 'week']
      : primary === 'WEEK_ENDING' ? ['week', 'candidate', ...(singleClient ? [] : ['client'])]
        : primary === 'WORK_DATE' ? ['date', 'candidate', ...(singleClient ? [] : ['client']), 'week']
          : primary === 'ACTION' ? ['action', 'candidate', ...(singleClient ? [] : ['client']), 'week']
            : primary === 'STATUS' ? ['status', 'candidate', ...(singleClient ? [] : ['client']), 'week']
              : ['candidate', ...(singleClient ? [] : ['client']), 'week'];
    const root = { children: new Map(), items: [] };
    for (const item of items) {
      let node = root;
      const path = [];
      for (const type of dimensions) {
        const dim = itemDimension(item, type);
        path.push(`${type}=${dim.id}`);
        const keyPrefix = type === 'candidate' ? 'candidate' : type === 'client' ? 'client' : type === 'week' ? 'week' : 'shift';
        // Expansion state is presentation-only.  Persist an opaque token rather
        // than candidate/client/action identifiers, otherwise a harmless UI
        // preference can look like financial or recipient authority to the
        // database validator.
        const key = `${keyPrefix}:u-${opaqueUiToken(path.join('|'))}`;
        if (!node.children.has(key)) node.children.set(key, { key, type, label: dim.label, badges: dim.badges || [], children: new Map(), items: [], count: 0 });
        node = node.children.get(key);
        if (type === 'candidate' && dim.badges?.length) node.badges = dim.badges;
        node.count += 1;
      }
      node.items.push(item);
    }

    const table = (rows) => `<table class="irv1-shifts"><thead><tr><th>Use</th><th>Imported evidence</th><th>Current CloudTMS evidence</th><th>Difference</th><th>Proposed outcome</th></tr></thead><tbody>${rows.map((item) => shiftRow(item, review)).join('')}</tbody></table>`;
    const renderNode = (node, depth) => {
      const isPrimary = depth === 0;
      const open = review.expanded.has(node.key);
      const children = Array.from(node.children.values()).map((child) => renderNode(child, depth + 1)).join('');
      // Detailed issue badges stay on their affected shift.  A single
      // server-derived badge on the week node makes it clear when individually
      // passed rows do not yet mean the complete Weekly timesheet is validated.
      const badges = node.type === 'week' ? branchBadgesHtml(node.badges) : '';
      const bigToggle = isPrimary ? `<button type="button" class="irv1-branch-toggle" data-ir-action="toggle-branch" data-expand="${open ? 'false' : 'true'}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(node.label)} and all sections">${open ? '−' : '+'}</button>` : '';
      return `<details class="irv1-group" data-ir-expand-key="${esc(node.key)}" ${open ? 'open' : ''}><summary>${bigToggle}<span class="irv1-group-label">${esc(node.label)} · ${node.count} item${node.count === 1 ? '' : 's'}</span>${badges}</summary>${children}${node.items.length ? table(node.items) : ''}</details>`;
    };
    return Array.from(root.children.values()).map((node) => renderNode(node, 0)).join('');
  }

  function renderEmailGroups(items, review) {
    const groups = new Map();
    for (const item of items) {
      const recipient = String(item.recipient_email || 'Recipient unavailable').toLowerCase();
      const recipientKey = String(item.recipient_group_key || recipient);
      if (!groups.has(recipientKey)) groups.set(recipientKey, { recipient, clients: new Map() });
      const clientKey = String(item.client_id || item.summary?.recipient_scope_key || 'client-unavailable');
      const clientLabel = item.client_name || item.summary?.client_name || 'Client';
      const group = groups.get(recipientKey);
      if (!group.clients.has(clientKey)) group.clients.set(clientKey, { label: clientLabel, candidates: new Map() });
      const client = group.clients.get(clientKey);
      const candidateKey = String(item.candidate_id || item.candidate_branch_key || item.candidate_name || 'candidate-unavailable');
      const candidateLabel = item.candidate_name || item.summary?.candidate_name || 'Unknown candidate';
      if (!client.candidates.has(candidateKey)) client.candidates.set(candidateKey, { label: candidateLabel, contracts: new Map() });
      const candidate = client.candidates.get(candidateKey);
      const contractKey = String(item.contract_id || item.summary?.recipient_scope_key || 'client-default');
      const contractLabel = item.contract_label || 'Client default';
      if (!candidate.contracts.has(contractKey)) candidate.contracts.set(contractKey, { label: contractLabel, rows: [] });
      candidate.contracts.get(contractKey).rows.push(item);
    }
    const table = (rows) => `<table class="irv1-shifts"><thead><tr><th>Use</th><th>Imported evidence</th><th>Current CloudTMS evidence</th><th>Difference</th><th>Proposed outcome</th></tr></thead><tbody>${rows.map((item) => shiftRow(item, review)).join('')}</tbody></table>`;
    return Array.from(groups, ([recipientKey, group]) => {
      const routeToken = opaqueUiToken(recipientKey);
      return `<section class="irv1-email-group"><h4>One email to ${esc(group.recipient)}</h4><div class="mini">Selected rows are combined into one message and shown as Client → Candidate → Contract → Shift.</div>${Array.from(group.clients, ([clientKey, client]) => {
        const expandClient = `client:u-${routeToken}-${opaqueUiToken(clientKey)}`;
        const openClient = review.expanded.has(expandClient);
        const clientCount = Array.from(client.candidates.values()).reduce((total, candidate) => total + Array.from(candidate.contracts.values()).reduce((n, contract) => n + contract.rows.length, 0), 0);
        return `<details class="irv1-group" data-ir-expand-key="${esc(expandClient)}" ${openClient ? 'open' : ''}><summary><button type="button" class="irv1-branch-toggle" data-ir-action="toggle-branch" data-expand="${openClient ? 'false' : 'true'}" aria-label="${openClient ? 'Collapse' : 'Expand'} ${esc(client.label)} and all sections">${openClient ? '−' : '+'}</button><span class="irv1-group-label">${esc(client.label)} · ${clientCount} shift${clientCount===1?'':'s'}</span></summary>${Array.from(client.candidates, ([candidateKey, candidate]) => {
          const expandCandidate = `candidate:u-${routeToken}-${opaqueUiToken(`${clientKey}|${candidateKey}`)}`;
          const candidateRows = Array.from(candidate.contracts.values()).flatMap((contract) => contract.rows);
          const summaryRow = candidateRows[0]?.summary || {};
          const totalShifts = Number(summaryRow.validation_total_shift_count || candidateRows.reduce((n, row) => n + Math.max(1, Array.isArray(row.evidence_rows) ? row.evidence_rows.length : 1), 0));
          const differenceCount = Number(summaryRow.validation_difference_count || candidateRows.reduce((n, row) => n + Math.max(1, Array.isArray(row.evidence_rows) ? row.evidence_rows.length : 1), 0));
          const weekEnding = candidateRows[0]?.week_ending_date || summaryRow.week_ending_date;
          const workDate = candidateRows[0]?.work_date || summaryRow.work_date;
          const periodLabel = reviewRoute(review).includes('DAILY')
            ? `Date ${formatDate(workDate)}`
            : `Week ending ${formatDate(weekEnding)}`;
          const validationLabel = totalShifts > 0
            ? `${candidate.label} · ${periodLabel} — validation failed: ${differenceCount} of ${totalShifts} shift${totalShifts===1?'':'s'} differ${differenceCount===1?'s':''}`
            : candidate.label;
          return `<details class="irv1-group" data-ir-expand-key="${esc(expandCandidate)}" ${review.expanded.has(expandCandidate) ? 'open' : ''}><summary>${esc(validationLabel)}</summary>${Array.from(candidate.contracts, ([contractKey, contract]) => {
            const expandContract = `week:u-${routeToken}-${opaqueUiToken(`${clientKey}|${candidateKey}|${contractKey}`)}`;
            return `<details class="irv1-group" data-ir-expand-key="${esc(expandContract)}" ${review.expanded.has(expandContract) ? 'open' : ''}><summary>${esc(contract.label)} · ${contract.rows.length} shift${contract.rows.length===1?'':'s'}</summary>${table(contract.rows)}</details>`;
          }).join('')}</details>`;
        }).join('')}</details>`;
      }).join('')}</section>`;
    }).join('');
  }

  function sortButtons(review) {
    const entries = [['CANDIDATE', 'Candidate'], ...(isSingleClientHealthRoster(review) ? [] : [['CLIENT', 'Client']]), ['WEEK_ENDING', 'Week ending'], ['WORK_DATE', 'Date'], ['ACTION', 'Action'], ['STATUS', 'Status']];
    return entries.map(([key, label]) => `<button type="button" class="irv1-sort ${review.sortBy === key ? 'is-active' : ''}" data-ir-action="sort" data-sort="${key}">${esc(label)}${review.sortBy === key ? (review.sortDirection === 'ASC' ? ' ↑' : ' ↓') : ''}</button>`).join('');
  }

  function reviewCards(review) {
    const counts = review.pageData?.view_counts || {};
    const cards = [
      ['PENDING', 'Pending action', 'Resolve blockers or choose required evidence'],
      ['READY', 'Ready', 'Changes and selections ready to apply'],
      ...(reviewRoute(review) === 'NHSP' ? [] : [['EMAIL', 'Emails', 'Client query rows selected for grouped emails']]),
      ['NO_ACTION', 'Passed checks', 'Validated rows and confirmed non-financial exceptions']
    ];
    return cards.map(([view, label, help]) => `<button type="button" class="irv1-card-filter ${review.view === view ? 'is-active' : ''}" data-ir-action="review-view" data-view="${view}"><strong>${Number(counts[view] || 0)}</strong><span>${esc(label)}</span><small>${esc(help)}</small></button>`).join('');
  }

  async function selectedSetFingerprint(ids) {
    const canonical = [...new Set(Array.isArray(ids) ? ids.map(String) : [])].sort().join('|');
    const digest = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  const CONFIRMATION_SECTIONS = Object.freeze({
    STANDARD: Object.freeze({ view: 'CONFIRM_STANDARD', title: 'Standard imported shifts' }),
    NON_STANDARD: Object.freeze({ view: 'CONFIRM_NON_STANDARD', title: 'Changed and cancelled shifts' }),
    VALIDATION: Object.freeze({ view: 'CONFIRM_VALIDATION', title: 'Timesheet validation outcomes' }),
    EMAIL: Object.freeze({ view: 'CONFIRM_EMAIL', title: 'Outgoing client query email' }),
    REFERENCE: Object.freeze({ view: 'CONFIRM_REFERENCE', title: 'Explicit reference decisions' })
  });

  function confirmationSectionCount(counts, key) {
    const fields = { STANDARD: 'standard', NON_STANDARD: 'non_standard', VALIDATION: 'validation', EMAIL: 'email', REFERENCE: 'reference' };
    return Number(counts?.[fields[key]] || 0);
  }

  async function fetchConfirmationSection(review, key, page = 1, pageSize = 25) {
    const definition = CONFIRMATION_SECTIONS[key];
    if (!definition) throw new Error('The requested confirmation section is not supported.');
    const params = new URLSearchParams({
      page: String(page), page_size: String(pageSize), sort_by: 'CANDIDATE', sort_direction: 'ASC', view: definition.view
    });
    return request(`/api/import-reviews/${encodeURIComponent(review.importId)}/actions?${params.toString()}`);
  }

  async function loadApplyConfirmation() {
    const review = state.review;
    if (!review) return false;
    review.busy = true;
    review.error = '';
    showScreen('Import review', renderReview, 'import-review-v1');
    try {
      const start = await fetchReviewHeader(review.importId);
      if (!reviewCan({ header: start }, 'APPLY')) {
        throw new Error('No selected candidate/client unit is currently ready. Recheck the review or resolve its remaining blockers.');
      }
      const selectedIds = Array.isArray(start.state.apply_contract?.selected_action_ids)
        ? start.state.apply_contract.selected_action_ids.map(String) : [];
      if (!selectedIds.length || selectedIds.length > 5000) throw new Error('The selected action set is empty or exceeds the bounded 5,000-action application limit.');
      const first = await fetchConfirmationSection(review, 'STANDARD', 1, 25);
      const counts = first?.confirmation_counts || {};
      if (Number(counts.selected_total || 0) !== selectedIds.length) {
        throw new Error('The server confirmation count does not match the selected application batch. Return to the review and choose Recheck.');
      }
      const sectionData = { STANDARD: first };
      const isNhsp = reviewRoute(review) === 'NHSP';
      const remainingKeys = Object.keys(CONFIRMATION_SECTIONS).filter((key) => key !== 'STANDARD'
        && confirmationSectionCount(counts, key) > 0 && !(key === 'EMAIL' && isNhsp));
      const remaining = await Promise.all(remainingKeys.map((key) => fetchConfirmationSection(review, key, 1, 25)));
      remainingKeys.forEach((key, index) => { sectionData[key] = remaining[index]; });

      const end = await fetchReviewHeader(review.importId);
      const startRequestHash = String(start.state.apply_contract?.request_hash || '');
      const endRequestHash = String(end.state.apply_contract?.request_hash || '');
      const startPreview = String(start.state.preview_fingerprint || '');
      const endPreview = String(end.state.preview_fingerprint || '');
      const endIds = Array.isArray(end.state.apply_contract?.selected_action_ids) ? end.state.apply_contract.selected_action_ids.map(String) : [];
      const [startSelectionFingerprint, endSelectionFingerprint] = await Promise.all([
        selectedSetFingerprint(selectedIds), selectedSetFingerprint(endIds)
      ]);
      if (startRequestHash !== endRequestHash || startPreview !== endPreview
        || Number(start.state.state_version) !== Number(end.state.state_version)
        || startSelectionFingerprint !== endSelectionFingerprint) {
        throw new Error('The review changed while final confirmation was loading. Check the refreshed review before applying.');
      }
      review.header = end;
      review.confirmation = {
        stateVersion: Number(end.state.state_version), requestHash: endRequestHash,
        previewFingerprint: endPreview, selectedSetFingerprint: endSelectionFingerprint,
        selectedIds, counts, sections: sectionData, openSections: new Set(['NON_STANDARD'])
      };
      review.confirmAcknowledged = false;
      review.busy = false;
      review.screen = 'confirm';
      showScreen('Import review', renderReview, 'import-review-v1');
      return true;
    } catch (error) {
      review.busy = false;
      review.confirmation = null;
      review.screen = 'review';
      review.error = error.message || 'The final confirmation could not be loaded safely.';
      showScreen('Import review', renderReview, 'import-review-v1');
      return false;
    }
  }

  async function loadConfirmationSection(key, page, pageSize) {
    const review = state.review;
    if (!review?.confirmation || !CONFIRMATION_SECTIONS[key]) return;
    review.busy = true;
    review.error = '';
    showScreen('Import review', renderReview, 'import-review-v1');
    try {
      const result = await fetchConfirmationSection(review, key, page, pageSize);
      if (!(await confirmationStillCurrent(review))) {
        review.confirmation = null;
        review.screen = 'review';
        review.error = 'The review changed while the confirmation page was loading. Check the refreshed review before applying.';
      } else {
        review.confirmation.sections[key] = result;
      }
    } catch (error) {
      review.error = error.message || 'The confirmation page could not be loaded.';
    } finally {
      review.busy = false;
      showScreen('Import review', renderReview, 'import-review-v1');
    }
  }

  async function confirmationStillCurrent(review) {
    const confirmation = review?.confirmation;
    if (!review || !confirmation) return false;
    const current = await fetchReviewHeader(review.importId);
    const ids = Array.isArray(current.state.apply_contract?.selected_action_ids) ? current.state.apply_contract.selected_action_ids.map(String) : [];
    const fingerprint = await selectedSetFingerprint(ids);
    const matches = reviewCan({ header: current }, 'APPLY')
      && Number(current.state.state_version) === confirmation.stateVersion
      && String(current.state.preview_fingerprint || '') === confirmation.previewFingerprint
      && String(current.state.apply_contract?.request_hash || '') === confirmation.requestHash
      && fingerprint === confirmation.selectedSetFingerprint;
    if (matches) review.header = current;
    return matches;
  }

  function confirmationEvidenceSummary(evidence, { includeDate = false } = {}) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return '<span class="mini">—</span>';
    const hours = workedHoursForDisplay(evidence);
    return `<div class="irv1-confirm-compact">${includeDate ? `<span><b>Date</b>${esc(formatDate(evidence.work_date))}</span>` : ''}<span><b>Shift</b>${esc(timeText(evidence.start))}–${esc(timeText(evidence.end))}</span><span><b>Break</b>${esc(evidence.break_minutes == null ? '—' : `${evidence.break_minutes} min`)}</span><span><b>Hours</b>${esc(Number.isFinite(hours) ? hours : '—')}</span><span><b>Role / band</b>${esc([evidence.role, evidence.band].filter(Boolean).join(' · ') || '—')}</span><span><b>Reference</b>${esc(evidence.reference || '—')}</span></div>`;
  }

  function confirmationActionLabel(item) {
    const protectedShift = item.protection?.paid === true || item.protection?.invoice_locked === true;
    if (item.action_kind === 'APPLY_AMENDMENT') {
      const route = String(item.amendment_route || item.summary_json?.amendment_route || '').trim().toUpperCase();
      if (route === 'AMEND_PAID_UNINVOICED_SOURCE') return 'TMS will use the existing paid-but-uninvoiced rollover, update the same shift and replace its import evidence. Payment is not being treated as invoice evidence.';
      if (route === 'AMEND_EXISTING_REPLACEMENT') return 'TMS will repair the active uninvoiced correction generation. Missing or incorrect active members will be normalised under the same correction ID. No additional correction generation will be created.';
      if (route === 'CREATE_REVERSAL_REPLACEMENT') return 'TMS will use the complete signed frozen invoice history for this exact shift, create one standard reversal and one standard corrected-hours timesheet, and leave all historical issued invoices unchanged.';
      if (route === 'AMEND_SOURCE') return 'TMS will update the existing shift and replace its current import evidence. No reversal or corrected-hours timesheet will be created.';
      return item.outcome_label || (protectedShift ? 'TMS will reverse and create replacement' : 'TMS will amend shift');
    }
    if (item.action_kind === 'APPLY_CANCELLATION') return protectedShift ? 'TMS will reverse shift' : 'TMS will cancel shift';
    return item.outcome_label || 'TMS will process this item';
  }

  function confirmationTable(items, key) {
    if (key === 'STANDARD') return `<div class="irv1-confirm-table-wrap"><table class="irv1-confirm-table"><thead><tr><th>Date</th><th>Shift</th><th>Break</th><th>Hours</th><th>Role / band</th><th>Reference</th><th>Action</th></tr></thead><tbody>${items.map((item) => { const evidence = item.imported_evidence || {}; const hours = workedHoursForDisplay(evidence); return `<tr><td class="nowrap">${esc(formatDate(evidence.work_date || item.work_date))}</td><td class="nowrap">${esc(timeText(evidence.start))}–${esc(timeText(evidence.end))}</td><td>${esc(evidence.break_minutes == null ? '—' : `${evidence.break_minutes} min`)}</td><td>${esc(Number.isFinite(hours) ? hours : '—')}</td><td>${esc([evidence.role, evidence.band].filter(Boolean).join(' · ') || '—')}</td><td>${esc(evidence.reference || '—')}</td><td><span class="irv1-confirm-action is-ready">${esc(confirmationActionLabel(item))}</span></td></tr>`; }).join('')}</tbody></table></div>`;
    const headers = key === 'NON_STANDARD'
      ? ['Date', 'Before apply (current)', 'After apply (imported)', 'Difference', 'Action']
      : key === 'VALIDATION'
        ? ['Date', 'Imported evidence', 'Current CloudTMS evidence', 'Difference', 'Outcome']
        : ['Date', 'Imported evidence', 'Current CloudTMS evidence', 'Reason', 'Decision'];
    return `<div class="irv1-confirm-table-wrap"><table class="irv1-confirm-table is-comparison"><thead><tr>${headers.map((value) => `<th>${esc(value)}</th>`).join('')}</tr></thead><tbody>${items.map((item) => `<tr><td class="nowrap">${esc(formatDate(item.imported_evidence?.work_date || item.current_evidence?.work_date || item.work_date))}</td><td>${confirmationEvidenceSummary(key === 'NON_STANDARD' ? item.current_evidence : item.imported_evidence)}</td><td>${confirmationEvidenceSummary(key === 'NON_STANDARD' ? item.imported_evidence : item.current_evidence)}</td><td>${differenceCell(item)}</td><td><span class="irv1-confirm-action ${key === 'NON_STANDARD' ? 'is-ready' : ''}">${esc(confirmationActionLabel(item))}</span></td></tr>`).join('')}</tbody></table></div>`;
  }

  function confirmationGroupedRows(items, review, key) {
    const clients = new Map();
    const singleClient = isSingleClientHealthRoster(review);
    for (const item of items) {
      const clientKey = singleClient ? 'single-client' : String(item.client_id || item.client_name || 'unknown-client');
      if (!clients.has(clientKey)) clients.set(clientKey, { label: item.client_name || 'Client', candidates: new Map(), total: Number(item.client_section_total_count || 0) });
      const client = clients.get(clientKey);
      const candidateKey = String(item.candidate_branch_key || item.candidate_id || item.candidate_name || 'unknown-candidate');
      if (!client.candidates.has(candidateKey)) client.candidates.set(candidateKey, { label: item.candidate_name || 'Candidate', rows: [], total: Number(item.candidate_section_total_count || 0) });
      client.candidates.get(candidateKey).rows.push(item);
    }
    const candidatesHtml = (client) => Array.from(client.candidates.values(), (candidate) => `<details class="irv1-confirm-candidate"><summary><span>${esc(candidate.label)}</span><small>${candidate.rows.length} on this page${candidate.total > candidate.rows.length ? ` · ${candidate.total} total` : ''}</small></summary>${confirmationTable(candidate.rows, key)}</details>`).join('');
    return Array.from(clients.values(), (client) => singleClient
      ? candidatesHtml(client)
      : `<section class="irv1-confirm-client"><h5>${esc(client.label)}<small>${client.total || Array.from(client.candidates.values()).reduce((sum, candidate) => sum + candidate.rows.length, 0)} item(s)</small></h5>${candidatesHtml(client)}</section>`).join('');
  }

  function confirmationPager(key, data) {
    const page = Number(data?.page_number || 1);
    const pageSize = Number(data?.page_size || 25);
    const totalPages = Math.max(1, Number(data?.total_pages || 0));
    return `<div class="irv1-confirm-pager"><label>Rows per page <select class="input" data-ir-confirm-page-size="${esc(key)}">${PAGE_SIZES.map((size) => `<option value="${size}" ${size === pageSize ? 'selected' : ''}>${size}</option>`).join('')}</select></label><div><button type="button" class="irv1-btn" data-ir-action="confirm-page" data-section="${esc(key)}" data-page="${page - 1}" ${data?.has_previous ? '' : 'disabled="disabled"'}>Previous</button><span>Page ${page} of ${totalPages}</span><button type="button" class="irv1-btn" data-ir-action="confirm-page" data-section="${esc(key)}" data-page="${page + 1}" ${data?.has_next ? '' : 'disabled="disabled"'}>Next</button></div></div>`;
  }

  function confirmationSectionHtml(review, key, { open = false } = {}) {
    const confirmation = review.confirmation;
    const data = confirmation?.sections?.[key];
    const count = confirmationSectionCount(confirmation?.counts, key);
    if (!count || !data) return '';
    const items = Array.isArray(data.items) ? data.items : [];
    const body = key === 'EMAIL' ? renderEmailGroups(items, { ...review, header: { ...review.header, state: { ...review.header.state, editability: { allowed_commands: [] } } } }) : confirmationGroupedRows(items, review, key);
    const isOpen = open || confirmation.openSections?.has(key);
    return `<details class="irv1-confirm-section" data-ir-confirm-section="${esc(key)}" ${isOpen ? 'open' : ''}><summary><span>${esc(CONFIRMATION_SECTIONS[key].title)}</span><strong>${count}</strong></summary><div class="irv1-confirm-section-body">${body || '<div class="irv1-empty">No items on this page.</div>'}${confirmationPager(key, data)}</div></details>`;
  }

  function renderApplyConfirmation(review) {
    const header = review.header;
    const apply = header.state.apply_contract || {};
    const summary = header.confirmation_summary || {};
    const confirmation = review.confirmation;
    const selectedOutcomeCount = Number(summary.selected_total ?? (Array.isArray(apply.selected_action_ids) ? apply.selected_action_ids.length : 0));
    const selectedChangeCount = Number(summary.selected_change_count || 0);
    const selectedEmailCount = Number(summary.selected_email_count || 0);
    const invalidationCount = Number(summary.selected_reference_invalidation_count ?? (Array.isArray(apply.reference_invalidation_action_ids) ? apply.reference_invalidation_action_ids.length : 0));
    const selectedActionCount = selectedChangeCount + selectedEmailCount + invalidationCount;
    const evidence = header.evidence || {};
    const authority = review.scope?.authority_summary || {};
    const isNhsp = reviewRoute(review) === 'NHSP';
    const authorityMode = String(review.scope?.authority_mode || authority.mode || '').toUpperCase();
    const counts = confirmation?.counts || {};
    const selectedAuthoritativeCount = Number(counts.standard || 0) + Number(counts.non_standard || 0);
    const selectedValidationCount = Number(counts.validation || 0) + Number(counts.email || 0) + Number(counts.reference || 0);
    const selectedBatchAuthorityResolved = selectedAuthoritativeCount > 0 || selectedValidationCount > 0;
    const authorityText = authorityMode === 'AUTHORITATIVE'
      ? 'Current policy: authoritative. Selected imported shifts may be added, amended or cancelled by TMS after final approval.'
      : authorityMode === 'VALIDATION_ONLY'
        ? 'Current policy: validation only. No timesheet hours or financial values will be changed from this import.'
        : authorityMode === 'MIXED'
          ? 'Current policy: mixed by contract. Each row is independently restricted to its server-approved authority.'
          : selectedAuthoritativeCount > 0
            ? 'Selected batch: server-approved import-authoritative action. Only the confirmed items below can change CloudTMS; unresolved rows remain pending.'
            : selectedValidationCount > 0
              ? 'Selected batch: server-approved validation outcomes. No timesheet hours or financial values will be changed by these validation-only items.'
              : 'Current policy cannot yet be confirmed. Resolve the outstanding mappings or settings and choose Recheck.';
    const settingsAsOf = authority.settings_as_of_date ? formatDate(authority.settings_as_of_date) : 'today';
    const complete = !!confirmation && Number(counts.selected_total || 0) === selectedOutcomeCount;
    const canApply = complete && reviewCan(review, 'APPLY') && Number(summary.batch_blocking_count || 0) === 0;
    const confirmLabel = selectedOutcomeCount > selectedActionCount
      ? `Confirm ${selectedActionCount} action${selectedActionCount === 1 ? '' : 's'} and record ${selectedOutcomeCount} outcome${selectedOutcomeCount === 1 ? '' : 's'}`
      : `Confirm and apply ${selectedActionCount} action${selectedActionCount === 1 ? '' : 's'}`;
    return `<div class="irv1-shell"><section class="irv1-intro"><div><h3>Final confirmation</h3><p>The server will revalidate the saved review before committing. The browser is not supplying financial values, validation rows or email recipients.</p></div><span class="irv1-contract">${esc(displayReviewStatus(header.state.status, header.state.partial_application === true))}</span></section>
      ${review.error ? `<div class="irv1-alert error">${esc(review.error)}</div>` : ''}
      <div class="irv1-alert ${(authorityMode === 'UNRESOLVED' || authorityMode === 'OUT_OF_SCOPE') && !selectedBatchAuthorityResolved ? 'error' : ''}"><strong>${esc(authorityText)}</strong><div class="mini">Settings checked as of ${esc(settingsAsOf)}; contract date coverage is still checked against each shift date.</div></div>
      <div class="irv1-settings-grid"><div class="irv1-settings-card"><strong>Source and coverage</strong><p>${esc(header.import.filename || 'Import')}<br/>${esc(String(header.import.coverage_mode || '').replaceAll('_', ' '))}<br/>${esc(formatDate(header.import.coverage_start_date))} to ${esc(formatDate(header.import.coverage_end_date))}</p><div class="mini">Verified source ${esc(String(evidence.source_file_sha256 || '').slice(0, 12))} · parser ${esc(evidence.parser_version || '—')} · preview generation ${esc(evidence.preview_generation || '—')}</div></div><div class="irv1-settings-card"><strong>This application batch</strong><p>${selectedActionCount} action(s)<br/>${selectedOutcomeCount} reviewed outcome(s)</p><div class="mini">Unchanged outcomes are recorded for audit without changing CloudTMS data. Only fully resolved candidate/client units in this confirmation can be processed.</div></div>${isNhsp ? '' : `<div class="irv1-settings-card"><strong>Client query email</strong><p>${Number(summary.selected_email_issue_count || 0)} new issue(s)<br/>${Number(summary.selected_email_reminder_count || 0)} explicit reminder(s)</p><div class="mini">The server groups every selected item into one email per normalised recipient address.</div></div>`}<div class="irv1-settings-card"><strong>Remaining review</strong><p>${Number(summary.blocking_count || 0)} unresolved blocker(s)<br/>${Number(summary.deferred_count || 0)} deferred action(s)</p><div class="mini">Pending and deferred work remains saved after this batch.</div></div></div>
      <div class="irv1-confirm-summary"><span><strong>${Number(counts.standard || 0)}</strong> standard shift(s)</span><span><strong>${Number(counts.amendment || 0)}</strong> amendment(s)</span><span><strong>${Number(counts.reversal_replacement || 0)}</strong> reversal + replacement</span><span><strong>${Number(counts.cancellation || 0) + Number(counts.reversal_only || 0)}</strong> cancellation / reversal</span>${Number(counts.validation || 0) ? `<span><strong>${Number(counts.validation || 0)}</strong> validation outcome(s)</span>` : ''}</div>
      ${confirmationSectionHtml(review, 'STANDARD')}
      ${confirmationSectionHtml(review, 'NON_STANDARD', { open: true })}
      ${confirmationSectionHtml(review, 'VALIDATION')}
      ${isNhsp ? '' : confirmationSectionHtml(review, 'EMAIL')}
      ${confirmationSectionHtml(review, 'REFERENCE')}
      <div class="mini">${Number(summary.deferred_count || 0)} action(s) are deferred and remain available when this review is reopened. Financial values remain server-owned and are recalculated only by the approved database functions.</div>
      ${invalidationCount === 0 ? '<div class="irv1-alert">No reference numbers will be cleared. A missing selection is explicit and clears nothing.</div>' : `<div class="irv1-alert">${invalidationCount} reference invalidation action(s) are explicitly selected. Only eligible, unlocked references can be cleared.</div>`}
      <label class="irv1-choice"><input type="checkbox" data-ir-confirm-ack ${review.confirmAcknowledged ? 'checked' : ''}/><span><strong>I have checked this ready application batch</strong><span>${isNhsp ? 'Only the selected, server-approved CloudTMS actions shown above will be committed. Pending and deferred work will remain open.' : 'Selected query emails are queued only after the source commit. Pending and deferred work remains open, and only explicitly selected eligible references can be cleared.'}</span></span></label>
      <div class="irv1-review-actions"><button class="irv1-btn" data-ir-action="apply-back">Back to review</button><button class="irv1-btn primary" data-ir-action="apply-confirm" ${review.busy || !review.confirmAcknowledged || !canApply ? 'disabled="disabled" aria-disabled="true"' : 'aria-disabled="false"'}>${review.busy ? 'Applying safely…' : esc(confirmLabel)}</button></div>
    </div>`;
  }

  function renderReview() {
    const review = state.review;
    if (!review) return '<div class="irv1-empty">No import review is open.</div>';
    if (review.screen === 'confirm') return renderApplyConfirmation(review);
    const header = review.header;
    const page = review.pageData || { items: [], view_counts: {} };
    const items = Array.isArray(page.items) ? page.items : [];
    const editability = header.state.editability || {};
    const readOnly = editability.read_only === true;
    const followUp = String(header.state.follow_up_status || 'NOT_REQUIRED').toUpperCase();
    const displayStatus = displayReviewStatus(header.state.status, header.state.partial_application === true);
    const body = items.length
      ? (review.view === 'EMAIL' ? renderEmailGroups(items, review) : groupItems(items, review))
      : `<div class="irv1-empty">There are no ${esc(review.view.toLowerCase().replaceAll('_', ' '))} items on this page.</div>`;
    const statusActions = reviewCan(review, 'VIEW_APPLY_STATUS') || recoveryFor(review.importId)
      ? `<button class="irv1-btn" data-ir-action="status">Refresh apply status</button>${reviewCan(review, 'RETRY_FOLLOW_UP') ? '<button class="irv1-btn" data-ir-action="retry">Retry failed follow-up</button>' : ''}`
      : '';
    const evidence = header.evidence || {};
    const conflictActions = review.conflictBuffer ? '<div class="irv1-alert"><strong>Your local choices are buffered.</strong><div class="irv1-review-actions"><button class="irv1-btn" data-ir-action="conflict-save">Save buffered choices against refreshed rows</button><button class="irv1-btn" data-ir-action="conflict-discard">Discard buffered choices</button></div></div>' : '';
    const inputFormatLabel = dailyInputFormatLabel({ ...header.import, parser_version: evidence.parser_version || header.import.parser_version });
    return `<div class="irv1-shell" id="irv1Review">
      <section class="irv1-review-head"><div><h3 class="irv1-title">${esc(header.import.filename || 'Import review')}</h3><div class="irv1-review-meta"><span class="irv1-chip">${esc(inputFormatLabel || header.import.source_route || header.import.source_system || '')}</span><span class="irv1-chip">${esc(formatDate(header.import.coverage_start_date))} – ${esc(formatDate(header.import.coverage_end_date))}</span><span class="irv1-status">${esc(displayStatus)}</span><span class="irv1-chip">Follow-up: ${esc(followUp)}</span></div><div class="mini irv1-evidence">Server evidence: source ${esc(String(evidence.source_file_sha256 || '').slice(0, 12) || 'unavailable')} · parser ${esc(evidence.parser_version || 'unavailable')} · preview ${esc(evidence.preview_generation || '—')}</div></div><div class="irv1-review-actions"><button class="irv1-btn" data-ir-action="home">${readOnly ? 'Close' : 'Save & close'}</button>${reviewCan(review, 'REFRESH') ? '<button class="irv1-btn" data-ir-action="refresh">Recheck</button>' : ''}${reviewCan(review, 'ABANDON') ? '<button class="irv1-btn danger" data-ir-action="abandon">Abandon import</button>' : ''}${statusActions}<button class="irv1-btn primary" data-ir-action="apply-preview" ${reviewCan(review, 'APPLY') ? 'aria-disabled="false" title="Review and apply the currently selected ready candidate/client units"' : 'disabled="disabled" aria-disabled="true" title="No selected candidate/client unit is currently ready"'}>Review and apply</button></div></section>
      ${review.error ? `<div class="irv1-alert error">${esc(review.error)}</div>` : ''}
      ${header.state.follow_up_error_message ? `<div class="irv1-alert error">${esc(header.state.follow_up_error_message)}</div>` : ''}
      ${header.state.partial_application === true ? `<div class="irv1-alert"><strong>${Number(header.state.applied_outcome_count || 0)} action(s) have already been completed.</strong><div class="mini">Completed work is locked. Resolve or reselect the remaining pending and deferred actions, then use Review and apply again.</div></div>` : ''}
      ${conflictActions}
      <section class="irv1-cards">${reviewCards(review)}</section>
      <section class="irv1-toolbar"><div class="irv1-toolbar-group"><span class="mini">Sort:</span>${sortButtons(review)}</div><div class="irv1-toolbar-group"><label>Rows per page <select class="input" data-ir-page-size>${PAGE_SIZES.map((size) => `<option value="${size}" ${review.pageSize === size ? 'selected' : ''}>${size}</option>`).join('')}</select></label><span class="irv1-save-state ${review.saveState === 'Selections saved' ? 'is-ok' : ''}">${esc(review.saveState)}</span></div></section>
      <section class="irv1-groups">${body}</section>
      <div class="irv1-pager"><button class="irv1-btn" data-ir-action="review-page" data-page="${review.page - 1}" ${page.has_previous ? '' : 'disabled="disabled" aria-disabled="true"'}>Previous</button><span>Page ${page.page_number || review.page} of ${page.total_pages || 1}<br/>${Number(page.total_items || 0)} item(s)</span><button class="irv1-btn" data-ir-action="review-page" data-page="${review.page + 1}" ${page.has_next ? '' : 'disabled="disabled" aria-disabled="true"'}>Next</button></div>
    </div>`;
  }

  async function changeReviewPage(patch) {
    const review = state.review;
    if (!review) return;
    if (!(await flushSelections({ quiet: true }))) return;
    Object.assign(review, patch);
    review.error = '';
    review.pageData = await fetchActionPage(review);
    showScreen('Import review', renderReview, 'import-review-v1');
    scheduleDocumentPreparationPoll(review);
  }

  async function saveDailyResolution(select, explicitTimesheetId) {
    const review = state.review;
    if (!review || !reviewCan(review, 'RESOLVE_DAILY_TIMESHEET')) return;
    if (!(await flushSelections({ quiet: true }))) return;
    const actionId = select.getAttribute('data-ir-daily-resolution');
    const item = (review.pageData?.items || []).find((entry) => entry.action_id === actionId);
    if (!item) return;
    try {
      await request(`/api/import-reviews/${encodeURIComponent(review.importId)}/daily-timesheet-resolution`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          hr_row_id: select.getAttribute('data-hr-row-id'),
          timesheet_id: explicitTimesheetId !== undefined ? explicitTimesheetId : (select.value || null),
          expected_state_version: review.header.state.state_version,
          expected_preview_generation: review.header.state.preview_generation,
          expected_evidence_fingerprint: select.getAttribute('data-evidence'),
          request_id: makeUuid()
        })
      });
      await openReview(review.importId, { skipAutoRecheck: true });
    } catch (error) {
      review.error = error.message || 'The existing timesheet selection was not saved.';
      showScreen('Import review', renderReview, 'import-review-v1');
    }
  }

  async function saveWeeklyCandidateNotWorked(actionId, confirmed) {
    const review = state.review;
    if (!review || !reviewCan(review, 'SAVE_SELECTIONS')) return;
    if (!(await flushSelections({ quiet: true }))) return;
    const item = (review.pageData?.items || []).find((entry) => String(entry.action_id) === String(actionId));
    if (!item || item.summary?.resolution_kind !== 'WEEKLY_CANDIDATE_DID_NOT_WORK') return;
    const accepted = await importUiConfirm({
      title: confirmed ? 'Confirm candidate did not work this shift?' : 'Undo confirmed exception?',
      messageHtml: confirmed
        ? `<div style="font-size:14px;font-weight:700;margin-bottom:6px;">${esc(item.candidate_name || item.summary?.candidate_name || 'Candidate')} · ${esc(formatDate(item.work_date || item.summary?.work_date))}</div><div class="mini">Use this only when the candidate submitted a Weekly timesheet and deliberately omitted this HealthRoster shift because they did not work it. CloudTMS will validate the remaining submitted shifts. No timesheet hours, TSFIN, invoice, payment or financial record will be changed.</div>`
        : '<div style="font-size:14px;font-weight:700;margin-bottom:6px;">Return this shift to Resolve blockers?</div><div class="mini">The Weekly validation will fail again until the shift is corrected or explicitly confirmed.</div>',
      confirmLabel: confirmed ? 'Confirm candidate did not work' : 'Undo confirmation',
      cancelLabel: 'Cancel',
      danger: false
    });
    if (!accepted) return;
    try {
      await request(`/api/import-reviews/${encodeURIComponent(review.importId)}/weekly-candidate-not-worked`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          action_id: item.action_id,
          confirmed,
          expected_state_version: review.header.state.state_version,
          expected_preview_generation: review.header.state.preview_generation,
          expected_evidence_fingerprint: item.evidence_fingerprint,
          request_id: makeUuid()
        })
      });
      await openReview(review.importId, { page: 1, skipAutoRecheck: true });
    } catch (error) {
      review.error = error.message || 'The Weekly validation exception was not saved. Choose Recheck and try again.';
      showScreen('Import review', renderReview, 'import-review-v1');
    }
  }

  async function refreshReview() {
    const review = state.review;
    if (!review) return;
    if (!(await flushSelections({ quiet: true }))) return;
    try {
      await request(`/api/import-reviews/${encodeURIComponent(review.importId)}/refresh`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expected_state_version: review.header.state.state_version, max_actions: 5000 })
      });
      await openReview(review.importId, { page: 1, skipAutoRecheck: true });
    } catch (error) {
      review.error = error.message || 'The review could not be rechecked.';
      showScreen('Import review', renderReview, 'import-review-v1');
    }
  }

  async function abandonReview() {
    const review = state.review;
    if (!review) return;
    const confirmed = await importUiConfirm({
      title: 'Abandon import review?',
      messageHtml: '<div style="font-size:14px;font-weight:700;margin-bottom:6px;">Abandon this import review?</div><div class="mini">The staged import will remain in history, but this review cannot be resumed. You can reimport the source file to start again.</div>',
      confirmLabel: 'Abandon import',
      cancelLabel: 'Keep reviewing',
      danger: true
    });
    if (!confirmed) return;
    await request(`/api/import-reviews/${encodeURIComponent(review.importId)}/abandon`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        expected_state_version: review.header.state.state_version,
        reason: 'Operator abandoned the import review to start again.', confirmed: true
      })
    });
    await openImportsModalV1();
  }

  async function applyReview() {
    const review = state.review;
    if (!review || review.busy || !review.confirmAcknowledged || !reviewCan(review, 'APPLY')) return;
    review.busy = true;
    review.error = '';
    showScreen('Import review', renderReview, 'import-review-v1');
    try {
      if (!(await confirmationStillCurrent(review))) {
        review.busy = false;
        review.confirmation = null;
        review.confirmAcknowledged = false;
        review.screen = 'review';
        review.error = 'The review changed after final confirmation. Check the refreshed review before applying.';
        showScreen('Import review', renderReview, 'import-review-v1');
        return;
      }
      const operationId = makeUuid();
      review.operationId = operationId;
      review.requestHash = review.header.state.apply_contract.request_hash;
      storeRecovery(review.importId, { operation_id: operationId, request_hash: review.requestHash, started_at_utc: new Date().toISOString() });
      const result = await request(`/api/import-reviews/${encodeURIComponent(review.importId)}/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          operation_id: operationId,
          expected_state_version: review.header.state.state_version,
          expected_request_hash: review.header.state.apply_contract.request_hash
        }),
        timeoutMs: 40000
      });
      if (result?.operation?.outcome || result?.apply?.ok) { storeRecovery(review.importId, null); await openReview(review.importId); }
      else await pollApplyStatus(review.importId, operationId, review.requestHash);
    } catch (error) {
      review.busy = false;
      if (review.operationId && review.requestHash && shouldRecoverApplyOutcome(error)) {
        await pollApplyStatus(review.importId, review.operationId, review.requestHash);
      } else {
        review.error = error.message || 'The import was not applied.';
        showScreen('Import review', renderReview, 'import-review-v1');
      }
    }
  }

  async function pollApplyStatus(importId, operationId, requestHash) {
    if (!operationId || !requestHash) return openReview(importId);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const status = await request(`/api/import-reviews/${encodeURIComponent(importId)}/apply-status?operation_id=${encodeURIComponent(operationId)}&request_hash=${encodeURIComponent(requestHash)}`);
      const outcome = String(status?.outcome || '').toUpperCase();
      if (outcome.startsWith('COMMITTED_')) {
        const followUpStatus = String(status?.follow_up_status || '').toUpperCase();
        if (outcome === 'COMMITTED_WITH_FOLLOW_UP_PENDING' && followUpStatus === 'PENDING') {
          await new Promise((resolve) => setTimeout(resolve, 900 + attempt * 200));
          continue;
        }
        storeRecovery(importId, null);
        return openReview(importId);
      }
      if (outcome === 'FAILED_BEFORE_COMMIT') {
        await request(`/api/import-reviews/${encodeURIComponent(importId)}/apply-recover`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: operationId, request_hash: requestHash })
        });
        storeRecovery(importId, null);
        return openReview(importId, { message: 'The apply attempt failed before any source commit. Nothing was applied. The review is open again and can be checked before a new attempt.' });
      }
      if (outcome === 'NOT_STARTED' || outcome === 'NOT_COMMITTED') {
        const current = state.review;
        if (current?.importId === importId) {
          current.error = 'The source commit is not proven. The operation ID and request hash are saved in this browser; use Refresh apply status before attempting anything again.';
          showScreen('Import review', renderReview, 'import-review-v1');
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 900 + attempt * 200));
    }
    const current = state.review;
    if (current?.importId === importId) {
      current.error = 'The apply outcome is still unknown. This recovery reference is saved for this browser. Refresh apply status; do not start another import apply.';
      current.operationId = operationId;
      current.requestHash = requestHash;
      showScreen('Import review', renderReview, 'import-review-v1');
      return;
    }
    await openReview(importId, { message: 'The apply outcome is still unknown. Refresh apply status before retrying.' });
  }

  async function refreshApplyStatus() {
    const review = state.review;
    const recovery = recoveryFor(review?.importId);
    const op = review?.header?.state?.last_operation_id || recovery?.operation_id || review?.operationId;
    const hash = review?.header?.state?.last_operation_request_hash
      || recovery?.request_hash
      || review?.requestHash
      || review?.header?.state?.apply_contract?.request_hash;
    if (!review || !op || !hash) return openReview(review.importId);
    await pollApplyStatus(review.importId, op, hash);
  }

  async function retryFollowUp() {
    const review = state.review;
    const op = review?.header?.state?.last_operation_id;
    const hash = review?.header?.state?.last_operation_request_hash;
    if (!review || !op || !hash) return;
    const priorRetryCount = Number(review?.header?.state?.follow_up_retry_count || 0);
    await request(`/api/import-reviews/${encodeURIComponent(review.importId)}/follow-up/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: op, request_hash: hash })
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await request(`/api/import-reviews/${encodeURIComponent(review.importId)}/apply-status?operation_id=${encodeURIComponent(op)}&request_hash=${encodeURIComponent(hash)}`);
      const followUpStatus = String(status?.follow_up_status || '').toUpperCase();
      const retryCount = Number(status?.follow_up_retry_count || 0);
      if (followUpStatus === 'COMPLETE' || followUpStatus === 'NOT_REQUIRED') {
        return openReview(review.importId);
      }
      if (followUpStatus === 'FAILED_RETRYABLE' && retryCount > priorRetryCount) {
        return openReview(review.importId);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await openReview(review.importId, { message: 'Post-commit work is still running. Use Refresh apply status to check it again; the source import will not be repeated.' });
  }

  function reviewItem(actionId) {
    return (state.review?.pageData?.items || []).find((item) => String(item.action_id) === String(actionId)) || null;
  }

  async function persistMapping(item, kind, selected) {
    const review = state.review;
    if (!review || !item) return;
    const summary = item.summary || {};
    const route = String(review.header?.import?.source_route || review.header?.import?.source_system || '').toUpperCase();
    const isDaily = route.includes('DAILY');
    if (kind === 'CANDIDATE') {
      const mapping = {
        staff_norm: String(summary.candidate_name || item.candidate_name || '').trim().toLowerCase(),
        hospital_or_trust: String(summary.client_name || item.client_name || '').trim().toLowerCase() || null,
        candidate_id: selected.id,
        client_id: item.client_id || null,
        work_date: item.work_date || summary.work_date || null
      };
      if (isDaily) await global.postHrRotaResolveMappings(review.importId, { candidate_mappings: [mapping] });
      else await global.postWeeklyResolveMappings(review.importId, route === 'NHSP' ? 'NHSP' : 'HR_WEEKLY', { candidate_mappings: [mapping], client_aliases: [] });
    } else if (kind === 'CLIENT') {
      const alias = {
        hospital_norm: String(summary.client_name || item.client_name || '').trim().toLowerCase(),
        client_id: selected.id,
        hr_row_ids: item.hr_row_id ? [item.hr_row_id] : []
      };
      if (isDaily) await global.postHrRotaResolveMappings(review.importId, { client_aliases: [alias] });
      else await global.postWeeklyResolveMappings(review.importId, route === 'NHSP' ? 'NHSP' : 'HR_WEEKLY', { candidate_mappings: [], client_aliases: [alias] });
    }
    return true;
  }

  async function resolveMapping(button) {
    const item = reviewItem(button.getAttribute('data-action-id'));
    const kind = button.getAttribute('data-resolution');
    if (!item || !kind || !reviewCan(state.review, 'SAVE_SELECTIONS')) return;
    const summary = item.summary || {};
    const route = String(state.review.header?.import?.source_route || state.review.header?.import?.source_system || '').toUpperCase();
    const reviewRouteState = { importId: state.review.importId };
    if (kind === 'CANDIDATE') {
      if (typeof global.openCandidatePicker !== 'function') throw new Error('The candidate picker is unavailable.');
      return global.openCandidatePicker(async ({ id, label }) => {
        await persistMapping(item, kind, { id, label });
        setTimeout(() => { if (state.review?.importId === reviewRouteState.importId) void refreshReview(); }, 0);
        return true;
      }, {
        context: { staffName: summary.candidate_name || item.candidate_name, unit: summary.client_name || item.client_name, importId: state.review.importId, dateYmd: item.work_date || summary.work_date },
        seed_hint: { source: 'import_review_v3', display_name: summary.candidate_name || item.candidate_name || '' },
        ignoreMembership: true
      });
    }
    if (kind === 'CLIENT') {
      if (typeof global.openClientPicker !== 'function') throw new Error('The client picker is unavailable.');
      return global.openClientPicker(async ({ id, label }) => {
        await persistMapping(item, kind, { id, label });
        setTimeout(() => { if (state.review?.importId === reviewRouteState.importId) void refreshReview(); }, 0);
        return true;
      });
    }
    if (kind === 'GRADE') {
      const select = document.querySelector(`[data-ir-grade-option="${CSS.escape(item.action_id)}"]`);
      const optionId = String(select?.value || '').trim();
      if (!optionId) throw new Error('Choose an existing mapping option first.');

      // Re-read the same bounded action page immediately before saving.  A
      // changed evidence fingerprint or removed option fails closed rather
      // than persisting a stale browser choice.
      const freshPage = await fetchActionPage(state.review);
      const freshItem = (freshPage?.items || []).find((entry) => String(entry.action_id) === String(item.action_id));
      const freshOption = (freshItem?.resolution_options || []).find((entry) => String(entry?.option_id || '') === optionId);
      if (!freshItem || freshItem.evidence_fingerprint !== item.evidence_fingerprint || !freshOption || freshOption.selectable === false) {
        state.review.pageData = freshPage;
        state.review.error = 'The mapping evidence changed. Check the refreshed options and choose again.';
        showScreen('Import review', renderReview, 'import-review-v1');
        return;
      }

      const incoming = String(freshItem.imported_evidence?.role || freshItem.summary?.role || '').trim();
      if (!incoming) throw new Error('The incoming grade is unavailable for this row.');
      const resolutionKind = String(freshItem.resolution_kind || '').toUpperCase();
      if (resolutionKind === 'WEEKLY_ASSIGNMENT_CONTRACT') {
        if (typeof global.apiCreateAssignmentBandMapping !== 'function') throw new Error('The weekly contract-mapping service is unavailable.');
        const contractId = String(freshOption.contract_id || '').trim();
        if (!contractId) throw new Error('The selected contract option is invalid.');
        await global.apiCreateAssignmentBandMapping({
          system_type: route === 'NHSP' ? 'NHSP' : 'HR_WEEKLY', incoming_code: incoming,
          candidate_id: freshItem.candidate_id, client_id: freshItem.client_id,
          target_contract_id: contractId,
          band_match_pattern: String(freshOption.band || freshOption.role || 'Contract').trim(),
          active: true, scope_kind: 'CANDIDATE_CLIENT', allow_candidate_client_scope: true,
          notes: `Resolved through durable import review ${state.review.importId}.`
        });
      } else if (resolutionKind === 'DAILY_GRADE_ROLE') {
        if (typeof global.postHrRotaResolveMappings !== 'function') throw new Error('The Daily grade-mapping service is unavailable.');
        const roleCode = String(freshOption.role_code || '').trim();
        if (!roleCode) throw new Error('The selected role option is invalid.');
        await global.postHrRotaResolveMappings(state.review.importId, {
          grade_role_mappings: [{ incoming_grade_norm: incoming.toLowerCase(), role_code: roleCode, band_norm: freshOption.band_norm || null }]
        });
      } else {
        throw new Error('This review item does not expose an approved grade-mapping action.');
      }
      await refreshReview();
    }
  }

  async function handleAction(button) {
    const action = button.getAttribute('data-ir-action');
    if (!action) return;
    try {
      if (action === 'reload-home') {
        await loadHome({ resetPaging: false });
        return showScreen('Imports', renderHome, 'imports-v1');
      }
      if (action === 'home' || action === 'coverage-cancel' || action === 'overlap-cancel') {
        cancelDocumentPreparationPoll();
        if (action === 'coverage-cancel' || action === 'overlap-cancel') {
          if (!(await confirmCoverageDiscard())) return;
          state.coverage = null;
        }
        if (action === 'home' && !(await flushSelections({ quiet: true }))) return;
        return openImportsModalV1();
      }
      if (action === 'home-page') {
        const page = Number(button.getAttribute('data-page'));
        if (page < 1) return;
        if (page > state.home.page && state.home.nextCursor) state.home.cursorStack[state.home.page] = state.home.nextCursor;
        state.home.page = page;
        await loadHome();
        return showScreen('Imports', renderHome, 'imports-v1');
      }
      if (action === 'continue') return openReview(button.getAttribute('data-import-id'));
      if (action === 'zero-shifts-open') {
        const clientId = String(document.querySelector('[data-ir-client="HR_DAILY"]')?.value || state.home.selectedClients.HR_DAILY || '').trim();
        state.home.selectedClients.HR_DAILY = clientId;
        state.home.zeroShifts = { clientId, startDate: '', endDate: '', busy: false, error: '' };
        showScreen('Imports', renderHome, 'imports-v1');
        focusZeroShiftsDialog();
        return;
      }
      if (action === 'zero-shifts-cancel') {
        state.home.zeroShifts = null;
        showScreen('Imports', renderHome, 'imports-v1');
        global.requestAnimationFrame(() => document.querySelector('[data-ir-action="zero-shifts-open"]')?.focus());
        return;
      }
      if (action === 'zero-shifts-submit') return submitZeroShiftsDeclaration();
      if (action === 'coverage-page') return loadCoveragePage(Number(button.getAttribute('data-page')));
      if (action === 'coverage-create') return createReviewFromCoverage();
      if (action === 'overlap-resume') return openReview(state.coverage?.selectedOverlapId);
      if (action === 'overlap-replace') { state.coverage.overlapChoice = 'SUPERSEDE'; state.coverage.error = ''; return showScreen('Confirm import coverage', renderCoverage, 'import-coverage-v1'); }
      if (action === 'review-view') {
        const nextView = button.getAttribute('data-view');
        if (state.review && nextView !== state.review.view) state.review.expanded.clear();
        return changeReviewPage({ view: nextView, page: 1 });
      }
      if (action === 'review-page') return changeReviewPage({ page: Number(button.getAttribute('data-page')) });
      if (action === 'sort') {
        const key = button.getAttribute('data-sort');
        return changeReviewPage({ sortBy: key, sortDirection: state.review.sortBy === key && state.review.sortDirection === 'ASC' ? 'DESC' : 'ASC', page: 1 });
      }
      if (action === 'toggle-branch') {
        const details = button.closest('details[data-ir-expand-key]');
        if (!details || !state.review) return;
        const expand = button.getAttribute('data-expand') === 'true';
        for (const branch of [details, ...details.querySelectorAll('details[data-ir-expand-key]')]) {
          const key = branch.getAttribute('data-ir-expand-key');
          branch.open = expand;
          if (key) { if (expand) state.review.expanded.add(key); else state.review.expanded.delete(key); }
        }
        button.textContent = expand ? '−' : '+';
        button.setAttribute('data-expand', expand ? 'false' : 'true');
        button.setAttribute('aria-label', `${expand ? 'Collapse' : 'Expand'} this group and all sections`);
        return;
      }
      if (action === 'refresh') return refreshReview();
      if (action === 'abandon') return abandonReview();
      if (action === 'resolve-mapping') return resolveMapping(button);
      if (action === 'daily-clear') {
        const item = reviewItem(button.getAttribute('data-action-id'));
        const select = document.querySelector(`[data-ir-daily-resolution="${CSS.escape(item?.action_id || '')}"]`);
        if (select) return saveDailyResolution(select, null);
      }
      if (action === 'weekly-candidate-not-worked') {
        return saveWeeklyCandidateNotWorked(
          button.getAttribute('data-action-id'),
          button.getAttribute('data-confirmed') === 'true'
        );
      }
      if (action === 'conflict-save') { state.review.conflictBuffer = null; return flushSelections(); }
      if (action === 'conflict-discard') { state.review.dirty.clear(); state.review.pendingSave = null; state.review.conflictBuffer = null; state.review.error = ''; return openReview(state.review.importId); }
      if (action === 'apply-preview') {
        if (!(await flushSelections({ quiet: true }))) return;
        return loadApplyConfirmation();
      }
      if (action === 'apply-back') { state.review.confirmation = null; state.review.confirmAcknowledged = false; state.review.screen = 'review'; return showScreen('Import review', renderReview, 'import-review-v1'); }
      if (action === 'confirm-page') {
        return loadConfirmationSection(button.getAttribute('data-section'), Number(button.getAttribute('data-page')), Number(state.review.confirmation?.sections?.[button.getAttribute('data-section')]?.page_size || 25));
      }
      if (action === 'apply-confirm') return applyReview();
      if (action === 'status') return refreshApplyStatus();
      if (action === 'retry') return retryFollowUp();
    } catch (error) {
      if (state.review) {
        state.review.error = error.message || 'The action could not be completed.';
        showScreen('Import review', renderReview, 'import-review-v1');
      } else {
        state.home.error = error.message || 'The action could not be completed.';
        showScreen('Imports', renderHome, 'imports-v1');
      }
    }
  }

  document.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-ir-action]');
    if (actionButton) { event.preventDefault(); void handleAction(actionButton); return; }
    const tile = event.target.closest('[data-ir-drop]');
    if (tile && !event.target.closest('select,input,button')) tile.querySelector('[data-ir-file]')?.click();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.home.zeroShifts && document.querySelector('[data-ir-zero-backdrop]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!state.home.zeroShifts.busy) {
        state.home.zeroShifts = null;
        showScreen('Imports', renderHome, 'imports-v1');
        global.requestAnimationFrame(() => document.querySelector('[data-ir-action="zero-shifts-open"]')?.focus());
      }
      return;
    }
    const tile = event.target.closest?.('[data-ir-drop]');
    if (tile && !event.target.closest?.('select,input,button') && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      tile.querySelector('[data-ir-file]')?.click();
    }
  }, true);

  function dismissActiveImportModal() {
    const frame = currentImportFrame();
    if (frame) {
      frame.isDirty = false;
      frame._snapshot = null;
      frame._closing = false;
      if (typeof frame._updateButtons === 'function') frame._updateButtons();
    }
    const close = document.getElementById('btnCloseModal');
    if (!close) return;
    state.closeBypass = true;
    try { close.click(); } finally { state.closeBypass = false; }
  }

  document.addEventListener('click', (event) => {
    const close = event.target.closest?.('#btnCloseModal');
    const coverageOpen = !!document.getElementById('irv1Coverage');
    const reviewOpen = !!document.getElementById('irv1Review');
    if (!close || state.closeBypass || (!coverageOpen && !reviewOpen)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void (async () => {
      if (coverageOpen) {
        const confirmed = await confirmCoverageDiscard();
        if (!confirmed) return;
        state.coverage = null;
        dismissActiveImportModal();
        return;
      }

      const review = state.review;
      if (!review) return dismissActiveImportModal();
      const hasUnsavedSelections = review.dirty.size > 0 || !!review.pendingSave || review.saveState === 'Saving selections…';
      if (!hasUnsavedSelections) return dismissActiveImportModal();
      const saved = await flushSelections({ quiet: true });
      if (saved) return dismissActiveImportModal();
      const discard = await importUiConfirm({
        title: 'Discard unsaved review changes?',
        messageHtml: '<div style="font-size:14px;font-weight:700;margin-bottom:6px;">Your selection changes could not be saved.</div><div class="mini">Discard only the unsaved browser changes and close this review?</div>',
        confirmLabel: 'Discard unsaved changes',
        cancelLabel: 'Keep reviewing',
        danger: true
      });
      if (discard) dismissActiveImportModal();
    })();
  }, true);

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches('[data-ir-client]')) {
      const kind = String(target.getAttribute('data-ir-client') || '');
      if (kind) state.home.selectedClients[kind] = String(target.value || '');
      return;
    }
    if (target.matches('[data-ir-file]')) {
      const kind = target.closest('[data-ir-drop]')?.getAttribute('data-ir-drop');
      const file = target.files?.[0];
      target.value = '';
      void handleStageFile(kind, file);
      return;
    }
    if (target.name === 'irCoverage' && state.coverage) {
      state.coverage.mode = target.value;
      state.coverage.error = '';
      showScreen('Confirm import coverage', renderCoverage, 'import-coverage-v1');
      return;
    }
    if (target.name === 'irOverlapTarget' && state.coverage) {
      state.coverage.selectedOverlapId = target.value;
      state.coverage.overlapChoice = null;
      showScreen('Confirm import coverage', renderCoverage, 'import-coverage-v1');
      return;
    }
    if (target.matches('[data-ir-home-status]')) {
      state.home.statusClass = target.value;
      void loadHome({ resetPaging: true }).then(() => showScreen('Imports', renderHome, 'imports-v1'));
      return;
    }
    if (target.matches('[data-ir-home-page-size]')) {
      state.home.pageSize = Number(target.value);
      void loadHome({ resetPaging: true }).then(() => showScreen('Imports', renderHome, 'imports-v1'));
      return;
    }
    if (target.matches('[data-ir-coverage-candidate]') && state.coverage) {
      const key = target.getAttribute('data-ir-coverage-candidate');
      if (target.checked) state.coverage.selectedCandidates.add(key); else state.coverage.selectedCandidates.delete(key);
      showScreen('Confirm import coverage', renderCoverage, 'import-coverage-v1');
      return;
    }
    if (target.matches('[data-ir-select]') && state.review) {
      const actionId = target.getAttribute('data-ir-select');
      state.review.dirty.set(actionId, target.checked);
      state.review.saveState = 'Unsaved selection';
      scheduleSave();
      return;
    }
    if (target.matches('[data-ir-page-size]') && state.review) {
      const size = Number(target.value);
      if (PAGE_SIZES.includes(size)) void changeReviewPage({ pageSize: size, page: 1 });
      return;
    }
    if (target.matches('[data-ir-confirm-page-size]') && state.review?.confirmation) {
      const key = target.getAttribute('data-ir-confirm-page-size');
      const size = Number(target.value);
      if (PAGE_SIZES.includes(size)) void loadConfirmationSection(key, 1, size);
      return;
    }
    if (target.matches('[data-ir-daily-resolution]') && target.value) void saveDailyResolution(target);
    if (target.matches('[data-ir-confirm-ack]') && state.review) {
      state.review.confirmAcknowledged = target.checked;
      showScreen('Import review', renderReview, 'import-review-v1');
    }
  }, true);

  document.addEventListener('toggle', (event) => {
    const confirmationSection = event.target.closest('[data-ir-confirm-section]');
    if (confirmationSection && state.review?.confirmation) {
      const key = confirmationSection.getAttribute('data-ir-confirm-section');
      if (confirmationSection.open) state.review.confirmation.openSections.add(key); else state.review.confirmation.openSections.delete(key);
      return;
    }
    const details = event.target.closest('[data-ir-expand-key]');
    if (!details || !state.review) return;
    const key = details.getAttribute('data-ir-expand-key');
    if (details.open) state.review.expanded.add(key); else state.review.expanded.delete(key);
  }, true);

  global.addEventListener('cloudtms:client-saved', invalidateClientEligibility);

  for (const eventName of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    document.addEventListener(eventName, (event) => {
      const tile = event.target.closest?.('[data-ir-drop]');
      if (!tile) return;
      event.preventDefault();
      event.stopPropagation();
      if (eventName === 'dragenter' || eventName === 'dragover') tile.classList.add('is-dragging');
      else tile.classList.remove('is-dragging');
      if (eventName === 'drop') void handleStageFile(tile.getAttribute('data-ir-drop'), event.dataTransfer?.files?.[0]);
    }, true);
  }

  function settingsValue(source, key) {
    const value = source && Object.prototype.hasOwnProperty.call(source, key) ? String(source[key] || '').toUpperCase() : '';
    return value === 'PAID_DATE' || value === 'NOW' ? value : null;
  }

  async function injectGlobalPolicy(root) {
    if (!root || root.querySelector('#irv1GlobalPolicy')) return;
    const card = document.createElement('section');
    card.id = 'irv1GlobalPolicy';
    card.className = 'irv1-settings-card';
    card.innerHTML = '<div class="irv1-save-state">Loading the stored import policy…</div>';
    root.appendChild(card);
    try {
      const result = await request('/api/settings/defaults');
      const source = result?.settings || result?.settings_defaults || result || {};
      const complete = settingsValue(source, 'reversal_complete_financials_date');
      const replacement = settingsValue(source, 'reversal_replacement_financials_date');
      if (!complete || !replacement || !source.updated_at) {
        card.innerHTML = '<div class="irv1-alert error"><strong>Import policy unavailable.</strong><br/>The stored global values or their concurrency version are missing. Nothing has been defaulted and saving is disabled.</div>';
        return;
      }
      global.modalCtx.data = Object.assign(global.modalCtx.data || {}, source);
      card.innerHTML = `<h3 class="irv1-title">Import-authoritative correction dates</h3><p class="mini">New clients inherit these global defaults. These settings affect only import-authoritative correction/replacement shifts; ordinary timesheets and Banking Pay financial authority are unchanged.</p><div class="irv1-settings-grid"><label>Completed reversal uses<select class="input" data-ir-global-policy="reversal_complete_financials_date"><option value="PAID_DATE" ${complete === 'PAID_DATE' ? 'selected' : ''}>Original paid date</option><option value="NOW" ${complete === 'NOW' ? 'selected' : ''}>Current date (now)</option></select></label><label>Replacement shift uses<select class="input" data-ir-global-policy="reversal_replacement_financials_date"><option value="PAID_DATE" ${replacement === 'PAID_DATE' ? 'selected' : ''}>Original paid date</option><option value="NOW" ${replacement === 'NOW' ? 'selected' : ''}>Current date (now)</option></select></label></div><div class="irv1-review-actions"><span class="irv1-save-state" data-ir-global-policy-status></span><button type="button" class="irv1-btn" data-ir-settings-save="global">Save import policy</button></div>`;
    } catch (error) {
      card.innerHTML = `<div class="irv1-alert error"><strong>Import policy unavailable.</strong><br/>${esc(error.message || 'The stored global settings could not be loaded.')} Nothing has been defaulted and saving is disabled.</div>`;
    }
  }

  async function loadClientPolicy(root) {
    if (!root || root.querySelector('#irv1ClientPolicy')) return;
    const clientId = global.modalCtx?.data?.id;
    const card = document.createElement('section');
    card.id = 'irv1ClientPolicy';
    card.className = 'irv1-settings-card';
    (root.querySelector('[data-record-panel="timesheets"]') || root).appendChild(card);
    if (!clientId) {
      card.hidden = true;
      return;
    }
    card.innerHTML = '<div class="irv1-save-state">Loading import policy…</div>';
    try {
      const response = await request(`/api/clients/${encodeURIComponent(clientId)}`);
      const policy = response.import_financial_policy || {};
      global.modalCtx.__importFinancialPolicy = policy;
      if (!policy.eligible) {
        card.hidden = true;
        return;
      }
      const complete = policy.reversal_complete_financials_date || {};
      const replacement = policy.reversal_replacement_financials_date || {};
      const option = (value, current, label) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
      card.innerHTML = `<h3 class="irv1-title">Import-authoritative correction dates</h3><p class="mini">Choose a client override or inherit the global default. A blank override is stored as inheritance, not as NOW.</p><div class="irv1-settings-grid"><label>Completed reversal uses<select class="input" data-ir-client-policy="reversal_complete_financials_date">${option('', complete.override == null ? '' : complete.override, `Inherit global (${complete.effective === 'PAID_DATE' ? 'Original paid date' : 'Current date'})`)}${option('PAID_DATE', complete.override, 'Original paid date')}${option('NOW', complete.override, 'Current date (now)')}</select></label><label>Replacement shift uses<select class="input" data-ir-client-policy="reversal_replacement_financials_date">${option('', replacement.override == null ? '' : replacement.override, `Inherit global (${replacement.effective === 'PAID_DATE' ? 'Original paid date' : 'Current date'})`)}${option('PAID_DATE', replacement.override, 'Original paid date')}${option('NOW', replacement.override, 'Current date (now)')}</select></label></div><div class="irv1-review-actions"><span class="irv1-save-state" data-ir-client-policy-status></span><button type="button" class="irv1-btn" data-ir-settings-save="client">Save import policy</button></div>`;
    } catch (error) {
      card.innerHTML = `<div class="irv1-alert error">${esc(error.message || 'The client policy could not be loaded.')}</div>`;
    }
  }

  function injectContractQueryEmail(root) {
    if (!root || root.querySelector('#irv1ContractQueryEmail')) return;
    const ctx = global.modalCtx || {};
    const main = ctx.formState?.main || {};
    const source = Object.prototype.hasOwnProperty.call(main, 'send_ts_queries_to_different_email') ? main : (ctx.data || {});
    const enabled = source.send_ts_queries_to_different_email === true || source.send_ts_queries_to_different_email === 'on';
    const address = String(source.ts_queries_alt_email_address || '');
    const frame = typeof global.__getModalFrame === 'function' ? global.__getModalFrame() : null;
    const editable = !frame || frame.mode === 'edit' || frame.mode === 'create';
    const card = document.createElement('section');
    card.id = 'irv1ContractQueryEmail';
    card.className = 'irv1-settings-card';
    card.innerHTML = `<h3 class="irv1-title">Timesheet query email</h3><p class="mini">This override is independent of invoice routing. If several contracts resolve to the same email address, the recipient receives one combined message with a separate, tidy contract section.</p><label style="display:grid;grid-template-columns:20px 1fr;align-items:center"><input type="checkbox" data-ir-contract-query-enabled ${enabled ? 'checked' : ''} ${editable ? '' : 'disabled="disabled" aria-disabled="true"'}/><span>Send this contract’s missing shifts, wrong hours and reference queries to a different address</span></label><label style="margin-top:10px">Contract query email<input type="email" class="input" data-ir-contract-query-address value="${esc(address)}" ${enabled && editable ? '' : 'disabled="disabled" aria-disabled="true"'} placeholder="name@trust.nhs.uk"/></label>`;
    root.appendChild(card);
  }

  async function saveGlobalPolicy(button) {
    const root = button.closest('#irv1GlobalPolicy');
    const status = root.querySelector('[data-ir-global-policy-status]');
    const source = global.modalCtx?.data || {};
    status.textContent = 'Saving…';
    const result = await request('/api/settings/defaults', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        reversal_complete_financials_date: root.querySelector('[data-ir-global-policy="reversal_complete_financials_date"]').value,
        reversal_replacement_financials_date: root.querySelector('[data-ir-global-policy="reversal_replacement_financials_date"]').value,
        expected_updated_at: source.updated_at,
        request_key: `global-import-policy:${makeUuid()}`
      })
    });
    Object.assign(source, result.stored || {}, { updated_at: result.updated_at });
    status.textContent = 'Saved'; status.classList.add('is-ok');
  }

  async function saveClientPolicy(button) {
    const root = button.closest('#irv1ClientPolicy');
    const status = root.querySelector('[data-ir-client-policy-status]');
    const policy = global.modalCtx?.__importFinancialPolicy || {};
    const clientId = global.modalCtx?.data?.id;
    status.textContent = 'Saving…';
    const result = await request(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        reversal_complete_financials_date: root.querySelector('[data-ir-client-policy="reversal_complete_financials_date"]').value || null,
        reversal_replacement_financials_date: root.querySelector('[data-ir-client-policy="reversal_replacement_financials_date"]').value || null,
        expected_client_rev: policy.client_rev,
        expected_settings_updated_at: policy.client_settings_updated_at,
        request_key: `client-import-policy:${makeUuid()}`
      })
    });
    policy.client_rev = result.client_rev;
    policy.client_settings_updated_at = result.settings_updated_at;
    status.textContent = 'Saved'; status.classList.add('is-ok');
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ir-settings-save]');
    if (!button) return;
    event.preventDefault();
    const task = button.getAttribute('data-ir-settings-save') === 'global' ? saveGlobalPolicy(button) : saveClientPolicy(button);
    task.catch((error) => {
      const status = button.parentElement?.querySelector('.irv1-save-state');
      if (status) { status.textContent = error.message || 'Not saved'; status.classList.add('is-error'); }
    });
  }, true);

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-ir-contract-query-enabled],[data-ir-contract-query-address]')) {
      const card = event.target.closest('#irv1ContractQueryEmail');
      const enabled = card.querySelector('[data-ir-contract-query-enabled]').checked;
      const address = card.querySelector('[data-ir-contract-query-address]');
      address.disabled = !enabled;
      const ctx = global.modalCtx || {};
      ctx.formState = ctx.formState || { main: {}, pay: {} };
      ctx.formState.main = ctx.formState.main || {};
      ctx.formState.main.send_ts_queries_to_different_email = enabled ? 'on' : '';
      ctx.formState.main.ts_queries_alt_email_address = enabled ? String(address.value || '').trim().toLowerCase() : null;
      ctx.__nonCalendarDirty = true;
      ctx.__contractSettingsDirty = true;
      try { global.dispatchEvent(new Event('modal-dirty')); } catch {}
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (!event.target.matches('[data-ir-contract-query-address]')) return;
    const card = event.target.closest('#irv1ContractQueryEmail');
    const ctx = global.modalCtx || {};
    ctx.formState = ctx.formState || { main: {}, pay: {} };
    ctx.formState.main = ctx.formState.main || {};
    ctx.formState.main.ts_queries_alt_email_address = card.querySelector('[data-ir-contract-query-enabled]')?.checked
      ? String(event.target.value || '').trim().toLowerCase()
      : null;
    ctx.__nonCalendarDirty = true;
    ctx.__contractSettingsDirty = true;
    try { global.dispatchEvent(new Event('modal-dirty')); } catch {}
  }, true);

  const observer = new MutationObserver(() => {
    const settingsRoot = document.getElementById('settingsForm');
    if (settingsRoot) void injectGlobalPolicy(settingsRoot);
    const clientRoot = document.getElementById('clientSettingsForm');
    if (clientRoot) void loadClientPolicy(clientRoot);
    const contractRoot = document.getElementById('contractSettingsForm');
    if (contractRoot) injectContractQueryEmail(contractRoot);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  global.CloudTmsImportReviewV1 = Object.freeze({
    contract: CONTRACT,
    pageSizes: PAGE_SIZES,
    openImportsModal: openImportsModalV1,
    ensureContract,
    invalidateClientEligibility,
    formatDate,
    reasonText,
    _state: state
  });
  global.openImportsModal = openImportsModalV1;
})(window);

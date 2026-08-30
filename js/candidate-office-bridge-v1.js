(() => {
  'use strict';
  const cache = new Map();
  const pending = new Map();
  const latestRequests = new Map();
  const batchQueues = new Map();
  const batchTimers = new Map();
  let capabilities = null;
  let controller = null;
  let initialized = false;
  let authorityGeneration = 0;
  let requestSerial = 0;
  const key = (surface, rowKey) => `${surface}:${rowKey}`;
  const requestKey = (surface, row) => [
    surface,
    row?.row_key || '',
    row?.timesheet_id || '',
    row?.contract_week_id || '',
    row?.expected_row_signature || ''
  ].join(':');
  const cacheKeyFor = (surface, row) => requestKey(surface, row);
  const attr = value => String(value == null ? '' : value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const rowFromSlot = slot => ({ row_key: slot.dataset.rowKey, timesheet_id: slot.dataset.timesheetId || null, contract_week_id: slot.dataset.contractWeekId || null, expected_row_signature: slot.dataset.rowSignature || null });
  const canSurface = surface => !!(capabilities?.authority_applies && capabilities?.permissions?.view_candidate_state && capabilities?.surfaces?.[String(surface).toLowerCase()]);
  function candidateProjectionNotApplicable(row) {
    if (!row || typeof row !== 'object') return false;
    return [row, row.row, row.data_row, row.effective, row.timesheet, row.contract_week]
      .some(source => source && typeof source === 'object' && source.candidate_office_projection_not_applicable === true);
  }
  const toast = (message, tone = 'ok') => { if (typeof window.__toast === 'function') window.__toast(message, tone); else console[tone === 'fail' ? 'error' : 'info'](message); };
  function clampExpandedCandidateModal(slot) {
    const modal = slot?.closest?.('#modal');
    if (!modal || modal.getClientRects().length === 0) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!slot.isConnected || slot.closest('#modal') !== modal) return;
      const rect = modal.getBoundingClientRect();
      const margin = 12;
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
      const left = Math.min(Math.max(margin, rect.left), maxLeft);
      const top = Math.min(Math.max(margin, rect.top), maxTop);
      if (Math.abs(left - rect.left) < 1 && Math.abs(top - rect.top) < 1) return;
      modal.style.position = 'fixed';
      modal.style.left = `${Math.round(left)}px`;
      modal.style.top = `${Math.round(top)}px`;
      modal.style.right = 'auto';
      modal.style.bottom = 'auto';
      modal.style.transform = 'none';
      const kind = String(window.__getModalFrame?.()?.kind || '').trim() || '__default__';
      window.__modalAnchorsByKind ||= {};
      window.__modalAnchorsByKind[kind] = { left: Math.round(left), top: Math.round(top) };
      window.__modalAnchor = { left: Math.round(left), top: Math.round(top) };
    }));
  }
  function projectionMatchesRow(projection, row) {
    const current = projection?.current_identity || {};
    if (!projection || !row) return false;
    if (row.row_key && String(current.row_key || '') !== String(row.row_key)) return false;
    if (row.timesheet_id && String(current.timesheet_id || '') !== String(row.timesheet_id)) return false;
    if (row.contract_week_id && String(current.contract_week_id || '') !== String(row.contract_week_id)) return false;
    if (row.expected_row_signature && String(current.row_signature || '') !== String(row.expected_row_signature)) return false;
    return true;
  }
  function findProjection(surface, rowKey, row = null) {
    if (row) {
      const projection = cache.get(cacheKeyFor(surface, row))?.projection || null;
      return !projectionMatchesRow(projection, row) ? null : projection;
    }
    let newest = null;
    for (const entry of cache.values()) {
      if (String(entry?.projection?.current_identity?.row_key || '') !== String(rowKey || '')) continue;
      if (!newest || Number(entry.observedAt || 0) > Number(newest.observedAt || 0)) newest = entry;
    }
    return newest?.projection || null;
  }
  function updateSlots(surface, rowKey, projection = null, error = null, requestedRow = null) {
    const surfaceApi = window.CloudTMSCandidateOfficeSurface;
    document.querySelectorAll(`[data-candidate-office-slot="1"][data-candidate-office-surface="${CSS.escape(surface)}"][data-row-key="${CSS.escape(rowKey)}"]`).forEach(slot => {
      const slotRow = rowFromSlot(slot);
      if (requestedRow && requestKey(surface, slotRow) !== requestKey(surface, requestedRow)) return;
      if (projection && !projectionMatchesRow(projection, slotRow)) return;
      const variant = slot.dataset.candidateOfficeVariant || (surface === 'TIMESHEET_SUMMARY' ? 'compact' : 'detail');
      if (error) { slot.innerHTML = surfaceApi.renderCandidateUnavailable(error, { variant }); return; }
      const summaryPresentation = surface === 'TIMESHEET_SUMMARY';
      const view = summaryPresentation
        ? window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(projection)
        : window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeDetail(projection, { surface });
      slot.innerHTML = surfaceApi.renderCandidateFragment(view, { surface, variant });
      clampExpandedCandidateModal(slot);
    });
    window.dispatchEvent(new CustomEvent('cloudtms:candidate-office-projection', { detail: { surface, row_key: rowKey, ok: !error } }));
  }
  async function loadSlot(slot, { force = false } = {}) {
    const requestedGeneration = authorityGeneration;
    const surface = slot.dataset.candidateOfficeSurface;
    const row = rowFromSlot(slot);
    if (!canSurface(surface)) { slot.remove(); return null; }
    const cacheKey = cacheKeyFor(surface, row);
    const rowRequestKey = key(surface, row.row_key);
    const pendingKey = requestKey(surface, row);
    if (!force && cache.has(cacheKey)) {
      const cached = cache.get(cacheKey).projection;
      if (projectionMatchesRow(cached, row)) {
        updateSlots(surface, row.row_key, cached);
        return cached;
      }
      cache.delete(cacheKey);
    }
    if (pending.has(pendingKey)) return pending.get(pendingKey);
    const requestEpoch = ++requestSerial;
    latestRequests.set(rowRequestKey, requestEpoch);
    const promise = (async () => {
      try {
        const projection = surface === 'SIMPLE_TIMESHEET' && row.timesheet_id
          ? await window.CloudTMSCandidateOfficeApi.fetchOfficeCandidateProjection({ timesheetId: row.timesheet_id, rowIdentity: row })
          : (await window.CloudTMSCandidateOfficeApi.fetchOfficeCandidateProjections({ surface, identities: [row] })).results[0]?.projection;
        if (requestedGeneration !== authorityGeneration || !canSurface(surface) || latestRequests.get(rowRequestKey) !== requestEpoch) return null;
        if (!projection) throw Object.assign(new Error('The Candidate projection was unavailable.'), { code: 'CANDIDATE_OFFICE_PROJECTION_FAILED' });
        cache.set(cacheKey, { projection, observedAt: Date.now() });
        updateSlots(surface, row.row_key, projection, null, row);
        return projection;
      } catch (error) {
        if (requestedGeneration !== authorityGeneration || !canSurface(surface) || latestRequests.get(rowRequestKey) !== requestEpoch) return null;
        const normalized = window.CloudTMSCandidateOfficeContract.normalizeCandidateOfficeError(error);
        updateSlots(surface, row.row_key, null, normalized, row);
        return null;
      } finally {
        if (pending.get(pendingKey) === promise) pending.delete(pendingKey);
      }
    })();
    pending.set(pendingKey, promise);
    return promise;
  }
  async function hydrateBatch(surface, slots) {
    const requestedGeneration = authorityGeneration;
    const byExactKey = new Map();
    slots.filter(slot => slot.isConnected).forEach(slot => {
      const row = rowFromSlot(slot);
      const cached = findProjection(surface, row.row_key, row);
      if (cached) {
        updateSlots(surface, row.row_key, cached, null, row);
        return;
      }
      const exactKey = cacheKeyFor(surface, row);
      cache.delete(exactKey);
      byExactKey.set(exactKey, row);
    });
    const identities = Array.from(byExactKey.values());
    const chunks = partitionProjectionIdentities(identities);
    for (const group of chunks) {
      const chunk = group.rows;
      const rowsByCorrelation = new Map(chunk.map(row => [row.row_key, row]));
      const requestEpochs = new Map(chunk.map(row => {
        const cacheKey = cacheKeyFor(surface, row);
        const epoch = ++requestSerial;
        latestRequests.set(cacheKey, epoch);
        return [cacheKey, epoch];
      }));
      try {
        const batch = await window.CloudTMSCandidateOfficeApi.fetchOfficeCandidateProjections({ surface, identities: chunk });
        if (requestedGeneration !== authorityGeneration || !canSurface(surface)) return;
        for (const item of batch.results) {
          const requestedRow = rowsByCorrelation.get(item.correlation_key) || null;
          if (!requestedRow) continue;
          const exactKey = cacheKeyFor(surface, requestedRow);
          if (latestRequests.get(exactKey) !== requestEpochs.get(exactKey)) continue;
          if (item.ok === true) {
            cache.set(exactKey, { projection: item.projection, observedAt: Date.now() });
            updateSlots(surface, item.correlation_key, item.projection, null, requestedRow);
          } else {
            updateSlots(surface, item.correlation_key, null, window.CloudTMSCandidateOfficeContract.normalizeCandidateOfficeError(item.error), requestedRow);
          }
        }
      } catch (error) {
        if (requestedGeneration !== authorityGeneration || !canSurface(surface)) return;
        const normalized = window.CloudTMSCandidateOfficeContract.normalizeCandidateOfficeError(error);
        chunk.forEach(row => {
          const exactKey = cacheKeyFor(surface, row);
          if (latestRequests.get(exactKey) === requestEpochs.get(exactKey)) {
            updateSlots(surface, row.row_key, null, normalized, row);
          }
        });
      }
    }
    slots.filter(slot => slot.isConnected).forEach(slot => {
      const row = rowFromSlot(slot);
      const found = findProjection(surface, row.row_key, row);
      if (found) updateSlots(surface, row.row_key, found, null, row);
    });
  }
  function flushBatch(surface) {
    batchTimers.delete(surface);
    const slots = Array.from(batchQueues.get(surface) || []);
    batchQueues.delete(surface);
    if (slots.length) hydrateBatch(surface, slots);
  }
  function queueBatchSlot(slot) {
    const surface = slot.dataset.candidateOfficeSurface;
    if (!batchQueues.has(surface)) batchQueues.set(surface, new Set());
    batchQueues.get(surface).add(slot);
    if (!batchTimers.has(surface)) batchTimers.set(surface, setTimeout(() => flushBatch(surface), 0));
  }
  function hydrateSlots(root = document) {
    const slots = [];
    if (root.matches?.('[data-candidate-office-slot="1"]')) slots.push(root);
    root.querySelectorAll?.('[data-candidate-office-slot="1"]').forEach(slot => slots.push(slot));
    slots.forEach(slot => {
      if (slot.dataset.candidateOfficeHydrated === '1') return;
      slot.dataset.candidateOfficeHydrated = '1';
      const surface = slot.dataset.candidateOfficeSurface;
      if (!canSurface(surface)) { slot.remove(); return; }
      if (surface === 'SIMPLE_TIMESHEET') loadSlot(slot);
      else queueBatchSlot(slot);
    });
  }
  function slotHtml(surface, row, { compact = surface === 'TIMESHEET_SUMMARY', variant = compact ? 'compact' : 'detail' } = {}) {
    if (!canSurface(surface)) return '';
    if (candidateProjectionNotApplicable(row)) return '';
    const identity = window.CloudTMSCandidateOfficeApi.buildIdentity(row);
    const existing = findProjection(surface, identity.row_key, identity);
    if (existing) {
      const view = surface === 'TIMESHEET_SUMMARY'
        ? window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(existing)
        : window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeDetail(existing, { surface });
      const content = window.CloudTMSCandidateOfficeSurface.renderCandidateFragment(view, { surface, variant });
      return `<div class="candidate-office-slot" data-candidate-office-slot="1" data-candidate-office-hydrated="1" data-candidate-office-variant="${attr(variant)}" data-candidate-office-surface="${attr(surface)}" data-row-key="${attr(identity.row_key)}" data-timesheet-id="${attr(identity.timesheet_id || '')}" data-contract-week-id="${attr(identity.contract_week_id || '')}" data-row-signature="${attr(identity.expected_row_signature || '')}" aria-live="polite">${content}</div>`;
    }
    return window.CloudTMSCandidateOfficeSurface.renderCandidateOfficeSlot({ surface, row, variant });
  }
  function embeddedSummaryResult(row) {
    if (row?.candidate_office_projection_loaded !== true) return null;
    const identity = window.CloudTMSCandidateOfficeApi.buildIdentity(row);
    if (candidateProjectionNotApplicable(row)) {
      return { identity,projection: null,error: null,notApplicable: true };
    }
    const rawProjection = row?.candidate_office_projection;
    if (rawProjection && typeof rawProjection === 'object') {
      try {
        const projection = window.CloudTMSCandidateOfficeContract.normalizeOfficeCandidateProjection(
          rawProjection,{ surface: 'TIMESHEET_SUMMARY', rowIdentity: identity }
        );
        if (!projectionMatchesRow(projection, identity)) {
          throw Object.assign(new Error('The embedded Candidate projection did not match this row.'), {
            code: 'CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID'
          });
        }
        cache.set(cacheKeyFor('TIMESHEET_SUMMARY', identity), { projection, observedAt: Date.now() });
        return { identity, projection, error: null };
      } catch (error) {
        return {
          identity,projection: null,
          error: window.CloudTMSCandidateOfficeContract.normalizeCandidateOfficeError(error)
        };
      }
    }
    return {
      identity,projection: null,
      error: window.CloudTMSCandidateOfficeContract.normalizeCandidateOfficeError(
        row?.candidate_office_projection_error || { code: 'CANDIDATE_OFFICE_PROJECTION_FAILED' }
      )
    };
  }
  function mountSummaryBadge(cell, row) {
    if (!row?.timesheet_id) return;
    const embedded = embeddedSummaryResult(row);
    if (embedded) {
      if (embedded.notApplicable) return;
      const slot = document.createElement('div');
      slot.className = 'candidate-office-slot';
      slot.dataset.candidateOfficeSlot = '1';
      slot.dataset.candidateOfficeHydrated = '1';
      slot.dataset.candidateOfficeVariant = 'compact';
      slot.dataset.candidateOfficeSurface = 'TIMESHEET_SUMMARY';
      slot.dataset.rowKey = embedded.identity.row_key;
      slot.dataset.timesheetId = embedded.identity.timesheet_id || '';
      slot.dataset.contractWeekId = embedded.identity.contract_week_id || '';
      slot.dataset.rowSignature = embedded.identity.expected_row_signature || '';
      slot.setAttribute('aria-live', 'polite');
      if (embedded.error) {
        slot.innerHTML = window.CloudTMSCandidateOfficeSurface.renderCandidateUnavailable(
          embedded.error,{ variant: 'compact' }
        );
      } else {
        const view = window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(
          embedded.projection
        );
        slot.innerHTML = window.CloudTMSCandidateOfficeSurface.renderCandidateFragment(
          view,{ surface: 'TIMESHEET_SUMMARY', variant: 'compact' }
        );
      }
      cell.appendChild(slot);
      queueMicrotask(() => window.dispatchEvent(new CustomEvent(
        'cloudtms:candidate-office-projection',
        { detail: { surface: 'TIMESHEET_SUMMARY', row_key: embedded.identity.row_key, ok: !embedded.error } }
      )));
      return;
    }
    if (!canSurface('TIMESHEET_SUMMARY')) return;
    const holder = document.createElement('span');
    holder.innerHTML = slotHtml('TIMESHEET_SUMMARY', row);
    cell.appendChild(holder.firstElementChild);
    hydrateSlots(cell);
  }
  function partitionProjectionIdentities(identities) {
    const chunks = [];
    for (const row of identities) {
      let chunk = chunks.find(candidate => candidate.rows.length < 100 && !candidate.rowKeys.has(row.row_key));
      if (!chunk) { chunk = { rows: [], rowKeys: new Set() }; chunks.push(chunk); }
      chunk.rows.push(row);
      chunk.rowKeys.add(row.row_key);
    }
    return chunks;
  }
  async function sortSummaryRowsByCandidateStatus(rows, direction = 'asc') {
    if (!canSurface('TIMESHEET_SUMMARY')) {
      throw Object.assign(new Error('Candidate Submission sorting is unavailable for this Office session.'), { code: 'CANDIDATE_OFFICE_PERMISSION_DENIED' });
    }
    const requestedRows = Array.isArray(rows) ? rows : [];
    const pendingRowsByExactKey = new Map();
    for (const row of requestedRows) {
      const identity = window.CloudTMSCandidateOfficeApi.buildIdentity(row);
      const embedded = embeddedSummaryResult(row);
      if (embedded?.notApplicable) continue;
      if (!findProjection('TIMESHEET_SUMMARY', identity.row_key, identity)) {
        pendingRowsByExactKey.set(cacheKeyFor('TIMESHEET_SUMMARY', identity), identity);
      }
    }
    const chunks = partitionProjectionIdentities(Array.from(pendingRowsByExactKey.values()));
    for (const group of chunks) {
      const chunk = group.rows;
      const batch = await window.CloudTMSCandidateOfficeApi.fetchOfficeCandidateProjections({
        surface: 'TIMESHEET_SUMMARY',
        identities: chunk
      });
      const byRowKey = new Map(chunk.map(identity => [identity.row_key, identity]));
      for (const item of batch.results) {
        const identity = byRowKey.get(item.correlation_key);
        if (!identity || item.ok !== true || !item.projection) {
          throw Object.assign(new Error('CloudTMS could not safely sort every Candidate Submission status.'), { code: item?.error?.code || 'CANDIDATE_OFFICE_PROJECTION_FAILED' });
        }
        cache.set(cacheKeyFor('TIMESHEET_SUMMARY', identity), { projection: item.projection, observedAt: Date.now() });
      }
    }
    const collator = new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true });
    const descending = String(direction || '').toLowerCase() === 'desc';
    return requestedRows.map((row, index) => {
      const identity = window.CloudTMSCandidateOfficeApi.buildIdentity(row);
      const projection = findProjection('TIMESHEET_SUMMARY', identity.row_key, identity);
      const view = projection ? window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary(projection) : null;
      return { row, index, label: String(view?.status?.label || '') };
    }).sort((left, right) => {
      if (!left.label && right.label) return 1;
      if (left.label && !right.label) return -1;
      const compared = collator.compare(left.label, right.label);
      if (compared) return descending ? -compared : compared;
      const candidateCompared = collator.compare(String(left.row?.candidate_name || ''), String(right.row?.candidate_name || ''));
      if (candidateCompared) return candidateCompared;
      return left.index - right.index;
    }).map(item => item.row);
  }
  function selectedSummaryRows(rows) {
    const snapshot = typeof window.getSelectionSnapshot === 'function' ? window.getSelectionSnapshot('timesheets') : { included_ids: [] };
    if (snapshot.mode === 'all_filtered') return rows.filter(row => typeof window.isRowSelected === 'function' && window.isRowSelected('timesheets', row.id));
    const selected = new Set(snapshot.included_ids || snapshot.ids || []);
    return rows.filter(row => selected.has(String(row.id)));
  }
  function createSummaryReminderButton({ rows }) {
    if (!capabilities?.permissions?.send_manager_reminder_batch || !canSurface('TIMESHEET_SUMMARY') || !window.CloudTMSCandidateOfficeUiPolicy?.isButtonApproved('TIMESHEET_SUMMARY', 'SEND_MANAGER_REMINDER_BATCH')) return null;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'candidate-office-summary-reminders'; button.textContent = 'Send Manager Reminders'; button.disabled = true;
    const sync = () => { const selected = selectedSummaryRows(rows()); button.disabled = !selected.some(row => { const identity = window.CloudTMSCandidateOfficeApi.buildIdentity(row); const projection = findProjection('TIMESHEET_SUMMARY', identity.row_key, identity); return projection?.available_actions?.some(action => action.code === 'SEND_MANAGER_REMINDER' && action.enabled); }); };
    button.addEventListener('click', async () => { const selected = selectedSummaryRows(rows()); if (selected.length) await controller.runReminderBatch({ rows: selected, trigger: button, surface: 'TIMESHEET_SUMMARY' }); sync(); });
    document.addEventListener('change', event => { if (event.target?.classList?.contains('row-select')) queueMicrotask(sync); });
    window.addEventListener('cloudtms:candidate-office-projection', event => { if (event.detail?.surface === 'TIMESHEET_SUMMARY') sync(); });
    setTimeout(sync, 0);
    return button;
  }
  function contextForSlot(slot, trigger) {
    const surface = slot.dataset.candidateOfficeSurface;
    const identity = rowFromSlot(slot);
    const projection = findProjection(surface, identity.row_key, identity);
    return { surface, identity, projection, trigger, dirtyGuard: surface === 'BULK_PROCESS' || surface === 'BULK_AUTHORISE' };
  }
  async function onClick(event) {
    const refresh = event.target.closest('[data-candidate-office-refresh]');
    if (refresh) { const slot = refresh.closest('[data-candidate-office-slot]'); if (slot) await loadSlot(slot, { force: true }); return; }
    const evidenceButton = event.target.closest('[data-candidate-office-evidence-action]');
    if (evidenceButton && !evidenceButton.disabled) {
      const slot = evidenceButton.closest('[data-candidate-office-slot]');
      if (!slot) return;
      event.preventDefault(); event.stopPropagation();
      const viewMode = evidenceButton.dataset.candidateOfficeEvidenceMode === 'view';
      const viewer = viewMode ? window.open('about:blank', '_blank') : null;
      if (viewMode && !viewer) {
        toast('Your browser prevented CloudTMS from opening the QR Pack. Allow pop-ups for CloudTMS and try again.', 'fail');
        return;
      }
      if (viewer) {
        try {
          viewer.opener = null;
          viewer.document.title = 'Opening Unsigned QR Pack…';
          viewer.document.body.textContent = 'CloudTMS is checking and opening the current Unsigned QR Pack…';
        } catch {}
      }
      evidenceButton.disabled = true;
      try {
        const freshProjection = await loadSlot(slot, { force: true });
        const actionCode = evidenceButton.dataset.candidateOfficeEvidenceAction;
        const action = freshProjection?.available_actions?.find(item => item.code === actionCode && item.enabled === true);
        if (!action || window.CloudTMSCandidateOfficeUiPolicy?.ownerOf(action.code) !== 'OFFICE_EVIDENCE') {
          throw Object.assign(new Error('This QR Pack is no longer available. Refresh the timesheet.'), { code: 'CANDIDATE_CONTEXT_STALE' });
        }
        const result = await window.CloudTMSCandidateOfficeApi.invokeOfficeCandidateAction({ action, userInputs: {}, idempotencyKey: null });
        if (!(result instanceof Blob)) {
          throw Object.assign(new Error('CloudTMS did not return the expected QR Pack PDF.'), { code: 'CANDIDATE_OFFICE_CONTRACT_INVALID' });
        }
        const signature = await result.slice(0, 5).text();
        if (signature !== '%PDF-') {
          throw Object.assign(new Error('CloudTMS did not return a valid QR Pack PDF.'), { code: 'CANDIDATE_OFFICE_CONTRACT_INVALID' });
        }
        const url = URL.createObjectURL(result);
        if (evidenceButton.dataset.candidateOfficeEvidenceMode === 'download') {
          const link = document.createElement('a');
          link.href = url;
          link.download = 'Unsigned QR Pack.pdf';
          document.body.appendChild(link);
          link.click();
          link.remove();
        } else {
          const viewerDocument = viewer.document;
          viewerDocument.title = 'Unsigned QR Pack';
          viewerDocument.body.replaceChildren();
          viewerDocument.body.style.margin = '0';
          viewerDocument.body.style.height = '100vh';
          viewerDocument.body.style.overflow = 'hidden';
          const frame = viewerDocument.createElement('iframe');
          frame.src = url;
          frame.title = 'Unsigned QR Pack';
          frame.setAttribute('aria-label', 'Unsigned QR Pack PDF');
          frame.style.width = '100%';
          frame.style.height = '100%';
          frame.style.border = '0';
          viewerDocument.body.appendChild(frame);
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (error) {
        try { viewer?.close(); } catch {}
        toast(window.CloudTMSCandidateOfficeContract.normalizeCandidateOfficeError(error).message, 'fail');
      } finally {
        evidenceButton.disabled = false;
      }
      return;
    }
    const button = event.target.closest('[data-candidate-office-action]');
    if (!button || button.disabled) return;
    const slot = button.closest('[data-candidate-office-slot]');
    if (!slot) return;
    event.preventDefault(); event.stopPropagation();
    const context = contextForSlot(slot, button);
    const action = context.projection?.available_actions?.find(item => item.code === button.dataset.candidateOfficeAction)
      || context.projection?.rejections?.map(item => item.recovery_action).find(item => item?.code === button.dataset.candidateOfficeAction);
    if (!action) { toast('Refresh the current Candidate state before continuing.', 'fail'); return; }
    await controller.runTypedAction({ ...context, action });
  }
  function legacySurface(button) {
    if (button.id?.startsWith('bulkProcess')) return 'BULK_PROCESS';
    if (button.id?.startsWith('bulkAuth')) return 'BULK_AUTHORISE';
    return 'SIMPLE_TIMESHEET';
  }
  function visibleDetailSlot(surface) {
    const preferredVariants = surface === 'SIMPLE_TIMESHEET' ? ['overview', 'actions', 'stage'] : ['detail'];
    for (const variant of preferredVariants) {
      const found = Array.from(document.querySelectorAll(`[data-candidate-office-slot="1"][data-candidate-office-surface="${surface}"][data-candidate-office-variant="${variant}"]`)).find(slot => slot.offsetParent !== null);
      if (found) return found;
    }
    return null;
  }
  async function onLegacyRouteClick(event) {
    if (!capabilities?.permissions?.change_route) return;
    const button = event.target.closest('[data-ts-action="switch-manual"], [data-ts-action="qr-convert-manual-only"], [data-ts-action="allow-qr-again"], [data-ts-action="allow-electronic-again"], [data-bulk-authorise-route-action="switch-manual"], [data-bulk-authorise-route-action="qr-convert-manual-only"]');
    if (!button || button.disabled) return;
    const surface = legacySurface(button);
    const slot = visibleDetailSlot(surface);
    if (!slot) return;
    const context = contextForSlot(slot, button);
    if (!context.identity.timesheet_id) return;
    const legacyAction = button.dataset.bulkAuthoriseRouteAction || button.dataset.tsAction;
    let routeAction = null;
    if (legacyAction === 'qr-convert-manual-only') routeAction = 'CONVERT_QR_TO_MANUAL';
    if (legacyAction === 'allow-qr-again') routeAction = 'ALLOW_QR_AGAIN';
    if (legacyAction === 'allow-electronic-again') routeAction = 'ALLOW_ELECTRONIC_AGAIN';
    if (legacyAction === 'switch-manual') {
      const stateRow = surface === 'BULK_PROCESS'
        ? (window.modalCtx?.bulkProcessState?.active_row || window.modalCtx?.bulkProcessState?.active_ctx?.row)
        : surface === 'BULK_AUTHORISE'
          ? (window.modalCtx?.bulkAuthoriseState?.active_row || window.modalCtx?.bulkAuthoriseState?.active_ctx?.row)
          : window.modalCtx?.timesheetDetails;
      const scope = String(stateRow?.sheet_scope || stateRow?.timesheet?.sheet_scope || context.projection?.workflow?.workflow_kind || '').toUpperCase();
      if (!scope) { event.preventDefault(); event.stopImmediatePropagation(); toast('Refresh this timesheet before changing its route.', 'fail'); return; }
      routeAction = scope === 'DAILY' ? 'SWITCH_DAILY_TO_MANUAL' : 'SWITCH_TO_MANUAL';
    }
    if (!routeAction) return;
    if (!window.CloudTMSCandidateOfficeUiPolicy?.isButtonApproved(surface, `ROUTE:${routeAction}`)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    await controller.runRouteAction({ ...context, action: routeAction });
  }
  function invalidate(context) {
    const surface = context.surface;
    const rowKey = context.identity?.row_key || context.projection?.current_identity?.row_key;
    for (const [cacheKey, entry] of Array.from(cache.entries())) {
      const current = entry?.projection?.current_identity || {};
      if (String(current.row_key || '') !== String(rowKey || '')) continue;
      if (!surface || cacheKey.startsWith(`${surface}:`)) cache.delete(cacheKey);
    }
  }
  async function refetch(context) {
    const rowKey = context.identity?.row_key || context.projection?.current_identity?.row_key;
    const slots = Array.from(document.querySelectorAll(`[data-candidate-office-slot="1"][data-row-key="${CSS.escape(rowKey || '')}"]`));
    await Promise.all(slots.map(slot => loadSlot(slot, { force: true })));
  }
  async function refreshAffectedRows(result, context) {
    const sourceContext = context.surface === 'BULK_PROCESS' ? 'bulk_process' : context.surface === 'BULK_AUTHORISE' ? 'bulk_authorise' : 'timesheet_modal';
    if (typeof window.refreshTimesheetLifecycleAffectedRows === 'function') {
      await window.refreshTimesheetLifecycleAffectedRows(result, { context: sourceContext, max_items: 100, apply: true, network: 'auto' });
    } else {
      const id = result?.current_timesheet_id || result?.timesheet_id || context.identity?.timesheet_id;
      if (id && typeof window.refreshTimesheetsSummaryAfterRotation === 'function') await window.refreshTimesheetsSummaryAfterRotation(id, { allowRenderAll: true });
    }
    await refetch(context);
  }
  function dirtyGuard(context) {
    if (context.surface === 'BULK_AUTHORISE' && typeof window.hasBulkAuthoriseGenuineDirtyEdits === 'function') return !window.hasBulkAuthoriseGenuineDirtyEdits(window.modalCtx?.bulkAuthoriseState || {});
    if (context.surface === 'BULK_PROCESS') return !(window.modalCtx?.bulkProcessState?.dirty === true || window.modalCtx?.bulkProcessState?.manual_dirty === true);
    return true;
  }
  const canonicalJson = value => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  };
  async function ensureFresh(context) {
    const surface = context.surface;
    const identity = context.identity || context.projection?.current_identity;
    if (!surface || !identity) return false;
    const projection = surface === 'SIMPLE_TIMESHEET' && identity.timesheet_id
      ? await window.CloudTMSCandidateOfficeApi.fetchOfficeCandidateProjection({ timesheetId: identity.timesheet_id, rowIdentity: identity })
      : (await window.CloudTMSCandidateOfficeApi.fetchOfficeCandidateProjections({ surface, identities: [identity] })).results[0]?.projection;
    if (!projection) return false;
    const rowKey = identity.row_key || projection.current_identity?.row_key;
    cache.set(cacheKeyFor(surface, identity), { projection, observedAt: Date.now() });
    updateSlots(surface, rowKey, projection);
    const sourceAction = context.action && typeof context.action === 'object' ? context.action : context.rejectionAction;
    if (!sourceAction?.code) return { projection };
    const candidates = [
      ...(projection.available_actions || []),
      ...(projection.rejections || []).map(item => item.recovery_action).filter(Boolean)
    ];
    const action = candidates.find(item => item.code === sourceAction.code);
    if (!action?.enabled) return false;
    if (action.invocation.method !== sourceAction.invocation?.method || action.invocation.path !== sourceAction.invocation?.path || canonicalJson(action.invocation.fixed_body) !== canonicalJson(sourceAction.invocation?.fixed_body || {})) return false;
    return { projection, action };
  }
  function initialize(capabilityContract) {
    authorityGeneration += 1;
    capabilities = capabilityContract;
    if (initialized) {
      hydrateSlots();
      window.dispatchEvent(new CustomEvent('cloudtms:candidate-office-ready', { detail: { contract_version: capabilities.contract_version } }));
      return;
    }
    initialized = true;
    controller = window.CloudTMSCandidateOfficeController.createCandidateOfficeActionController({ api: window.CloudTMSCandidateOfficeApi, modals: window.CloudTMSCandidateOfficeModals, runDirtyGuard: dirtyGuard, ensureFresh, invalidateProjection: invalidate, refetchProjection: refetch, refreshAffectedRows, applyRowPatch: async () => {}, showToast: toast, createIdempotencyKey: () => crypto.randomUUID() });
    document.addEventListener('click', onClick, true);
    document.addEventListener('click', onLegacyRouteClick, true);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => { if (node.nodeType === 1) hydrateSlots(node); }))).observe(document.body, { childList: true, subtree: true });
    hydrateSlots();
    window.dispatchEvent(new CustomEvent('cloudtms:candidate-office-ready', { detail: { contract_version: capabilities.contract_version } }));
  }
  function deactivate() {
    authorityGeneration += 1;
    capabilities = null;
    cache.clear();
    pending.clear();
    latestRequests.clear();
    batchQueues.clear();
    for (const timer of batchTimers.values()) clearTimeout(timer);
    batchTimers.clear();
    document.querySelectorAll('[data-candidate-office-slot="1"]').forEach(slot => {
      slot.dataset.candidateOfficeHydrated = '0';
      slot.replaceChildren();
    });
    document.documentElement.removeAttribute('data-candidate-office-contract');
  }
  Object.assign(window, { CloudTMSCandidateOfficeBridge: Object.freeze({ initialize, deactivate, hydrateSlots, hydrateBatch, slotHtml, embeddedSummaryResult, candidateProjectionNotApplicable, mountSummaryBadge, sortSummaryRowsByCandidateStatus, createSummaryReminderButton, findProjection, loadSlot, invalidate, refetch, get capabilities() { return capabilities; }, get controller() { return controller; } }) });
})();

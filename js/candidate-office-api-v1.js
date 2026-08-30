(() => {
  'use strict';
  const contract = () => window.CloudTMSCandidateOfficeContract;
  const officeAuthFetch = () => {
    if (typeof authFetch === 'function') return authFetch;
    if (typeof window.authFetch === 'function') return window.authFetch;
    return null;
  };
  const officeApiUrl = path => {
    if (typeof API === 'function') return API(path);
    if (typeof window.API === 'function') return window.API(path);
    const base = String(window.BROKER_BASE_URL || '').replace(/\/+$/, '');
    return base ? `${base}${path}` : '';
  };
  async function request(path, { method = 'GET', body, signal, responseType = 'json', headers = {} } = {}) {
    const fetcher = officeAuthFetch();
    const url = officeApiUrl(path);
    if (!fetcher || !url) throw Object.assign(new Error('CloudTMS Office request service is unavailable.'), { code: 'CANDIDATE_OFFICE_TRANSPORT_UNAVAILABLE' });
    const init = { method, headers: { ...headers }, signal };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response;
    try { response = await fetcher(url, init); }
    catch (error) { throw Object.assign(error, { code: error.code || 'CANDIDATE_OFFICE_NETWORK_ERROR', requestBody: body }); }
    if (responseType === 'blob' && response.ok) return response.blob();
    const rawText = await response.text().catch(() => '');
    let payload = {};
    try { payload = rawText ? JSON.parse(rawText) : {}; } catch { payload = { message: rawText }; }
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.message || `Candidate Office request failed (${response.status}).`);
      error.status = response.status;
      error.payload = payload;
      error.code = payload?.error_code || payload?.code || 'CANDIDATE_OFFICE_REQUEST_FAILED';
      error.requestBody = body;
      throw error;
    }
    return payload;
  }
  const buildIdentity = row => contract().normalizeOfficeCandidateIdentity({
    row_key: row.row_key || row.id || row.timesheet_id || row.contract_week_id,
    timesheet_id: row.timesheet_id || row.current_timesheet_id || null,
    contract_week_id: row.contract_week_id || null,
    expected_row_signature: row.backend_row_signature || row.row_signature || row.expected_row_signature || null
  });
  async function fetchOfficeCandidateCapabilities({ signal } = {}) { return contract().normalizeOfficeCandidateCapabilities(await request('/api/candidate-app/office-capabilities', { signal })); }
  async function fetchOfficeCandidateProjection({ timesheetId, rowIdentity = null, signal }) {
    const identity = rowIdentity ? contract().normalizeOfficeCandidateIdentity(rowIdentity) : null;
    const id = String(timesheetId || identity?.timesheet_id || '').trim();
    if (!id) throw new Error('A timesheet identity is required.');
    if (identity?.timesheet_id && identity.timesheet_id !== id) throw Object.assign(new Error('The requested timesheet identity is inconsistent.'), { code: 'CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID' });
    const params = new URLSearchParams();
    if (identity?.row_key) params.set('row_key', identity.row_key);
    if (identity?.contract_week_id) params.set('contract_week_id', identity.contract_week_id);
    if (identity?.expected_row_signature) params.set('expected_row_signature', identity.expected_row_signature);
    const query = params.size ? `?${params.toString()}` : '';
    const raw = await request(`/api/candidate-app/timesheets/${encodeURIComponent(id)}/office-detail${query}`, { signal });
    return contract().normalizeOfficeCandidateProjection(raw, { surface: 'SIMPLE_TIMESHEET', rowIdentity: identity });
  }
  async function fetchOfficeCandidateProjections({ surface, identities, signal }) {
    if (!Array.isArray(identities) || !identities.length || identities.length > 100) throw new Error('Between 1 and 100 row identities are required.');
    const selected_rows = identities.map(identity => contract().normalizeOfficeCandidateIdentity(identity));
    const raw = await request('/api/candidate-app/timesheets/office-projections', { method: 'POST', body: { surface, selected_rows }, signal });
    return contract().normalizeOfficeCandidateProjectionBatch(raw, { surface, identities: selected_rows });
  }
  async function previewCandidateRouteChange({ timesheetId, action, signal }) {
    return contract().normalizeCandidateRoutePreview(await request(`/api/candidate-app/timesheets/${encodeURIComponent(timesheetId)}/route-preview?action=${encodeURIComponent(action)}`, { signal }));
  }
  async function confirmCandidateRouteChange({ timesheetId, preview, reasonCode, reasonNote, idempotencyKey, allowManualOnly = false, signal }) {
    const normalized = contract().normalizeCandidateRoutePreview(preview);
    return request(`/api/candidate-app/timesheets/${encodeURIComponent(timesheetId)}/route-confirm`, { method: 'POST', signal, body: {
      expected_timesheet_id: normalized.expected_timesheet_id,
      expected_row_signature: normalized.expected_row_signature || normalized.row_signature,
      expected_context_sha256: normalized.context_sha256,
      action: normalized.permitted_action,
      reason_code: reasonCode || null,
      reason_note: reasonNote || null,
      allow_manual_only: allowManualOnly === true,
      idempotency_key: idempotencyKey
    } });
  }
  async function previewCandidateRejection({ invocation = null, timesheetId = null, signal }) {
    const path = invocation?.path || `/api/candidate-app/timesheets/${encodeURIComponent(timesheetId)}/reject-preview`;
    return contract().normalizeCandidateRejectPreview(await request(path, { method: 'GET', signal }));
  }
  async function confirmCandidateRejection({ timesheetId, preview, reason, idempotencyKey, signal }) {
    const normalized = contract().normalizeCandidateRejectPreview(preview);
    return request(`/api/candidate-app/timesheets/${encodeURIComponent(timesheetId || normalized.expected_timesheet_id)}/reject`, { method: 'POST', signal, body: {
      expected_timesheet_id: normalized.expected_timesheet_id,
      expected_row_signature: normalized.expected_row_signature,
      context_sha256: normalized.context_sha256,
      reason,
      idempotency_key: idempotencyKey
    } });
  }
  async function invokeOfficeCandidateAction({ action, userInputs = {}, idempotencyKey = null, signal }) {
    const normalized = contract().normalizeOfficeCandidateAction(action);
    if (!normalized.enabled) throw Object.assign(new Error(normalized.disabled_reason || 'This action is not currently available.'), { code: normalized.disabled_reason_code || 'CANDIDATE_ACTION_NOT_ELIGIBLE' });
    if (normalized.invocation.kind === 'CLIENT_DESTINATION') return Object.freeze({ ok: true, client_destination: normalized.invocation.path, fixed_body: normalized.invocation.fixed_body });
    if (normalized.invocation.method === 'GET') return request(normalized.invocation.path, { method: 'GET', signal, responseType: normalized.code.includes('PACK') || normalized.code.includes('DOCUMENT') ? 'blob' : 'json' });
    const body = { ...normalized.invocation.fixed_body };
    for (const input of normalized.invocation.required_user_inputs) {
      const name = String(input.name || '').trim();
      if (!name) continue;
      const value = userInputs[name];
      if (input.required === true && (value == null || String(value).trim() === '')) throw Object.assign(new Error(`${name.replaceAll('_', ' ')} is required.`), { code: 'CANDIDATE_REASON_REQUIRED', field: name });
      if (value != null) body[name] = value;
    }
    if (normalized.invocation.idempotency === 'REQUIRED') {
      const key = String(idempotencyKey || '').trim();
      if (!key || key.length > 200) throw Object.assign(new Error('A valid Candidate Office operation key is required.'), { code: 'CANDIDATE_IDEMPOTENCY_KEY_REQUIRED' });
      body.idempotency_key = key;
    }
    return request(normalized.invocation.path, { method: 'POST', body, signal });
  }
  function normalizeManagerReminderSelection(selection) {
    const source = selection && typeof selection === 'object' && !Array.isArray(selection) ? selection : {};
    const mode = String(source.mode || '').trim().toUpperCase();
    if (!['EXPLICIT', 'ALL_ELIGIBLE'].includes(mode)) throw Object.assign(new Error('The manager reminder selection mode is invalid.'), { code: 'CANDIDATE_REMINDER_BATCH_SELECTION_INVALID' });
    const normalizeKeys = (value, name) => {
      if (!Array.isArray(value) || value.length > 1000) throw Object.assign(new Error(`The manager reminder ${name} selection is invalid.`), { code: 'CANDIDATE_REMINDER_BATCH_SELECTION_INVALID' });
      const keys = [...new Set(value.map(item => String(item || '').trim()))];
      if (keys.some(item => !item || item.length > 256)) throw Object.assign(new Error(`The manager reminder ${name} selection is invalid.`), { code: 'CANDIDATE_REMINDER_BATCH_SELECTION_INVALID' });
      return keys;
    };
    const included = normalizeKeys(source.included_row_keys || [], 'included');
    const excluded = normalizeKeys(source.excluded_row_keys || [], 'excluded');
    if ((mode === 'EXPLICIT' && (!included.length || excluded.length)) || (mode === 'ALL_ELIGIBLE' && included.length)) {
      throw Object.assign(new Error('The manager reminder selection is inconsistent.'), { code: 'CANDIDATE_REMINDER_BATCH_SELECTION_INVALID' });
    }
    return Object.freeze({ mode, included_row_keys: Object.freeze(included), excluded_row_keys: Object.freeze(excluded) });
  }
  async function fetchManagerReminderEligibility({ page = 1, pageSize = 25, catalogueRevision = null, surnameQuery = '', sortBy = 'CANDIDATE_SURNAME', sortDirection = 'ASC', signal } = {}) {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('The manager reminder page request is invalid.');
    const query = String(surnameQuery || '').trim();
    const order = String(sortBy || '').trim().toUpperCase();
    const direction = String(sortDirection || '').trim().toUpperCase();
    if (query.length > 100 || !['CANDIDATE_SURNAME', 'LAST_MANAGER_EMAIL'].includes(order) || !['ASC', 'DESC'].includes(direction)) throw new Error('The manager reminder filter or sort request is invalid.');
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (catalogueRevision) params.set('catalogue_revision', String(catalogueRevision));
    if (query) params.set('surname_query', query);
    params.set('sort_by', order);
    params.set('sort_direction', direction);
    return contract().normalizeManagerReminderEligibilityPage(await request(`/api/candidate-app/manager-reminder-eligibility?${params.toString()}`, { signal }));
  }
  async function previewManagerReminderSelection({ selection, catalogueRevision, signal }) {
    const normalizedSelection = normalizeManagerReminderSelection(selection);
    return contract().normalizeManagerReminderBatchPreview(await request('/api/candidate-app/manager-reminder-batches/preview', {
      method: 'POST', signal, body: { catalogue_revision: catalogueRevision, selection: normalizedSelection }
    }));
  }
  async function executeManagerReminderSelection({ selection, catalogueRevision, preview, batchId, idempotencyKey, signal }) {
    const normalizedSelection = normalizeManagerReminderSelection(selection);
    return contract().normalizeManagerReminderBatchResult(await request('/api/candidate-app/manager-reminder-batches', { method: 'POST', signal, body: {
      catalogue_revision: catalogueRevision,
      selection: normalizedSelection,
      selected_rows: preview.selected_rows,
      batch_id: batchId,
      idempotency_key: idempotencyKey,
      preview_context_hash: preview.preview_context_hash,
      selection_fingerprint: preview.selection_fingerprint
    } }));
  }
  async function previewManagerReminderBatch({ identities, signal }) { return request('/api/candidate-app/manager-reminder-batches/preview', { method: 'POST', body: { selected_rows: identities.map(buildIdentity) }, signal }); }
  async function executeManagerReminderBatch({ identities, preview, batchId, idempotencyKey, signal }) {
    return request('/api/candidate-app/manager-reminder-batches', { method: 'POST', signal, body: {
      selected_rows: identities.map(buildIdentity),
      batch_id: batchId,
      idempotency_key: idempotencyKey,
      preview_context_hash: preview.preview_context_hash,
      selection_fingerprint: preview.selection_fingerprint
    } });
  }
  async function fetchManagerReminderBatch({ batchId, signal }) {
    return contract().normalizeManagerReminderBatchResult(
      await request(`/api/candidate-app/manager-reminder-batches/${encodeURIComponent(batchId)}`, { signal })
    );
  }
  async function fetchCandidateDocument({ path, signal }) {
    if (!String(path || '').startsWith('/api/candidate-app/')) throw new Error('The Candidate document path is invalid.');
    return request(path, { method: 'GET', signal, responseType: 'blob' });
  }
  Object.assign(window, { CloudTMSCandidateOfficeApi: Object.freeze({ request, buildIdentity, fetchOfficeCandidateCapabilities, fetchOfficeCandidateProjection, fetchOfficeCandidateProjections, previewCandidateRouteChange, confirmCandidateRouteChange, previewCandidateRejection, confirmCandidateRejection, invokeOfficeCandidateAction, normalizeManagerReminderSelection, fetchManagerReminderEligibility, previewManagerReminderSelection, executeManagerReminderSelection, previewManagerReminderBatch, executeManagerReminderBatch, fetchManagerReminderBatch, fetchCandidateDocument }) });
})();

(() => {
  'use strict';

  const CAPABILITY_CACHE_KEY = 'cloudtms.invoiceAsyncCapabilities.v8';
  const WATCH_STORAGE_KEY_PREFIX = 'cloudtms.invoiceOperationWatches.v8';
  const LEGACY_WATCH_STORAGE_KEY = 'cloudtms.invoiceOperationWatches.v8';
  const EXPECTED_BACKEND_CONTRACT = 'INVOICE_ASYNC_BACKEND_V8';
  const EXPECTED_DOCUMENT_CONTRACT = 'INVOICE_DOCUMENT_VERSION_ACCESS_V1';
  const SUPPORTED_MEDIA = Object.freeze(['application/pdf', 'image/jpeg', 'image/png']);
  const REQUIRED_FEATURES = Object.freeze([
    'batch_candidate_paging_v2',
    'batch_selection_rules_v2',
    'batch_selection_summary_v2',
    'batch_facets_v2',
    'batch_result_paging_v2',
    'generate_and_view_v2',
    'exact_document_version_access_v1',
    'separate_issue_delivery_state_v2',
    'bounded_viewer_contract_v2'
  ]);
  const MAX_WATCHES = 100;
  const DOCUMENT_FOREGROUND_WATCH_FAST_MS = 30 * 1000;
  const DOCUMENT_FOREGROUND_WATCH_MEDIUM_MS = 2 * 60 * 1000;
  const DOCUMENT_FOREGROUND_WATCH_MAX_MS = 5 * 60 * 1000;
  const ACTIVE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const TERMINAL_UNHANDLED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const TERMINAL_HANDLED_GRACE_MS = 15 * 60 * 1000;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const TERMINAL = new Set(['COMPLETE', 'FAILED', 'DEAD_LETTER', 'BLOCKED', 'CANCELLED', 'SUPERSEDED']);
  const ACTIVE = new Set(['SUBMITTED', 'QUEUED', 'RUNNING', 'WAITING', 'RETRY_WAIT']);
  const OPERATION_ARRAY_FIELDS = Object.freeze([
    'operations',
    'per_command_results',
    'issue_results',
    'delivery_results',
    'children',
    'child_operations',
    'document_operations',
    'delivery_operations',
    'watched_invoice_operations'
  ]);

  let capabilityPromise = null;
  let installed = false;
  let delegatedClickInstalled = false;
  let refreshTimer = null;
  let activeWatchStorageKey = null;
  const activeInvoiceViewers = new Map();
  const invoiceDocumentForegroundWatches = new Map();

  const clean = value => String(value == null ? '' : value).trim();
  const upper = value => clean(value).toUpperCase();
  const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const asArray = value => Array.isArray(value) ? value : [];
  const nowIso = () => new Date().toISOString();
  const invoiceApi = path => `${window.BROKER_BASE_URL || ''}${path}`;
  const escapeHtml = value => clean(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  async function invoiceAsyncUiNotice(message, title = 'Invoice') {
    const text = clean(message) || 'The invoice action could not be completed.';
    const openConfirm = window.openUiConfirmModal;
    if (typeof openConfirm === 'function') {
      await openConfirm({
        title,
        message: text,
        confirm_label: 'OK',
        hide_cancel: true,
        kind: 'invoice-async-ui-notice',
        suppress_parent_persist: true
      });
      return;
    }
    try { window.__toast?.(text); } catch {}
  }

  function invoiceAsyncIdentity() {
    const userId = clean(window.__USER_ID || window.__auth?.user?.id || window.SESSION?.user?.id).toLowerCase();
    const environment = clean(window.location?.host || 'unknown').toLowerCase();
    return UUID_RE.test(userId) ? { environment, user_id: userId } : null;
  }

  function capabilityCacheKey() {
    const identity = invoiceAsyncIdentity();
    return identity
      ? `${CAPABILITY_CACHE_KEY}:${identity.environment}:${identity.user_id}`
      : null;
  }

  function operationWatchStorageKey() {
    const identity = invoiceAsyncIdentity();
    return identity
      ? `${WATCH_STORAGE_KEY_PREFIX}:${identity.environment}:${identity.user_id}`
      : null;
  }

  function exactMediaContract(value) {
    const media = asArray(value).map(item => clean(item).toLowerCase()).filter(Boolean);
    return media.length === SUPPORTED_MEDIA.length
      && SUPPORTED_MEDIA.every((item, index) => media[index] === item);
  }

  function featureEnabled(payload, key) {
    return payload?.[key] === true || payload?.feature_flags?.[key] === true;
  }

  function validateInvoiceAsyncCapabilities(value) {
    const source = asObject(value);
    const backendContract = clean(source.backend_contract_version || source.contract_version);
    if (backendContract !== EXPECTED_BACKEND_CONTRACT) {
      throw new Error('INVOICE_ASYNC_CAPABILITY_CONTRACT_MISMATCH');
    }
    if (clean(source.document_view_contract_version) !== EXPECTED_DOCUMENT_CONTRACT) {
      throw new Error('INVOICE_DOCUMENT_ACCESS_CONTRACT_MISMATCH');
    }
    if (!exactMediaContract(source.supported_media_types)) {
      throw new Error('INVOICE_ASYNC_MEDIA_CONTRACT_MISMATCH');
    }
    if (source.heartbeat_supported !== true) {
      throw new Error('INVOICE_ASYNC_REQUIRED_FEATURE_MISSING');
    }
    const documentReadReady = source.document_read_ready === true
      || (source.document_read_ready == null && source.deployment_contract_ready === true);
    const documentGenerationReady = source.document_generation_ready === true
      || (source.document_generation_ready == null && source.deployment_contract_ready === true);
    if (documentGenerationReady && REQUIRED_FEATURES.some(key => !featureEnabled(source, key))) {
      throw new Error('INVOICE_ASYNC_REQUIRED_FEATURE_MISSING');
    }
    if (!documentReadReady) {
      throw new Error('INVOICE_ASYNC_DEPLOYMENT_CONTRACT_MISMATCH');
    }
    const generationReady = documentGenerationReady
      && source.database_contract_ready === true
      && source.deployment_contract_ready === true
      && source.pipeline_enabled === true
      && source.processor_enabled === true;
    return Object.freeze({
      available: true,
      contract_version: backendContract,
      backend_contract_version: backendContract,
      database_contract_ready: source.database_contract_ready === true,
      deployment_contract_ready: source.deployment_contract_ready === true,
      document_read_ready: documentReadReady,
      document_generation_ready: generationReady,
      pipeline_enabled: source.pipeline_enabled === true,
      processor_enabled: source.processor_enabled === true,
      enabled_for_user: source.enabled_for_user === true && generationReady,
      controlled_cohort: source.controlled_cohort === true,
      scheduled_enabled: source.scheduled_enabled === true,
      heartbeat_supported: true,
      supported_media_types: Object.freeze([...SUPPORTED_MEDIA]),
      document_view_contract_version: EXPECTED_DOCUMENT_CONTRACT,
      feature_flags: Object.freeze(Object.fromEntries(
        REQUIRED_FEATURES.map(key => [key, featureEnabled(source, key)])
      ))
    });
  }

  function unavailableCapabilities(errorCode = 'INVOICE_ASYNC_CAPABILITY_UNAVAILABLE') {
    return Object.freeze({
      available: false,
      database_contract_ready: false,
      deployment_contract_ready: false,
      document_read_ready: false,
      document_generation_ready: false,
      enabled_for_user: false,
      pipeline_enabled: false,
      processor_enabled: false,
      controlled_cohort: false,
      scheduled_enabled: false,
      heartbeat_supported: false,
      supported_media_types: Object.freeze([]),
      error_code: clean(errorCode) || 'INVOICE_ASYNC_CAPABILITY_UNAVAILABLE'
    });
  }

  function readCachedInvoiceAsyncCapabilities() {
    try {
      const key = capabilityCacheKey();
      if (!key) return null;
      const envelope = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!envelope || clean(envelope.cache_version) !== 'V8') return null;
      if (Date.parse(envelope.expires_at_utc) <= Date.now()) return null;
      return validateInvoiceAsyncCapabilities(envelope.capabilities);
    } catch {
      return null;
    }
  }

  function cacheInvoiceAsyncCapabilities(capabilities) {
    try {
      const key = capabilityCacheKey();
      if (key) {
        if (capabilities?.available === true) {
          sessionStorage.setItem(key, JSON.stringify({
            cache_version: 'V8',
            cached_at_utc: nowIso(),
            expires_at_utc: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            capabilities
          }));
        }
        else sessionStorage.removeItem(key);
      }
    } catch {}
    window.__invoiceAsyncCapability = capabilities;
    return capabilities;
  }

  async function fetchInvoiceAsyncCapabilities() {
    if (typeof window.authFetch !== 'function') {
      throw new Error('INVOICE_ASYNC_AUTH_FETCH_UNAVAILABLE');
    }
    const response = await window.authFetch(invoiceApi('/api/invoice-async/capabilities'), {
      method: 'GET',
      headers: { accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `INVOICE_ASYNC_CAPABILITY_HTTP_${response.status}`);
    return validateInvoiceAsyncCapabilities(payload);
  }

  async function loadInvoiceAsyncCapabilities(options = {}) {
    if (options.force === true) {
      try {
        const key = capabilityCacheKey();
        if (key) sessionStorage.removeItem(key);
      } catch {}
    }
    if (options.force !== true) {
      const cached = readCachedInvoiceAsyncCapabilities();
      if (cached) return cacheInvoiceAsyncCapabilities(cached);
      if (capabilityPromise) return capabilityPromise;
    }
    capabilityPromise = fetchInvoiceAsyncCapabilities()
      .then(cacheInvoiceAsyncCapabilities)
      .catch(error => cacheInvoiceAsyncCapabilities(unavailableCapabilities(error?.message)));
    try {
      return await capabilityPromise;
    } finally {
      capabilityPromise = null;
    }
  }

  function isInvoiceAsyncUiEnabled() {
    return window.__invoiceAsyncCapability?.enabled_for_user === true
      && window.__invoiceAsyncGenerationInstalled === true
      && installed === true;
  }

  function isInvoiceAsyncDocumentReadEnabled() {
    return window.__invoiceAsyncCapability?.document_read_ready === true
      && installed === true;
  }

  function hasOperationMarker(row, context = {}) {
    return !!(
      row.operation_id
      || row.operationId
      || row.operation_type
      || row.operationType
      || row.change_seq != null
      || row.effective_change_seq != null
      || row.phase
    );
  }

  function normaliseInvoiceOperationWatch(value, context = {}) {
    if (typeof value === 'string') {
      if (
        context.explicit_operation_ids !== true
        || !UUID_RE.test(clean(value))
        || (!context.operation_type && !context.purpose)
      ) return null;
      value = { operation_id: value };
    }
    const row = asObject(value);
    if (!hasOperationMarker(row, context)) return null;
    const operationId = clean(row.operation_id || row.operationId).toLowerCase();
    if (!UUID_RE.test(operationId)) return null;
    const rootId = clean(row.root_operation_id || row.rootOperationId || context.root_operation_id || operationId).toLowerCase();
    const createdRaw = clean(row.created_at_utc || row.createdAtUtc || context.created_at_utc || nowIso());
    const updatedRaw = clean(row.updated_at_utc || row.updatedAtUtc || nowIso());
    const status = upper(row.status || row.operation_status || context.status || 'SUBMITTED');
    const handledAt = clean(row.terminal_handled_at_utc || row.terminalHandledAtUtc);
    return {
      operation_id: operationId,
      root_operation_id: UUID_RE.test(rootId) ? rootId : operationId,
      operation_type: upper(row.operation_type || row.operationType || context.operation_type || context.operationType),
      purpose: upper(row.purpose || row.document_purpose || context.purpose),
      entity_type: upper(row.entity_type || row.entityType || context.entity_type),
      entity_id: clean(row.entity_id || row.entityId || context.entity_id).toLowerCase() || null,
      status,
      phase: upper(row.phase || row.current_phase || context.phase || status),
      effective_change_seq: Math.max(0, Math.trunc(Number(
        row.effective_change_seq ?? row.change_seq ?? row.changeSeq ?? context.effective_change_seq ?? 0
      ) || 0)),
      document_version_id: clean(row.document_version_id || row.documentVersionId || context.document_version_id).toLowerCase() || null,
      error_code: upper(row.error_code || row.errorCode || context.error_code) || null,
      error_summary: clean(row.error_summary || row.errorSummary || row.message || context.error_summary) || null,
      retry_available: row.retry_available === true || row.can_retry === true,
      notify: row.notify === true,
      progress: asObject(row.progress || row.progress_summary || context.progress),
      notification_state: asObject(row.notification_state || row.notificationState || context.notification_state),
      modal_identity: clean(row.modal_identity || row.modalIdentity || context.modal_identity) || null,
      command_token: clean(row.command_token || row.commandToken || context.command_token) || null,
      issue_mode: upper(row.issue_mode || row.issueMode || context.issue_mode) || null,
      result_page_revision: clean(row.result_page_revision || row.resultPageRevision || context.result_page_revision) || null,
      created_at_utc: Number.isNaN(Date.parse(createdRaw)) ? nowIso() : new Date(createdRaw).toISOString(),
      updated_at_utc: Number.isNaN(Date.parse(updatedRaw)) ? nowIso() : new Date(updatedRaw).toISOString(),
      terminal_handled_at_utc: Number.isNaN(Date.parse(handledAt)) ? null : new Date(handledAt).toISOString()
    };
  }

  function mergeWatch(previous, incoming) {
    if (!previous) return incoming;
    if (incoming.effective_change_seq < previous.effective_change_seq) return previous;
    return {
      ...previous,
      ...incoming,
      root_operation_id: incoming.root_operation_id || previous.root_operation_id,
      operation_type: incoming.operation_type || previous.operation_type,
      purpose: incoming.purpose || previous.purpose,
      entity_type: incoming.entity_type || previous.entity_type,
      entity_id: incoming.entity_id || previous.entity_id,
      document_version_id: incoming.document_version_id || previous.document_version_id,
      error_code: incoming.error_code || previous.error_code,
      error_summary: incoming.error_summary || previous.error_summary,
      progress: { ...asObject(previous.progress), ...asObject(incoming.progress) },
      notification_state: { ...asObject(previous.notification_state), ...asObject(incoming.notification_state) },
      issue_mode: incoming.issue_mode || previous.issue_mode,
      result_page_revision: incoming.result_page_revision || previous.result_page_revision,
      created_at_utc: previous.created_at_utc || incoming.created_at_utc,
      terminal_handled_at_utc: incoming.terminal_handled_at_utc || previous.terminal_handled_at_utc
    };
  }

  function deduplicateInvoiceOperationWatch(rows) {
    const map = new Map();
    for (const value of asArray(rows)) {
      const row = normaliseInvoiceOperationWatch(value, { explicit_operation_ids: false });
      if (!row) continue;
      map.set(row.operation_id, mergeWatch(map.get(row.operation_id), row));
    }
    return [...map.values()];
  }

  function pruneInvoiceOperationWatches(rows) {
    const now = Date.now();
    const kept = deduplicateInvoiceOperationWatch(rows).filter(row => {
      const created = Date.parse(row.created_at_utc) || now;
      if (!TERMINAL.has(row.status)) return created >= now - ACTIVE_MAX_AGE_MS;
      const handled = Date.parse(row.terminal_handled_at_utc);
      if (Number.isFinite(handled)) return handled >= now - TERMINAL_HANDLED_GRACE_MS;
      return created >= now - TERMINAL_UNHANDLED_MAX_AGE_MS;
    });
    return kept
      .sort((a, b) => {
        const aPriority = !TERMINAL.has(a.status) ? 0 : (a.terminal_handled_at_utc ? 2 : 1);
        const bPriority = !TERMINAL.has(b.status) ? 0 : (b.terminal_handled_at_utc ? 2 : 1);
        if (aPriority !== bPriority) return aPriority - bPriority;
        return Date.parse(b.updated_at_utc) - Date.parse(a.updated_at_utc);
      })
      .slice(0, MAX_WATCHES);
  }

  function loadInvoiceOperationWatches() {
    try {
      sessionStorage.removeItem(LEGACY_WATCH_STORAGE_KEY);
      const key = operationWatchStorageKey();
      if (!key) return [];
      return pruneInvoiceOperationWatches(JSON.parse(sessionStorage.getItem(key) || '[]'));
    } catch {
      return [];
    }
  }

  function saveInvoiceOperationWatches(rows) {
    const saved = pruneInvoiceOperationWatches(rows);
    const key = operationWatchStorageKey();
    if (!key) {
      window.__invoiceOperationWatches = [];
      return [];
    }
    try {
      sessionStorage.removeItem(LEGACY_WATCH_STORAGE_KEY);
      sessionStorage.setItem(key, JSON.stringify(saved));
    } catch {}
    activeWatchStorageKey = key;
    window.__invoiceOperationWatches = saved;
    return saved;
  }

  function registerInvoiceOperationWatch(value, context = {}) {
    const values = asArray(value).length || Array.isArray(value) ? asArray(value) : [value];
    const accepted = values.map(item => normaliseInvoiceOperationWatch(item, context)).filter(Boolean);
    if (!accepted.length) return [];
    const existing = loadInvoiceOperationWatches();
    const map = new Map(existing.map(row => [row.operation_id, row]));
    for (const row of accepted) map.set(row.operation_id, mergeWatch(map.get(row.operation_id), row));
    saveInvoiceOperationWatches([...map.values()]);
    return accepted;
  }

  function extractOperationRows(payload, context = {}) {
    const source = asObject(payload);
    const rows = [];
    const direct = normaliseInvoiceOperationWatch(source, context);
    if (direct) rows.push(direct);
    const singular = normaliseInvoiceOperationWatch(source.operation, context);
    if (singular) rows.push(singular);
    for (const field of OPERATION_ARRAY_FIELDS) {
      for (const value of asArray(source[field])) {
        const row = normaliseInvoiceOperationWatch(value, context);
        if (row) rows.push(row);
      }
    }
    for (const value of asArray(source.operation_ids)) {
      const row = normaliseInvoiceOperationWatch(value, { ...context, explicit_operation_ids: true });
      if (row) rows.push(row);
    }
    return deduplicateInvoiceOperationWatch(rows);
  }

  function registerInvoiceOperationsFromResponse(payload, context = {}) {
    const rows = extractOperationRows(payload, context);
    if (rows.length) registerInvoiceOperationWatch(rows, context);
    return rows;
  }

  function markInvoiceOperationHandled(operationId) {
    const canonicalId = clean(operationId).toLowerCase();
    const handledAt = nowIso();
    return saveInvoiceOperationWatches(loadInvoiceOperationWatches().map(row =>
      row.operation_id === canonicalId ? { ...row, terminal_handled_at_utc: handledAt } : row
    ));
  }

  function acknowledgeInvoiceOperationNotification(operationId, notificationKey) {
    const canonicalId = clean(operationId).toLowerCase();
    return saveInvoiceOperationWatches(loadInvoiceOperationWatches().map(row => row.operation_id === canonicalId
      ? {
        ...row,
        notification_state: { ...asObject(row.notification_state), [clean(notificationKey)]: true }
      }
      : row));
  }

  function buildInvoiceHeartbeatWatches() {
    return loadInvoiceOperationWatches().slice(0, MAX_WATCHES).map(row => ({
      operation_id: row.operation_id,
      known_change_seq: row.effective_change_seq
    }));
  }

  function invoiceDocumentForegroundWatchDelay(elapsedMs) {
    if (elapsedMs < DOCUMENT_FOREGROUND_WATCH_FAST_MS) return 2000;
    if (elapsedMs < DOCUMENT_FOREGROUND_WATCH_MEDIUM_MS) return 5000;
    if (elapsedMs < DOCUMENT_FOREGROUND_WATCH_MAX_MS) return 15000;
    return null;
  }

  function invoiceDocumentForegroundWatchMatches(watch) {
    if (!watch || watch.stopped === true) return false;
    const viewer = asObject(watch.modal_ctx?.invoiceAsync?.viewer_request);
    if (
      !viewer.open
      || viewer.request_serial !== watch.request_serial
      || viewer.entity_type !== 'INVOICE'
      || viewer.entity_id !== watch.entity_id
      || viewer.operation_id !== watch.operation_id
      || (watch.purpose && viewer.purpose !== watch.purpose)
      || viewer.abort_controller?.signal?.aborted === true
    ) return false;
    if (window.modalCtx && window.modalCtx !== watch.modal_ctx) return false;
    return true;
  }

  function stopInvoiceDocumentForegroundWatch(target, reason = 'stopped') {
    const requestSerial = typeof target === 'string' ? clean(target) : '';
    const matching = [...invoiceDocumentForegroundWatches.values()].filter(watch =>
      (requestSerial && watch.request_serial === requestSerial)
      || (!requestSerial && target && watch.modal_ctx === target)
    );
    for (const watch of matching) {
      watch.stopped = true;
      watch.stop_reason = clean(reason) || 'stopped';
      if (watch.timer) clearTimeout(watch.timer);
      if (watch.deadline_timer) clearTimeout(watch.deadline_timer);
      watch.timer = null;
      watch.deadline_timer = null;
      try {
        watch.abort_signal?.removeEventListener?.('abort', watch.abort_handler);
      } catch {}
      invoiceDocumentForegroundWatches.delete(watch.request_serial);
    }
    return matching.length;
  }

  function stopAllInvoiceDocumentForegroundWatches(reason = 'stopped') {
    let stopped = 0;
    for (const requestSerial of [...invoiceDocumentForegroundWatches.keys()]) {
      stopped += stopInvoiceDocumentForegroundWatch(requestSerial, reason);
    }
    return stopped;
  }

  async function requestInvoiceDocumentForegroundUpdate(watch) {
    const heartbeat = window.__changesHeartbeat || window.__changeHeartbeat;
    if (typeof heartbeat?.pingOnce !== 'function') return false;
    await heartbeat.pingOnce(`invoice-document-foreground:${watch.operation_id}`);
    return true;
  }

  async function runInvoiceDocumentForegroundWatch(target) {
    const watch = typeof target === 'string'
      ? invoiceDocumentForegroundWatches.get(clean(target))
      : target;
    if (!watch || watch.stopped === true) return false;
    if (!invoiceDocumentForegroundWatchMatches(watch)) {
      stopInvoiceDocumentForegroundWatch(watch.request_serial, 'lifecycle-exit');
      return false;
    }
    const elapsedMs = Date.now() - watch.started_at_ms;
    if (elapsedMs >= DOCUMENT_FOREGROUND_WATCH_MAX_MS) {
      stopInvoiceDocumentForegroundWatch(watch.request_serial, 'maximum-duration');
      return false;
    }
    if (watch.in_flight === true) return false;
    watch.in_flight = true;
    try {
      await requestInvoiceDocumentForegroundUpdate(watch);
    } catch (error) {
      if (watch.abort_signal?.aborted === true) {
        stopInvoiceDocumentForegroundWatch(watch.request_serial, 'request-abort');
        return false;
      }
      watch.last_error = clean(error?.message || error);
    } finally {
      watch.in_flight = false;
    }
    if (!invoiceDocumentForegroundWatchMatches(watch)) {
      stopInvoiceDocumentForegroundWatch(watch.request_serial, 'lifecycle-exit');
      return false;
    }
    const delayMs = invoiceDocumentForegroundWatchDelay(Date.now() - watch.started_at_ms);
    if (delayMs == null) {
      stopInvoiceDocumentForegroundWatch(watch.request_serial, 'maximum-duration');
      return false;
    }
    watch.timer = setTimeout(() => {
      watch.timer = null;
      Promise.resolve(runInvoiceDocumentForegroundWatch(watch)).catch(() => {});
    }, delayMs);
    try { watch.timer?.unref?.(); } catch {}
    return true;
  }

  function startInvoiceDocumentForegroundWatch(modalCtx, options = {}) {
    const viewer = asObject(modalCtx?.invoiceAsync?.viewer_request);
    const operationId = clean(options.operation_id || viewer.operation_id).toLowerCase();
    const entityId = clean(options.entity_id || viewer.entity_id).toLowerCase();
    const requestSerial = clean(options.request_serial || viewer.request_serial);
    const purpose = upper(options.purpose || viewer.purpose);
    if (
      !viewer.open
      || viewer.entity_type !== 'INVOICE'
      || !UUID_RE.test(operationId)
      || !UUID_RE.test(entityId)
      || !requestSerial
      || viewer.request_serial !== requestSerial
      || viewer.operation_id !== operationId
      || viewer.entity_id !== entityId
      || (purpose && viewer.purpose !== purpose)
    ) return null;
    stopInvoiceDocumentForegroundWatch(modalCtx, 'watch-replacement');
    const watch = {
      modal_ctx: modalCtx,
      request_serial: requestSerial,
      entity_id: entityId,
      operation_id: operationId,
      purpose,
      started_at_ms: Date.now(),
      in_flight: false,
      stopped: false,
      timer: null,
      deadline_timer: null,
      abort_signal: viewer.abort_controller?.signal || null,
      abort_handler: null,
      last_error: null
    };
    watch.abort_handler = () => stopInvoiceDocumentForegroundWatch(requestSerial, 'request-abort');
    try { watch.abort_signal?.addEventListener?.('abort', watch.abort_handler, { once: true }); } catch {}
    invoiceDocumentForegroundWatches.set(requestSerial, watch);
    watch.deadline_timer = setTimeout(() => {
      stopInvoiceDocumentForegroundWatch(requestSerial, 'maximum-duration');
    }, DOCUMENT_FOREGROUND_WATCH_MAX_MS);
    try { watch.deadline_timer?.unref?.(); } catch {}
    Promise.resolve(runInvoiceDocumentForegroundWatch(watch)).catch(() => {});
    return {
      request_serial: requestSerial,
      entity_id: entityId,
      operation_id: operationId,
      purpose
    };
  }

  function stopInvoiceDocumentForegroundWatchForSignal(signal) {
    const operationId = clean(signal?.operation_id).toLowerCase();
    const entityId = clean(signal?.entity_id).toLowerCase();
    const status = upper(signal?.status || signal?.operation_status || signal?.state);
    if (!UUID_RE.test(operationId) || (!TERMINAL.has(status) && status !== 'READY')) return 0;
    let stopped = 0;
    for (const watch of [...invoiceDocumentForegroundWatches.values()]) {
      if (watch.operation_id === operationId && (!entityId || watch.entity_id === entityId)) {
        stopped += stopInvoiceDocumentForegroundWatch(watch.request_serial, `operation-${status.toLowerCase()}`);
      }
    }
    return stopped;
  }

  function activeInvoiceDocumentForegroundWatchCount() {
    return invoiceDocumentForegroundWatches.size;
  }

  function operationFamily(value) {
    const row = asObject(value);
    const combined = `${upper(row.operation_type)} ${upper(row.purpose)} ${upper(row.phase)}`;
    if (/DELIVER|DELIVERY|EMAIL/.test(combined)) return 'DELIVERY';
    if (/ISSUE|LEGAL|FREEZE|FINALISE/.test(combined)) return 'ISSUE';
    if (/ASSET|INSPECT|NORMALIS/.test(combined)) return 'ASSET';
    if (/TIMESHEET/.test(combined)) return 'TIMESHEET_DOCUMENT';
    return 'DOCUMENT';
  }

  function deriveInvoiceAsyncActionState(value, familyOverride = '') {
    const row = asObject(value);
    const family = upper(familyOverride) || operationFamily(row);
    const status = upper(row.status || row.operation_status || row.state);
    const phase = upper(row.phase || row.current_phase || status);
    const failed = ['FAILED', 'DEAD_LETTER', 'BLOCKED'].includes(status);
    const cancelled = ['CANCELLED', 'SUPERSEDED'].includes(status);
    const documentFamily = ['DOCUMENT', 'TIMESHEET_DOCUMENT'].includes(family);
    const documentVersionId = clean(row.document_version_id).toLowerCase();
    const exactDocumentReady = UUID_RE.test(documentVersionId)
      && !ACTIVE.has(status)
      && !failed
      && !cancelled;
    const ready = documentFamily
      ? exactDocumentReady
      : ['COMPLETE', 'READY', 'ISSUED'].includes(status) || exactDocumentReady;
    const retry = row.retry_available === true;
    const base = {
      family,
      status,
      phase,
      terminal: TERMINAL.has(status),
      retry_available: retry,
      view_available: ready && !!row.document_version_id,
      document_version_id: exactDocumentReady ? documentVersionId : null,
      tone: 'muted',
      label: status || 'Not started',
      button_label: '',
      disabled: false,
      aria_busy: false
    };
    if (family === 'ASSET') {
      const labels = {
        QUEUED: 'Queued', ASSET_INSPECT: 'Inspecting', INSPECTING: 'Inspecting',
        ASSET_NORMALISE: 'Normalising', NORMALISING: 'Normalising', COMPLETE: 'Ready',
        ASSET_MEDIA_TYPE_UNSUPPORTED: 'Unsupported', ASSET_CORRUPT: 'Corrupt',
        ASSET_MISSING: 'Missing', FAILED: 'Failed', DEAD_LETTER: 'Failed', RETRY_WAIT: 'Retry scheduled'
      };
      return {
        ...base,
        tone: ready ? 'ready' : (failed ? 'error' : (ACTIVE.has(status) ? 'amber' : 'muted')),
        label: labels[phase] || labels[status] || clean(phase.replaceAll('_', ' ')) || 'Queued',
        button_label: retry ? 'Retry evidence' : '',
        disabled: !retry,
        aria_busy: ACTIVE.has(status)
      };
    }
    if (family === 'DELIVERY') {
      const label = ready ? 'Email queued'
        : failed ? (status === 'BLOCKED' ? 'Delivery blocked' : 'Delivery failed')
          : (ACTIVE.has(status) ? 'Preparing email…' : 'Email not requested');
      return {
        ...base,
        tone: ready ? 'ready' : (failed ? 'error' : (ACTIVE.has(status) ? 'amber' : 'muted')),
        label,
        button_label: retry ? 'Retry delivery' : (ready ? 'Email queued' : 'Email invoice'),
        disabled: ACTIVE.has(status) || ready || (failed && !retry),
        aria_busy: ACTIVE.has(status)
      };
    }
    if (family === 'ISSUE') {
      let label = 'Issue invoice';
      if (/VALIDAT/.test(phase)) label = 'Validating…';
      else if (/FREEZE|FINAL_DOCUMENT|RENDER|MERGE|VERIFY/.test(phase)) label = 'Preparing final document…';
      else if (/FINALIS|LEGAL/.test(phase)) label = 'Finalising issue…';
      else if (ready) label = 'Issued';
      else if (failed) label = 'Issue blocked';
      return {
        ...base,
        tone: ready ? 'ready' : (failed ? 'error' : (ACTIVE.has(status) ? 'amber' : 'muted')),
        label,
        button_label: retry ? 'Retry issue' : label,
        disabled: ACTIVE.has(status) || ready || (failed && !retry),
        aria_busy: ACTIVE.has(status)
      };
    }
    const timesheet = family === 'TIMESHEET_DOCUMENT';
    const activeDocument = ACTIVE.has(status);
    const activeInvoiceCanAdvance = family === 'DOCUMENT' && activeDocument;
    const preparingLabel = timesheet ? 'Preparing timesheet…' : 'Preparing invoice PDF…';
    const readyLabel = timesheet ? 'Open timesheet PDF' : 'View invoice PDF';
    const failedLabel = timesheet ? 'Timesheet PDF failed' : 'Invoice PDF failed';
    const terminalWithoutVersion = TERMINAL.has(status) && !exactDocumentReady;
    return {
      ...base,
      tone: ready ? 'ready' : (failed || terminalWithoutVersion ? 'error' : (ACTIVE.has(status) ? 'amber' : 'muted')),
      label: ready ? readyLabel : (terminalWithoutVersion ? 'Document unavailable' : (failed ? failedLabel : (ACTIVE.has(status) ? preparingLabel : (timesheet ? 'Prepare timesheet PDF' : 'Prepare invoice PDF')))),
      button_label: ready ? readyLabel : (terminalWithoutVersion ? 'Document unavailable' : (failed && retry ? (timesheet ? 'Retry timesheet PDF' : 'Retry invoice PDF') : (activeInvoiceCanAdvance ? 'Generate invoice PDF now' : (activeDocument ? preparingLabel : (timesheet ? 'Prepare timesheet PDF' : 'Generate invoice PDF'))))),
      disabled: terminalWithoutVersion || (activeDocument && !activeInvoiceCanAdvance) || (failed && !retry),
      aria_busy: activeDocument,
      view_available: exactDocumentReady
    };
  }

  function renderInvoiceProgressText(value) {
    const row = asObject(value);
    const state = deriveInvoiceAsyncActionState(row);
    if (state.view_available) return 'Ready';
    if (state.terminal) return state.label;
    if (['DOCUMENT', 'TIMESHEET_DOCUMENT'].includes(state.family)) return state.label;
    const progress = asObject(row.progress);
    const current = Number(progress.completed_units ?? progress.completed ?? progress.current);
    const total = Number(progress.total_units ?? progress.total);
    return Number.isFinite(current) && Number.isFinite(total) && total > 0
      ? `${state.label} — ${current}/${total}`
      : state.label;
  }

  function renderInvoiceOperationError(value) {
    const row = asObject(value);
    const diagnostic = window.invoiceDiagnosticForCode?.(row.error_code);
    return clean(diagnostic?.long_explanation || row.error_summary || diagnostic?.short_label);
  }

  function renderDocumentAssetBadge(value, family = '') {
    const state = deriveInvoiceAsyncActionState(value, family);
    const documentFamily = ['DOCUMENT', 'TIMESHEET_DOCUMENT'].includes(state.family);
    const displayLabel = documentFamily && state.view_available ? 'Ready' : state.label;
    const colours = {
      ready: ['#14532d', '#dcfce7'],
      amber: ['#78350f', '#fef3c7'],
      error: ['#7f1d1d', '#fee2e2'],
      muted: ['#334155', '#e2e8f0']
    };
    const [colour, background] = colours[state.tone] || colours.muted;
    return `<span class="invoice-async-badge invoice-async-badge--${escapeHtml(state.tone)}" data-tone="${escapeHtml(state.tone)}" style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:750;color:${colour};background:${background};">${escapeHtml(displayLabel)}</span>`;
  }

  function renderDiagnosticList(title, values, tone) {
    const rows = asArray(values).map(value => {
      const code = typeof value === 'string' ? value : value?.code;
      const diagnostic = window.invoiceDiagnosticForCode?.(code);
      return {
        label: clean(diagnostic?.short_label || value?.label || 'Needs attention'),
        explanation: clean(diagnostic?.long_explanation || value?.message || 'Review this item before continuing.'),
        code: upper(code)
      };
    }).filter(value => value.label);
    if (!rows.length) return '';
    return `<details class="invoice-async-diagnostic invoice-async-diagnostic--${tone}" style="margin-top:6px;"><summary>${escapeHtml(title)} (${rows.length})</summary><ul>${rows.map(value => `<li><strong>${escapeHtml(value.label)}</strong> — ${escapeHtml(value.explanation)}${value.code ? `<span class="sr-only"> (${escapeHtml(value.code)})</span>` : ''}</li>`).join('')}</ul></details>`;
  }

  function renderInvoiceAsyncState(detail = {}) {
    const source = asObject(detail);
    const sections = [
      ['Invoice document', source.document_operation || source.document_state, 'DOCUMENT'],
      ['Timesheet document', source.timesheet_document_operation || source.timesheet_document_state, 'TIMESHEET_DOCUMENT'],
      ['Legal issue', source.issue_operation || source.legal_issue_state, 'ISSUE'],
      ['Delivery', source.delivery_operation || source.delivery_state, 'DELIVERY'],
      ['Asset processing', source.asset_operation || source.asset_state, 'ASSET']
    ].filter(([, value]) => value != null);
    return `${sections.length ? `<section class="card invoice-async-state" data-invoice-async-state style="margin-top:12px;">
      <h3>Document and delivery progress</h3>
      ${sections.map(([label, value, family]) => {
        const row = typeof value === 'string' ? { status: value } : asObject(value);
        return `<div class="invoice-async-state-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid var(--line);"><span>${escapeHtml(label)}</span><span>${renderDocumentAssetBadge(row, family)}</span></div>`;
      }).join('')}
    </section>` : ''}
    <div class="invoice-async-diagnostics">
      ${renderDiagnosticList('Hard issue blockers', source.hard_blockers || source.hard_blocker_codes, 'error')}
      ${renderDiagnosticList('Document dependencies', source.document_dependencies || source.document_dependency_codes, 'amber')}
      ${renderDiagnosticList('Delivery blockers', source.delivery_blockers || source.delivery_blocker_codes, 'error')}
      ${renderDiagnosticList('Warnings', source.warnings || source.warning_codes, 'amber')}
    </div>`;
  }

  function applyInvoiceActionButtonState(root = document) {
    const watches = new Map(loadInvoiceOperationWatches().map(row => [row.operation_id, row]));
    for (const button of root?.querySelectorAll?.('[data-invoice-async-operation-id]') || []) {
      const operationId = clean(button.dataset.invoiceAsyncOperationId).toLowerCase();
      const watch = watches.get(operationId);
      if (!watch) continue;
      const state = deriveInvoiceAsyncActionState(watch, button.dataset.invoiceAsyncFamily);
      if (!button.dataset.invoiceAsyncOriginalLabel) button.dataset.invoiceAsyncOriginalLabel = clean(button.textContent);
      button.dataset.invoiceAsyncTone = state.tone;
      button.dataset.documentVersionId = state.document_version_id || '';
      button.classList.toggle('is-processing', state.tone === 'amber');
      button.classList.toggle('is-ready', state.tone === 'ready');
      button.classList.toggle('is-failed', state.tone === 'error');
      button.style.borderColor = state.tone === 'amber' ? '#d97706'
        : state.tone === 'ready' ? '#16a34a'
          : state.tone === 'error' ? '#dc2626' : '';
      button.disabled = state.disabled;
      button.setAttribute('aria-busy', String(state.aria_busy));
      button.setAttribute('aria-disabled', String(state.disabled));
      const visibleLabel = state.button_label || state.label || button.dataset.invoiceAsyncOriginalLabel;
      if (state.aria_busy) {
        button.innerHTML = `<span aria-hidden="true">⟳</span> <span>${escapeHtml(visibleLabel)}</span>`;
      } else {
        button.textContent = visibleLabel;
      }
      button.title = renderInvoiceOperationError(watch) || renderInvoiceProgressText(watch);
      let status = button.parentElement?.querySelector(`[data-invoice-button-status="${CSS.escape(operationId)}"]`);
      if (!status) {
        status = document.createElement('span');
        status.className = 'sr-only invoice-async-button-status';
        status.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
        status.setAttribute('aria-live', 'polite');
        status.dataset.invoiceButtonStatus = operationId;
        button.insertAdjacentElement('afterend', status);
      }
      status.textContent = state.label;
    }
  }

  function updateOpenInvoiceModalFromSignal(signal) {
    stopInvoiceDocumentForegroundWatchForSignal(signal);
    const signalEntityId = clean(signal.entity_id).toLowerCase();
    const viewerModal = activeInvoiceViewers.get(signalEntityId);
    const family = operationFamily(signal);
    if (
      viewerModal
      && signal.document_version_id
      && ['DOCUMENT', 'TIMESHEET_DOCUMENT'].includes(family)
    ) {
      const viewer = asObject(viewerModal.invoiceAsync?.viewer_request);
      const operationId = clean(signal.operation_id).toLowerCase();
      if (
        viewer.open
        && viewer.entity_id === signalEntityId
        && viewer.entity_type === (family === 'TIMESHEET_DOCUMENT' ? 'TIMESHEET' : 'INVOICE')
        && (!viewer.operation_id || viewer.operation_id === operationId)
        && (!viewer.purpose || !signal.purpose || viewer.purpose === signal.purpose)
      ) {
        Promise.resolve(completeInvoiceAsyncViewer(
          viewerModal,
          signal.document_version_id,
          {
            request_serial: viewer.request_serial,
            entity_id: signalEntityId,
            operation_id: viewer.operation_id || operationId,
            purpose: viewer.purpose || signal.purpose
          }
        )).catch(() => {});
      }
    }
    const modal = window.modalCtx;
    if (!modal || typeof modal !== 'object') return false;
    const invoiceId = clean(modal.invoiceId || modal.invoiceDetail?.invoice?.id || modal.dataLoaded?.invoice?.id || modal.data?.id).toLowerCase();
    if (invoiceId && signalEntityId !== invoiceId) return false;
    modal.invoiceAsync = asObject(modal.invoiceAsync);
    const slot = family === 'ISSUE' ? 'issue_operation'
      : family === 'DELIVERY' ? 'delivery_operation'
        : family === 'ASSET' ? 'asset_operation'
          : family === 'TIMESHEET_DOCUMENT' ? 'timesheet_document_operation'
            : 'document_operation';
    const previous = asObject(modal.invoiceAsync[slot]);
    if (Number(signal.effective_change_seq) < Number(previous.effective_change_seq || 0)) return false;
    modal.invoiceAsync[slot] = { ...previous, ...signal };
    if (signal.document_version_id && ['DOCUMENT', 'TIMESHEET_DOCUMENT'].includes(family)) {
      modal.invoiceAsync.document_version_id = signal.document_version_id;
    }
    const host = document.querySelector('[data-invoice-async-state-host]');
    if (host) host.innerHTML = renderInvoiceAsyncState({ ...asObject(modal.invoiceDetail), ...modal.invoiceAsync });
    applyInvoiceActionButtonState(document);
    return true;
  }

  function updateOpenInvoiceBatchModalFromSignal(signal) {
    return window.InvoiceBatchModalV8?.applyInvoiceBatchOperationSignal?.(signal)
      || window.applyInvoiceBatchOperationSignal?.(signal)
      || false;
  }

  function renderTimesheetEvidenceProcessingState(value) {
    const row = asObject(value);
    const asset = typeof row.asset_state === 'string' ? { status: row.asset_state, error_code: row.asset_error } : asObject(row.asset_operation || row.asset_state);
    const documentState = typeof row.timesheet_document_state === 'string'
      ? { status: row.timesheet_document_state }
      : asObject(row.timesheet_document_operation || row.timesheet_document_state);
    const error = renderInvoiceOperationError(asset);
    const retryOperationId = clean(asset.operation_id || row.asset_operation_id).toLowerCase();
    return `<div class="timesheet-evidence-processing" data-timesheet-evidence-processing style="display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin-top:6px;">
      <span>Source ${renderDocumentAssetBadge(asset, 'ASSET')}</span>
      <span>Timesheet PDF ${renderDocumentAssetBadge(documentState, 'TIMESHEET_DOCUMENT')}</span>
      ${error ? `<span class="mini error">${escapeHtml(error)}</span>` : ''}
      ${asset.retry_available === true && UUID_RE.test(retryOperationId)
        ? `<button type="button" class="btn btn-xs btn-outline" data-invoice-evidence-retry data-operation-id="${escapeHtml(retryOperationId)}">Retry</button>`
        : ''}
      ${upper(asset.error_code) === 'ASSET_MEDIA_TYPE_UNSUPPORTED' ? '<span class="mini">PDF, JPEG/JPG and static PNG only</span>' : ''}
    </div>`;
  }

  async function submitInvoiceOperationControl(actions, options = {}) {
    const canonicalActions = asArray(actions).map(action => {
      const source = asObject(action);
      const type = upper(source.action);
      const operationId = clean(source.operation_id).toLowerCase();
      if (!['RETRY', 'CANCEL', 'RESCHEDULE', 'RAISE_PRIORITY'].includes(type)
          || !UUID_RE.test(operationId)) {
        throw new Error('OPERATION_CONTROL_ACTION_SCHEMA_INVALID');
      }
      const result = { action: type, operation_id: operationId };
      if (type === 'RETRY' && source.retry_chunk_id != null) {
        const chunkId = clean(source.retry_chunk_id).toLowerCase();
        if (!UUID_RE.test(chunkId)) throw new Error('OPERATION_CONTROL_ACTION_SCHEMA_INVALID');
        result.retry_chunk_id = chunkId;
      }
      if (type === 'RESCHEDULE') {
        const date = new Date(source.run_after_utc || '');
        if (!Number.isFinite(date.getTime())) throw new Error('OPERATION_CONTROL_ACTION_SCHEMA_INVALID');
        result.run_after_utc = date.toISOString();
      }
      return result;
    });
    if (!canonicalActions.length) throw new Error('OPERATION_CONTROL_ACTION_SCHEMA_INVALID');
    const requestToken = clean(options.request_token) || crypto.randomUUID();
    const response = await window.authFetch(invoiceApi('/api/invoice-operations/control'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': requestToken
      },
      body: JSON.stringify({
        contract_version: 'INVOICE_OPERATION_CONTROL_V2',
        command_token: requestToken,
        request_token: requestToken,
        actions: canonicalActions
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(
      new Error(payload.error || payload.message || `INVOICE_OPERATION_CONTROL_HTTP_${response.status}`),
      {
        request_token: requestToken,
        operation_control_response_definitive: true
      }
    );
    return { ...payload, request_token: requestToken };
  }

  async function retryInvoiceEvidenceOperation(operationId, button) {
    const canonicalId = clean(operationId).toLowerCase();
    if (!UUID_RE.test(canonicalId)) throw new Error('INVOICE_EVIDENCE_OPERATION_ID_INVALID');
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    let definitiveResponse = false;
    try {
      const retainedToken = clean(button?.dataset?.operationControlToken) || crypto.randomUUID();
      if (button) button.dataset.operationControlToken = retainedToken;
      const payload = await submitInvoiceOperationControl(
        [{ operation_id: canonicalId, action: 'RETRY' }],
        { request_token: retainedToken }
      );
      definitiveResponse = true;
      const results = asArray(payload.results).filter(row => clean(row?.operation_id).toLowerCase() === canonicalId);
      const rejected = results.find(row => row?.accepted === false);
      if (rejected) {
        const rejectionCode = clean(
          rejected?.error?.code
          || rejected?.error_code
          || rejected?.code
        );
        throw new Error(rejectionCode || 'INVOICE_EVIDENCE_RETRY_REJECTED');
      }
      if (!results.length) throw new Error('INVOICE_EVIDENCE_RETRY_RESULT_MISSING');
      if (results.length) {
        registerInvoiceOperationWatch(results, {
          explicit_operation_ids: true,
          operation_type: 'PREPARE_INVOICE_ASSET',
          purpose: 'ASSET'
        });
        applyInvoiceOperationUpdates({ watched_invoice_operations: results });
      }
      try { window.__toast?.('Evidence retry queued.'); } catch {}
      if (button) delete button.dataset.operationControlToken;
      return payload;
    } catch (error) {
      if (button && (
        definitiveResponse
        || error?.operation_control_response_definitive === true
      )) {
        delete button.dataset.operationControlToken;
      }
      throw error;
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.setAttribute('aria-busy', 'false');
      }
    }
  }

  function handleInvoiceAsyncDelegatedClick(event) {
    const button = event?.target?.closest?.('[data-invoice-evidence-retry]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    retryInvoiceEvidenceOperation(button.dataset.operationId, button)
      .catch(error => {
        try { window.__toast?.(clean(error?.message || error) || 'Evidence retry failed.'); } catch {}
      });
  }

  function attachInvoiceAsyncDelegatedHandlers() {
    if (delegatedClickInstalled) return;
    document.addEventListener('click', handleInvoiceAsyncDelegatedClick);
    delegatedClickInstalled = true;
  }

  function detachInvoiceAsyncDelegatedHandlers() {
    if (!delegatedClickInstalled) return;
    document.removeEventListener('click', handleInvoiceAsyncDelegatedClick);
    delegatedClickInstalled = false;
  }

  function updateVisibleAssetStateFromSignal(signal) {
    const entityId = clean(signal.entity_id);
    if (!entityId) return false;
    let applied = false;
    const selector = [
      `[data-evidence-id="${CSS.escape(entityId)}"]`,
      `[data-timesheet-id="${CSS.escape(entityId)}"]`,
      `[data-asset-id="${CSS.escape(entityId)}"]`
    ].join(',');
    for (const target of document.querySelectorAll(selector)) {
      const family = operationFamily(signal);
      const model = family === 'ASSET'
        ? { asset_operation: signal, timesheet_document_state: target.dataset.timesheetDocumentState || 'NOT_READY' }
        : { asset_state: target.dataset.assetState || 'QUEUED', timesheet_document_operation: signal };
      target.dataset.asyncState = upper(signal.status);
      let host = target.querySelector('[data-timesheet-evidence-processing-host]');
      if (!host) {
        host = document.createElement('div');
        host.dataset.timesheetEvidenceProcessingHost = '1';
        target.appendChild(host);
      }
      host.innerHTML = renderTimesheetEvidenceProcessingState(model);
      applied = true;
    }
    return applied;
  }

  function hydrateVisibleTimesheetEvidenceProcessingStates(root = document) {
    let applied = 0;
    for (const target of root?.querySelectorAll?.('[data-evidence-id], [data-timesheet-id]') || []) {
      const assetState = clean(target.dataset.assetState || target.dataset.processingState);
      const documentState = clean(target.dataset.timesheetDocumentState || target.dataset.documentState);
      const assetOperationId = clean(target.dataset.assetOperationId);
      const documentOperationId = clean(target.dataset.documentOperationId);
      if (!assetState && !documentState && !assetOperationId && !documentOperationId) continue;
      const watches = loadInvoiceOperationWatches();
      const assetOperation = watches.find(row => row.operation_id === assetOperationId);
      const documentOperation = watches.find(row => row.operation_id === documentOperationId);
      let host = target.querySelector('[data-timesheet-evidence-processing-host]');
      if (!host) {
        host = document.createElement('div');
        host.dataset.timesheetEvidenceProcessingHost = '1';
        target.appendChild(host);
      }
      host.innerHTML = renderTimesheetEvidenceProcessingState({
        asset_state: assetState || 'QUEUED',
        asset_operation: assetOperation,
        timesheet_document_state: documentState || 'NOT_READY',
        timesheet_document_operation: documentOperation
      });
      applied += 1;
    }
    return applied;
  }

  function notificationMessage(signal) {
    const family = operationFamily(signal);
    const success = signal.status === 'COMPLETE' || !!signal.document_version_id;
    if (family === 'DELIVERY') return success ? 'Invoice email has been queued.' : 'Invoice delivery needs attention.';
    if (family === 'ISSUE') return success ? 'Invoice issue completed.' : 'Invoice issue needs attention.';
    if (family === 'ASSET') {
      if (signal.error_code === 'ASSET_MEDIA_TYPE_UNSUPPORTED') return 'Evidence image is unsupported. Use PDF, JPEG/JPG or static PNG.';
      return success ? 'Evidence is ready.' : 'Evidence processing needs attention.';
    }
    if (family === 'TIMESHEET_DOCUMENT') return success ? 'Timesheet PDF is ready.' : 'Timesheet PDF preparation failed.';
    return success ? 'Invoice PDF is ready.' : 'Invoice document preparation failed.';
  }

  function markSharedInvoiceUpdate(message) {
    window.__updatesAvailable = window.__updatesAvailable || {};
    window.__updatesAvailable.invoices = true;
    window.__invoiceAsyncLastUpdateMessage = clean(message);
    try { window.renderTools?.(); } catch {}
  }

  function notifyInvoiceOperationResult(signal, previous) {
    if (signal.notify !== true && !TERMINAL.has(signal.status) && !signal.document_version_id) return null;
    const key = `${signal.operation_id}:${signal.effective_change_seq}:${signal.status}:${signal.document_version_id || ''}`;
    if (asObject(previous?.notification_state)[key]) return null;
    const message = notificationMessage(signal);
    try { window.__toast?.(message); } catch {}
    signal.notification_state = { ...asObject(previous?.notification_state), [key]: true };
    markSharedInvoiceUpdate(message);
    return key;
  }

  function scheduleInvoiceSectionRefresh(reason = 'invoice-operation-update') {
    markSharedInvoiceUpdate(reason);
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      try {
        if (typeof window.invoiceAsyncRefreshVisibleSection === 'function') {
          await window.invoiceAsyncRefreshVisibleSection({ reason });
        } else if (clean(window.currentSection).toLowerCase() === 'invoices' && typeof window.refreshCurrentSection === 'function') {
          await window.refreshCurrentSection({ preserve_state: true, reason });
        } else {
          window.renderTools?.();
        }
      } catch {}
    }, 500);
  }

  function applyInvoiceOperationUpdates(payload) {
    const signals = Array.isArray(payload) ? payload : asArray(payload?.watched_invoice_operations);
    if (!signals.length) return [];
    const map = new Map(loadInvoiceOperationWatches().map(row => [row.operation_id, row]));
    const applied = [];
    for (const value of signals) {
      const signal = normaliseInvoiceOperationWatch(value);
      if (!signal) continue;
      const previous = map.get(signal.operation_id);
      if (previous && signal.effective_change_seq < previous.effective_change_seq) continue;
      const merged = mergeWatch(previous, signal);
      notifyInvoiceOperationResult(merged, previous);
      map.set(merged.operation_id, merged);
      updateOpenInvoiceModalFromSignal(merged);
      Promise.resolve(updateOpenInvoiceBatchModalFromSignal(merged)).catch(() => {});
      updateVisibleAssetStateFromSignal(merged);
      applied.push(merged);
    }
    saveInvoiceOperationWatches([...map.values()]);
    applyInvoiceActionButtonState(document);
    if (applied.some(row => TERMINAL.has(row.status) || row.document_version_id)) {
      scheduleInvoiceSectionRefresh('Invoice processing updated');
    }
    return applied;
  }

  async function openExactReadyDocument(documentVersionId, options = {}) {
    const id = clean(typeof documentVersionId === 'string'
      ? documentVersionId
      : documentVersionId?.document_version_id || documentVersionId?.id).toLowerCase();
    if (!UUID_RE.test(id)) throw new Error('READY_DOCUMENT_VERSION_ID_INVALID');
    const presign = await window.authFetch(invoiceApi(`/api/invoice-document-versions/${encodeURIComponent(id)}/presign`), {
      method: 'POST',
      headers: { accept: 'application/json' },
      signal: options.signal
    });
    const descriptor = await presign.json().catch(() => ({}));
    if (!presign.ok || !descriptor.url || clean(descriptor.document_version_id).toLowerCase() !== id) {
      throw new Error(descriptor.error || `READY_DOCUMENT_ACCESS_FAILED_${presign.status}`);
    }
    const documentResponse = await window.authFetch(descriptor.url, {
      method: 'GET',
      headers: { accept: 'application/pdf' },
      signal: options.signal
    });
    if (!documentResponse.ok) throw new Error(`READY_DOCUMENT_DOWNLOAD_FAILED_${documentResponse.status}`);
    const blob = await documentResponse.blob();
    if (blob.type && blob.type !== 'application/pdf') throw new Error('READY_DOCUMENT_MEDIA_TYPE_INVALID');
    const blobUrl = URL.createObjectURL(blob);
    if (options.returnBlobUrl === true) {
      return {
        document_version_id: id,
        purpose: descriptor.purpose || null,
        blob_url: blobUrl,
        revoke: () => URL.revokeObjectURL(blobUrl)
      };
    }
    const opened = window.open(blobUrl, '_blank', 'noopener');
    if (!opened) {
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.click();
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
    return { document_version_id: id, purpose: descriptor.purpose || null };
  }

  function renderInvoiceAsyncViewerContent(modalCtx) {
    const viewer = asObject(modalCtx?.invoiceAsync?.viewer_request);
    const diagnostic = viewer.error
      ? (window.invoiceDiagnosticForCode?.(viewer.error) || { short_label: 'Needs attention' })
      : null;
    const title = viewer.entity_type === 'TIMESHEET' ? 'Timesheet PDF' : 'Invoice PDF';
    return `<div class="invoice-async-viewer" data-invoice-async-viewer="${escapeHtml(viewer.entity_id || '')}">
      <div class="invoice-async-viewer-status" aria-live="polite">
        ${viewer.error ? `<span class="error">${escapeHtml(diagnostic.short_label)}</span>` : escapeHtml(viewer.status_message || 'Preparing document')}
      </div>
      ${viewer.blob_url
        ? `<iframe src="${escapeHtml(viewer.blob_url)}" title="${escapeHtml(title)} preview" style="width:100%;height:75vh;border:1px solid var(--line);border-radius:10px;background:#111;"></iframe>`
        : viewer.viewer_state === 'BLOCKED'
          ? ''
          : '<div style="display:grid;place-items:center;min-height:55vh;gap:10px;"><span class="invbatch-spinner" aria-hidden="true"></span><span>Preparing document</span></div>'}
    </div>`;
  }

  function repaintInvoiceAsyncViewer(modalCtx) {
    const entityId = clean(modalCtx?.invoiceAsync?.viewer_request?.entity_id);
    if (!entityId) return;
    const host = document.querySelector(`[data-invoice-async-viewer="${CSS.escape(entityId)}"]`);
    if (host) host.outerHTML = renderInvoiceAsyncViewerContent(modalCtx);
  }

  function revokeInvoiceAsyncViewerBlob(modalCtx) {
    const viewer = asObject(modalCtx?.invoiceAsync?.viewer_request);
    if (viewer.blob_url) {
      try { URL.revokeObjectURL(viewer.blob_url); } catch {}
      viewer.blob_url = null;
    }
  }

  function openPreparingInvoiceViewer(modalCtx, entityType, entityId, purpose, commandToken, options = {}) {
    const canonicalEntityType = upper(entityType);
    const canonicalEntityId = clean(entityId).toLowerCase();
    const requestedPurpose = upper(purpose);
    modalCtx.invoiceAsync = asObject(modalCtx.invoiceAsync);
    stopInvoiceDocumentForegroundWatch(modalCtx, 'viewer-replacement');
    try { modalCtx.invoiceAsync.viewer_request?.abort_controller?.abort(); } catch {}
    revokeInvoiceAsyncViewerBlob(modalCtx);
    const requestSerial = crypto.randomUUID();
    const abortController = new AbortController();
    modalCtx.invoiceAsync.viewer_request = {
      contract_version: 'INVOICE_VIEWER_V2',
      entity_type: canonicalEntityType,
      entity_id: canonicalEntityId,
      purpose: requestedPurpose,
      requested_purpose: requestedPurpose,
      command_token: commandToken,
      request_serial: requestSerial,
      abort_controller: abortController,
      open: true,
      viewer_state: 'PREPARING',
      status_message: canonicalEntityType === 'TIMESHEET' ? 'Preparing timesheet' : 'Preparing preview',
      document_version_id: null,
      operation_id: null,
      blob_url: null,
      error: null
    };
    const showViewer = options.show_viewer !== false;
    if (showViewer) activeInvoiceViewers.set(canonicalEntityId, modalCtx);
    else activeInvoiceViewers.delete(canonicalEntityId);
    if (!showViewer) return requestSerial;
    if (typeof window.showModal !== 'function') return requestSerial;
    window.showModal(
      canonicalEntityType === 'TIMESHEET' ? 'Timesheet PDF' : 'Invoice PDF Preview',
      [{ key: 'main', label: 'PDF' }],
      () => renderInvoiceAsyncViewerContent(modalCtx),
      null,
      true,
      null,
      {
        kind: 'invoice-async-document-viewer-v8',
        noParentGate: true,
        onDismiss: () => {
          const viewer = asObject(modalCtx.invoiceAsync?.viewer_request);
          stopInvoiceDocumentForegroundWatch(modalCtx, 'viewer-close');
          viewer.open = false;
          try { viewer.abort_controller?.abort(); } catch {}
          revokeInvoiceAsyncViewerBlob(modalCtx);
          activeInvoiceViewers.delete(canonicalEntityId);
        }
      }
    );
    return requestSerial;
  }

  async function completeInvoiceAsyncViewer(modalCtx, documentVersionId, expected = {}) {
    const viewer = asObject(modalCtx?.invoiceAsync?.viewer_request);
    const canonicalVersion = clean(documentVersionId).toLowerCase();
    if (!viewer.open || !UUID_RE.test(canonicalVersion)) return null;
    if (expected.request_serial && viewer.request_serial !== expected.request_serial) return null;
    if (expected.entity_id && viewer.entity_id !== expected.entity_id) return null;
    if (expected.operation_id && viewer.operation_id !== expected.operation_id) return null;
    if (expected.purpose && viewer.purpose !== expected.purpose) return null;
    stopInvoiceDocumentForegroundWatch(modalCtx, 'document-ready');
    if (viewer.document_version_id === canonicalVersion && viewer.blob_url) return viewer;
    viewer.status_message = 'Opening exact document version';
    viewer.error = null;
    repaintInvoiceAsyncViewer(modalCtx);
    try {
      const result = await openExactReadyDocument(canonicalVersion, {
        returnBlobUrl: true,
        signal: viewer.abort_controller?.signal
      });
      if (!viewer.open
          || (expected.request_serial && viewer.request_serial !== expected.request_serial)
          || (expected.entity_id && viewer.entity_id !== expected.entity_id)
          || (expected.operation_id && viewer.operation_id !== expected.operation_id)
          || (expected.purpose && viewer.purpose !== expected.purpose)) {
        result.revoke?.();
        return null;
      }
      revokeInvoiceAsyncViewerBlob(modalCtx);
      viewer.document_version_id = canonicalVersion;
      viewer.blob_url = result.blob_url;
      viewer.viewer_state = 'READY';
      viewer.status_message = viewer.entity_type === 'TIMESHEET' ? 'Timesheet PDF ready' : 'Invoice PDF ready';
      viewer.error = null;
      repaintInvoiceAsyncViewer(modalCtx);
      return viewer;
    } catch (error) {
      viewer.status_message = 'Preview failed';
      viewer.viewer_state = 'BLOCKED';
      viewer.error = clean(error?.message || error);
      repaintInvoiceAsyncViewer(modalCtx);
      return null;
    }
  }

  function attachOperationToButtons(operation, family) {
    if (!operation?.operation_id) return;
    const modal = window.modalCtx;
    const selectors = family === 'DELIVERY'
      ? ['[data-action*="email"]', '#btnInvoiceEmail']
      : ['[data-action*="pdf"]', '[data-action*="render"]', '#btnInvoiceRenderPdf'];
    for (const selector of selectors) {
      for (const button of document.querySelectorAll(selector)) {
        button.dataset.invoiceAsyncOperationId = operation.operation_id;
        button.dataset.invoiceAsyncFamily = family;
        if (modal?.invoiceId) button.dataset.invoiceId = modal.invoiceId;
      }
    }
    applyInvoiceActionButtonState(document);
  }

  async function handleInvoiceRenderPdfAsync(modalCtx) {
    const invoiceId = clean(
      modalCtx?.invoiceId
      || modalCtx?.invoiceDetail?.invoice?.id
      || modalCtx?.dataLoaded?.invoice?.id
      || modalCtx?.data?.id
    ).toLowerCase();
    if (!UUID_RE.test(invoiceId)) {
      await invoiceAsyncUiNotice('Invoice id missing.');
      return null;
    }
    modalCtx.invoiceAsync = asObject(modalCtx.invoiceAsync);
    const invoiceRecord = asObject(
      modalCtx?.invoiceDetail?.invoice
      || modalCtx?.dataLoaded?.invoice
      || modalCtx?.dataLoaded?.invoice_row
      || modalCtx?.data
    );
    const invoiceStatusAtOpen = upper(invoiceRecord.status);
    const signalReadyVersionId = clean(modalCtx.invoiceAsync.document_version_id).toLowerCase();
    const recordReadyVersionId = clean(
      ['ISSUED', 'PAID', 'PART_PAID', 'PARTIALLY_PAID'].includes(invoiceStatusAtOpen)
        ? invoiceRecord.issued_document_version_id
        : invoiceRecord.preview_document_version_id
    ).toLowerCase();
    const readyVersionId = UUID_RE.test(signalReadyVersionId)
      ? signalReadyVersionId
      : recordReadyVersionId;
    const exactReadyFromSignal = UUID_RE.test(signalReadyVersionId);
    const exactReadyFromRecord = upper(invoiceRecord.document_state) === 'READY'
      && UUID_RE.test(recordReadyVersionId);
    if (exactReadyFromSignal || exactReadyFromRecord) {
      const purpose = ['ISSUED', 'PAID', 'PART_PAID', 'PARTIALLY_PAID'].includes(invoiceStatusAtOpen)
        ? 'FINAL_ISSUE'
        : 'DRAFT_PREVIEW';
      const commandToken = crypto.randomUUID();
      const requestSerial = openPreparingInvoiceViewer(
        modalCtx,
        'INVOICE',
        invoiceId,
        purpose,
        commandToken
      );
      modalCtx.invoiceAsync.viewer_request.purpose = purpose;
      await completeInvoiceAsyncViewer(modalCtx, readyVersionId, {
        request_serial: requestSerial,
        entity_id: invoiceId,
        purpose
      });
      return {
        contract_version: 'INVOICE_VIEWER_V2',
        viewer_state: 'READY',
        purpose,
        document_version_id: readyVersionId
      };
    }
    const retained = asObject(modalCtx.invoiceAsync.viewer_request);
    const commandToken = retained.open && retained.entity_id === invoiceId && clean(retained.command_token)
      ? clean(retained.command_token)
      : crypto.randomUUID();
    const requestSerial = openPreparingInvoiceViewer(
      modalCtx,
      'INVOICE',
      invoiceId,
      'DRAFT_PREVIEW',
      commandToken,
      { show_viewer: false }
    );
    let response;
    try {
      response = await window.authFetch(invoiceApi(`/api/invoices/${encodeURIComponent(invoiceId)}/render`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': commandToken },
        body: JSON.stringify({ command_token: commandToken, priority_reason: 'VIEW_NOW' }),
        signal: modalCtx.invoiceAsync.viewer_request.abort_controller.signal
      });
    } catch (error) {
      const viewer = asObject(modalCtx.invoiceAsync?.viewer_request);
      if (viewer.open && viewer.request_serial === requestSerial
          && viewer.entity_type === 'INVOICE' && viewer.entity_id === invoiceId) {
        viewer.status_message = 'Preview failed';
        viewer.error = clean(error?.message || error);
        repaintInvoiceAsyncViewer(modalCtx);
      }
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    const viewer = asObject(modalCtx.invoiceAsync?.viewer_request);
    const currentRequest = viewer.open
      && viewer.request_serial === requestSerial
      && viewer.entity_type === 'INVOICE'
      && viewer.entity_id === invoiceId;
    if (clean(payload.contract_version) !== 'INVOICE_VIEWER_V2') {
      if (currentRequest) {
        viewer.viewer_state = 'BLOCKED';
        viewer.status_message = 'Preview failed';
        viewer.error = 'INVOICE_VIEWER_CONTRACT_MISMATCH';
        repaintInvoiceAsyncViewer(modalCtx);
      }
      throw new Error('INVOICE_VIEWER_CONTRACT_MISMATCH');
    }
    const viewerState = upper(payload.viewer_state);
    const purpose = upper(payload.purpose || 'DRAFT_PREVIEW');
    const versionId = clean(payload.document_version?.id || payload.document_version_id).toLowerCase();
    if (!currentRequest) return payload;
    if (!['DRAFT_PREVIEW', 'FINAL_ISSUE'].includes(purpose)) {
      viewer.viewer_state = 'BLOCKED';
      viewer.status_message = 'Preview failed';
      viewer.error = 'INVOICE_VIEWER_PURPOSE_INVALID';
      repaintInvoiceAsyncViewer(modalCtx);
      throw new Error('INVOICE_VIEWER_PURPOSE_INVALID');
    }
    const invoiceStatus = upper(
      modalCtx?.invoiceDetail?.invoice?.status
      || modalCtx?.dataLoaded?.invoice?.status
      || modalCtx?.data?.status
    );
    if (['ISSUED', 'PAID', 'PART_PAID', 'PARTIALLY_PAID'].includes(invoiceStatus)
        && purpose !== 'FINAL_ISSUE') {
      viewer.viewer_state = 'BLOCKED';
      viewer.status_message = 'Issued document unavailable';
      viewer.error = 'ISSUED_DOCUMENT_PURPOSE_INVALID';
      repaintInvoiceAsyncViewer(modalCtx);
      throw new Error('ISSUED_DOCUMENT_PURPOSE_INVALID');
    }
    viewer.purpose = purpose;
    if (response.status === 200 && viewerState === 'READY' && UUID_RE.test(versionId)) {
      viewer.open = false;
      viewer.viewer_state = 'READY';
      viewer.document_version_id = versionId;
      viewer.status_message = 'Invoice PDF ready';
      modalCtx.invoiceAsync.document_version_id = versionId;
      modalCtx.invoiceAsync.document_state = 'READY';
      modalCtx.invoiceAsync.document_operation = {
        ...asObject(payload.operation),
        operation_id: clean(payload.operation?.operation_id).toLowerCase() || null,
        operation_type: payload.operation?.operation_type || 'VIEW_INVOICE_DOCUMENT',
        entity_type: 'INVOICE',
        entity_id: invoiceId,
        status: 'COMPLETE',
        purpose,
        document_version_id: versionId
      };
      const host = document.querySelector('[data-invoice-async-state-host]');
      if (host) host.innerHTML = renderInvoiceAsyncState({ ...asObject(modalCtx.invoiceDetail), ...modalCtx.invoiceAsync });
      const pdfButton = document.querySelector('[data-action="inv-open-pdf"]');
      if (pdfButton) {
        pdfButton.disabled = false;
        pdfButton.textContent = 'View invoice PDF';
        pdfButton.dataset.documentVersionId = versionId;
        pdfButton.setAttribute('aria-busy', 'false');
        pdfButton.setAttribute('aria-disabled', 'false');
      }
      try { window.__toast?.('Invoice PDF is ready to open.'); } catch {}
      return payload;
    }
    if (response.status === 202 && viewerState === 'PREPARING') {
      const operations = registerInvoiceOperationsFromResponse(payload, {
        response_family: 'VIEW',
        operation_type: 'VIEW_INVOICE_DOCUMENT',
        entity_type: 'INVOICE',
        entity_id: invoiceId,
        purpose,
        command_token: commandToken,
        modal_identity: `invoice:${invoiceId}`,
        explicit_operation_ids: true
      });
      const operation = operations[0];
      if (!UUID_RE.test(clean(operation?.operation_id))) {
        viewer.viewer_state = 'BLOCKED';
        viewer.status_message = 'Preview failed';
        viewer.error = 'INVOICE_VIEWER_CONTRACT_MISMATCH';
        repaintInvoiceAsyncViewer(modalCtx);
        throw new Error('INVOICE_VIEWER_CONTRACT_MISMATCH');
      }
      viewer.operation_id = operation.operation_id;
      viewer.status_message = payload.status_message || 'Generating invoice PDF';
      modalCtx.invoiceAsync = {
        ...asObject(modalCtx.invoiceAsync),
        document_operation: operation,
        document_state: 'PREPARING'
      };
      const host = document.querySelector('[data-invoice-async-state-host]');
      if (host) host.innerHTML = renderInvoiceAsyncState({ ...asObject(modalCtx.invoiceDetail), ...modalCtx.invoiceAsync });
      attachOperationToButtons(operation, 'DOCUMENT');
      startInvoiceDocumentForegroundWatch(modalCtx, {
        request_serial: requestSerial,
        entity_id: invoiceId,
        operation_id: operation.operation_id,
        purpose
      });
      try { window.__toast?.('Invoice PDF generation started. This button will update when it is ready.'); } catch {}
      return payload;
    }
    const errorCode = clean(payload.error_code || payload.error || payload.message || `INVOICE_DOCUMENT_HTTP_${response.status}`);
    viewer.status_message = 'Preview failed';
    viewer.viewer_state = 'BLOCKED';
    viewer.error = errorCode;
    repaintInvoiceAsyncViewer(modalCtx);
    if (errorCode === 'ISSUED_DOCUMENT_INTEGRITY_FAILURE' || errorCode === 'ISSUED_DOCUMENT_POINTER_MISSING') {
      throw new Error(`The issued legal document cannot be opened (${errorCode}).`);
    }
    throw new Error(errorCode);
  }

  async function openTimesheetDocumentV8(timesheetId, options = {}) {
    const canonicalId = clean(timesheetId).toLowerCase();
    if (!UUID_RE.test(canonicalId)) throw new Error('TIMESHEET_ID_INVALID');
    const modalCtx = activeInvoiceViewers.get(canonicalId) || { invoiceAsync: {} };
    const retained = asObject(modalCtx.invoiceAsync?.viewer_request);
    const commandToken = clean(options.command_token)
      || (retained.open && retained.entity_id === canonicalId ? clean(retained.command_token) : '')
      || crypto.randomUUID();
    const requestSerial = openPreparingInvoiceViewer(
      modalCtx,
      'TIMESHEET',
      canonicalId,
      'TIMESHEET',
      commandToken
    );
    let response;
    try {
      response = await window.authFetch(invoiceApi(`/api/timesheets/${encodeURIComponent(canonicalId)}/pdf`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': commandToken },
        body: JSON.stringify({ command_token: commandToken, priority_reason: 'VIEW_NOW' }),
        signal: modalCtx.invoiceAsync.viewer_request.abort_controller.signal
      });
    } catch (error) {
      const viewer = asObject(modalCtx.invoiceAsync?.viewer_request);
      if (viewer.request_serial === requestSerial) {
        viewer.viewer_state = 'BLOCKED';
        viewer.status_message = 'Timesheet document failed';
        viewer.error = clean(error?.message || error);
        repaintInvoiceAsyncViewer(modalCtx);
      }
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    const viewer = asObject(modalCtx.invoiceAsync?.viewer_request);
    const currentRequest = viewer.open
      && viewer.request_serial === requestSerial
      && viewer.entity_type === 'TIMESHEET'
      && viewer.entity_id === canonicalId;
    if (clean(payload.contract_version) !== 'INVOICE_VIEWER_V2') {
      if (currentRequest) {
        viewer.viewer_state = 'BLOCKED';
        viewer.status_message = 'Timesheet document failed';
        viewer.error = 'INVOICE_VIEWER_CONTRACT_MISMATCH';
        repaintInvoiceAsyncViewer(modalCtx);
      }
      throw new Error('INVOICE_VIEWER_CONTRACT_MISMATCH');
    }
    const viewerState = upper(payload.viewer_state);
    const purpose = upper(payload.purpose || 'TIMESHEET');
    const versionId = clean(payload.document_version?.id || payload.document_version_id).toLowerCase();
    if (!currentRequest) return payload;
    if (purpose !== 'TIMESHEET') {
      viewer.viewer_state = 'BLOCKED';
      viewer.status_message = 'Timesheet document failed';
      viewer.error = 'INVOICE_VIEWER_PURPOSE_INVALID';
      repaintInvoiceAsyncViewer(modalCtx);
      throw new Error('INVOICE_VIEWER_PURPOSE_INVALID');
    }
    viewer.purpose = purpose;
    if (response.status === 200 && viewerState === 'READY' && UUID_RE.test(versionId)) {
      await completeInvoiceAsyncViewer(modalCtx, versionId, {
        request_serial: requestSerial,
        entity_id: canonicalId,
        purpose
      });
      return payload;
    }
    if (response.status === 202 && viewerState === 'PREPARING' && UUID_RE.test(clean(payload.operation_id))) {
      const [operation] = registerInvoiceOperationWatch({
        operation_id: payload.operation_id,
        operation_type: 'VIEW_TIMESHEET_DOCUMENT',
        entity_type: 'TIMESHEET',
        entity_id: canonicalId,
        purpose,
        status: 'QUEUED',
        phase: 'BUSINESS_WORK',
        command_token: commandToken,
        modal_identity: `timesheet:${canonicalId}`
      }, { response_family: 'VIEW', explicit_operation_ids: true });
      modalCtx.invoiceAsync.viewer_request.operation_id = operation?.operation_id || payload.operation_id;
      modalCtx.invoiceAsync.viewer_request.status_message = payload.status_message || 'Preparing timesheet';
      return payload;
    }
    const errorCode = clean(payload.error_code || payload.error || payload.message || `TIMESHEET_DOCUMENT_HTTP_${response.status}`);
    if (currentRequest) {
      viewer.viewer_state = 'BLOCKED';
      viewer.status_message = payload.status_message || 'Timesheet document blocked';
      viewer.error = errorCode;
      repaintInvoiceAsyncViewer(modalCtx);
    }
    throw new Error(errorCode);
  }

  async function handleInvoiceEmailAsync(modalCtx, options = {}) {
    const invoiceId = clean(modalCtx?.invoiceId || modalCtx?.invoiceDetail?.invoice?.id || modalCtx?.data?.id).toLowerCase();
    if (!UUID_RE.test(invoiceId)) {
      await invoiceAsyncUiNotice('Invoice id missing.');
      return null;
    }
    modalCtx.invoiceAsync = asObject(modalCtx.invoiceAsync);
    const explicitResend = options.resend === true;
    const commandToken = explicitResend || !clean(modalCtx.invoiceAsync.delivery_command_token)
      ? crypto.randomUUID()
      : clean(modalCtx.invoiceAsync.delivery_command_token);
    const deliveryToken = explicitResend || !clean(modalCtx.invoiceAsync.delivery_request_token)
      ? crypto.randomUUID()
      : clean(modalCtx.invoiceAsync.delivery_request_token);
    if (commandToken === deliveryToken) throw new Error('DELIVERY_REQUEST_TOKEN_INVALID');
    modalCtx.invoiceAsync.delivery_command_token = commandToken;
    modalCtx.invoiceAsync.delivery_request_token = deliveryToken;
    const body = {
      command_token: commandToken,
      delivery_request_token: deliveryToken
    };
    const delivery = asObject(modalCtx.invoiceAsync.delivery_intent || modalCtx.delivery_intent);
    if (delivery.delivery_policy) body.delivery_policy = delivery.delivery_policy;
    if (delivery.recipient_set) body.recipient_set = delivery.recipient_set;
    if (delivery.cc) body.cc = delivery.cc;
    if (delivery.bcc) body.bcc = delivery.bcc;
    const response = await window.authFetch(invoiceApi(`/api/invoices/${encodeURIComponent(invoiceId)}/email`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': commandToken },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (![200, 202, 207].includes(response.status)) {
      throw new Error(payload.error || payload.message || `INVOICE_DELIVERY_HTTP_${response.status}`);
    }
    const operations = registerInvoiceOperationsFromResponse(payload, {
      response_family: 'DELIVERY',
      operation_type: 'DELIVER_INVOICES',
      entity_type: 'INVOICE',
      entity_id: invoiceId,
      purpose: 'DELIVERY',
      command_token: commandToken,
      modal_identity: `invoice:${invoiceId}`,
      explicit_operation_ids: true
    });
    const operation = operations[0];
    modalCtx.invoiceAsync.delivery_operation = operation;
    attachOperationToButtons(operation, 'DELIVERY');
    try { window.__toast?.(explicitResend ? 'A new invoice delivery attempt has started.' : 'Invoice delivery preparation started.'); } catch {}
    return payload;
  }

  function augmentInvoiceModalRenderer() {
    const original = window.renderInvoiceModalContent;
    if (typeof original !== 'function' || original.__invoiceAsyncWrapped) return;
    const wrapped = function invoiceAsyncModalRenderer(modalCtx, invoiceData) {
      const html = original.apply(this, arguments);
      const detail = asObject(invoiceData || modalCtx?.invoiceDetail);
      const asyncState = { ...detail, ...asObject(modalCtx?.invoiceAsync) };
      return `${html}<div data-invoice-async-state-host>${renderInvoiceAsyncState(asyncState)}</div>`;
    };
    wrapped.__invoiceAsyncWrapped = true;
    wrapped.__invoiceAsyncOriginal = original;
    window.renderInvoiceModalContent = wrapped;
  }

  async function invoiceAsyncUnavailableAction(actionName = null, args = []) {
    const retryDelaysMs = [0, 250, 1000];
    for (const delayMs of retryDelaysMs) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (actionName && typeof window.initialiseInvoiceAsyncUi === 'function') {
        const capabilities = await window.initialiseInvoiceAsyncUi({ force: true }).catch(() => null);
        const recovered = window[actionName];
        if (
          capabilities?.enabled_for_user === true
          && typeof recovered === 'function'
          && recovered !== unavailableInvoiceActionHandlers[actionName]
        ) {
          return recovered(...args);
        }
      }
    }
    const message = 'Invoice processing could not reconnect automatically. The action was not started.';
    try { window.__toast?.(message); } catch {}
    try { console.warn('[INVOICE_ASYNC_RECOVERY]', message); } catch {}
    return null;
  }

  const unavailableInvoiceActionHandlers = Object.freeze({
    handleInvoiceRenderPdf: (...args) => invoiceAsyncUnavailableAction('handleInvoiceRenderPdf', args),
    handleInvoiceEmail: (...args) => invoiceAsyncUnavailableAction('handleInvoiceEmail', args),
    getTimesheetPdfUrl: (...args) => invoiceAsyncUnavailableAction('getTimesheetPdfUrl', args),
    openTimesheetPdf: (...args) => invoiceAsyncUnavailableAction('openTimesheetPdf', args),
    openTimesheetDocumentV8: (...args) => invoiceAsyncUnavailableAction('openTimesheetDocumentV8', args)
  });

  function installInvoiceAsyncUnavailableActions() {
    Object.assign(window, unavailableInvoiceActionHandlers);
    window.__invoiceAsyncOverridesInstalled = false;
    window.__invoiceAsyncGenerationInstalled = false;
    window.InvoiceBatchModalV8?.install?.();
    return true;
  }

  function installOverrides() {
    if (window.__invoiceAsyncCapability?.document_read_ready !== true) return false;
    const generationEnabled = window.__invoiceAsyncCapability?.enabled_for_user === true
      && window.__invoiceAsyncCapability?.document_generation_ready === true;
    const firstInstall = installed !== true;
    augmentInvoiceModalRenderer();
    window.handleInvoiceRenderPdf = handleInvoiceRenderPdfAsync;
    window.getTimesheetPdfUrl = openTimesheetDocumentV8;
    window.openTimesheetPdf = openTimesheetDocumentV8;
    window.openTimesheetDocumentV8 = openTimesheetDocumentV8;
    if (firstInstall) window.InvoiceBatchModalV8?.install?.();
    window.handleInvoiceEmail = generationEnabled
      ? handleInvoiceEmailAsync
      : unavailableInvoiceActionHandlers.handleInvoiceEmail;
    if (generationEnabled) {
      attachInvoiceAsyncDelegatedHandlers();
      saveInvoiceOperationWatches(loadInvoiceOperationWatches());
    } else {
      detachInvoiceAsyncDelegatedHandlers();
      window.__invoiceOperationWatches = [];
    }
    applyInvoiceActionButtonState(document);
    hydrateVisibleTimesheetEvidenceProcessingStates(document);
    installed = true;
    window.__invoiceAsyncOverridesInstalled = true;
    window.__invoiceAsyncGenerationInstalled = generationEnabled;
    return true;
  }

  function uninstallOverrides(options = {}) {
    const reason = clean(options.reason || 'capability-unavailable').toLowerCase();
    const priorWatchKey = clean(options.previous_watch_storage_key || activeWatchStorageKey);
    stopAllInvoiceDocumentForegroundWatches(reason);
    for (const modalCtx of activeInvoiceViewers.values()) {
      const viewer = asObject(modalCtx?.invoiceAsync?.viewer_request);
      viewer.open = false;
      try { viewer.abort_controller?.abort(); } catch {}
      revokeInvoiceAsyncViewerBlob(modalCtx);
    }
    activeInvoiceViewers.clear();
    try { window.InvoiceBatchModalV8?.close?.(); } catch {}
    detachInvoiceAsyncDelegatedHandlers();
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    window.__invoiceOperationWatches = [];
    if (['logout', 'user-replacement'].includes(reason)) {
      try {
        if (priorWatchKey) sessionStorage.removeItem(priorWatchKey);
        sessionStorage.removeItem(LEGACY_WATCH_STORAGE_KEY);
      } catch {}
      activeWatchStorageKey = null;
    }
    installed = false;
    installInvoiceAsyncUnavailableActions();
    return true;
  }

  async function initialiseInvoiceAsyncUi(options = {}) {
    const requestedWatchKey = operationWatchStorageKey();
    if (activeWatchStorageKey && activeWatchStorageKey !== requestedWatchKey) {
      uninstallOverrides({
        reason: requestedWatchKey ? 'user-replacement' : 'logout',
        previous_watch_storage_key: activeWatchStorageKey
      });
    }
    const capabilities = await loadInvoiceAsyncCapabilities(options);
    const resolvedWatchKey = operationWatchStorageKey();
    if (requestedWatchKey !== resolvedWatchKey) {
      uninstallOverrides({
        reason: resolvedWatchKey ? 'user-replacement' : 'logout',
        previous_watch_storage_key: activeWatchStorageKey
      });
    }
    if (capabilities.document_read_ready !== true) {
      uninstallOverrides({
        reason: resolvedWatchKey ? 'capability-unavailable' : 'logout',
        previous_watch_storage_key: activeWatchStorageKey
      });
      return capabilities;
    }
    activeWatchStorageKey = resolvedWatchKey;
    installOverrides();
    return capabilities;
  }

  Object.assign(window, {
    fetchInvoiceAsyncCapabilities,
    validateInvoiceAsyncCapabilities,
    cacheInvoiceAsyncCapabilities,
    loadInvoiceAsyncCapabilities,
    isInvoiceAsyncUiEnabled,
    isInvoiceAsyncDocumentReadEnabled,
    initialiseInvoiceAsyncUi,
    installInvoiceAsyncOverrides: installOverrides,
    installInvoiceAsyncUnavailableActions,
    uninstallInvoiceAsyncOverrides: uninstallOverrides,
    loadInvoiceOperationWatches,
    normaliseInvoiceOperationWatch,
    deduplicateInvoiceOperationWatch,
    pruneInvoiceOperationWatches,
    saveInvoiceOperationWatches,
    registerInvoiceOperationWatch,
    extractInvoiceOperationRows: extractOperationRows,
    registerInvoiceOperationsFromResponse,
    markInvoiceOperationHandled,
    acknowledgeInvoiceOperationNotification,
    buildInvoiceHeartbeatWatches,
    startInvoiceDocumentForegroundWatch,
    stopInvoiceDocumentForegroundWatch,
    stopAllInvoiceDocumentForegroundWatches,
    runInvoiceDocumentForegroundWatch,
    activeInvoiceDocumentForegroundWatchCount,
    applyInvoiceOperationUpdates,
    renderInvoiceAsyncState,
    deriveInvoiceAsyncActionState,
    renderInvoiceProgressText,
    renderInvoiceOperationError,
    renderDocumentAssetBadge,
    applyInvoiceActionButtonState,
    renderTimesheetEvidenceProcessingState,
    hydrateVisibleTimesheetEvidenceProcessingStates,
    retryInvoiceEvidenceOperation,
    submitInvoiceOperationControl,
    openExactReadyDocument,
    revokeInvoiceAsyncViewerBlob,
    completeInvoiceAsyncViewer,
    openTimesheetDocumentV8,
    handleInvoiceRenderPdfAsync,
    handleInvoiceEmailAsync
  });

  window.__invoiceAsyncCapability = unavailableCapabilities('NOT_INITIALISED');
  installInvoiceAsyncUnavailableActions();
  window.addEventListener('pagehide', () => {
    stopAllInvoiceDocumentForegroundWatches('pagehide');
    for (const modalCtx of activeInvoiceViewers.values()) {
      revokeInvoiceAsyncViewerBlob(modalCtx);
      try { modalCtx?.invoiceAsync?.viewer_request?.abort_controller?.abort(); } catch {}
    }
    activeInvoiceViewers.clear();
  });
  const begin = () => {
    // The capability endpoint is authenticated. On the signed-out login page,
    // wait for bootstrapApp() after login instead of creating an expected 401
    // request and a noisy browser console entry.
    if (!capabilityCacheKey()) {
      return Promise.resolve(cacheInvoiceAsyncCapabilities(
        unavailableCapabilities('INVOICE_ASYNC_AUTHENTICATED_USER_REQUIRED')
      ));
    }
    return initialiseInvoiceAsyncUi().catch(() => unavailableCapabilities());
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', begin, { once: true });
  } else {
    queueMicrotask(begin);
  }
})();

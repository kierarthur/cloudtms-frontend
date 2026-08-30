(function installBulkRowFreshnessV1(win) {
  'use strict';

  if (!win || win.bulkRowFreshnessV1) return;

  const inflightByIdentity = new Map();
  const FILTER_KEYS = [
    'q', 'candidate_id', 'client_id', 'date_from', 'date_to',
    'week_ending_date', 'week_ending_from', 'week_ending_to', 'bucket',
    'show_weekly_manual', 'show_daily_manual', 'show_daily', 'show_weekly',
    'show_manual', 'show_qr', 'show_electronic', 'validation_already',
    'validation_awaiting', 'show_authorised_invoiced_unissued'
  ];
  const PROCESS_SECTIONS = ['unprocessed_eligible', 'processed_eligible'];
  const AUTHORISE_SECTIONS = ['processed_eligible', 'authorised_eligible'];

  const trim = (value) => String(value == null ? '' : value).trim();
  const deep = (value) => {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  };
  const plain = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const signatureOf = (row) => trim(row?.backend_row_signature || row?.row_signature || row?.mutation_row_signature || row?.render_signature);
  const rowKeyOf = (row) => {
    const value = plain(row);
    const explicit = trim(value.row_key || value.rowKey || value.new_row_key);
    if (explicit) return explicit;
    const timesheetId = trim(value.current_timesheet_id || value.timesheet_id || value.requested_timesheet_id);
    if (timesheetId) return `timesheet:${timesheetId}`;
    const contractWeekId = trim(value.contract_week_id || value.contractWeekId);
    return contractWeekId ? `contract_week:${contractWeekId}` : '';
  };
  const identityOf = (row) => {
    const value = plain(row);
    const rowKey = rowKeyOf(value);
    const timesheetId = trim(value.current_timesheet_id || value.timesheet_id || value.requested_timesheet_id);
    const keyWeekId = /^contract_week:/i.test(rowKey) ? trim(rowKey.replace(/^contract_week:/i, '')) : '';
    const contractWeekId = trim(value.contract_week_id || value.contractWeekId || keyWeekId);
    return { rowKey, timesheetId, contractWeekId };
  };
  const stableIdentityOf = (row) => {
    const identity = identityOf(row);
    if (identity.contractWeekId) return `contract_week:${identity.contractWeekId}`;
    if (identity.timesheetId) return `timesheet:${identity.timesheetId}`;
    return identity.rowKey;
  };
  const sameLogicalRow = (row, identity) => {
    const candidate = identityOf(row);
    if (identity.rowKey && candidate.rowKey === identity.rowKey) return true;
    if (identity.contractWeekId && candidate.contractWeekId === identity.contractWeekId) return true;
    if (identity.timesheetId && candidate.timesheetId === identity.timesheetId) return true;
    return false;
  };
  const sectionOf = (surface, row) => {
    if (surface === 'bulk_process') {
      const bucket = trim(row?.bulk_process_bucket || row?.bucket || row?.processing_status).toUpperCase();
      return bucket === 'PROCESSED' ? 'processed_eligible' : 'unprocessed_eligible';
    }
    return trim(row?.bulk_authorise_section).toLowerCase();
  };

  function buildUrl(options) {
    const surface = trim(options.surface).toLowerCase();
    const row = plain(options.row);
    const identity = identityOf(row);
    const params = new URLSearchParams();
    params.set('surface', surface);
    if (surface === 'bulk_authorise') params.set('classification', trim(options.classification || 'TIMESHEETS').toUpperCase());
    if (identity.rowKey) params.set('row_key', identity.rowKey);
    if (trim(options.previousRowKey)) params.set('previous_row_key', trim(options.previousRowKey));
    if (identity.timesheetId) params.set('timesheet_id', identity.timesheetId);
    if (identity.contractWeekId) params.set('contract_week_id', identity.contractWeekId);
    const signature = trim(options.knownSignature || signatureOf(row));
    if (signature) params.set('known_signature', signature);
    const currentSection = trim(options.currentSection || sectionOf(surface, row)).toLowerCase();
    if (currentSection) params.set('current_section', currentSection);
    const filters = plain(options.filters);
    for (const key of FILTER_KEYS) {
      const value = filters[key];
      if (value == null || trim(value) === '') continue;
      params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    const path = `/api/timesheets/bulk-row-freshness?${params.toString()}`;
    if (typeof win.API === 'function') return win.API(path);
    const brokerBase = trim(win.BROKER_BASE_URL).replace(/\/+$/, '');
    return brokerBase ? `${brokerBase}${path}` : path;
  }

  async function fetchDecision(options) {
    const state = plain(options.state);
    const surface = trim(options.surface).toLowerCase();
    const identity = stableIdentityOf(options.row);
    if (!identity) throw new Error('A row identity is required for freshness validation.');
    const stateEpochKey = surface === 'bulk_authorise'
      ? '__bulk_authorise_freshness_epoch'
      : '__bulk_process_freshness_epoch';
    const stateCheckingKey = surface === 'bulk_authorise'
      ? '__bulk_authorise_freshness_checking'
      : '__bulk_process_freshness_checking';
    const epoch = Number(state[stateEpochKey] || 0) + 1;
    state[stateEpochKey] = epoch;
    state[stateCheckingKey] = true;
    const requestKey = `${surface}|${identity}`;
    let promise = inflightByIdentity.get(requestKey);

    if (!promise) {
      promise = (async () => {
        const controller = new AbortController();
        const timeoutMs = Math.max(3000, Math.min(5000, Number(options.timeoutMs || 4500) || 4500));
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const fetcher = typeof options.fetch === 'function' ? options.fetch : win.authFetch;
          if (typeof fetcher !== 'function') throw new Error('Authenticated request transport is unavailable.');
          const response = await fetcher(buildUrl(options), { method: 'GET', signal: controller.signal, cache: 'no-store' });
          let payload = null;
          try { payload = await response.json(); } catch { payload = null; }
          if (!response.ok || payload?.ok !== true) {
            const error = new Error(trim(payload?.message || payload?.error || 'Current server state could not be confirmed.'));
            error.code = trim(payload?.error_code || 'FRESHNESS_FAILED');
            error.status = Number(response.status || 0) || 0;
            throw error;
          }
          return payload;
        } catch (error) {
          if (error?.name === 'AbortError') {
            const timeoutError = new Error('Current server state could not be confirmed before the freshness check timed out.');
            timeoutError.code = 'FRESHNESS_TIMEOUT';
            throw timeoutError;
          }
          throw error;
        } finally {
          clearTimeout(timer);
        }
      })();
      inflightByIdentity.set(requestKey, promise);
      promise.finally(() => {
        if (inflightByIdentity.get(requestKey) === promise) inflightByIdentity.delete(requestKey);
      }).catch(() => {});
    }

    try {
      const decision = await promise;
      return {
        accepted: Number(state[stateEpochKey] || 0) === epoch,
        stale: Number(state[stateEpochKey] || 0) !== epoch,
        epoch,
        identity,
        decision
      };
    } finally {
      if (Number(state[stateEpochKey] || 0) === epoch) state[stateCheckingKey] = false;
    }
  }

  function aliasesFor(decision, fallbackRow) {
    const row = plain(decision?.row);
    const fallback = plain(fallbackRow);
    return Array.from(new Set([
      trim(decision?.previous_row_key),
      trim(decision?.row_key),
      rowKeyOf(row),
      rowKeyOf(fallback)
    ].filter(Boolean)));
  }

  function matchesAny(row, aliases, stableIdentities) {
    const key = rowKeyOf(row);
    if (key && aliases.includes(key)) return true;
    return stableIdentities.some((identity) => sameLogicalRow(row, identity));
  }

  function remapSelection(values, aliases, canonicalKey, keepCanonical) {
    const selected = Array.isArray(values) ? values.map(trim).filter(Boolean) : [];
    const hadOld = selected.some((key) => aliases.includes(key));
    const kept = selected.filter((key) => !aliases.includes(key));
    if (hadOld && keepCanonical && canonicalKey) kept.push(canonicalKey);
    return Array.from(new Set(kept));
  }

  function invalidateRowCaches(state, aliases, identities, cacheNames) {
    const needles = Array.from(new Set([
      ...aliases,
      ...identities.flatMap((identity) => [identity.rowKey, identity.timesheetId, identity.contractWeekId])
    ].map(trim).filter(Boolean)));
    for (const name of cacheNames) {
      const store = state[name];
      if (!store || typeof store !== 'object') continue;
      for (const key of Object.keys(store)) {
        if (needles.some((needle) => trim(key).includes(needle))) {
          try { delete store[key]; } catch {}
        }
      }
    }
  }

  function clearActiveRowOwnedState(state) {
    state.active_row = null;
    state.active_row_key = null;
    state.activeRowKey = null;
    state.active_context = null;
    state.active_ctx = null;
    state.active_details = null;
    state.__active_context_is_minimal = false;
    const pane = plain(state.evidence_pane_state);
    state.evidence_pane_state = {
      ...pane,
      attached_rows: [],
      attached_all_rows: [],
      active_attached_id: null,
      active_attached_item: null,
      active_queue_id: null,
      active_queue_item: null,
      __preview_target_key: '',
      __preview_signed_url: '',
      __preview_load_requested_target_key: '',
      __preview_identity: '',
      __bulk_authorise_evidence_identity: ''
    };
  }

  function reconcileBulkProcess(stateInput, decisionInput, fallbackRow = null) {
    const state = plain(stateInput);
    const decision = plain(decisionInput);
    if (decision.outcome === 'CURRENT' && decision.changed === false) return { applied: false, unchanged: true };
    const dataset = plain(state.dataset);
    const originalUnprocessed = Array.isArray(dataset.unprocessed_rows) ? dataset.unprocessed_rows.slice() : [];
    const originalProcessed = Array.isArray(dataset.processed_rows) ? dataset.processed_rows.slice() : [];
    const originalCombined = [...originalUnprocessed, ...originalProcessed];
    const aliases = aliasesFor(decision, fallbackRow);
    const identities = [identityOf(decision.row), identityOf(fallbackRow)].filter((identity) => identity.rowKey || identity.timesheetId || identity.contractWeekId);
    const oldIndex = originalCombined.findIndex((candidate) => matchesAny(candidate, aliases, identities));
    const removeMatches = (rows) => rows.filter((candidate) => !matchesAny(candidate, aliases, identities));
    const unprocessed = removeMatches(originalUnprocessed);
    const processed = removeMatches(originalProcessed);
    const eligible = decision.eligible_for_surface === true && decision.outcome !== 'REMOVED' && decision.outcome !== 'DELETED' && decision.row;
    const canonicalRow = eligible ? deep(decision.row) : null;
    const canonicalKey = trim(decision.row_key || rowKeyOf(canonicalRow));
    if (canonicalRow) canonicalRow.row_key = canonicalKey;
    if (eligible && decision.target_section === 'processed_eligible') processed.push(canonicalRow);
    else if (eligible) unprocessed.push(canonicalRow);
    dataset.unprocessed_rows = unprocessed;
    dataset.processed_rows = processed;
    dataset.counts = {
      ...plain(dataset.counts),
      unprocessed: unprocessed.length,
      processed: processed.length,
      total: unprocessed.length + processed.length
    };
    state.dataset = dataset;
    state.selected_row_keys = remapSelection(state.selected_row_keys, aliases, canonicalKey, !!eligible);
    invalidateRowCaches(state, aliases, identities, [
      '__bulk_process_row_context_cache', '__bulk_process_row_context_inflight',
      '__bulk_process_context_cache', '__bulk_process_context_inflight'
    ]);

    const activeIdentity = identityOf(state.active_row);
    const activeMatched = matchesAny(state.active_row || { row_key: state.active_row_key }, aliases, identities)
      || identities.some((identity) => sameLogicalRow(activeIdentity, identity));
    if (activeMatched && eligible) {
      state.active_row = { ...plain(state.active_row), ...deep(canonicalRow) };
      state.active_row_key = canonicalKey;
      state.activeRowKey = canonicalKey;
    } else if (activeMatched && !eligible) {
      clearActiveRowOwnedState(state);
    }

    const remaining = [...unprocessed, ...processed];
    const successor = !eligible && remaining.length
      ? remaining[Math.max(0, Math.min(oldIndex < 0 ? 0 : oldIndex, remaining.length - 1))]
      : null;
    state.warning_text = eligible
      ? 'This row was updated elsewhere and has been refreshed.'
      : 'This row is no longer available in Bulk Process.';
    return {
      applied: true,
      unchanged: false,
      eligible: !!eligible,
      canonical_row_key: canonicalKey || null,
      replacement_row_key: rowKeyOf(successor) || null,
      needs_context: !!eligible
    };
  }

  function reconcileBulkAuthorise(stateInput, decisionInput, fallbackRow = null) {
    const state = plain(stateInput);
    const decision = plain(decisionInput);
    if (decision.outcome === 'CURRENT' && decision.changed === false) return { applied: false, unchanged: true };
    const dataset = plain(state.dataset);
    const originalRows = Array.isArray(dataset.rows) ? dataset.rows.slice() : [];
    const aliases = aliasesFor(decision, fallbackRow);
    const identities = [identityOf(decision.row), identityOf(fallbackRow)].filter((identity) => identity.rowKey || identity.timesheetId || identity.contractWeekId);
    const oldIndex = originalRows.findIndex((candidate) => matchesAny(candidate, aliases, identities));
    const rows = originalRows.filter((candidate) => !matchesAny(candidate, aliases, identities));
    const eligible = decision.eligible_for_surface === true && decision.outcome !== 'REMOVED' && decision.outcome !== 'DELETED' && decision.row;
    const canonicalRow = eligible ? deep(decision.row) : null;
    const canonicalKey = trim(decision.row_key || rowKeyOf(canonicalRow));
    if (canonicalRow) {
      canonicalRow.row_key = canonicalKey;
      canonicalRow.bulk_authorise_section = decision.target_section;
      rows.push(canonicalRow);
    }
    dataset.rows = rows;
    const processedCount = rows.filter((candidate) => trim(candidate?.bulk_authorise_section) === 'processed_eligible').length;
    const authorisedCount = rows.filter((candidate) => trim(candidate?.bulk_authorise_section) === 'authorised_eligible').length;
    dataset.counts = {
      ...plain(dataset.counts),
      total: rows.length,
      processed_eligible: processedCount,
      authorised_eligible: authorisedCount
    };
    state.dataset = dataset;
    const selection = plain(state.selected_row_keys_by_section);
    const wasSelected = [...(Array.isArray(selection.processed_eligible) ? selection.processed_eligible : []), ...(Array.isArray(selection.authorised_eligible) ? selection.authorised_eligible : [])]
      .map(trim)
      .some((key) => aliases.includes(key));
    const nextSelection = {
      processed_eligible: remapSelection(selection.processed_eligible, aliases, canonicalKey, false),
      authorised_eligible: remapSelection(selection.authorised_eligible, aliases, canonicalKey, false)
    };
    if (wasSelected && eligible && canonicalKey && AUTHORISE_SECTIONS.includes(decision.target_section)) {
      nextSelection[decision.target_section] = Array.from(new Set([...nextSelection[decision.target_section], canonicalKey]));
    }
    state.selected_row_keys_by_section = nextSelection;
    state.selected_row_keys = [];
    state.selected_section = null;
    invalidateRowCaches(state, aliases, identities, [
      '__bulk_authorise_context_cache', '__bulk_authorise_context_inflight',
      '__bulk_authorise_row_context_cache', '__bulk_authorise_row_context_inflight'
    ]);
    const activeMatched = matchesAny(state.active_row || { row_key: state.active_row_key }, aliases, identities);
    if (activeMatched && eligible) {
      state.active_row = { ...plain(state.active_row), ...deep(canonicalRow) };
      state.active_row_key = canonicalKey;
      state.activeRowKey = canonicalKey;
    } else if (activeMatched && !eligible) {
      clearActiveRowOwnedState(state);
    }
    const successor = !eligible && rows.length
      ? rows[Math.max(0, Math.min(oldIndex < 0 ? 0 : oldIndex, rows.length - 1))]
      : null;
    state.warning_text = eligible
      ? 'This row was updated elsewhere and has been refreshed.'
      : 'This row is no longer available in Bulk Authorise.';
    return {
      applied: true,
      unchanged: false,
      eligible: !!eligible,
      canonical_row_key: canonicalKey || null,
      replacement_row_key: rowKeyOf(successor) || null,
      needs_context: !!eligible
    };
  }

  function markUnconfirmed(stateInput, surface, error) {
    const state = plain(stateInput);
    const key = surface === 'bulk_authorise'
      ? '__bulk_authorise_freshness_unconfirmed'
      : '__bulk_process_freshness_unconfirmed';
    state[key] = true;
    state[surface === 'bulk_authorise' ? '__bulk_authorise_freshness_checking' : '__bulk_process_freshness_checking'] = false;
    state.warning_text = trim(error?.message) || 'Current server state could not be confirmed. Click the row to retry.';
    return false;
  }

  function markConfirmed(stateInput, surface) {
    const state = plain(stateInput);
    const key = surface === 'bulk_authorise'
      ? '__bulk_authorise_freshness_unconfirmed'
      : '__bulk_process_freshness_unconfirmed';
    state[key] = false;
    state[surface === 'bulk_authorise' ? '__bulk_authorise_freshness_checking' : '__bulk_process_freshness_checking'] = false;
  }

  async function confirmDirtyConflict(options) {
    const state = plain(options.state);
    const decision = plain(options.decision);
    if (typeof win.openUiConfirmModal !== 'function') return false;
    const removed = decision.outcome === 'REMOVED' || decision.outcome === 'DELETED';
    const result = await win.openUiConfirmModal({
      title: 'This row changed elsewhere',
      message: removed
        ? 'Another user changed this row and it is no longer available here. Your unsaved edits cannot be applied. Continue with the current server state?'
        : 'Another user changed this row while you had unsaved edits. Continue and reload the current server version?',
      confirm_label: removed ? 'Continue' : 'Reload server version',
      confirm_class: 'btn btn-primary',
      cancel_label: 'Keep reviewing'
    });
    if (!result?.confirmed) return false;

    if (options.surface === 'bulk_authorise') {
      try {
        const draft = typeof win.ensureBulkAuthoriseManualDraftState === 'function'
          ? win.ensureBulkAuthoriseManualDraftState(state)
          : null;
        draft?.discardActiveDraft?.({ source: 'bulk-row-freshness-conflict', writeToActiveState: false });
      } catch {}
    } else if (typeof win.clearBulkProcessDirty === 'function') {
      try { win.clearBulkProcessDirty(state, 'bulk-row-freshness-conflict', { source: 'bulk-row-freshness-v1' }); } catch {}
    }
    state.dirty = false;
    try {
      const frame = typeof win.__getModalFrame === 'function' ? win.__getModalFrame() : null;
      if (frame) {
        frame.isDirty = false;
        frame._updateButtons?.();
      }
    } catch {}
    return true;
  }

  win.bulkRowFreshnessV1 = Object.freeze({
    fetchDecision,
    reconcileBulkProcess,
    reconcileBulkAuthorise,
    confirmDirtyConflict,
    markUnconfirmed,
    markConfirmed,
    rowKeyOf,
    identityOf,
    stableIdentityOf,
    _inflightByIdentity: inflightByIdentity
  });
})(window);

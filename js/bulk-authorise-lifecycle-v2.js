(function installBulkAuthoriseLifecycleV2(win) {
  'use strict';

  if (!win || win.__bulkAuthoriseLifecycleV2Installed === true) return;

  const legacy = {
    open: win.openBulkAuthoriseWorkbench,
    setActiveRow: win.setActiveBulkAuthoriseRowFromVisibleRows,
    bindClassification: win.bindBulkAuthoriseClassificationButtons,
    rerender: win.rerenderBulkAuthoriseWorkbench,
    authoriseSelected: win.handleBulkAuthoriseSelected,
    unauthoriseSelected: win.handleBulkUnauthoriseSelected
  };

  if (
    typeof legacy.open !== 'function' ||
    typeof legacy.setActiveRow !== 'function' ||
    typeof legacy.rerender !== 'function'
  ) {
    return;
  }

  win.__bulkAuthoriseLifecycleV2Installed = true;

  const controllers = new WeakMap();
  const trim = (value) => String(value == null ? '' : value).trim();
  const deep = (value) => {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  };
  const classificationOf = (value) => {
    const key = trim(value).toUpperCase();
    return (key === 'TIMESHEETS' || key === 'NHSP' || key === 'HR') ? key : 'TIMESHEETS';
  };
  const rowKeyOf = (row) => {
    const value = row && typeof row === 'object' ? row : {};
    const explicit = trim(value.row_key || value.rowKey);
    if (explicit) return explicit;
    const timesheetId = trim(value.current_timesheet_id || value.timesheet_id || value.requested_timesheet_id || value.expected_timesheet_id);
    if (timesheetId) return `timesheet:${timesheetId}`;
    const contractWeekId = trim(value.contract_week_id || value.contractWeekId);
    return contractWeekId ? `contract_week:${contractWeekId}` : '';
  };
  const failedRowKeys = (result) => {
    const rows = Array.isArray(result && result.failed_items) ? result.failed_items : [];
    return Array.from(new Set(rows.map((entry) => trim(
      entry && (entry.row_key || entry.row_key_before || entry.row_key_after || entry.previous_row_key)
    )).filter(Boolean)));
  };
  const currentState = (state) => {
    if (state && typeof state === 'object') return state;
    const modalState = win.modalCtx && win.modalCtx.bulkAuthoriseState;
    return modalState && typeof modalState === 'object' ? modalState : null;
  };
  const visibleRowsFor = (state) => {
    if (typeof win.getVisibleBulkAuthoriseRows === 'function') {
      try {
        const visible = win.getVisibleBulkAuthoriseRows(state);
        if (Array.isArray(visible)) return visible.slice();
        if (Array.isArray(visible && visible.visible_rows)) return visible.visible_rows.slice();
      } catch {}
    }
    return Array.isArray(state && state.dataset && state.dataset.rows) ? state.dataset.rows.slice() : [];
  };
  const requestFiltersFor = (state) => {
    if (typeof win.buildBulkAuthoriseDatasetRequestFilters === 'function') {
      try { return win.buildBulkAuthoriseDatasetRequestFilters(state); } catch {}
    }
    return { ...(state && state.filters ? state.filters : {}), classification: classificationOf(state && state.classification) };
  };

  const selectionMapFor = (state) => {
    const source = state?.selected_row_keys_by_section && typeof state.selected_row_keys_by_section === 'object'
      ? state.selected_row_keys_by_section
      : {};
    return {
      processed_eligible: Array.from(new Set((Array.isArray(source.processed_eligible) ? source.processed_eligible : []).map(trim).filter(Boolean))),
      authorised_eligible: Array.from(new Set((Array.isArray(source.authorised_eligible) ? source.authorised_eligible : []).map(trim).filter(Boolean)))
    };
  };
  const installSelectionMap = (state, map) => {
    state.selected_row_keys_by_section = {
      processed_eligible: Array.isArray(map?.processed_eligible) ? map.processed_eligible.slice() : [],
      authorised_eligible: Array.isArray(map?.authorised_eligible) ? map.authorised_eligible.slice() : []
    };
    // These fields are retained only as the legacy bulk-action execution adapter.
    state.selected_row_keys = [];
    state.selected_section = null;
  };
  const sectionScrollPositions = () => {
    const read = (section) => Number(win.document?.querySelector?.(`[data-bulk-authorise-section-scroll="${section}"]`)?.scrollTop || 0);
    return {
      processed_eligible: read('processed_eligible'),
      authorised_eligible: read('authorised_eligible')
    };
  };

  const captureMutationIntent = (action, state, options = {}) => {
    const rows = visibleRowsFor(state);
    const activeRowKey = trim(state?.active_row_key || rowKeyOf(state?.active_row));
    const targetSection = action === 'authorise' ? 'processed_eligible' : 'authorised_eligible';
    const selectionMap = selectionMapFor(state);
    const source = trim(options?.source).toLowerCase();
    const selectedKeys = source === 'selected-bulk'
      ? (Array.isArray(state?.selected_row_keys) ? state.selected_row_keys.map(trim).filter(Boolean) : selectionMap[targetSection])
      : [];
    const selectedSection = source === 'selected-bulk' ? trim(state?.selected_section || targetSection) : '';
    const sectionRows = rows.filter((row) => trim(row?.bulk_authorise_section) === targetSection);
    const sectionKeys = sectionRows.map(rowKeyOf).filter(Boolean);
    const affectedKeys = selectedKeys.length && selectedSection === targetSection
      ? selectedKeys.filter((key) => sectionKeys.includes(key))
      : (activeRowKey && sectionKeys.includes(activeRowKey) ? [activeRowKey] : []);
    const activeAffected = !!(activeRowKey && affectedKeys.includes(activeRowKey));
    const anchorKey = activeAffected ? activeRowKey : affectedKeys[affectedKeys.length - 1];
    const anchorIndex = sectionKeys.indexOf(anchorKey);
    const fallbackRowKeys = action === 'authorise' && anchorIndex >= 0
      ? sectionKeys.slice(anchorIndex + 1).filter((key) => !affectedKeys.includes(key))
      : affectedKeys.slice();
    const leftPane = win.document?.getElementById?.('bulkAuthoriseLeftPane');
    return {
      action,
      active_row_key: activeRowKey,
      affected_row_keys: affectedKeys,
      active_affected: activeAffected,
      fallback_row_keys: fallbackRowKeys,
      selected_row_keys: selectedKeys,
      selected_section: selectedSection || null,
      checkbox_selection: selectionMap,
      source: source || 'unknown',
      preserve_checkbox_selection: source !== 'selected-bulk',
      section_scroll_top: sectionScrollPositions(),
      left_scroll_top: Number(leftPane?.scrollTop || 0)
    };
  };

  const restoreLeftPanePosition = (scrollTop, activeRowKey, ensureVisible) => {
    const apply = () => {
      const positions = scrollTop && typeof scrollTop === 'object' ? scrollTop : {};
      for (const section of ['processed_eligible', 'authorised_eligible']) {
        const scroller = win.document?.querySelector?.(`[data-bulk-authorise-section-scroll="${section}"]`);
        if (scroller) scroller.scrollTop = Number(positions[section] || 0);
      }
      if (!ensureVisible || !activeRowKey) return;
      const leftPane = win.document?.getElementById?.('bulkAuthoriseLeftPane');
      const rows = Array.from(leftPane?.querySelectorAll?.('[data-bulk-authorise-row="1"][data-row-key]') || []);
      const activeElement = rows.find((row) => trim(row.getAttribute('data-row-key')) === activeRowKey);
      if (!activeElement || typeof activeElement.getBoundingClientRect !== 'function') return;
      const host = activeElement.closest?.('[data-bulk-authorise-section-scroll]');
      if (!host) return;
      const hostRect = host.getBoundingClientRect();
      const rowRect = activeElement.getBoundingClientRect();
      if (rowRect.top < hostRect.top) host.scrollTop += rowRect.top - hostRect.top;
      else if (rowRect.bottom > hostRect.bottom) host.scrollTop += rowRect.bottom - hostRect.bottom;
    };
    apply();
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(apply);
  };

  function cancelPreviewInflight(pane) {
    const inflight = pane && pane.__preview_presign_inflight;
    if (!inflight || typeof inflight !== 'object') return;
    for (const pending of Object.values(inflight)) {
      try { pending && typeof pending.abort === 'function' && pending.abort(); } catch {}
      try { pending && typeof pending.cancel === 'function' && pending.cancel(); } catch {}
    }
  }

  function clearDockedViewer(state, key) {
    if (!state[key] || typeof state[key] !== 'object') return;
    state[key] = {
      ...state[key],
      open: false,
      row_key: '',
      evidence_id: '',
      storage_key: '',
      signed_url: '',
      file_name: '',
      kind: '',
      mime_type: '',
      rotation_deg: 0
    };
  }

  function clearRowOwnedState(state, options = {}) {
    if (!state || typeof state !== 'object') return;
    const pane = state.evidence_pane_state && typeof state.evidence_pane_state === 'object'
      ? state.evidence_pane_state
      : {};
    const queueRows = options.preserveQueueRows === false
      ? []
      : (Array.isArray(pane.queue_rows) ? pane.queue_rows.map(deep) : []);

    cancelPreviewInflight(pane);
    state.evidence_pane_state = {
      ...pane,
      active_tab: 'attached',
      attached_rows: [],
      attached_all_rows: [],
      active_attached_id: null,
      active_attached_item: null,
      active_queue_id: null,
      active_queue_item: null,
      queue_rows: queueRows,
      all_rows: queueRows,
      __preview_presign_inflight: {},
      __preview_target_key: '',
      __preview_signed_url: '',
      __preview_load_requested_target_key: '',
      __preview_identity: '',
      __active_attached_preview_target: '',
      __bulk_authorise_evidence_identity: '',
      __queue_loaded_identity: '',
      __queue_manual_override: false,
      __queue_manual_override_identity: '',
      __queue_manual_override_scope: '',
      __attached_manual_override: true,
      pendingAttached: false,
      __pending_attached: false,
      __pendingAttached: false,
      pendingAttachedIdentity: '',
      __pending_attached_identity: '',
      pendingAttachedRequestKey: '',
      __pending_attached_request_key: ''
    };

    state.__bulkAuthorisePreviewActiveRowKey = '';
    state.__bulkAuthorisePreviewActiveBackendRowSignature = '';
    state.__bulkAuthorisePreviewActiveRenderSignature = '';
    state.__bulkAuthorisePreviewActiveRowSignature = '';
    state.__bulk_authorise_open_preview_settle_key = '';
    state.__bulk_authorise_open_preview_settle_pending = false;
    state.__bulk_authorise_open_preview_settle_last_committed_key = '';
    state.__bulk_authorise_open_preview_settle_last_record_identity = '';
    state.__bulkAuthoriseImportEvidenceView = { loading: false, error: '', payload: null, request_key: '' };
    state.imported_evidence_context_cache = {};
    clearDockedViewer(state, 'bulkAuthoriseDockedEvidenceViewer');
    clearDockedViewer(state, 'dockedEvidenceViewer');

    if (win.modalCtx && (win.modalCtx.bulkAuthoriseState === state || trim(win.modalCtx.entity).toLowerCase() === 'bulk-authorise')) {
      win.modalCtx.__bulkAuthoriseRecordIdentity = null;
      win.modalCtx.timesheetDetails = {};
      win.modalCtx.timesheetRelated = {};
      win.modalCtx.timesheetMeta = {};
      win.modalCtx.timesheetState = { evidence: [] };
    }
  }

  function clearActiveRow(state) {
    state.active_row_key = null;
    state.activeRowKey = null;
    state.active_row = null;
    state.active_context = null;
    state.active_ctx = null;
    state.active_details = null;
    state.activeRecordIdentity = null;
    state.activeTimesheetId = null;
    state.activeContractWeekId = null;
    state.__bulkAuthoriseRecordIdentity = '';
    state.__bulk_authorise_active_backend_row_signature = '';
    state.__bulk_authorise_active_render_signature = '';
    state.__bulk_authorise_active_row_signature = '';
    state.__bulk_authorise_row_context_ready = false;
    state.__bulk_authorise_row_context_ready_backend_signature = '';
    state.__bulk_authorise_row_context_ready_render_signature = '';
    state.__bulk_authorise_row_context_ready_signature = '';
    state.__bulk_authorise_row_context_ready_seq = Number(state.__bulk_authorise_row_change_seq || 0) || 0;
  }

  function clearActiveRowContext(state) {
    if (!state || typeof state !== 'object') return;
    state.active_context = null;
    state.active_ctx = null;
    state.active_details = null;
    state.activeRecordIdentity = null;
    state.activeTimesheetId = null;
    state.activeContractWeekId = null;
    state.__bulkAuthoriseRecordIdentity = '';
    state.__bulk_authorise_active_backend_row_signature = '';
    state.__bulk_authorise_active_render_signature = '';
    state.__bulk_authorise_active_row_signature = '';
    state.__bulk_authorise_row_context_ready = false;
    state.__bulk_authorise_row_context_ready_backend_signature = '';
    state.__bulk_authorise_row_context_ready_render_signature = '';
    state.__bulk_authorise_row_context_ready_signature = '';
    state.__bulk_authorise_row_context_ready_seq = Number(state.__bulk_authorise_row_change_seq || 0) || 0;
  }

  const ROW_SNAPSHOT_FIELDS = [
    'active_row_key',
    'activeRowKey',
    'active_row',
    'active_context',
    'active_ctx',
    'active_details',
    'activeRecordIdentity',
    'activeTimesheetId',
    'activeContractWeekId',
    '__bulkAuthoriseRecordIdentity',
    '__bulk_authorise_active_backend_row_signature',
    '__bulk_authorise_active_render_signature',
    '__bulk_authorise_active_row_signature',
    'activeRowSignature',
    '__bulk_authorise_row_context_ready',
    '__bulk_authorise_row_context_ready_backend_signature',
    '__bulk_authorise_row_context_ready_render_signature',
    '__bulk_authorise_row_context_ready_signature',
    'evidence_pane_state',
    '__bulkAuthorisePreviewActiveRowKey',
    '__bulkAuthorisePreviewActiveBackendRowSignature',
    '__bulkAuthorisePreviewActiveRenderSignature',
    '__bulkAuthorisePreviewActiveRowSignature',
    '__bulk_authorise_open_preview_settle_key',
    '__bulk_authorise_open_preview_settle_pending',
    '__bulk_authorise_open_preview_settle_last_committed_key',
    '__bulk_authorise_open_preview_settle_last_record_identity',
    '__bulkAuthoriseImportEvidenceView',
    'imported_evidence_context_cache',
    'bulkAuthoriseDockedEvidenceViewer',
    'dockedEvidenceViewer'
  ];

  const QUEUE_STATE_FIELDS = [
    'queue_rows',
    'all_rows',
    'active_queue_id',
    'active_queue_item',
    '__queue_loaded',
    '__queue_loaded_at',
    '__queue_loaded_identity',
    '__queue_loaded_scope',
    '__queue_scope',
    '__queue_manual_override',
    '__queue_manual_override_identity',
    '__queue_manual_override_scope'
  ];

  function watchVectorFromState(state) {
    const candidates = [
      state?.active_context?.watch_vector,
      state?.active_ctx?.watch_vector,
      state?.active_details?.watch_vector,
      state?.active_context?.details?.watch_vector
    ];
    for (const candidate of candidates) {
      if (
        candidate &&
        typeof candidate === 'object' &&
        candidate.cacheable === true &&
        trim(candidate.watch_token)
      ) return deep(candidate);
    }
    return null;
  }

  function defaultFastSurfaceAdapter() {
    const doc = win.document;
    const patchActiveRow = (rowKey) => {
      const rows = Array.from(doc?.querySelectorAll?.('[data-bulk-authorise-row="1"][data-row-key]') || []);
      for (const row of rows) {
        const active = trim(row.getAttribute?.('data-row-key')) === rowKey;
        if (row.style) {
          row.style.borderColor = active ? 'var(--accent,#6ea8fe)' : 'rgba(255,255,255,0.08)';
          row.style.boxShadow = active ? '0 0 0 1px rgba(110,168,254,0.35) inset' : 'none';
        }
        try {
          if (active) row.setAttribute('aria-current', 'true');
          else row.removeAttribute('aria-current');
        } catch {}
      }
    };
    return {
      capture() {
        const content = doc?.getElementById?.('bulkAuthoriseWorkbenchContent');
        const middle = doc?.getElementById?.('bulkAuthoriseMiddlePane');
        const right = doc?.getElementById?.('bulkAuthoriseRightPane');
        if (!content || !middle || !right || middle.parentNode !== content || right.parentNode !== content) return null;
        const surface = {
          middle,
          right,
          middle_scroll_top: Number(middle.scrollTop || 0),
          right_scroll_top: Number(right.scrollTop || 0)
        };
        try { middle.remove(); } catch { return null; }
        try { right.remove(); } catch { return null; }
        return surface;
      },
      restore(surface, rowKey) {
        const content = doc?.getElementById?.('bulkAuthoriseWorkbenchContent');
        if (!content || !surface?.middle || !surface?.right) return false;
        try {
          content.replaceChildren(surface.middle, surface.right);
          surface.middle.scrollTop = Number(surface.middle_scroll_top || 0);
          surface.right.scrollTop = Number(surface.right_scroll_top || 0);
          patchActiveRow(rowKey);
          return true;
        } catch {
          return false;
        }
      },
      setBusy(busy) {
        const content = doc?.getElementById?.('bulkAuthoriseWorkbenchContent');
        if (!content) return;
        try { content.inert = busy === true; } catch {}
        try { content.setAttribute('aria-busy', busy === true ? 'true' : 'false'); } catch {}
        if (content.style) content.style.pointerEvents = busy === true ? 'none' : '';
      },
      release(surface) {
        for (const node of [surface?.middle, surface?.right]) {
          if (!node || node.isConnected) continue;
          try { node.remove(); } catch {}
        }
      }
    };
  }

  class BulkAuthoriseLifecycleController {
    constructor(state) {
      this.state = state;
      this.rowEpoch = 0;
      this.datasetEpoch = 0;
      this.closed = false;
      this.initialised = false;
      this.frame = null;
      this.frameDismiss = null;
      this.rowSnapshots = new Map();
      this.maxRowSnapshots = 8;
      state.__bulkAuthoriseLifecycleVersion = 7;
      state.__bulkAuthoriseLifecycleController = this;
    }

    surfaceAdapter() {
      const adapter = win.__bulkAuthoriseFastSurfaceAdapter;
      return adapter && typeof adapter === 'object' ? adapter : defaultFastSurfaceAdapter();
    }

    dropSnapshot(rowKey) {
      const key = trim(rowKey);
      if (!key) return;
      const snapshot = this.rowSnapshots.get(key);
      if (snapshot?.surface) {
        try { this.surfaceAdapter().release?.(snapshot.surface); } catch {}
      }
      this.rowSnapshots.delete(key);
    }

    clearSnapshots() {
      for (const key of Array.from(this.rowSnapshots.keys())) this.dropSnapshot(key);
      this.rowSnapshots.clear();
    }

    captureSnapshot(rowKey) {
      const key = trim(rowKey);
      if (!key || this.state.__bulk_authorise_row_context_ready !== true) return null;
      const vector = watchVectorFromState(this.state);
      if (!vector) return null;
      const snapshot = { row_key: key, watch_vector: vector, state: {}, modal: {}, surface: null };
      for (const field of ROW_SNAPSHOT_FIELDS) snapshot.state[field] = deep(this.state[field]);
      const modal = win.modalCtx && typeof win.modalCtx === 'object' ? win.modalCtx : null;
      if (modal && modal.bulkAuthoriseState === this.state) {
        for (const field of ['__bulkAuthoriseRecordIdentity', 'timesheetDetails', 'timesheetRelated', 'timesheetMeta', 'timesheetState']) {
          snapshot.modal[field] = deep(modal[field]);
        }
      }
      try { snapshot.surface = this.surfaceAdapter().capture?.(key) || null; } catch { snapshot.surface = null; }
      if (!snapshot.surface) return null;
      this.dropSnapshot(key);
      this.rowSnapshots.set(key, snapshot);
      while (this.rowSnapshots.size > this.maxRowSnapshots) this.dropSnapshot(this.rowSnapshots.keys().next().value);
      return snapshot;
    }

    restoreSnapshot(snapshot, target, rowChangeSeq) {
      if (!snapshot || !target) return false;
      const livePane = this.state.evidence_pane_state && typeof this.state.evidence_pane_state === 'object'
        ? this.state.evidence_pane_state
        : {};
      const globalQueue = {};
      for (const field of QUEUE_STATE_FIELDS) globalQueue[field] = deep(livePane[field]);
      for (const field of ROW_SNAPSHOT_FIELDS) this.state[field] = deep(snapshot.state[field]);
      const restoredPane = this.state.evidence_pane_state && typeof this.state.evidence_pane_state === 'object'
        ? this.state.evidence_pane_state
        : {};
      for (const field of QUEUE_STATE_FIELDS) {
        if (globalQueue[field] !== undefined) restoredPane[field] = globalQueue[field];
      }
      this.state.evidence_pane_state = restoredPane;
      this.state.active_row = { ...deep(snapshot.state.active_row || {}), ...deep(target) };
      this.state.active_row_key = rowKeyOf(target);
      this.state.activeRowKey = this.state.active_row_key;
      this.state.__bulk_authorise_row_context_ready = true;
      this.state.__bulk_authorise_row_context_ready_seq = rowChangeSeq;
      const modal = win.modalCtx && typeof win.modalCtx === 'object' ? win.modalCtx : null;
      if (modal && modal.bulkAuthoriseState === this.state) {
        for (const [field, value] of Object.entries(snapshot.modal || {})) modal[field] = deep(value);
      }
      try {
        if (typeof win.syncBulkAuthoriseModalCtxToActiveRow === 'function') {
          win.syncBulkAuthoriseModalCtxToActiveRow(this.state, { source: 'validated-row-cache-restore' });
        }
      } catch {}
      return this.surfaceAdapter().restore?.(snapshot.surface, this.state.active_row_key) === true;
    }

    async validateSnapshot(snapshot, target, rowChangeSeq, epoch, classification) {
      if (!snapshot?.watch_vector || typeof win.fetchBulkAuthoriseRowWatch !== 'function') return false;
      let result = null;
      try {
        result = await win.fetchBulkAuthoriseRowWatch(target, {
          row_key: rowKeyOf(target),
          current_timesheet_id: target.current_timesheet_id || target.timesheet_id,
          contract_week_id: target.contract_week_id,
          classification,
          known_watch_token: snapshot.watch_vector.watch_token
        });
      } catch {
        result = null;
      }
      if (!this.isCurrentRowTransition(epoch, classification, rowKeyOf(target))) return false;
      const vector = result?.watch_vector;
      if (!(result?.ok === true && result?.unchanged === true && vector?.cacheable === true && trim(vector.watch_token))) return false;
      snapshot.watch_vector = deep(vector);
      if (this.state.active_context && typeof this.state.active_context === 'object') this.state.active_context.watch_vector = deep(vector);
      if (this.state.active_ctx && typeof this.state.active_ctx === 'object') this.state.active_ctx.watch_vector = deep(vector);
      if (this.state.active_details && typeof this.state.active_details === 'object') this.state.active_details.watch_vector = deep(vector);
      this.state.__bulk_authorise_row_context_ready_seq = rowChangeSeq;
      return true;
    }

    rows() {
      return visibleRowsFor(this.state);
    }

    findRow(preferredRowKey, allowEmptySelection = false) {
      const rows = this.rows();
      const preferred = trim(preferredRowKey);
      if (preferred) {
        const exact = rows.find((row) => rowKeyOf(row) === preferred);
        if (exact) return exact;
      }
      if (allowEmptySelection) return null;
      return rows.find((row) => trim(row && row.bulk_authorise_section) === 'processed_eligible')
        || rows.find((row) => trim(row && row.bulk_authorise_section) === 'authorised_eligible')
        || rows[0]
        || null;
    }

    hasGenuineDirtyEdits() {
      if (typeof win.hasBulkAuthoriseGenuineDirtyEdits === 'function') {
        try { return !!win.hasBulkAuthoriseGenuineDirtyEdits(this.state, { preferDom: true }); } catch {}
      }
      return !!this.state.dirty;
    }

    async passDirtyGuard(nextRowKey, intent) {
      if (!this.hasGenuineDirtyEdits()) return true;
      if (typeof win.handleBulkAuthoriseUnsavedChangeGuard !== 'function') return false;
      return !!(await win.handleBulkAuthoriseUnsavedChangeGuard(this.state, nextRowKey || null, {
        intent: intent || 'bulk-authorise-lifecycle-v2',
        nextRowKey: nextRowKey || null,
        force: true,
        source: 'bulk-authorise-lifecycle-v2'
      }));
    }

    stampRoot() {
      const root = win.document && win.document.getElementById('bulkAuthoriseWorkbenchRoot');
      if (!root) return;
      root.dataset.bulkAuthoriseController = 'v2';
      root.dataset.bulkAuthoriseRowEpoch = String(this.rowEpoch);
      root.dataset.bulkAuthoriseDatasetEpoch = String(this.datasetEpoch);
      const liveState = win.modalCtx?.bulkAuthoriseState || this.state;
      const activeRow = liveState.active_row && typeof liveState.active_row === 'object' ? liveState.active_row : {};
      const activeRowKey = trim(liveState.active_row_key || rowKeyOf(activeRow));
      const renderedRows = Array.from(root.querySelectorAll('[data-bulk-authorise-row="1"][data-row-key][data-section]'));
      const renderedActiveRow = renderedRows.find((row) => activeRowKey && trim(row.getAttribute('data-row-key')) === activeRowKey)
        || renderedRows.find((row) => trim(row.getAttribute('style')).includes('var(--accent'))
        || null;
      const renderedActiveSection = trim(renderedActiveRow?.getAttribute?.('data-section'));
      const activeIsAuthorised = trim(activeRow.bulk_authorise_section) === 'authorised_eligible'
        || renderedActiveSection === 'authorised_eligible'
        || activeRow.is_authorised === true
        || trim(activeRow.state).toUpperCase() === 'AUTHORISED';
      if (activeIsAuthorised) {
        const additionalRateInputs = root.querySelectorAll('#bulkAuthoriseRightPane input[data-extra-code]');
        for (const input of additionalRateInputs) {
          input.disabled = true;
          input.readOnly = true;
          input.setAttribute('aria-disabled', 'true');
          input.setAttribute('data-bulk-authorise-authorised-lock', '1');
          input.title = 'Additional rates cannot be edited after the timesheet is authorised.';
        }
      }
      this.installDomBoundary();
      const evidenceController = win.__bulkAuthoriseEvidenceControllerTest?.controllerFor?.(liveState);
      if (
        evidenceController &&
        evidenceController.isTimesheets() &&
        evidenceController.isRowTransitionHydrationPending?.() !== true
      ) {
        evidenceController.sanitize('lifecycle-v2-post-render');
        evidenceController.renderAttachedSelection();
        evidenceController.schedulePostRenderSettle();
        void evidenceController.ensureAttachedPreview(false);
      }
    }

    authorisationTargets(selectedControl) {
      const rows = this.rows();
      const targetKeys = selectedControl
        ? selectionMapFor(this.state).processed_eligible
        : [trim(this.state.active_row_key || rowKeyOf(this.state.active_row))].filter(Boolean);
      const wanted = new Set(targetKeys);
      return rows.filter((row) => wanted.has(rowKeyOf(row)) && trim(row?.bulk_authorise_section) === 'processed_eligible');
    }

    rowHasVerifiedTimesheetEvidence(row) {
      if (!row || row.__evidence_badges_verified !== true) return null;
      const badges = Array.isArray(row.evidence_badges) ? row.evidence_badges : [];
      return badges.some((badge) => {
        if (typeof badge === 'string') return trim(badge).toUpperCase() === 'TIMESHEET';
        const kind = trim(badge?.kind || badge?.evidence_kind || badge?.type || badge?.name).toUpperCase();
        if (kind !== 'TIMESHEET') return false;
        if (badge?.present === false || badge?.has_evidence === false) return false;
        return Number(badge?.count ?? 1) > 0;
      });
    }

    async confirmMissingRequiredEvidence(selectedControl) {
      if (classificationOf(this.state.classification) !== 'TIMESHEETS') return true;
      const targets = this.authorisationTargets(selectedControl);
      const requiresPhysicalEvidence = targets.filter((row) => row.client_no_timesheet_required === false);
      if (!requiresPhysicalEvidence.length) return true;

      const evidenceController = win.__bulkAuthoriseEvidenceControllerTest?.controllerFor?.(this.state);
      if (evidenceController?.hydrateDatasetBadges) await evidenceController.hydrateDatasetBadges();
      const missing = requiresPhysicalEvidence.filter((row) => this.rowHasVerifiedTimesheetEvidence(row) === false);
      const unverified = requiresPhysicalEvidence.filter((row) => this.rowHasVerifiedTimesheetEvidence(row) == null);
      if (unverified.length) {
        if (typeof win.openUiConfirmModal === 'function') {
          await win.openUiConfirmModal({
            title: 'Timesheet evidence could not be verified',
            message: 'The attached timesheet evidence could not be verified. Please try again before authorising.',
            confirm_label: 'OK',
            hide_cancel: true
          });
        }
        return false;
      }
      if (!missing.length) return true;
      if (typeof win.openUiConfirmModal !== 'function') return false;
      const response = await win.openUiConfirmModal({
        title: 'Missing timesheet image',
        message: missing.length === 1
          ? 'This timesheet has no physical timesheet image attached. Are you sure you want to continue?'
          : `${missing.length} timesheets have no physical timesheet image attached. Are you sure you want to continue?`,
        confirm_label: 'OK',
        cancel_label: 'Cancel'
      });
      return response?.confirmed === true;
    }

    async runOwnedAction(button) {
      const state = this.state;
      if (
        !button ||
        button.disabled ||
        state.loading ||
        state.batch_busy ||
        state.saving ||
        state.unprocessing ||
        state.__workbench_modal_spinner_active ||
        state.__bulk_authorise_freshness_checking === true ||
        state.__bulk_authorise_freshness_unconfirmed === true
      ) return false;

      const selectedAction = trim(button.getAttribute('data-bulk-authorise-selected-action') || '').toLowerCase();
      const id = trim(button.id || '');
      const action = selectedAction || (id === 'bulkAuthActionRowAuthoriseBtn' ? 'authorise' : (id === 'bulkAuthActionRowUnauthoriseBtn' ? 'unauthorise' : ''));
      if (action !== 'authorise' && action !== 'unauthorise') return false;

      const selectedControl = !!selectedAction;
      const activeRowKey = trim(state.active_row_key || rowKeyOf(state.active_row));
      const buttonRowKey = trim(button.getAttribute('data-row-key') || button.dataset?.rowKey || '');
      if (!selectedControl && buttonRowKey && activeRowKey && buttonRowKey !== activeRowKey) {
        await this.render('[TS][BULK-AUTH][LIFECYCLE-V2][STALE-ACTION]');
        return false;
      }

      let options;
      if (selectedControl) {
        const selectedSection = action === 'authorise' ? 'processed_eligible' : 'authorised_eligible';
        const selectedKeys = selectionMapFor(state)[selectedSection];
        const selectedCount = selectedKeys.length;
        if (selectedCount < 1) return false;
        state.selected_row_keys = selectedKeys.slice();
        state.selected_section = selectedSection;
        options = {
          source: 'selected-bulk',
          showCompletionModal: false,
          returnCompletionResult: true
        };
      } else {
        if (!activeRowKey) return false;
        const backendSignature = trim(
          state.__bulk_authorise_active_backend_row_signature ||
          state.active_row?.backend_row_signature ||
          state.active_row?.row_backend_signature ||
          state.active_row?.row_signature
        );
        const renderSignature = trim(state.__bulk_authorise_active_render_signature || '');
        const rowChangeSeq = Number(state.__bulk_authorise_row_change_seq || 0) || 0;
        const recordIdentity = trim(state.__bulkAuthoriseRecordIdentity || state.activeRecordIdentity || '');
        options = {
          source: 'action-row',
          showCompletionModal: false,
          actionRowKey: activeRowKey,
          activeRowStrategy: action === 'authorise' ? 'next-processed-after-authorise' : 'same-row-after-unauthorise',
          actionSource: action === 'authorise' ? 'action-row-authorise' : 'action-row-unauthorise',
          actionRowSignature: backendSignature,
          actionBackendRowSignature: backendSignature,
          actionRenderSignature: renderSignature,
          actionRowChangeSeq: rowChangeSeq,
          actionRecordIdentity: recordIdentity
        };
        if (action === 'authorise') options.commitDirtyBeforeAuthorise = true;
      }

      const handler = action === 'authorise' ? win.handleBulkAuthoriseSelected : win.handleBulkUnauthoriseSelected;
      if (typeof handler !== 'function') return false;
      if (action === 'authorise' && !(await this.confirmMissingRequiredEvidence(selectedControl))) return false;
      const execute = () => handler(state, options);
      const label = action === 'authorise' ? 'Authorising' : 'Unauthorising';
      let outcome;
      try {
        outcome = typeof win.withExistingModalLoadingSpinner === 'function'
          ? await win.withExistingModalLoadingSpinner(state, label, execute)
          : await execute();
      } finally {
        if (!this.closed && state.__workbench_modal_spinner_active !== true) {
          try {
            await this.render(`[TS][BULK-AUTH][LIFECYCLE-V2][${action.toUpperCase()}-ACTION-SETTLED]`);
          } catch {}
        }
      }

      const completionModal = selectedControl && outcome && typeof outcome === 'object' ? outcome.completionModal : null;
      if (completionModal?.shouldShow && !state.__workbench_modal_spinner_active && typeof win.openUiConfirmModal === 'function') {
        await win.openUiConfirmModal({
          title: completionModal.title || (action === 'authorise' ? 'Bulk Authorise result' : 'Bulk Unauthorise result'),
          message: completionModal.message || '',
          confirm_label: completionModal.confirm_label || 'OK',
          cancel_label: completionModal.cancel_label || ''
        });
      }
      return outcome;
    }

    installDomBoundary() {
      const doc = win.document;
      if (!doc) return;
      const controller = this;
      const stopOwnedEvent = (event) => {
        try { event.preventDefault(); } catch {}
        try { event.stopImmediatePropagation(); } catch {}
        try { event.stopPropagation(); } catch {}
      };
      doc.__bulkAuthoriseLifecycleV2ActiveController = this;
      if (typeof doc.addEventListener === 'function' && doc.__bulkAuthoriseLifecycleV2DocumentBoundary !== true) {
        const dispatch = (event) => {
          const live = doc.__bulkAuthoriseLifecycleV2ActiveController;
          if (!live || live.closed) return;
          const state = live.state;
          if (!state || state.loading || state.batch_busy || state.__workbench_modal_spinner_active) return;
          const workbenchRoot = doc.getElementById('bulkAuthoriseWorkbenchRoot');
          if (!workbenchRoot) return;
          const target = event.target;
          if (!target || typeof target.closest !== 'function') return;

          if (event.type === 'click') {
            const classificationRoot = doc.getElementById('bulkAuthoriseClassificationButtonsRoot');
            const classificationButton = target.closest('[data-bulk-authorise-classification-btn="1"][data-classification]');
            if (classificationRoot && classificationButton && classificationRoot.contains(classificationButton)) {
              stopOwnedEvent(event);
              void live.transitionToClassification(classificationButton.getAttribute('data-classification'));
              return;
            }

            const actionButton = target.closest('[data-bulk-authorise-selected-action], #bulkAuthActionRowAuthoriseBtn, #bulkAuthActionRowUnauthoriseBtn');
            if (actionButton && workbenchRoot.contains(actionButton)) {
              stopOwnedEvent(event);
              void live.runOwnedAction(actionButton);
              return;
            }
          }

          if (event.type === 'keydown') {
            const key = trim(event.key);
            if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return;
          } else if (event.type !== 'click') {
            return;
          }

          const listsRoot = doc.getElementById('bulkAuthoriseListsRoot');
          const rowElement = target.closest('[data-bulk-authorise-row="1"][data-row-key]');
          if (!listsRoot || !rowElement || !listsRoot.contains(rowElement)) return;
          const interactive = target.closest([
            '[data-bulk-authorise-row-checkbox="1"]',
            '[data-bulk-authorise-section-checkbox="1"]',
            '[data-bulk-authorise-selected-action]',
            'button',
            'a',
            'input',
            'select',
            'textarea',
            'label',
            '[role="button"]',
            '[role="link"]',
            '[role="checkbox"]',
            '[contenteditable]',
            '[data-bulk-authorise-action-control="1"]',
            '[data-bulk-authorise-no-row-open="1"]',
            '[data-no-row-open="1"]',
            '[data-row-open-ignore="1"]'
          ].join(','));
          if (interactive && rowElement.contains(interactive)) return;
          const nextRowKey = trim(rowElement.getAttribute('data-row-key') || '');
          if (!nextRowKey) return;
          stopOwnedEvent(event);
          void live.transitionToRow(nextRowKey, { source: 'row_click' });
        };
        doc.addEventListener('click', dispatch, true);
        doc.addEventListener('keydown', dispatch, true);
        doc.__bulkAuthoriseLifecycleV2DocumentBoundary = true;
      }

      const listsRoot = doc.getElementById('bulkAuthoriseListsRoot');
      if (listsRoot && typeof listsRoot.addEventListener === 'function' && listsRoot.__bulkAuthoriseLifecycleV2RowBoundary !== this) {
        const handleRowEvent = (event) => {
          if (controller.closed || controller.state.loading || controller.state.batch_busy || controller.state.__workbench_modal_spinner_active) return;
          if (event.type === 'keydown') {
            const key = trim(event.key);
            if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return;
          }
          const target = event.target;
          if (!target || typeof target.closest !== 'function') return;
          const rowElement = target.closest('[data-bulk-authorise-row="1"][data-row-key]');
          if (!rowElement || !listsRoot.contains(rowElement)) return;
          const interactive = target.closest([
            '[data-bulk-authorise-row-checkbox="1"]',
            '[data-bulk-authorise-section-checkbox="1"]',
            '[data-bulk-authorise-selected-action]',
            'button',
            'a',
            'input',
            'select',
            'textarea',
            'label',
            '[role="button"]',
            '[role="link"]',
            '[role="checkbox"]',
            '[contenteditable]',
            '[data-bulk-authorise-action-control="1"]',
            '[data-bulk-authorise-no-row-open="1"]',
            '[data-no-row-open="1"]',
            '[data-row-open-ignore="1"]'
          ].join(','));
          if (interactive && rowElement.contains(interactive)) return;
          const nextRowKey = trim(rowElement.getAttribute('data-row-key') || '');
          if (!nextRowKey) return;
          stopOwnedEvent(event);
          void controller.transitionToRow(nextRowKey, { source: 'row_click' });
        };
        listsRoot.addEventListener('click', handleRowEvent, true);
        listsRoot.addEventListener('keydown', handleRowEvent, true);
        listsRoot.__bulkAuthoriseLifecycleV2RowBoundary = this;
      }

      const classificationRoot = doc.getElementById('bulkAuthoriseClassificationButtonsRoot');
      if (classificationRoot && typeof classificationRoot.addEventListener === 'function' && classificationRoot.__bulkAuthoriseLifecycleV2Boundary !== this) {
        classificationRoot.addEventListener('click', (event) => {
          const target = event.target;
          const button = target && typeof target.closest === 'function'
            ? target.closest('[data-bulk-authorise-classification-btn="1"][data-classification]')
            : null;
          if (!button || !classificationRoot.contains(button)) return;
          stopOwnedEvent(event);
          void controller.transitionToClassification(button.getAttribute('data-classification'));
        }, true);
        classificationRoot.__bulkAuthoriseLifecycleV2Boundary = this;
      }

      const workbenchRoot = doc.getElementById('bulkAuthoriseWorkbenchRoot');
      if (workbenchRoot && typeof workbenchRoot.addEventListener === 'function' && workbenchRoot.__bulkAuthoriseLifecycleV2ActionBoundary !== this) {
        workbenchRoot.addEventListener('click', (event) => {
          const target = event.target;
          const button = target && typeof target.closest === 'function'
            ? target.closest('[data-bulk-authorise-selected-action], #bulkAuthActionRowAuthoriseBtn, #bulkAuthActionRowUnauthoriseBtn')
            : null;
          if (!button || !workbenchRoot.contains(button)) return;
          stopOwnedEvent(event);
          void controller.runOwnedAction(button);
        }, true);
        workbenchRoot.__bulkAuthoriseLifecycleV2ActionBoundary = this;
      }
    }

    enforcePreviewOwnership() {
      const state = this.state;
      const activeKey = trim(state.active_row_key || rowKeyOf(state.active_row));
      const pane = state.evidence_pane_state && typeof state.evidence_pane_state === 'object'
        ? state.evidence_pane_state
        : null;
      if (!pane) return;

      if (!activeKey) {
        clearRowOwnedState(state);
        return;
      }

      if (classificationOf(state.classification) !== 'TIMESHEETS') {
        const importedView = deep(state.__bulkAuthoriseImportEvidenceView);
        clearRowOwnedState(state);
        state.__bulkAuthoriseImportEvidenceView = importedView;
        return;
      }

      if (trim(pane.active_tab).toLowerCase() === 'queue') return;
      const owner = trim(
        state.__bulkAuthorisePreviewActiveRowKey ||
        pane.__bulk_authorise_evidence_identity ||
        pane.__preview_identity
      );
      if (owner && owner !== activeKey && owner !== `row:${activeKey}`) clearRowOwnedState(state);
    }

    async render(reason) {
      if (this.closed) return false;
      await legacy.rerender(this.state, reason || '[TS][BULK-AUTH][LIFECYCLE-V2]');
      if (this.closed) return false;
      this.enforcePreviewOwnership();
      this.stampRoot();
      return true;
    }

    isCurrentRowTransition(epoch, expectedClassification, expectedRowKey) {
      return !this.closed
        && this.rowEpoch === epoch
        && classificationOf(this.state.classification) === expectedClassification
        && trim(this.state.active_row_key || rowKeyOf(this.state.active_row)) === expectedRowKey;
    }

    async transitionToRow(preferredRowKey, options = {}) {
      if (this.closed) return false;
      const allowEmptySelection = options.allowEmptySelection === true || options.allow_empty_selection === true;
      let target = this.findRow(preferredRowKey, allowEmptySelection);
      let targetKey = rowKeyOf(target);
      const currentKey = trim(this.state.active_row_key || rowKeyOf(this.state.active_row));
      const source = trim(options.source || 'row_click').toLowerCase();
      const epoch = ++this.rowEpoch;
      let freshnessChanged = false;
      let freshnessUnchanged = false;

      if (targetKey !== currentKey && options.skipDirtyGuard !== true) {
        const allowed = await this.passDirtyGuard(targetKey, options.intent || options.source || 'row-switch');
        if (!allowed) return false;
        if (this.closed || this.rowEpoch !== epoch) return false;
      }

      if (source === 'row_click' && target) {
        const freshnessApi = win.bulkRowFreshnessV1;
        if (!freshnessApi || typeof freshnessApi.fetchDecision !== 'function') {
          this.state.__bulk_authorise_freshness_unconfirmed = true;
          this.state.warning_text = 'Current server state could not be confirmed. Click the row to retry.';
          await this.render('[TS][BULK-AUTH][LIFECYCLE-V2][FRESHNESS-UNAVAILABLE]');
          return false;
        }

        let freshnessResult = null;
        try {
          freshnessResult = await freshnessApi.fetchDecision({
            surface: 'bulk_authorise',
            state: this.state,
            row: target,
            previousRowKey: targetKey,
            classification: classificationOf(this.state.classification),
            currentSection: trim(target.bulk_authorise_section),
            filters: requestFiltersFor(this.state),
            timeoutMs: 4500
          });
        } catch (error) {
          freshnessApi.markUnconfirmed?.(this.state, 'bulk_authorise', error);
          if (this.rowEpoch === epoch) await this.render('[TS][BULK-AUTH][LIFECYCLE-V2][FRESHNESS-FAILED]');
          return false;
        }
        if (!freshnessResult?.accepted || this.closed || this.rowEpoch !== epoch) return false;

        const decision = freshnessResult.decision || {};
        if (
          targetKey === currentKey &&
          this.hasGenuineDirtyEdits() &&
          (decision.changed === true || decision.outcome === 'REMOVED' || decision.outcome === 'DELETED')
        ) {
          const confirmed = await freshnessApi.confirmDirtyConflict?.({
            surface: 'bulk_authorise',
            state: this.state,
            decision
          });
          if (!confirmed || this.closed || this.rowEpoch !== epoch) {
            freshnessApi.markUnconfirmed?.(this.state, 'bulk_authorise', new Error('The server change has not been applied. Click the row to review it again.'));
            if (this.rowEpoch === epoch) await this.render('[TS][BULK-AUTH][LIFECYCLE-V2][FRESHNESS-CONFLICT-RETAINED]');
            return false;
          }
        }

        freshnessApi.markConfirmed?.(this.state, 'bulk_authorise');
        freshnessUnchanged = decision.outcome === 'CURRENT' && decision.changed === false;
        if (freshnessUnchanged && targetKey === currentKey) return true;

        if (!freshnessUnchanged) {
          const previousTargetKey = targetKey;
          const reconciliation = freshnessApi.reconcileBulkAuthorise(this.state, decision, target);
          this.dropSnapshot(previousTargetKey);
          if (reconciliation?.canonical_row_key) this.dropSnapshot(reconciliation.canonical_row_key);
          if (!reconciliation?.eligible) {
            const replacementKey = trim(reconciliation?.replacement_row_key);
            return await this.transitionToRow(replacementKey || null, {
              allowEmptySelection: !replacementKey,
              skipDirtyGuard: true,
              source: 'freshness_replacement'
            });
          }
          freshnessChanged = true;
          targetKey = trim(reconciliation.canonical_row_key || decision.row_key || targetKey);
          target = this.findRow(targetKey, false) || (decision.row && typeof decision.row === 'object' ? decision.row : target);
        }
      }

      const fastPathEligible = !!(
        !freshnessChanged &&
        target &&
        targetKey &&
        currentKey &&
        targetKey !== currentKey &&
        source === 'row_click'
      );
      if (fastPathEligible) this.captureSnapshot(currentKey);
      const cachedTarget = fastPathEligible ? this.rowSnapshots.get(targetKey) : null;
      const selection = selectionMapFor(this.state);
      const expectedClassification = classificationOf(this.state.classification);
      // The legacy selector owns the row-change sequence and increments it for
      // a genuine row change. Read the committed value after selection; a
      // lifecycle-side pre-increment makes the context response look stale.
      let rowChangeSeq = Number(this.state.__bulk_authorise_row_change_seq || 0) || 0;
      this.state.__bulk_authorise_v2_transition_loading = true;
      this.state.__bulk_authorise_last_transition_mode = cachedTarget ? 'validating-cache' : 'full';

      const selectDatasetRow = async () => {
        await legacy.setActiveRow(this.state, targetKey || null, {
          ...options,
          __bulkAuthoriseLifecycleBypass: true,
          skipDirtyGuard: true,
          rerender: false,
          datasetOnly: true,
          minimalOnly: true,
          // minimalOnly/datasetOnly already defer the legacy context request.
          // Keep this explicit flag false because the legacy selector treats
          // deferContextRefresh:true as an instruction to schedule its own
          // editor hydration, while this controller owns the full hydration.
          deferContextRefresh: false,
          refreshContext: false,
          scheduleHydration: false,
          skipEvidenceHydration: true,
          skip_evidence_hydration: true,
          hydrationRerender: false,
          source: options.source || 'row_click'
        });
        rowChangeSeq = Number(this.state.__bulk_authorise_row_change_seq || 0) || 0;
        installSelectionMap(this.state, selection);
      };

      if (cachedTarget) {
        await selectDatasetRow();
        const restored = this.restoreSnapshot(cachedTarget, target, rowChangeSeq);
        if (restored) {
          try { this.surfaceAdapter().setBusy?.(true); } catch {}
          const unchanged = freshnessUnchanged === true
            ? true
            : await this.validateSnapshot(cachedTarget, target, rowChangeSeq, epoch, expectedClassification);
          if (!this.isCurrentRowTransition(epoch, expectedClassification, targetKey)) return false;
          if (unchanged) {
            this.state.__bulk_authorise_v2_transition_loading = false;
            this.state.__bulk_authorise_last_transition_mode = 'validated-cache-hit';
            try { this.surfaceAdapter().setBusy?.(false); } catch {}
            try {
              const root = win.document?.getElementById?.('bulkAuthoriseWorkbenchRoot');
              if (root?.dataset) root.dataset.bulkAuthoriseTransitionMode = 'validated-cache-hit';
              const frame = typeof win.__getModalFrame === 'function' ? win.__getModalFrame() : null;
              frame?._updateButtons?.();
            } catch {}
            return true;
          }
        }
        this.dropSnapshot(targetKey);
        this.state.__bulk_authorise_last_transition_mode = 'cache-invalid-full';
      }

      clearRowOwnedState(this.state);
      clearActiveRowContext(this.state);
      await selectDatasetRow();
      const activeKey = trim(this.state.active_row_key || rowKeyOf(this.state.active_row));
      if (!activeKey) {
        this.state.__bulk_authorise_v2_transition_loading = false;
        await this.render('[TS][BULK-AUTH][LIFECYCLE-V2][EMPTY]');
        return true;
      }

      await this.render('[TS][BULK-AUTH][LIFECYCLE-V2][ROW-SKELETON]');
      if (!this.isCurrentRowTransition(epoch, expectedClassification, activeKey)) return false;

      try {
        if (typeof win.refreshBulkAuthoriseActiveContext === 'function') {
          const fullRefresh = await win.refreshBulkAuthoriseActiveContext(this.state, {
            row: this.state.active_row,
            row_key: activeKey,
            rowChangeSeq,
            source: 'bulk-authorise-lifecycle-v2-row',
            profile: 'full',
            context_profile: 'full',
            full: true,
            forceFull: true,
            include_evidence: true,
            include_compare: true,
            include_import_source_rows: true,
            bypassCache: true,
            authoritative: true,
            rerender: false
          });
          const evidenceLayerLoaded = [
            this.state.active_context,
            this.state.active_details
          ].some((candidate) => candidate && typeof candidate === 'object' && candidate.evidence_loaded === true);
          if (
            fullRefresh !== false &&
            classificationOf(this.state.classification) === 'TIMESHEETS' &&
            freshnessChanged !== true &&
            !evidenceLayerLoaded &&
            this.isCurrentRowTransition(epoch, expectedClassification, activeKey)
          ) {
            // The currently deployed context service can return a complete
            // editor layer without its evidence layer even for profile=full.
            // Load that missing layer here, still under the single lifecycle
            // transition, so the preview binder never starts a competing load.
            await win.refreshBulkAuthoriseActiveContext(this.state, {
              row: this.state.active_row,
              row_key: activeKey,
              rowChangeSeq,
              source: 'bulk-authorise-lifecycle-v2-row-evidence',
              profile: 'evidence',
              context_profile: 'evidence',
              include_evidence: true,
              include_compare: false,
              include_import_source_rows: false,
              bypassCache: true,
              authoritative: true,
              rerender: false
            });
          }
        }
      } catch (error) {
        if (this.isCurrentRowTransition(epoch, expectedClassification, activeKey)) {
          this.state.warning_text = trim(error && error.message) || 'The selected row could not be fully refreshed.';
        }
      }

      if (!this.isCurrentRowTransition(epoch, expectedClassification, activeKey)) return false;
      this.state.__bulk_authorise_v2_transition_loading = false;
      this.state.__bulk_authorise_last_transition_mode = this.state.__bulk_authorise_last_transition_mode === 'cache-invalid-full'
        ? 'cache-invalid-full'
        : 'full';
      await this.render('[TS][BULK-AUTH][LIFECYCLE-V2][ROW-READY]');
      try {
        const root = win.document?.getElementById?.('bulkAuthoriseWorkbenchRoot');
        if (root?.dataset) root.dataset.bulkAuthoriseTransitionMode = this.state.__bulk_authorise_last_transition_mode;
      } catch {}
      return true;
    }

    resetClassificationState(nextClassification) {
      this.clearSnapshots();
      this.state.classification = nextClassification;
      installSelectionMap(this.state, { processed_eligible: [], authorised_eligible: [] });
      this.state.middle_pane_mode = 'single';
      this.state.middle_pane_section = 'processed_eligible';
      this.state.imported_evidence_page = 1;
      this.state.imported_evidence_page_index = 0;
      this.state.error_text = '';
      this.state.warning_text = '';
      this.state.__bulk_authorise_context_cache = {};
      this.state.__bulk_authorise_context_inflight = {};
      this.state.__bulk_authorise_context_bypass_signatures = {};
      this.state.__bulkAuthoriseImportEvidenceCache = {};
      this.state.__bulkAuthoriseImportEvidenceInflight = {};
      this.state.__bulkAuthoriseImportEvidenceErrors = {};
      clearActiveRow(this.state);
      clearRowOwnedState(this.state);
    }

    async transitionToClassification(nextValue) {
      if (this.closed || this.state.loading || this.state.batch_busy) return false;
      const nextClassification = classificationOf(nextValue);
      if (nextClassification === classificationOf(this.state.classification)) return true;
      const allowed = await this.passDirtyGuard(null, 'classification-change');
      if (!allowed || this.closed) return false;

      const epoch = ++this.datasetEpoch;
      ++this.rowEpoch;
      this.resetClassificationState(nextClassification);
      this.state.loading = true;
      this.state.__bulk_authorise_classification_changing = true;
      this.state.__bulk_authorise_dataset_refreshing = true;
      this.state.__bulk_authorise_dataset_ready = false;
      await this.render('[TS][BULK-AUTH][LIFECYCLE-V2][CLASSIFICATION-LOADING]');

      try {
        const dataset = await win.fetchBulkAuthoriseDataset(requestFiltersFor(this.state), {
          bypassCache: true,
          forceFreshDataset: true,
          noBackgroundRevalidate: true,
          state: this.state
        });
        if (this.closed || this.datasetEpoch !== epoch || classificationOf(this.state.classification) !== nextClassification) return false;
        this.state.dataset = deep(dataset);
        this.state.loading = false;
        this.state.__bulk_authorise_classification_changing = false;
        this.state.__bulk_authorise_dataset_refreshing = false;
        this.state.__bulk_authorise_dataset_ready = true;
        return await this.transitionToRow(null, { skipDirtyGuard: true, source: 'classification-change' });
      } catch (error) {
        if (this.closed || this.datasetEpoch !== epoch) return false;
        this.state.loading = false;
        this.state.__bulk_authorise_classification_changing = false;
        this.state.__bulk_authorise_dataset_refreshing = false;
        this.state.__bulk_authorise_dataset_ready = false;
        this.state.error_text = trim(error && error.message) || 'Failed to switch Bulk Authorise classification.';
        await this.render('[TS][BULK-AUTH][LIFECYCLE-V2][CLASSIFICATION-ERROR]');
        return false;
      }
    }

    bindClassificationButtons() {
      const root = win.document && win.document.getElementById('bulkAuthoriseClassificationButtonsRoot');
      if (!root || root.dataset.boundBulkAuthoriseClassificationButtonsV2 === '1') return;
      root.dataset.boundBulkAuthoriseClassificationButtonsV2 = '1';
      const buttons = Array.from(root.querySelectorAll('[data-bulk-authorise-classification-btn="1"][data-classification]'));
      for (const button of buttons) {
        if (button.dataset.boundBulkAuthoriseClassificationButtonV2 === '1') continue;
        button.dataset.boundBulkAuthoriseClassificationButtonV2 = '1';
        button.addEventListener('click', () => {
          void this.transitionToClassification(button.getAttribute('data-classification'));
        });
      }
    }

    chooseActiveAfterMutation(action, mutationIntent = {}, result = {}) {
      const rows = this.rows();
      const rowByKey = new Map(rows.map((row) => [rowKeyOf(row), row]).filter(([key]) => !!key));
      const previousActiveKey = trim(mutationIntent.active_row_key || result.pre_mutation_active_row_key);
      const previous = rowByKey.get(previousActiveKey) || null;
      const preferred = trim(result.preferred_active_row_key);
      const resultFallbacks = Array.isArray(result.fallback_row_keys) ? result.fallback_row_keys.map(trim).filter(Boolean) : [];
      const intentFallbacks = Array.isArray(mutationIntent.fallback_row_keys) ? mutationIntent.fallback_row_keys.map(trim).filter(Boolean) : [];
      const affectedKeys = Array.isArray(mutationIntent.affected_row_keys) ? mutationIntent.affected_row_keys.map(trim).filter(Boolean) : [];
      const candidates = [preferred, ...resultFallbacks, ...intentFallbacks, ...affectedKeys].filter(Boolean);

      if (action === 'unauthorise') {
        const moved = candidates.find((key) => trim(rowByKey.get(key)?.bulk_authorise_section) === 'processed_eligible');
        if (moved) return moved;
        if (previous) return rowKeyOf(previous);
        return '';
      }

      if (mutationIntent.active_affected !== true && previous) return rowKeyOf(previous);
      const nextProcessed = candidates.find((key) => trim(rowByKey.get(key)?.bulk_authorise_section) === 'processed_eligible');
      return nextProcessed || '';
    }

    reconcileCheckboxSelection(mutationIntent = {}, result = {}) {
      const snapshot = mutationIntent.checkbox_selection && typeof mutationIntent.checkbox_selection === 'object'
        ? mutationIntent.checkbox_selection
        : { processed_eligible: [], authorised_eligible: [] };
      const selected = new Set([
        ...(Array.isArray(snapshot.processed_eligible) ? snapshot.processed_eligible : []),
        ...(Array.isArray(snapshot.authorised_eligible) ? snapshot.authorised_eligible : [])
      ].map(trim).filter(Boolean));
      const resultEntries = [
        ...(Array.isArray(result?.results) ? result.results : []),
        ...(Array.isArray(result?.affected_rows) ? result.affected_rows : []),
        ...(Array.isArray(result?.result?.results) ? result.result.results : []),
        ...(Array.isArray(result?.result?.affected_rows) ? result.result.affected_rows : []),
        ...(Array.isArray(result?.affected_refresh?.flattened_rows) ? result.affected_refresh.flattened_rows : [])
      ];
      const remappedKeys = new Map();
      for (const entry of resultEntries) {
        const before = trim(entry?.row_key_before || entry?.previous_row_key || entry?.old_row_key || entry?.row_key);
        const after = trim(entry?.row_key_after || entry?.new_row_key || entry?.row_key);
        if (before && after) remappedKeys.set(before, after);
        if (before && after && before !== after && selected.delete(before)) selected.add(after);
      }

      if (mutationIntent.preserve_checkbox_selection !== true) {
        const failed = new Set(failedRowKeys(result).flatMap((key) => [key, remappedKeys.get(key)]).filter(Boolean));
        for (const key of mutationIntent.affected_row_keys || []) {
          const normalised = trim(key);
          const current = remappedKeys.get(normalised) || normalised;
          if (current && !failed.has(normalised) && !failed.has(current)) selected.delete(current);
        }
      }

      const next = { processed_eligible: [], authorised_eligible: [] };
      for (const row of this.rows()) {
        const key = rowKeyOf(row);
        const section = trim(row?.bulk_authorise_section);
        if (selected.has(key) && Object.prototype.hasOwnProperty.call(next, section)) next[section].push(key);
      }
      installSelectionMap(this.state, next);
      return next;
    }

    async refreshCanonicalDatasetAfterMutation(action, result, mutationIntent = {}) {
      if (this.closed || !result) return false;
      this.clearSnapshots();
      const successCount = Number(result.success_count || 0) || 0;
      const epoch = ++this.datasetEpoch;
      this.state.__bulk_authorise_v2_canonical_refreshing = true;
      try {
        const dataset = await win.fetchBulkAuthoriseDataset(requestFiltersFor(this.state), {
          bypassCache: true,
          forceFreshDataset: true,
          mutationRefresh: true,
          noBackgroundRevalidate: true,
          mutationSeq: Number(result.mutationSeq || 0) || 0,
          state: this.state
        });
        if (this.closed || this.datasetEpoch !== epoch) return false;
        this.state.dataset = deep(dataset);

        if (successCount < 1) {
          const visibleKeys = new Set(this.rows().map(rowKeyOf).filter(Boolean));
          const originalActiveKey = trim(mutationIntent.active_row_key);
          const nextActiveKey = visibleKeys.has(originalActiveKey) ? originalActiveKey : '';
          this.reconcileCheckboxSelection(mutationIntent, result);
          const currentActiveKey = trim(this.state.active_row_key || rowKeyOf(this.state.active_row));
          const canPreserveCurrentContext = !!(
            nextActiveKey &&
            nextActiveKey === currentActiveKey &&
            this.state.active_context &&
            typeof this.state.active_context === 'object'
          );
          if (canPreserveCurrentContext) {
            // No row was mutated, so the already-loaded detail/evidence context is
            // still authoritative. Adopt only the fresh canonical row/status data;
            // a second full-context request is redundant and can leave the modal
            // spinner waiting on a slow database connection.
            this.rowEpoch += 1;
            await legacy.setActiveRow(this.state, nextActiveKey, {
              __bulkAuthoriseLifecycleBypass: true,
              skipDirtyGuard: true,
              source: 'status_patch',
              statusPatch: true,
              preserveActiveContext: true,
              preserveEvidencePane: true,
              preserveSignedUrlCache: true,
              datasetOnly: true,
              minimalOnly: true,
              deferContextRefresh: true,
              refreshContext: false,
              scheduleHydration: false,
              skipEvidenceHydration: true,
              skip_evidence_hydration: true,
              hydrationRerender: false,
              rerender: false
            });
            await this.render('[TS][BULK-AUTH][LIFECYCLE-V2][FAILED-MUTATION-RECONCILED]');
          } else {
            await this.transitionToRow(nextActiveKey, {
              skipDirtyGuard: true,
              source: 'canonical-mutation-refresh',
              allowEmptySelection: !nextActiveKey
            });
          }
          restoreLeftPanePosition(
            mutationIntent.section_scroll_top,
            nextActiveKey,
            result.ensure_active_row_visible === true
          );
          this.state.lifecycle_refresh_failed = false;
          this.state.lifecycle_refresh_error = '';
          result.canonical_dataset_refreshed = true;
          result.failed_mutation_reconciled = true;
          result.refresh_failed = false;
          result.refresh_error = null;
          return true;
        }

        const nextActiveKey = this.chooseActiveAfterMutation(action, mutationIntent, result);
        this.reconcileCheckboxSelection(mutationIntent, result);
        const clearActiveRowAfterAuthorise = action === 'authorise' && mutationIntent.active_affected === true && !nextActiveKey;
        await this.transitionToRow(nextActiveKey, {
          skipDirtyGuard: true,
          source: 'canonical-mutation-refresh',
          allowEmptySelection: clearActiveRowAfterAuthorise
        });
        restoreLeftPanePosition(
          mutationIntent.section_scroll_top,
          nextActiveKey,
          action === 'unauthorise' || result.ensure_active_row_visible === true
        );
        result.canonical_dataset_refreshed = true;
        return true;
      } catch (error) {
        result.canonical_dataset_refreshed = false;
        result.canonical_dataset_refresh_error = trim(error && error.message) || 'Canonical Bulk Authorise refresh failed.';
        this.state.lifecycle_refresh_failed = true;
        this.state.lifecycle_refresh_error = result.canonical_dataset_refresh_error;
        return false;
      } finally {
        this.state.__bulk_authorise_v2_canonical_refreshing = false;
      }
    }

    attachFrameTeardown() {
      const frame = typeof win.__getModalFrame === 'function' ? win.__getModalFrame() : null;
      if (!frame || trim(frame.kind) !== 'bulk-authorise-workbench' || frame.__bulkAuthoriseLifecycleV2Teardown === true) return;
      frame.__bulkAuthoriseLifecycleV2Teardown = true;
      this.frame = frame;
      this.frameDismiss = typeof frame._onDismiss === 'function' ? frame._onDismiss : null;
      const controller = this;
      frame._onDismiss = function bulkAuthoriseLifecycleV2Dismiss(...args) {
        controller.close();
        return controller.frameDismiss ? controller.frameDismiss.apply(this, args) : undefined;
      };
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      ++this.rowEpoch;
      ++this.datasetEpoch;
      this.clearSnapshots();
      this.state.__bulk_authorise_row_change_seq = (Number(this.state.__bulk_authorise_row_change_seq || 0) || 0) + 1;
      clearRowOwnedState(this.state, { preserveQueueRows: false });
      clearActiveRow(this.state);
      if (this.state.__bulk_authorise_evidence_guard_observer && typeof this.state.__bulk_authorise_evidence_guard_observer.disconnect === 'function') {
        try { this.state.__bulk_authorise_evidence_guard_observer.disconnect(); } catch {}
      }
      this.state.__bulk_authorise_evidence_guard_observer = null;
    }

    async initialise() {
      if (this.initialised || this.closed) return this.state;
      this.initialised = true;
      this.attachFrameTeardown();
      installSelectionMap(this.state, selectionMapFor(this.state));
      const initialKey = trim(this.state.active_row_key || rowKeyOf(this.state.active_row));
      await this.transitionToRow(initialKey, {
        skipDirtyGuard: true,
        source: 'initial-lifecycle-v2'
      });
      return this.state;
    }
  }

  function controllerFor(stateLike) {
    const state = currentState(stateLike);
    if (!state) return null;
    let controller = controllers.get(state);
    if (!controller) {
      controller = new BulkAuthoriseLifecycleController(state);
      controllers.set(state, controller);
    }
    return controller;
  }

  win.bindBulkAuthoriseClassificationButtons = function bindBulkAuthoriseClassificationButtonsV2(state) {
    const controller = controllerFor(state);
    if (!controller) return;
    controller.bindClassificationButtons();
  };

  win.setActiveBulkAuthoriseRowFromVisibleRows = async function setActiveBulkAuthoriseRowV2(state, preferredRowKey, options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const source = trim(opts.source || opts.mode || opts.actionSource).toLowerCase();
    const bypass = opts.__bulkAuthoriseLifecycleBypass === true
      || opts.statusPatch === true
      || opts.status_patch === true
      || opts.identityPatch === true
      || opts.identity_patch === true
      || /^(status_patch|identity_patch|affected_row_refresh|canonical-mutation-refresh)$/.test(source);
    if (bypass) return legacy.setActiveRow(state, preferredRowKey, opts);
    const controller = controllerFor(state);
    return controller ? controller.transitionToRow(preferredRowKey, opts) : legacy.setActiveRow(state, preferredRowKey, opts);
  };

  if (typeof legacy.authoriseSelected === 'function') {
    win.handleBulkAuthoriseSelected = async function handleBulkAuthoriseSelectedV2(state, options) {
      const liveState = currentState(state);
      const mutationIntent = captureMutationIntent('authorise', liveState, options);
      const result = await legacy.authoriseSelected(state, options);
      const controller = controllerFor(liveState);
      if (controller) await controller.refreshCanonicalDatasetAfterMutation('authorise', result, mutationIntent);
      return result;
    };
  }

  if (typeof legacy.unauthoriseSelected === 'function') {
    win.handleBulkUnauthoriseSelected = async function handleBulkUnauthoriseSelectedV2(state, options) {
      const liveState = currentState(state);
      const mutationIntent = captureMutationIntent('unauthorise', liveState, options);
      const result = await legacy.unauthoriseSelected(state, options);
      const controller = controllerFor(liveState);
      if (controller) await controller.refreshCanonicalDatasetAfterMutation('unauthorise', result, mutationIntent);
      return result;
    };
  }

  win.openBulkAuthoriseWorkbench = async function openBulkAuthoriseWorkbenchV2(...args) {
    const state = await legacy.open.apply(this, args);
    const controller = controllerFor(state);
    if (controller) await controller.initialise();
    return state;
  };

  win.__bulkAuthoriseLifecycleV2Test = {
    controllerFor,
    clearRowOwnedState,
    classificationOf,
    rowKeyOf,
    legacy
  };
})(window);

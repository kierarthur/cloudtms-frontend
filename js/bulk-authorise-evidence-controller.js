(function installBulkAuthoriseEvidenceController(win) {
  'use strict';

  if (!win || win.__bulkAuthoriseEvidenceControllerInstalled === true) return;
  win.__bulkAuthoriseEvidenceControllerInstalled = true;

  const doc = win.document;
  const SELECT_QUEUE_REPLACEMENT_MESSAGE = 'Please select an image from the queue to replace this evidence with';
  const controllers = new WeakMap();
  // Shell rerenders can replace the Bulk Authorise state object while evidence
  // verification is in flight. Keep signature-guarded truth at the modal scope
  // so the successor controller can consume the completed request. This cache is
  // cleared for every new modal open and updated after evidence mutations.
  const verifiedBadgeTruthForOpenModal = new Map();
  // Post-render bindings and the DOM observer can briefly see successor state
  // objects for the same active row. Share the one active-row policy read at
  // modal scope so those controllers consume the same result. The entry is
  // replaced as soon as a different timesheet becomes active and is cleared
  // after evidence mutation or a new modal open, so it is not a cross-row or
  // cross-open cache.
  const mutationPolicyForOpenModal = {
    timesheetId: '',
    policy: null,
    promise: null
  };
  const clearSharedMutationPolicy = (timesheetId = '') => {
    if (timesheetId && mutationPolicyForOpenModal.timesheetId !== timesheetId) return;
    mutationPolicyForOpenModal.timesheetId = '';
    mutationPolicyForOpenModal.policy = null;
    mutationPolicyForOpenModal.promise = null;
  };
  let activeBulkAuthoriseState = null;
  let activeQueueSelectionStabilizeEpoch = 0;
  const legacy = {
    open: win.openBulkAuthoriseWorkbench,
    renderShell: win.renderBulkAuthoriseShell,
    refreshContext: win.refreshBulkAuthoriseActiveContext,
    bindEvidence: win.bindBulkAuthoriseEvidencePane,
    bindPreview: win.bindBulkAuthorisePreviewPane,
    reconcileEvidence: win.reconcileBulkProcessEvidenceStateAfterContextRefresh
  };

  const trim = (value) => String(value == null ? '' : value).trim();
  const liveBulkAuthoriseState = () => (
    (win.modalCtx?.bulkAuthoriseState && typeof win.modalCtx.bulkAuthoriseState === 'object')
      ? win.modalCtx.bulkAuthoriseState
      : activeBulkAuthoriseState
  );
  const upper = (value) => trim(value).toUpperCase();
  const clone = (value) => {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  };
  const cleanFileKey = (value) => trim(value).replace(/^\/+/, '');
  const classificationOf = (state) => {
    const value = upper(state && state.classification);
    return value === 'NHSP' || value === 'HR' || value === 'HEALTHROSTER' ? value : 'TIMESHEETS';
  };
  const rowIdentityOf = (state) => trim(
    state && (
      state.active_row_key ||
      state.active_row?.row_key ||
      state.__bulkAuthoriseRecordIdentity ||
      state.active_row?.timesheet_id ||
      state.active_row?.current_timesheet_id ||
      state.active_row?.contract_week_id
    )
  );
  const evidenceIdOf = (item) => trim(
    item && (
      item.evidence_id ||
      item.timesheet_evidence_id ||
      item.evidenceId ||
      item.id
    )
  );
  const evidenceFileKeyOf = (item) => cleanFileKey(
    item && (
      item.storage_key ||
      item.r2_key ||
      item.file_key ||
      item.download_storage_key ||
      item.preview_storage_key
    )
  );
  const evidenceKindOf = (item) => {
    const value = upper(item && (item.kind || item.evidence_kind || item.staged_kind));
    if (value === 'TIME SHEET' || value === 'TIME-SHEET') return 'TIMESHEET';
    if (value === 'ACCOM') return 'ACCOMMODATION';
    return value || 'OTHER';
  };
  const evidenceFilenameOf = (item) => {
    const explicit = trim(item && (
      item.filename ||
      item.original_filename ||
      item.file_name ||
      item.display_name ||
      item.name
    ));
    if (explicit) return explicit;
    const fileKey = evidenceFileKeyOf(item);
    return trim(fileKey.split('/').filter(Boolean).pop()) || 'Evidence file';
  };
  const isSyntheticEvidence = (item) => {
    const id = evidenceIdOf(item);
    const systemTimesheet = evidenceKindOf(item) === 'TIMESHEET' && !!(
      /^(?:synthetic-attached|system:|sys:)/i.test(id) ||
      (item?.system === true && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    );
    return !!(
      !item ||
      item.__synthetic_attached_fallback === true ||
      item.is_synthetic_attached_fallback === true ||
      item.__primary_artifact_fallback === true ||
      item.is_primary_artifact_fallback === true ||
      systemTimesheet
    );
  };
  const persistedEvidenceIdOf = (item) => {
    const explicit = trim(item?.evidence_id || item?.timesheet_evidence_id);
    if (explicit) return explicit;
    const id = evidenceIdOf(item);
    return !isSyntheticEvidence(item) && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      ? id
      : '';
  };
  const normaliseEvidence = (item) => {
    if (!item || typeof item !== 'object') return null;
    const fileKey = evidenceFileKeyOf(item);
    if (!fileKey) return null;
    const synthetic = isSyntheticEvidence(item);
    const staged = item.is_staged_context === true || ['STAGED', 'QUEUED'].includes(upper(item.status || item.queue_status));
    const source = upper(item.source_label || item.source_badge);
    if (staged && !trim(item.evidence_id || item.timesheet_evidence_id) && source !== 'ATTACHED') return null;
    const kind = evidenceKindOf(item);
    const id = evidenceIdOf(item) || `${synthetic ? 'synthetic-attached' : 'system'}:${kind}:${fileKey}`;
    const displayName = evidenceFilenameOf(item) || `${kind === 'TIMESHEET' ? 'Timesheet' : 'Evidence'} file`;
    return {
      ...clone(item),
      id,
      evidence_id: synthetic ? null : (persistedEvidenceIdOf(item) || (item.system === true ? id : null)),
      __synthetic_attached_fallback: synthetic,
      is_synthetic_attached_fallback: synthetic,
      kind,
      staged_kind: kind,
      display_name: displayName,
      filename: trim(item.filename) || displayName,
      original_filename: trim(item.original_filename) || displayName,
      storage_key: fileKey,
      r2_key: fileKey,
      file_key: fileKey,
      download_storage_key: cleanFileKey(item.download_storage_key || fileKey),
      source_label: trim(item.source_label) || 'Attached',
      source_badge: trim(item.source_badge) || 'Attached'
    };
  };
  const filterNormalisedEvidenceRows = (rows) => {
    const source = Array.isArray(rows) ? rows.filter(Boolean) : [];
    const realNonTimesheetKeys = new Set(source
      .filter((item) => !isSyntheticEvidence(item) && evidenceKindOf(item) !== 'TIMESHEET')
      .map(evidenceFileKeyOf)
      .filter(Boolean));
    return source.filter((item) => !(
      isSyntheticEvidence(item) &&
      evidenceKindOf(item) === 'TIMESHEET' &&
      realNonTimesheetKeys.has(evidenceFileKeyOf(item))
    ));
  };
  const itemKey = (item) => {
    const normalised = normaliseEvidence(item);
    return normalised ? `${evidenceIdOf(normalised)}|${evidenceFileKeyOf(normalised)}` : '';
  };
  const selectionKey = (item) => {
    const normalised = normaliseEvidence(item);
    return normalised ? `attached|${evidenceIdOf(normalised)}|${evidenceFileKeyOf(normalised)}` : '';
  };
  const rowKeyOf = (row) => trim(row && (row.row_key || row.timesheet_id || row.current_timesheet_id || row.contract_week_id));
  const rowSignatureOf = (row) => trim(row && (
    row.backend_row_signature ||
    row.row_backend_signature ||
    row.mutation_row_signature ||
    row.row_signature ||
    row.expected_row_signature
  ));
  const badgeKinds = ['TIMESHEET', 'MILEAGE', 'TRAVEL', 'ACCOMMODATION', 'OTHER'];
  const badgeLabel = (kind) => kind === 'TIMESHEET'
    ? 'Timesheet'
    : (kind === 'ACCOMMODATION' ? 'Accommodation' : `${kind.slice(0, 1)}${kind.slice(1).toLowerCase()}`);
  const buildBadges = (rows) => {
    const counts = new Map();
    for (const item of rows) {
      const kind = badgeKinds.includes(evidenceKindOf(item)) ? evidenceKindOf(item) : 'OTHER';
      counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    return badgeKinds.map((kind) => ({
      kind,
      label: badgeLabel(kind),
      present: (counts.get(kind) || 0) > 0,
      has_evidence: (counts.get(kind) || 0) > 0,
      count: counts.get(kind) || 0
    }));
  };
  const positiveBadgeKinds = (badges) => (Array.isArray(badges) ? badges : [])
    .filter((badge) => badge && (badge.present === true || badge.has_evidence === true || Number(badge.count || 0) > 0))
    .map((badge) => evidenceKindOf(badge));
  const badgeStateFromRows = (rows) => ({
    evidence_badges: buildBadges(Array.isArray(rows) ? rows : []),
    has_any_evidence: Array.isArray(rows) && rows.length > 0,
    attached_evidence_count: Array.isArray(rows) ? rows.length : 0
  });
  const badgeStateFromPayload = (payload, evidenceRows) => {
    const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
    const serverBadges = Array.isArray(payload?.evidence_badges)
      ? payload.evidence_badges.filter((badge) => badge && typeof badge === 'object')
      : [];
    if (!serverBadges.length) return badgeStateFromRows(rows);
    const badgeCount = serverBadges.reduce((total, badge) => {
      const explicit = Number(badge.count || 0) || 0;
      return total + (explicit > 0 ? explicit : (badge.present === true || badge.has_evidence === true ? 1 : 0));
    }, 0);
    const payloadCount = Number(payload?.attached_evidence_count ?? payload?.evidence_count);
    const attachedCount = Number.isFinite(payloadCount) && payloadCount >= 0
      ? payloadCount
      : (rows.length || badgeCount);
    return {
      evidence_badges: clone(serverBadges),
      has_any_evidence: payload?.has_any_evidence === true || attachedCount > 0 || badgeCount > 0,
      attached_evidence_count: attachedCount
    };
  };
  const timesheetIdOf = (state) => trim(
    state?.active_row?.current_timesheet_id ||
    state?.active_row?.timesheet_id ||
    state?.active_row?.requested_timesheet_id ||
    state?.active_details?.current_timesheet_id ||
    state?.active_details?.timesheet?.timesheet_id ||
    state?.active_context?.current_timesheet_id ||
    state?.active_context?.details?.timesheet?.timesheet_id
  );
  const isAuthorisedState = (state) => {
    const row = state?.active_row || {};
    const details = state?.active_details || {};
    const section = upper(row.bulk_authorise_section || state?.active_context?.row?.bulk_authorise_section);
    const status = upper(row.status || row.processing_status || details.processing_status || details.timesheet?.status);
    const revoked = trim(row.revoked_at || details.revoked_at || details.timesheet?.revoked_at);
    if (section === 'PROCESSED_ELIGIBLE' || revoked) return false;
    return !!(
      section === 'AUTHORISED_ELIGIBLE' ||
      row.authorised === true || row.is_authorised === true ||
      trim(row.authorised_at_server || row.authorised_at_utc || details.authorised_at_server || details.timesheet?.authorised_at_server) ||
      ['AUTHORISED', 'AUTHORIZED', 'READY_FOR_INVOICE', 'READY_FOR_HR'].includes(status)
    );
  };
  const openBulkAuthoriseUiDialog = (options = {}) => new Promise((resolve) => {
    if (!doc || typeof doc.createElement !== 'function' || !doc.body) {
      resolve(options.fallback_value || 'cancel');
      return;
    }
    const existing = doc.getElementById('bulkAuthoriseEvidenceUiDialog');
    try { existing?.remove?.(); } catch {}

    const overlay = doc.createElement('div');
    overlay.id = 'bulkAuthoriseEvidenceUiDialog';
    overlay.dataset.bulkAuthoriseEvidenceUiDialog = '1';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(2,6,23,.78);';
    const panel = doc.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'bulkAuthoriseEvidenceUiDialogTitle');
    panel.style.cssText = 'width:min(620px,calc(100vw - 48px));border:1px solid var(--line,#334155);border-radius:12px;background:var(--panel,#0f172a);color:var(--text,#f8fafc);box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden;';
    const header = doc.createElement('div');
    header.style.cssText = 'display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--line,#334155);';
    const title = doc.createElement('div');
    title.id = 'bulkAuthoriseEvidenceUiDialogTitle';
    title.style.cssText = 'font-weight:800;font-size:14px;';
    title.textContent = trim(options.title) || 'Evidence';
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-outline';
    close.setAttribute('aria-label', 'Close and cancel');
    close.textContent = 'Close';
    header.append(title, close);
    const body = doc.createElement('div');
    body.style.cssText = 'padding:16px 14px;white-space:pre-wrap;font-size:13px;line-height:1.45;';
    body.textContent = trim(options.message);
    const footer = doc.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 14px;border-top:1px solid var(--line,#334155);';
    panel.append(header, body, footer);
    overlay.append(panel);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { doc.removeEventListener('keydown', onKeyDown, true); } catch {}
      try { overlay.remove(); } catch {}
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(options.cancel_value || 'cancel');
    };
    close.addEventListener('click', () => finish(options.cancel_value || 'cancel'));
    for (const action of (Array.isArray(options.actions) ? options.actions : [])) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = action.class_name || 'btn btn-outline';
      button.dataset.bulkAuthoriseEvidenceDialogAction = trim(action.value);
      button.textContent = trim(action.label);
      if (action.danger === true) button.style.cssText = 'border-color:rgba(248,113,113,.8);color:#fecaca;background:rgba(127,29,29,.34);';
      button.addEventListener('click', () => finish(action.value));
      footer.appendChild(button);
    }
    doc.body.appendChild(overlay);
    doc.addEventListener('keydown', onKeyDown, true);
    const focusTarget = footer.querySelector?.('button:last-child') || close;
    try { focusTarget.focus(); } catch {}
  });

  class BulkAuthoriseEvidenceController {
    constructor(state) {
      this.state = state;
      this.datasetRef = null;
      this.datasetBadgeTruth = new Map();
      this.datasetInitialBadgeTruth = new Map();
      this.datasetPendingBadgeIdentities = new Set();
      this.verifiedBadgeTruth = verifiedBadgeTruthForOpenModal;
      this.badgeHydrationDatasetRef = null;
      this.badgeHydrationPromise = null;
      this.badgeHydrationRenderPromise = null;
      this.badgeHydrationRenderRequested = false;
      this.badgeHydrationEpoch = 0;
      this.badgeHydrationAbortControllers = [];
      this.rowsByIdentity = new Map();
      this.selectedByIdentity = new Map();
      this.selectionEpoch = 0;
      this.guardEpoch = 0;
      this.pendingGuardKey = '';
      this.basePostRenderBindings = null;
      this.boundPostRenderBindings = null;
      this.previewRequestKey = '';
      this.previewRequestPromise = null;
      this.previewAbortController = null;
      this.postRenderSettleEpoch = 0;
      this.lastPointerSelectionKey = '';
      this.mutationPolicyTimesheetId = '';
      this.mutationPolicy = null;
      this.mutationPolicyPromise = null;
      this.mutationInFlight = false;
      this.lastMutationPointerControl = null;
      this.lastMutationPointerAt = 0;
      this.deferredMutationControl = null;
      this.deferredMutationEpoch = 0;
      this.queueRefreshRenderEpoch = 0;
      this.queueRefreshFallbackPromise = null;
      this.queueRefreshRenderPending = false;
      this.rememberedQueueAnchor = null;
    }

    isTimesheets() {
      return classificationOf(this.state) === 'TIMESHEETS';
    }

    isLive() {
      return !!(
        this.isTimesheets() &&
        liveBulkAuthoriseState() === this.state &&
        doc && doc.getElementById('bulkAuthoriseWorkbenchRoot')
      );
    }

    isRowTransitionHydrationPending() {
      // The lifecycle owns the complete transition through its final ready
      // render. A context can become ready just before that render; allowing
      // evidence work in that gap starts an early policy/preview pass which
      // the final render immediately repeats.
      return this.state?.__bulk_authorise_v2_transition_loading === true;
    }

    mutationEndpoint(suffix = '') {
      const base = trim(win.BROKER_BASE_URL).replace(/\/$/, '');
      const timesheetId = timesheetIdOf(this.state);
      if (!base || !timesheetId) return '';
      return `${base}/api/timesheets/${encodeURIComponent(timesheetId)}/bulk-authorise-evidence${suffix}`;
    }

    applyMutationPolicyToEvidenceContext(policy) {
      if (!policy || policy.can_manage_evidence !== true) return false;
      const context = this.state && this.state.active_context;
      if (!context || typeof context !== 'object') return false;
      let changed = false;
      if (context.can_manage_evidence !== true) {
        context.can_manage_evidence = true;
        changed = true;
      }
      if (policy.has_mutable_unissued_invoice === true) {
        if (context.evidence_document_locked !== false) {
          context.evidence_document_locked = false;
          changed = true;
        }
        if (trim(context.evidence_lock_reason)) {
          context.evidence_lock_reason = null;
          changed = true;
        }
      }
      this.state.__bulk_authorise_can_manage_evidence = true;
      this.state.__bulk_authorise_evidence_policy_applied = true;
      this.state.__bulk_authorise_mutable_unissued_invoice = policy.has_mutable_unissued_invoice === true;
      return changed;
    }

    ensureMutationPolicy(force = false) {
      const timesheetId = timesheetIdOf(this.state);
      const endpoint = this.mutationEndpoint('-policy');
      if (!timesheetId || !endpoint || typeof win.authFetch !== 'function') return Promise.resolve(null);
      if (!force && this.mutationPolicyTimesheetId === timesheetId && this.mutationPolicy) return Promise.resolve(this.mutationPolicy);
      if (!force && this.mutationPolicyTimesheetId === timesheetId && this.mutationPolicyPromise) return this.mutationPolicyPromise;
      this.mutationPolicyTimesheetId = timesheetId;
      this.mutationPolicy = null;
      if (
        force ||
        mutationPolicyForOpenModal.timesheetId !== timesheetId ||
        (!mutationPolicyForOpenModal.policy && !mutationPolicyForOpenModal.promise)
      ) {
        mutationPolicyForOpenModal.timesheetId = timesheetId;
        mutationPolicyForOpenModal.policy = null;
        const sharedWork = (async () => {
          try {
            const response = await win.authFetch(endpoint);
            const text = await response.text().catch(() => '');
            const payload = text ? JSON.parse(text) : {};
            if (!response.ok || payload?.ok === false) throw new Error(payload?.message || 'Evidence policy could not be loaded.');
            return payload;
          } catch (error) {
            return {
              can_manage_evidence: false,
              protected_reason: 'POLICY_UNAVAILABLE',
              message: trim(error?.message) || 'Evidence policy could not be loaded.'
            };
          }
        })();
        const sharedTracked = sharedWork.then((payload) => {
          if (mutationPolicyForOpenModal.timesheetId === timesheetId) {
            mutationPolicyForOpenModal.policy = payload;
            if (mutationPolicyForOpenModal.promise === sharedTracked) mutationPolicyForOpenModal.promise = null;
          }
          return payload;
        });
        mutationPolicyForOpenModal.promise = sharedTracked;
      }
      const sharedPolicy = mutationPolicyForOpenModal.policy;
      const sharedPromise = sharedPolicy
        ? Promise.resolve(sharedPolicy)
        : mutationPolicyForOpenModal.promise;
      const work = Promise.resolve(sharedPromise).then(async (payload) => {
        if (!payload || timesheetId !== timesheetIdOf(this.state)) return null;
        this.mutationPolicy = payload;
        const controlsMissing = !doc?.getElementById?.('bpQueueKindSelect');
        const contextChanged = this.applyMutationPolicyToEvidenceContext(payload);
        this.stampMutationControls();
        if ((contextChanged || controlsMissing) && payload?.can_manage_evidence === true && this.isLive()) {
          const leftPane = doc?.getElementById?.('bulkAuthoriseLeftPane');
          const leftScrollTop = Number(leftPane?.scrollTop || 0);
          if (typeof win.rerenderBulkAuthoriseWorkbench === 'function') {
            await win.rerenderBulkAuthoriseWorkbench(this.state, '[TS][BULK-AUTH][EVIDENCE-POLICY]');
          }
          this.settle('evidence-policy-applied');
          const restoreScroll = () => {
            const liveLeftPane = doc?.getElementById?.('bulkAuthoriseLeftPane');
            if (liveLeftPane) liveLeftPane.scrollTop = leftScrollTop;
          };
          restoreScroll();
          if (typeof win.setTimeout === 'function') {
            win.setTimeout(restoreScroll, 0);
            win.setTimeout(restoreScroll, 150);
          }
        }
        return payload;
      });
      const tracked = work.finally(() => {
        if (this.mutationPolicyPromise === tracked) this.mutationPolicyPromise = null;
      });
      this.mutationPolicyPromise = tracked;
      return tracked;
    }

    showInfo(message, title = 'Evidence') {
      return openBulkAuthoriseUiDialog({
        title,
        message,
        cancel_value: 'ok',
        actions: [{ value: 'ok', label: 'OK', class_name: 'btn btn-outline' }]
      });
    }

    chooseDisposition(item) {
      const kind = badgeLabel(evidenceKindOf(item));
      return openBulkAuthoriseUiDialog({
        title: `Remove ${kind} evidence`,
        message: `What would you like to do with the ${kind.toLowerCase()} evidence?`,
        cancel_value: 'cancel',
        actions: [
          { value: 'delete', label: 'Permanently delete', class_name: 'btn btn-outline', danger: true },
          { value: 'return_to_queue', label: 'Return to timesheet queue', class_name: 'btn btn-outline' },
          { value: 'cancel', label: 'Cancel', class_name: 'btn btn-outline' }
        ]
      });
    }

    confirmReplacement() {
      return openBulkAuthoriseUiDialog({
        title: 'Replace evidence',
        message: 'You can only remove this evidence by replacing it with the item in your view, do you want to replace this?',
        cancel_value: 'cancel',
        actions: [
          { value: 'replace', label: 'Replace', class_name: 'btn btn-outline' },
          { value: 'cancel', label: 'Cancel', class_name: 'btn btn-outline' }
        ]
      });
    }

    itemForRemoveControl(control) {
      const identity = rowIdentityOf(this.state);
      const rows = this.rowsByIdentity.get(identity) || [];
      const requestedSelection = trim(control?.getAttribute?.('data-attached-selection-key'));
      const requestedId = trim(control?.getAttribute?.('data-evidence-id'));
      const requestedAttachedId = trim(control?.getAttribute?.('data-attached-id'));
      const requestedFile = cleanFileKey(control?.getAttribute?.('data-file-key') || control?.getAttribute?.('data-storage-key'));
      const requestedKind = evidenceKindOf({ kind: control?.getAttribute?.('data-kind') });
      const matched = rows.find((item) => requestedSelection && selectionKey(item) === requestedSelection)
        || rows.find((item) => {
          const realEvidenceId = persistedEvidenceIdOf(item);
          const attachedId = evidenceIdOf(item);
          return (
            (!requestedId || realEvidenceId === requestedId) &&
            (!requestedAttachedId || attachedId === requestedAttachedId) &&
            (!requestedFile || evidenceFileKeyOf(item) === requestedFile) &&
            (!requestedKind || evidenceKindOf(item) === requestedKind)
          );
        })
        || null;
      if (matched) return matched;
      if (!requestedFile || !requestedKind) return null;
      return normaliseEvidence({
        id: requestedAttachedId || requestedId || `${control?.getAttribute?.('data-synthetic') === '1' ? 'synthetic-attached' : 'system'}:${requestedKind}:${requestedFile}`,
        evidence_id: requestedId || null,
        kind: requestedKind,
        display_name: trim(control?.getAttribute?.('data-display-name')) || requestedFile.split('/').pop() || 'Evidence file',
        storage_key: requestedFile,
        __synthetic_attached_fallback: control?.getAttribute?.('data-synthetic') === '1',
        is_synthetic_attached_fallback: control?.getAttribute?.('data-synthetic') === '1'
      });
    }

    displayedQueueItem() {
      const pane = this.state.evidence_pane_state || {};
      const queueItem = pane.active_queue_item && typeof pane.active_queue_item === 'object' ? pane.active_queue_item : null;
      const queueId = trim(queueItem?.id || queueItem?.queue_id || pane.active_queue_id);
      const storageKey = evidenceFileKeyOf(queueItem);
      const target = trim(pane.__preview_target_key);
      const signedUrl = trim(pane.__preview_signed_url);
      const queueTab = doc?.getElementById?.('bulkProcessEvidenceTabQueue');
      const queueVisible = !!(
        trim(pane.active_tab).toLowerCase() === 'queue' &&
        queueTab && (
          trim(queueTab.getAttribute?.('aria-selected')).toLowerCase() === 'true' ||
          queueTab.classList?.contains?.('active') ||
          queueTab.classList?.contains?.('is-active')
        )
      );
      const targetMatches = !!(
        target && queueId && storageKey &&
        target.toLowerCase().startsWith('queue|') &&
        target.includes(queueId) &&
        target.includes(storageKey)
      );
      const stage = doc?.getElementById?.('bulkProcessPreviewStage');
      const previewNode = stage?.querySelector?.('img,iframe,canvas,object,embed');
      const previewText = trim(stage?.textContent).toLowerCase();
      const previewReady = !!(
        previewNode ||
        (signedUrl && stage && !/loading|no queue|no attached|could not|select an image/.test(previewText))
      );
      if (!queueVisible || !queueItem || !queueId || !storageKey || !targetMatches || !signedUrl || !previewReady) return null;
      return { item: queueItem, queue_id: queueId, storage_key: storageKey };
    }

    async requestMutation(payload) {
      if (this.mutationInFlight) throw new Error('An evidence change is already in progress.');
      const policy = await this.ensureMutationPolicy(false);
      if (!policy?.can_manage_evidence) {
        throw new Error(policy?.message || (
          policy?.invoice_blocked
            ? 'Evidence cannot be changed because the related invoice has been issued.'
            : 'Evidence cannot be changed for this row.'
        ));
      }
      const endpoint = this.mutationEndpoint('');
      if (!endpoint || typeof win.authFetch !== 'function') throw new Error('The evidence service is not available.');
      this.mutationInFlight = true;
      this.stampMutationControls();
      try {
        const timesheetId = timesheetIdOf(this.state);
        const response = await win.authFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            expected_timesheet_id: timesheetId,
            source: 'bulk_authorise_evidence_controller'
          })
        });
        const text = await response.text().catch(() => '');
        let result = {};
        try { result = text ? JSON.parse(text) : {}; } catch { result = {}; }
        if (!response.ok || result?.ok === false) {
          const error = new Error(result?.message || result?.error || 'The evidence change failed.');
          error.code = result?.error_code || result?.error || '';
          throw error;
        }
        await this.refreshAfterMutation(result, payload?.action || 'evidence', payload);
        return result;
      } finally {
        this.mutationInFlight = false;
        this.stampMutationControls();
      }
    }

    async refreshAfterMutation(result, reason = 'evidence', requestPayload = null) {
      const leftPane = doc?.getElementById?.('bulkAuthoriseLeftPane');
      const leftScrollTop = Number(leftPane?.scrollTop || 0);
      const state = this.state;
      const pane = state.evidence_pane_state || (state.evidence_pane_state = {});
      this.invalidateQueueAfterReturn(result);
      pane.active_tab = 'attached';
      pane.__attached_manual_override = true;
      pane.__queue_manual_override = false;
      state.error_text = '';
      state.warning_text = '';
      clearSharedMutationPolicy(timesheetIdOf(state));
      this.mutationPolicy = null;
      this.mutationPolicyPromise = null;
      let mutationRows = null;
      const applyMutationRowsToState = (targetState) => {
        if (!Array.isArray(mutationRows) || !targetState || typeof targetState !== 'object') return;
        const writeRows = (container) => {
          if (!container || typeof container !== 'object') return;
          container.evidence = mutationRows.map(clone);
          container.evidence_loaded = true;
        };
        if (!targetState.active_context || typeof targetState.active_context !== 'object') targetState.active_context = {};
        writeRows(targetState.active_context);
        writeRows(targetState.active_row);
        writeRows(targetState.active_context.row);
        writeRows(targetState.active_context.data_row);
        writeRows(targetState.active_context.details);
        writeRows(targetState.active_context.details?.timesheet);
        targetState.active_context.context_profile = 'evidence';
        if (!targetState.active_details || typeof targetState.active_details !== 'object') targetState.active_details = {};
        writeRows(targetState.active_details);
        writeRows(targetState.active_details.timesheet);
        writeRows(targetState.active_details.details);
        writeRows(targetState.active_ctx);
        writeRows(targetState.active_ctx?.row);
        writeRows(targetState.active_ctx?.data_row);
        writeRows(targetState.active_ctx?.state);
        writeRows(targetState.active_ctx?.state?.timesheet);
        writeRows(targetState.active_ctx?.details);
        writeRows(targetState.active_ctx?.details?.timesheet);
        const activeIdentity = rowIdentityOf(targetState);
        const dataset = targetState.dataset && typeof targetState.dataset === 'object' ? targetState.dataset : {};
        const collections = [
          dataset.rows,
          dataset.processed_eligible_rows,
          dataset.authorised_eligible_rows,
          dataset.unauthorised_rows,
          dataset.processed_eligible,
          dataset.authorised_eligible,
          dataset.authorised_rows
        ].filter(Array.isArray);
        for (const collection of collections) {
          for (const row of collection) {
            if (rowKeyOf(row) === activeIdentity) writeRows(row);
          }
        }
      };
      const applyMutationRows = () => {
        applyMutationRowsToState(state);
        const liveState = liveBulkAuthoriseState();
        if (liveState && liveState !== state) applyMutationRowsToState(liveState);
      };
      if (Array.isArray(result?.evidence)) {
        mutationRows = filterNormalisedEvidenceRows(result.evidence.map(normaliseEvidence).filter(Boolean));
        applyMutationRows();
      }
      if (upper(reason) === 'REMOVE') {
        const removedId = trim(requestPayload?.evidence_id || result?.removed_evidence_id);
        const currentRows = Array.isArray(mutationRows)
          ? mutationRows
          : (this.rowsByIdentity.get(rowIdentityOf(state)) || this.authoritativeEvidence().rows || []);
        if (removedId && Array.isArray(currentRows)) {
          mutationRows = currentRows.filter((item) => persistedEvidenceIdOf(item) !== removedId).map(clone);
          applyMutationRows();
        }
      }
      if (typeof win.refreshBulkAuthoriseActiveContext === 'function') {
        await win.refreshBulkAuthoriseActiveContext(state, {
          row: state.active_row,
          base_only: false,
          profile: 'evidence',
          context_profile: 'evidence',
          include_evidence: true,
          include_compare: false,
          include_import_source_rows: false,
          bypassCache: true,
          invalidateCache: true,
          evidencePatch: true,
          source: 'evidence_patch',
          rerender: false
        });
      }
      if (!Array.isArray(mutationRows) && state.active_context?.evidence_loaded === true && Array.isArray(state.active_context.evidence)) {
        mutationRows = filterNormalisedEvidenceRows(state.active_context.evidence.map(normaliseEvidence).filter(Boolean));
      }
      // The mutation response is the authoritative post-write snapshot. Context
      // refresh can leave older evidence arrays in secondary compatibility
      // containers, so overwrite every source before reconciliation.
      applyMutationRows();
      this.sanitize(`mutation:${reason}`);
      const liveState = liveBulkAuthoriseState();
      const liveController = liveState && liveState !== state ? controllerFor(liveState) : null;
      if (liveController) {
        liveController.invalidateQueueAfterReturn(result);
        const livePane = liveState.evidence_pane_state || (liveState.evidence_pane_state = {});
        livePane.active_tab = 'attached';
        livePane.__attached_manual_override = true;
        livePane.__queue_manual_override = false;
        liveController.sanitize(`mutation:${reason}:live-state`);
      }
      if (typeof win.rerenderBulkAuthoriseWorkbench === 'function') {
        await win.rerenderBulkAuthoriseWorkbench(liveState || state, `[TS][BULK-AUTH][EVIDENCE-MUTATION:${reason}]`);
      }
      this.settle(`mutation:${reason}:settled`);
      if (liveController) liveController.settle(`mutation:${reason}:live-state-settled`);
      const restoreScroll = () => {
        const liveLeftPane = doc?.getElementById?.('bulkAuthoriseLeftPane');
        if (liveLeftPane) liveLeftPane.scrollTop = leftScrollTop;
      };
      restoreScroll();
      if (typeof win.setTimeout === 'function') {
        win.setTimeout(restoreScroll, 0);
        win.setTimeout(restoreScroll, 150);
      }
      void this.ensureMutationPolicy(false);
    }

    invalidateQueueAfterReturn(result) {
      const action = upper(result?.action);
      const queueMembershipChanged = !!(
        result && (
          result.workbench_queue_created === true ||
          trim(result.returned_queue_id) ||
          action === 'ATTACH' ||
          action === 'REPLACE'
        )
      );
      if (!queueMembershipChanged) return false;
      const state = this.state;
      const pane = state.evidence_pane_state || (state.evidence_pane_state = {});
      const queueScope = trim(pane.__queue_scope || pane.__queue_loaded_scope || 'global:QUEUED') || 'global:QUEUED';
      pane.queue_rows = [];
      pane.__queue_loaded = false;
      pane.__queue_scope = queueScope;
      pane.__queue_loaded_scope = queueScope;
      pane.__queue_loaded_identity = '';
      pane.__queue_loading = false;
      pane.__queue_loading_scope = '';
      pane.__queue_loading_identity = '';
      pane.__queue_count_loading_identity = '';
      pane.__queue_refresh_inflight = null;
      pane.__queue_refresh_inflight_by_owner = {};
      pane.__queue_refresh_last_result = '';
      pane.__queue_last_error = '';
      pane.queue_loaded_at_utc = '';
      pane.__queue_loaded_at_utc = '';
      return true;
    }

    rememberQueueSelection(reason = 'queue-selection') {
      const pane = this.state.evidence_pane_state || (this.state.evidence_pane_state = {});
      const rows = Array.isArray(pane.queue_rows) ? pane.queue_rows.filter(Boolean) : [];
      const item = pane.active_queue_item && typeof pane.active_queue_item === 'object'
        ? pane.active_queue_item
        : null;
      const queueId = trim(item?.id || item?.queue_id || pane.active_queue_id);
      const storageKey = evidenceFileKeyOf(item);
      if (!queueId || !storageKey) return this.rememberedQueueAnchor;
      let index = rows.findIndex((row) => {
        const rowId = trim(row?.id || row?.queue_id);
        return rowId === queueId && evidenceFileKeyOf(row) === storageKey;
      });
      if (index < 0) index = rows.findIndex((row) => trim(row?.id || row?.queue_id) === queueId);
      if (index < 0) index = Math.max(0, Number(pane.__remembered_queue_index || 0) || 0);
      this.rememberedQueueAnchor = {
        queue_id: queueId,
        storage_key: storageKey,
        index,
        reason: trim(reason) || 'queue-selection'
      };
      pane.__bulk_authorise_last_viewed_queue_anchor = clone(this.rememberedQueueAnchor);
      this.state.__bulk_authorise_last_viewed_queue_anchor = clone(this.rememberedQueueAnchor);
      pane.__remembered_queue_id = queueId;
      pane.__remembered_queue_index = index;
      return this.rememberedQueueAnchor;
    }

    getRememberedQueueAnchor() {
      const pane = this.state.evidence_pane_state || {};
      const anchor = this.rememberedQueueAnchor
        || pane.__bulk_authorise_last_viewed_queue_anchor
        || this.state.__bulk_authorise_last_viewed_queue_anchor
        || null;
      if (!anchor || typeof anchor !== 'object') return null;
      const queueId = trim(anchor.queue_id || anchor.queueId);
      const storageKey = cleanFileKey(anchor.storage_key || anchor.storageKey);
      if (!queueId || !storageKey) return null;
      return {
        queue_id: queueId,
        storage_key: storageKey,
        index: Math.max(0, Number(anchor.index || 0) || 0),
        reason: trim(anchor.reason) || 'queue-selection'
      };
    }

    restoreRememberedQueueSelection(reason = 'queue-restore') {
      const pane = this.state.evidence_pane_state || (this.state.evidence_pane_state = {});
      const rows = Array.isArray(pane.queue_rows) ? pane.queue_rows.filter(Boolean) : [];
      const anchor = this.getRememberedQueueAnchor();
      if (!anchor || !rows.length) return { restored: false, changed: false, index: -1 };
      let index = rows.findIndex((row) => {
        const rowId = trim(row?.id || row?.queue_id);
        return rowId === trim(anchor.queue_id) && evidenceFileKeyOf(row) === evidenceFileKeyOf(anchor);
      });
      if (index < 0) index = rows.findIndex((row) => trim(row?.id || row?.queue_id) === trim(anchor.queue_id));
      if (index < 0) index = Math.min(Math.max(0, Number(anchor.index || 0) || 0), rows.length - 1);
      const item = rows[index] || null;
      const queueId = trim(item?.id || item?.queue_id);
      const storageKey = evidenceFileKeyOf(item);
      if (!item || !queueId || !storageKey) return { restored: false, changed: false, index: -1 };
      const currentId = trim(pane.active_queue_id || pane.active_queue_item?.id || pane.active_queue_item?.queue_id);
      const currentStorageKey = evidenceFileKeyOf(pane.active_queue_item);
      const changed = currentId !== queueId || currentStorageKey !== storageKey;
      pane.active_queue_id = queueId;
      pane.active_queue_item = clone(item);
      pane.__remembered_queue_id = queueId;
      pane.__remembered_queue_index = index;
      this.rememberedQueueAnchor = {
        queue_id: queueId,
        storage_key: storageKey,
        index,
        reason: trim(reason) || 'queue-restore'
      };
      pane.__bulk_authorise_last_viewed_queue_anchor = clone(this.rememberedQueueAnchor);
      this.state.__bulk_authorise_last_viewed_queue_anchor = clone(this.rememberedQueueAnchor);
      if (trim(pane.active_tab).toLowerCase() === 'queue') {
        const target = `queue|${queueId}|${storageKey}`;
        pane.__queue_manual_override = true;
        pane.__queue_manual_override_identity = '';
        pane.__queue_manual_override_scope = trim(pane.__queue_scope || pane.__queue_loaded_scope || 'global:QUEUED') || 'global:QUEUED';
        if (trim(pane.__preview_target_key) !== target) {
          pane.active_pdf_page = 1;
          pane.__preview_target_key = target;
          pane.__preview_load_requested_target_key = target;
          pane.__preview_signed_url = '';
          pane.__preview_signed_url_error = '';
          pane.__preview_error = '';
          pane.__preview_loading = true;
        }
      }
      return { restored: true, changed, index };
    }

    scheduleQueueSelectionStabilization(reason = 'queue-tab') {
      const scheduledAnchor = this.getRememberedQueueAnchor();
      if (typeof win.setTimeout !== 'function' || !scheduledAnchor) return false;
      const epoch = ++activeQueueSelectionStabilizeEpoch;
      for (const delay of [0, 100, 350, 900, 1500]) {
        win.setTimeout(async () => {
          if (epoch !== activeQueueSelectionStabilizeEpoch) return;
          const liveState = liveBulkAuthoriseState();
          const liveController = controllerFor(liveState);
          if (!liveController || !liveController.isLive()) return;
          if (!liveController.getRememberedQueueAnchor()) {
            liveController.rememberedQueueAnchor = clone(scheduledAnchor);
            const livePane = liveState.evidence_pane_state || (liveState.evidence_pane_state = {});
            livePane.__bulk_authorise_last_viewed_queue_anchor = clone(scheduledAnchor);
            liveState.__bulk_authorise_last_viewed_queue_anchor = clone(scheduledAnchor);
          }
          const pane = liveState.evidence_pane_state || {};
          if (trim(pane.active_tab).toLowerCase() !== 'queue' || pane.__queue_loaded !== true) return;
          const restored = liveController.restoreRememberedQueueSelection(`${reason}:${delay}`);
          const renderedQueueText = trim(doc?.getElementById?.('bulkAuthoriseWorkbenchRoot')?.textContent);
          const renderedQueueMatch = renderedQueueText.match(/Images in Queue\s+(\d+)\s*\/\s*(\d+)/i);
          const renderedQueueIndex = renderedQueueMatch ? Math.max(0, Number(renderedQueueMatch[1] || 1) - 1) : -1;
          if (!restored.changed && renderedQueueIndex === restored.index) return;
          try {
            if (typeof win.rerenderBulkAuthoriseWorkbench === 'function') {
              await win.rerenderBulkAuthoriseWorkbench(liveState, `[TS][BULK-AUTH][QUEUE-SELECTION-RESTORE:${reason}]`);
            } else if (typeof liveState.__rerenderWorkbench === 'function') {
              await liveState.__rerenderWorkbench({ reason: `bulk-authorise-queue-selection-restore-${reason}`, force: true });
            }
            const settledState = liveBulkAuthoriseState();
            const settledController = controllerFor(settledState);
            if (settledController?.isLive?.()) settledController.settle(`queue-selection-restore:${reason}`);
          } catch {}
        }, delay);
      }
      return true;
    }

    ensureQueueLoadedForBulkAuthorise(reason = 'queue-tab') {
      if (!this.isLive()) return Promise.resolve(false);
      const state = this.state;
      const pane = state.evidence_pane_state || (state.evidence_pane_state = {});
      if (trim(pane.active_tab).toLowerCase() !== 'queue') return Promise.resolve(false);
      if (pane.__queue_loaded === true) return Promise.resolve(true);
      if (this.queueRefreshFallbackPromise) return this.queueRefreshFallbackPromise;
      if (typeof win.refreshTimesheetImportsQueue !== 'function') return Promise.resolve(false);

      const queueScope = trim(pane.__queue_scope || pane.__queue_loaded_scope || 'global:QUEUED') || 'global:QUEUED';
      const ownerToken = trim(
        state.__bulk_authorise_modal_open_token ||
        state.__bulkAuthoriseModalOpenToken ||
        win.modalCtx?.__bulk_authorise_modal_open_token ||
        win.modalCtx?.__bulkAuthoriseModalOpenToken
      );
      const ownerIdentity = trim(
        state.__bulk_authorise_owner_identity ||
        state.__bulkAuthoriseOwnerIdentity ||
        win.modalCtx?.owner_identity ||
        win.modalCtx?.__bulk_authorise_owner_identity
      );
      const activeIdentity = rowIdentityOf(state);
      const previousRows = Array.isArray(pane.queue_rows) ? pane.queue_rows.filter(Boolean) : [];
      const previousId = trim(pane.active_queue_id || pane.active_queue_item?.id || pane.active_queue_item?.queue_id || pane.__remembered_queue_id);
      let previousIndex = previousRows.findIndex((item) => trim(item?.id || item?.queue_id) === previousId);
      if (previousIndex < 0) previousIndex = Math.max(0, Number(pane.__remembered_queue_index || 0) || 0);

      const work = (async () => {
        try {
          await win.refreshTimesheetImportsQueue(pane, {
            ownerState: state,
            owner_kind: 'bulk_authorise',
            owner_identity: ownerIdentity,
            modal_open_token: ownerToken,
            active_identity: activeIdentity,
            queue_scope: queueScope,
            status: trim(queueScope.split(':')[1] || 'QUEUED').toUpperCase() || 'QUEUED',
            preserve_last_viewed_queue: true,
            suppressWhileBusy: true,
            force: true,
            allowWithoutActiveIdentity: true,
            source: `bulk-authorise-evidence-controller:${trim(reason) || 'queue-tab'}`
          });
          if (!this.isLive() || state.evidence_pane_state !== pane) return false;
          const rows = Array.isArray(pane.queue_rows) ? pane.queue_rows : [];
          const active = rows.find((item) => trim(item?.id || item?.queue_id) === previousId)
            || rows[Math.min(previousIndex, Math.max(0, rows.length - 1))]
            || null;
          pane.active_queue_id = active ? (trim(active.id || active.queue_id) || null) : null;
          pane.active_queue_item = active ? clone(active) : null;
          pane.__remembered_queue_id = pane.active_queue_id;
          pane.__remembered_queue_index = active ? Math.max(0, rows.indexOf(active)) : 0;
          if (active) this.rememberQueueSelection(`queue-refresh:${reason}`);
          return pane.__queue_loaded === true;
        } catch (error) {
          if (this.isLive() && state.evidence_pane_state === pane) {
            pane.__queue_last_error = trim(error?.message || error || 'Failed to refresh queue.');
          }
          return false;
        }
      })();
      this.queueRefreshFallbackPromise = work.finally(() => {
        if (this.queueRefreshFallbackPromise === work || this.queueRefreshFallbackPromise) {
          this.queueRefreshFallbackPromise = null;
        }
      });
      return this.queueRefreshFallbackPromise;
    }

    scheduleQueueRefreshRender(reason = 'queue-tab') {
      if (typeof win.setTimeout !== 'function') return false;
      const epoch = ++this.queueRefreshRenderEpoch;
      this.queueRefreshRenderPending = true;
      let fallbackStarted = false;
      let completionRenderAttempts = 0;
      const debug = (phase, details = {}) => {
        win.__bulkAuthoriseQueueRenderDebug = {
          phase,
          reason: trim(reason) || 'queue-tab',
          epoch,
          ...details
        };
      };
      debug('scheduled');
      const check = async (attempt = 0) => {
        if (epoch !== this.queueRefreshRenderEpoch || !this.isLive()) {
          if (epoch === this.queueRefreshRenderEpoch) this.queueRefreshRenderPending = false;
          debug('cancelled', { attempt, live: this.isLive(), current_epoch: this.queueRefreshRenderEpoch });
          return false;
        }
        const pane = this.state.evidence_pane_state || {};
        if (trim(pane.active_tab).toLowerCase() !== 'queue') {
          if (attempt < 5) win.setTimeout(() => check(attempt + 1), 50);
          else this.queueRefreshRenderPending = false;
          debug('waiting-for-queue-tab', { attempt });
          return false;
        }
        const loaded = pane.__queue_loaded === true;
        const error = trim(pane.__queue_last_error || pane.queue_error || pane.__queue_error);
        if (!loaded && !error) {
          if (!fallbackStarted && attempt >= 2 && pane.__queue_loading !== true) {
            fallbackStarted = true;
            await this.ensureQueueLoadedForBulkAuthorise(reason);
            if (epoch !== this.queueRefreshRenderEpoch || !this.isLive()) return false;
          }
          if (attempt < 100) win.setTimeout(() => check(attempt + 1), 100);
          return false;
        }
        const root = doc.getElementById('bulkAuthoriseWorkbenchRoot');
        const renderedText = trim(root?.textContent);
        if (loaded && /Images in Queue\s+\d+\s*\/\s*\d+/i.test(renderedText)) {
          this.queueRefreshRenderPending = false;
          debug('complete', { attempt, completion_render_attempts: completionRenderAttempts });
          return true;
        }
        if (completionRenderAttempts < 5) {
          completionRenderAttempts += 1;
          const renderReason = `evidence-refresh-queue-loaded-${trim(reason) || 'queue-tab'}`;
          debug('rendering', { attempt, completion_render_attempts: completionRenderAttempts, has_state_renderer: typeof this.state.__rerenderWorkbench === 'function' });
          try {
            if (typeof this.state.__rerenderWorkbench === 'function') {
              await this.state.__rerenderWorkbench({ reason: renderReason, force: true });
            } else if (typeof win.rerenderBulkAuthoriseWorkbench === 'function') {
              await win.rerenderBulkAuthoriseWorkbench(this.state, `[TS][BULK-AUTH][EVIDENCE-REFRESH][QUEUE-LOADED:${reason}]`);
            }
          } catch (error) {
            debug('render-error', { attempt, completion_render_attempts: completionRenderAttempts, message: trim(error?.message || error) });
          }
          if (epoch === this.queueRefreshRenderEpoch && this.isLive()) this.settle(`queue-loaded:${reason}`);
        }
        if (epoch !== this.queueRefreshRenderEpoch || !this.isLive()) return false;
        const liveText = trim(doc.getElementById('bulkAuthoriseWorkbenchRoot')?.textContent);
        if (loaded && /Images in Queue\s+\d+\s*\/\s*\d+/i.test(liveText)) {
          this.queueRefreshRenderPending = false;
          debug('complete-after-render', { attempt, completion_render_attempts: completionRenderAttempts });
          return true;
        }
        debug('waiting-after-render', { attempt, completion_render_attempts: completionRenderAttempts, loaded });
        if (attempt < 100) win.setTimeout(() => check(attempt + 1), 100);
        else this.queueRefreshRenderPending = false;
        return false;
      };
      win.setTimeout(check, 0);
      return true;
    }

    async navigateQueue(delta) {
      if (!this.isLive()) return false;
      const pane = this.state.evidence_pane_state || (this.state.evidence_pane_state = {});
      if (trim(pane.active_tab).toLowerCase() !== 'queue') return false;
      if (pane.__queue_loaded !== true && pane.__queue_loading !== true) {
        await this.ensureQueueLoadedForBulkAuthorise('queue-navigation');
      }
      if (!this.isLive() || trim(pane.active_tab).toLowerCase() !== 'queue') return false;
      const rows = Array.isArray(pane.queue_rows) ? pane.queue_rows.filter(Boolean) : [];
      if (!rows.length) return false;
      const activeId = trim(pane.active_queue_id || pane.active_queue_item?.id || pane.active_queue_item?.queue_id);
      const activeFileKey = evidenceFileKeyOf(pane.active_queue_item);
      let index = rows.findIndex((item) => {
        const id = trim(item?.id || item?.queue_id);
        return !!(activeId && id === activeId && (!activeFileKey || evidenceFileKeyOf(item) === activeFileKey));
      });
      if (index < 0) index = rows.findIndex((item) => trim(item?.id || item?.queue_id) === activeId);
      if (index < 0) index = 0;
      const nextIndex = index + (Number(delta) < 0 ? -1 : 1);
      if (nextIndex < 0 || nextIndex >= rows.length) return false;
      const next = rows[nextIndex];
      const nextId = trim(next?.id || next?.queue_id);
      const nextFileKey = evidenceFileKeyOf(next);
      if (!nextId || !nextFileKey) return false;
      const target = `queue|${nextId}|${nextFileKey}`;
      pane.active_tab = 'queue';
      pane.__attached_manual_override = false;
      pane.__queue_manual_override = true;
      pane.__queue_manual_override_identity = '';
      pane.__queue_manual_override_scope = trim(pane.__queue_scope || pane.__queue_loaded_scope || 'global:QUEUED') || 'global:QUEUED';
      pane.active_queue_id = nextId;
      pane.active_queue_item = clone(next);
      pane.__remembered_queue_id = nextId;
      pane.__remembered_queue_index = nextIndex;
      this.rememberQueueSelection('queue-navigation');
      pane.active_pdf_page = 1;
      pane.__preview_target_key = target;
      pane.__preview_load_requested_target_key = target;
      pane.__preview_signed_url = '';
      pane.__preview_signed_url_error = '';
      pane.__preview_error = '';
      pane.__preview_loading = true;
      if (typeof this.state.__rerenderWorkbench === 'function') {
        await this.state.__rerenderWorkbench({ reason: 'bulk-authorise-queue-navigation', force: true });
      } else if (typeof win.rerenderBulkAuthoriseWorkbench === 'function') {
        await win.rerenderBulkAuthoriseWorkbench(this.state, '[TS][BULK-AUTH][QUEUE-NAVIGATION]');
      }
      this.settle('queue-navigation');
      return true;
    }

    stampQueueNavigationControls() {
      const pane = this.state?.evidence_pane_state || {};
      if (trim(pane.active_tab).toLowerCase() !== 'queue') return false;
      const rows = Array.isArray(pane.queue_rows) ? pane.queue_rows.filter(Boolean) : [];
      const activeId = trim(pane.active_queue_id || pane.active_queue_item?.id || pane.active_queue_item?.queue_id);
      const activeFileKey = evidenceFileKeyOf(pane.active_queue_item);
      let index = rows.findIndex((item) => {
        const id = trim(item?.id || item?.queue_id);
        return !!(activeId && id === activeId && (!activeFileKey || evidenceFileKeyOf(item) === activeFileKey));
      });
      if (index < 0) index = rows.findIndex((item) => trim(item?.id || item?.queue_id) === activeId);
      if (index < 0 && rows.length) {
        const restored = this.restoreRememberedQueueSelection('queue-control-stamp');
        if (restored.restored) {
          index = restored.index;
          if (restored.changed) this.scheduleQueueSelectionStabilization('queue-control-stamp');
        }
      }
      if (index < 0 && rows.length) {
        index = Math.min(Math.max(0, Number(pane.__remembered_queue_index || 0) || 0), rows.length - 1);
        const active = rows[index];
        pane.active_queue_id = trim(active?.id || active?.queue_id) || null;
        pane.active_queue_item = active ? clone(active) : null;
        pane.__remembered_queue_index = index;
        if (active) this.rememberQueueSelection('queue-control-default');
      }
      const previous = doc?.getElementById?.('bpQueuePrevBtn');
      const next = doc?.getElementById?.('bpQueueNextBtn');
      if (previous) previous.disabled = !(index > 0);
      if (next) next.disabled = !(index >= 0 && index < rows.length - 1);
      return index >= 0;
    }

    async removeEvidence(control) {
      try {
        const item = this.itemForRemoveControl(control);
        if (!item) throw new Error('The evidence item could not be identified. Refresh the row and try again.');
        const policy = await this.ensureMutationPolicy(false);
        if (!policy?.can_manage_evidence) throw new Error(policy?.message || 'Evidence cannot be changed for this row.');
        const identity = rowIdentityOf(this.state);
        const rows = this.rowsByIdentity.get(identity) || [];
        const kind = evidenceKindOf(item);
        const sameKindCount = rows.filter((row) => evidenceKindOf(row) === kind).length;
        const authorised = typeof policy.authorised === 'boolean'
          ? policy.authorised
          : isAuthorisedState(this.state);
        const realEvidenceId = persistedEvidenceIdOf(item);
        const synthetic = isSyntheticEvidence(item) || !realEvidenceId;

        if (authorised && sameKindCount <= 1) {
          const queue = this.displayedQueueItem();
          if (!queue) {
            await this.showInfo(SELECT_QUEUE_REPLACEMENT_MESSAGE, 'Select a replacement');
            return false;
          }
          const confirmed = await this.confirmReplacement();
          if (confirmed !== 'replace') return false;
          const disposition = await this.chooseDisposition(item);
          if (disposition === 'cancel') return false;
          await this.requestMutation({
            action: 'replace',
            evidence_id: realEvidenceId || null,
            old_storage_key: evidenceFileKeyOf(item),
            kind,
            synthetic,
            queue_id: queue.queue_id,
            expected_storage_key: queue.storage_key,
            disposition
          });
          if (typeof win.__toast === 'function') win.__toast('Evidence replaced');
          return true;
        }

        if (synthetic) throw new Error('This system Timesheet item can only be changed by replacing it on an authorised row.');
        const disposition = await this.chooseDisposition(item);
        if (disposition === 'cancel') return false;
        await this.requestMutation({
          action: 'remove',
          evidence_id: realEvidenceId,
          kind,
          disposition
        });
        if (typeof win.__toast === 'function') win.__toast(disposition === 'return_to_queue' ? 'Evidence returned to the timesheet queue' : 'Evidence permanently deleted');
        return true;
      } catch (error) {
        await this.showInfo(trim(error?.message) || 'The evidence change failed.', 'Evidence could not be changed');
        return false;
      }
    }

    async attachDisplayedQueueItem() {
      try {
        const queue = this.displayedQueueItem();
        if (!queue) {
          await this.showInfo('Please select an image from the queue to attach as evidence', 'Select an image');
          return false;
        }
        const select = doc?.getElementById?.('bpQueueKindSelect');
        const kind = evidenceKindOf({ kind: select?.value || this.state.evidence_pane_state?.pending_attach_kind });
        const identity = rowIdentityOf(this.state);
        const rows = this.rowsByIdentity.get(identity) || [];
        if (kind === 'TIMESHEET' && rows.some((item) => evidenceKindOf(item) === 'TIMESHEET')) {
          await this.showInfo('Timesheet evidence is already attached. Remove or replace it before attaching another Timesheet.', 'Timesheet already attached');
          return false;
        }
        await this.requestMutation({
          action: 'attach',
          queue_id: queue.queue_id,
          expected_storage_key: queue.storage_key,
          kind
        });
        if (typeof win.__toast === 'function') win.__toast('Queue file attached');
        return true;
      } catch (error) {
        await this.showInfo(trim(error?.message) || 'The queue image could not be attached.', 'Evidence could not be attached');
        return false;
      }
    }

    async uploadEvidence() {
      if (!doc || typeof doc.createElement !== 'function' || !doc.body) return false;
      const select = doc.getElementById('bpQueueKindSelect');
      const kind = evidenceKindOf({ kind: select?.value || this.state.evidence_pane_state?.pending_attach_kind });
      const identity = rowIdentityOf(this.state);
      const rows = this.rowsByIdentity.get(identity) || [];
      if (kind === 'TIMESHEET' && rows.some((item) => evidenceKindOf(item) === 'TIMESHEET')) {
        await this.showInfo('Timesheet evidence is already attached. Remove or replace it before uploading another Timesheet.', 'Timesheet already attached');
        return false;
      }
      const input = doc.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,image/png,image/jpeg';
      input.dataset.bulkAuthoriseEvidenceUploadInput = '1';
      input.style.cssText = 'position:fixed;left:-10000px;top:-10000px;';
      doc.body.appendChild(input);
      input.addEventListener('change', async () => {
        const file = input.files?.[0] || null;
        try { input.remove(); } catch {}
        if (!file) return;
        try {
          const contentType = trim(file.type) || 'application/octet-stream';
          const presignEndpoint = `${trim(win.BROKER_BASE_URL).replace(/\/$/, '')}/api/files/presign-upload`;
          const presignResponse = await win.authFetch(presignEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content_type: contentType, filename: file.name || 'evidence-file' })
          });
          const presignText = await presignResponse.text().catch(() => '');
          let presign = {};
          try { presign = presignText ? JSON.parse(presignText) : {}; } catch {}
          if (!presignResponse.ok || !trim(presign.upload_url) || !trim(presign.key)) {
            throw new Error(presign?.message || 'The evidence upload could not be prepared.');
          }
          const rawFetch = typeof win.fetch === 'function' ? win.fetch.bind(win) : null;
          if (!rawFetch) throw new Error('The evidence upload service is not available.');
          const uploadResponse = await rawFetch(presign.upload_url, {
            method: 'PUT', headers: { 'Content-Type': contentType }, body: file
          });
          if (!uploadResponse.ok) throw new Error('The evidence file could not be uploaded.');
          await this.requestMutation({
            action: 'add',
            kind,
            display_name: file.name || 'Evidence file',
            storage_key: presign.key
          });
          if (typeof win.__toast === 'function') win.__toast('Evidence uploaded');
        } catch (error) {
          await this.showInfo(trim(error?.message) || 'The evidence upload failed.', 'Evidence could not be uploaded');
        }
      }, { once: true });
      input.click();
      return true;
    }

    stampMutationControls() {
      if (!doc || !this.isTimesheets()) return;
      if (this.isRowTransitionHydrationPending()) return;
      const policy = this.mutationPolicyTimesheetId === timesheetIdOf(this.state) ? this.mutationPolicy : null;
      const allowed = policy?.can_manage_evidence === true && !this.mutationInFlight;
      const identity = rowIdentityOf(this.state);
      const rows = this.rowsByIdentity.get(identity) || [];
      const hasTimesheet = rows.some((item) => evidenceKindOf(item) === 'TIMESHEET');
      const root = doc.getElementById('bulkAuthoriseWorkbenchRoot');
      const thumbs = root?.querySelectorAll?.('[data-bp-preview-attached-thumb="1"]') || [];
      let index = 0;
      for (const thumb of thumbs) {
        const item = rows[index] || null;
        index += 1;
        if (!item) continue;
        let remove = thumb.querySelector?.('[data-bp-preview-attached-remove="1"]') || null;
        if (!remove && allowed) {
          remove = doc.createElement('span');
          remove.setAttribute('role', 'button');
          remove.setAttribute('tabindex', '0');
          remove.dataset.bpPreviewAttachedRemove = '1';
          remove.textContent = '✕';
          thumb.appendChild(remove);
        }
        if (!remove) continue;
        remove.hidden = !allowed;
        remove.setAttribute('aria-label', 'Remove or replace attached evidence');
        remove.setAttribute('title', 'Remove or replace attached evidence');
        remove.setAttribute('data-attached-id', evidenceIdOf(item));
        remove.setAttribute('data-evidence-id', persistedEvidenceIdOf(item));
        remove.setAttribute('data-storage-key', evidenceFileKeyOf(item));
        remove.setAttribute('data-file-key', evidenceFileKeyOf(item));
        remove.setAttribute('data-attached-selection-key', selectionKey(item));
        remove.setAttribute('data-kind', evidenceKindOf(item));
        remove.setAttribute('data-display-name', evidenceFilenameOf(item));
        remove.setAttribute('data-synthetic', isSyntheticEvidence(item) ? '1' : '0');
        remove.style.cssText = `position:absolute;top:3px;right:4px;display:${allowed ? 'inline-flex' : 'none'};align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;border:1px solid rgba(248,113,113,.65);background:rgba(127,29,29,.82);color:#fecaca;font-size:12px;font-weight:900;line-height:1;cursor:pointer;z-index:4;`;
        try { thumb.style.paddingRight = '28px'; } catch {}
      }

      const kindSelect = doc.getElementById('bpQueueKindSelect');
      if (kindSelect) {
        kindSelect.disabled = !allowed;
        for (const option of Array.from(kindSelect.options || [])) {
          if (upper(option.value) === 'TIMESHEET') {
            option.disabled = hasTimesheet || !allowed;
            option.title = hasTimesheet ? 'Timesheet evidence is already attached' : '';
          } else {
            option.disabled = !allowed;
          }
        }
        if (upper(kindSelect.value) === 'TIMESHEET' && hasTimesheet) {
          const fallback = Array.from(kindSelect.options || []).find((option) => !option.disabled);
          if (fallback) {
            kindSelect.value = fallback.value;
            if (this.state.evidence_pane_state) this.state.evidence_pane_state.pending_attach_kind = fallback.value;
          }
        }
      }
      const upload = doc.getElementById('bpUploadEvidenceBtn');
      if (upload) upload.disabled = !allowed;
      const attach = doc.getElementById('bpQueueAttachBtn');
      if (attach) {
        const queue = this.displayedQueueItem();
        const kind = evidenceKindOf({ kind: kindSelect?.value || this.state.evidence_pane_state?.pending_attach_kind });
        attach.disabled = !allowed || !queue || (kind === 'TIMESHEET' && hasTimesheet);
      }
      if (!policy && !this.mutationPolicyPromise) void this.ensureMutationPolicy(false);
    }

    datasetRows() {
      const dataset = this.state && this.state.dataset;
      if (!dataset || typeof dataset !== 'object') return [];
      const collections = [
        dataset.rows,
        dataset.processed_eligible_rows,
        dataset.authorised_eligible_rows,
        dataset.unauthorised_rows,
        dataset.processed_eligible,
        dataset.authorised_eligible
      ];
      const rows = [];
      const seen = new Set();
      for (const collection of collections) {
        if (!Array.isArray(collection)) continue;
        for (const row of collection) {
          if (!row || typeof row !== 'object' || seen.has(row)) continue;
          seen.add(row);
          rows.push(row);
        }
      }
      return rows;
    }

    captureDatasetTruth() {
      const dataset = this.state && this.state.dataset;
      if (dataset === this.datasetRef) return;
      for (const controller of this.badgeHydrationAbortControllers) {
        try { controller?.abort?.(); } catch {}
      }
      this.badgeHydrationAbortControllers = [];
      this.badgeHydrationEpoch += 1;
      this.badgeHydrationDatasetRef = null;
      this.badgeHydrationPromise = null;
      this.badgeHydrationRenderPromise = null;
      this.badgeHydrationRenderRequested = false;
      this.datasetRef = dataset || null;
      this.datasetBadgeTruth.clear();
      this.datasetInitialBadgeTruth.clear();
      this.datasetPendingBadgeIdentities.clear();
      for (const row of this.datasetRows()) {
        const key = rowKeyOf(row);
        if (!key) continue;
        const initial = {
          evidence_badges: clone(Array.isArray(row.evidence_badges) ? row.evidence_badges : []),
          has_any_evidence: row.has_any_evidence === true,
          attached_evidence_count: Number(row.attached_evidence_count || 0) || 0,
          artifact_hints: {
            primary_artifact_id: row.primary_artifact_id ?? null,
            primary_artifact_kind: row.primary_artifact_kind ?? null,
            primary_artifact_storage_key: row.primary_artifact_storage_key ?? null,
            manual_pdf_r2_key: row.manual_pdf_r2_key ?? null,
            manualPdfR2Key: row.manualPdfR2Key ?? null,
            uploaded_pdf_r2_key: row.uploaded_pdf_r2_key ?? null,
            uploadedPdfR2Key: row.uploadedPdfR2Key ?? null
          }
        };
        const verified = this.reusableVerifiedBadgeState(row);
        const current = verified || initial;
        row.__evidence_badges_verified = !!verified;
        this.datasetBadgeTruth.set(key, clone(current));
        this.datasetInitialBadgeTruth.set(key, clone(initial));
        if (verified) {
          row.evidence_badges = clone(verified.evidence_badges);
          row.has_any_evidence = verified.has_any_evidence === true;
          row.attached_evidence_count = Number(verified.attached_evidence_count || 0) || 0;
        }
      }
    }

    reusableVerifiedBadgeState(row) {
      const identity = rowKeyOf(row);
      const currentSignature = rowSignatureOf(row);
      const cached = identity ? this.verifiedBadgeTruth.get(identity) : null;
      if (!cached) return null;
      const cachedSignature = trim(cached.row_signature);
      if (!cachedSignature || !currentSignature || cachedSignature !== currentSignature) {
        if (identity) this.verifiedBadgeTruth.delete(identity);
        return null;
      }
      return clone(cached.badge_state || null);
    }

    rememberVerifiedBadgeState(identity, badgeState, row) {
      const key = trim(identity || rowKeyOf(row));
      const signature = rowSignatureOf(row);
      if (!key || !signature || !badgeState) return false;
      this.verifiedBadgeTruth.set(key, {
        row_signature: signature,
        badge_state: clone(badgeState)
      });
      return true;
    }

    writeDatasetBadgeState(identity, badgeState, options = {}) {
      if (!identity || !badgeState) return;
      const initial = this.datasetInitialBadgeTruth.get(identity) || null;
      for (const row of this.datasetRows()) {
        if (rowKeyOf(row) !== identity) continue;
        row.evidence_badges = clone(badgeState.evidence_badges);
        row.has_any_evidence = badgeState.has_any_evidence === true;
        row.attached_evidence_count = Number(badgeState.attached_evidence_count || 0) || 0;
        if (options.verified === true) row.__evidence_badges_verified = true;
        else if (options.verified === false) row.__evidence_badges_verified = false;
        if (options.pending === true) {
          row.primary_artifact_id = null;
          row.primary_artifact_kind = null;
          row.primary_artifact_storage_key = null;
          row.manual_pdf_r2_key = null;
          row.manualPdfR2Key = null;
          row.uploaded_pdf_r2_key = null;
          row.uploadedPdfR2Key = null;
        } else if (options.restoreArtifactHints === true && initial?.artifact_hints) {
          Object.assign(row, clone(initial.artifact_hints));
        }
      }
    }

    prepareDatasetBadgeHydration(rows) {
      for (const row of rows) {
        const identity = rowKeyOf(row);
        const timesheetId = trim(row?.current_timesheet_id || row?.timesheet_id || row?.requested_timesheet_id);
        if (!identity || !timesheetId) continue;
        this.datasetPendingBadgeIdentities.add(identity);
        const initial = this.datasetInitialBadgeTruth.get(identity) || null;
        if (initial) this.datasetBadgeTruth.set(identity, clone(initial));
      }
    }

    extractEvidencePayload(payload) {
      if (!payload || typeof payload !== 'object') return [];
      const sources = [payload.evidence, payload.details?.evidence, payload.state?.evidence].filter(Array.isArray);
      const rows = [];
      const seen = new Set();
      for (const source of sources) {
        for (const raw of source) {
          const item = normaliseEvidence(raw);
          if (!item) continue;
          const key = itemKey(item);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          rows.push(item);
        }
      }
      return filterNormalisedEvidenceRows(rows);
    }

    async hydrateDatasetBadgeRow(row, datasetRef, epoch) {
      const identity = rowKeyOf(row);
      const timesheetId = trim(row?.current_timesheet_id || row?.timesheet_id || row?.requested_timesheet_id);
      const brokerBaseUrl = trim(win.BROKER_BASE_URL).replace(/\/$/, '');
      if (!identity || !timesheetId || !brokerBaseUrl || typeof win.authFetch !== 'function') return false;

      const pairs = [
        ['row_key', identity],
        ['timesheet_id', timesheetId],
        ['current_timesheet_id', trim(row?.current_timesheet_id || row?.timesheet_id || timesheetId)],
        ['requested_timesheet_id', trim(row?.requested_timesheet_id || row?.timesheet_id || timesheetId)],
        ['expected_timesheet_id', trim(row?.expected_timesheet_id || row?.current_timesheet_id || row?.timesheet_id || timesheetId)],
        ['contract_week_id', trim(row?.contract_week_id)],
        ['profile', 'evidence'],
        ['context_profile', 'evidence'],
        ['include_evidence', 'true'],
        ['include_compare', 'false'],
        ['include_import_source_rows', 'false']
      ].filter(([, value]) => trim(value));
      const query = pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
      const endpoint = `${brokerBaseUrl}/api/timesheets/${encodeURIComponent(timesheetId)}/bulk-authorise-context?${query}`;
      const abortController = typeof win.AbortController === 'function' ? new win.AbortController() : null;
      let hydrationTimeout = 0;
      if (abortController) this.badgeHydrationAbortControllers.push(abortController);
      if (abortController && typeof win.setTimeout === 'function') {
        hydrationTimeout = win.setTimeout(() => {
          try { abortController.abort(); } catch {}
        }, 15000);
      }

      try {
        const response = await win.authFetch(endpoint, abortController ? { signal: abortController.signal } : undefined);
        const text = await response.text().catch(() => '');
        if (!response.ok) return false;
        const payload = text ? JSON.parse(text) : {};
        if (!payload || typeof payload !== 'object' || payload.ok === false || payload.soft_failure === true || payload.evidence_refresh_failed === true) return false;
        if (datasetRef !== this.datasetRef || epoch !== this.badgeHydrationEpoch) return false;

        const evidenceRows = this.extractEvidencePayload(payload);
        const badgeState = badgeStateFromPayload(payload, evidenceRows);
        this.datasetBadgeTruth.set(identity, clone(badgeState));
        // Cache against the canonical dataset row signature. Evidence-profile
        // context payloads can carry a different layer signature; keying the
        // cache to that signature causes a harmless shell rerender to discard
        // the successfully verified badge truth for the unchanged list row.
        this.rememberVerifiedBadgeState(identity, badgeState, row);
        this.datasetPendingBadgeIdentities.delete(identity);
        this.writeDatasetBadgeState(identity, badgeState, {
          restoreArtifactHints: evidenceRows.length > 0,
          verified: true
        });
        return true;
      } catch {
        return false;
      } finally {
        if (hydrationTimeout && typeof win.clearTimeout === 'function') {
          try { win.clearTimeout(hydrationTimeout); } catch {}
        }
        if (abortController) {
          this.badgeHydrationAbortControllers = this.badgeHydrationAbortControllers.filter((candidate) => candidate !== abortController);
        }
      }
    }

    scheduleDatasetBadgeHydrationRender(datasetRef, epoch, reason = 'row-settled') {
      if (datasetRef !== this.datasetRef || epoch !== this.badgeHydrationEpoch) return Promise.resolve(false);
      this.badgeHydrationRenderRequested = true;
      if (this.badgeHydrationRenderPromise) return this.badgeHydrationRenderPromise;

      const work = (async () => {
        let rendered = false;
        while (this.badgeHydrationRenderRequested && datasetRef === this.datasetRef && epoch === this.badgeHydrationEpoch) {
          this.badgeHydrationRenderRequested = false;
          await Promise.resolve();
          if (
            datasetRef !== this.datasetRef ||
            epoch !== this.badgeHydrationEpoch ||
            typeof win.rerenderBulkAuthoriseWorkbench !== 'function' ||
            !this.isLive()
          ) continue;
          await win.rerenderBulkAuthoriseWorkbench(this.state, `[TS][BULK-AUTH][EVIDENCE-BADGES:${reason}]`);
          rendered = true;
          if (datasetRef === this.datasetRef && epoch === this.badgeHydrationEpoch) {
            this.settle(`dataset-badge-hydration:${reason}`);
            const liveController = controllerFor(liveBulkAuthoriseState()) || this;
            liveController.stampVisibleRowBadges();
          }
        }
        return rendered;
      })();
      const renderPromise = work.finally(() => {
        if (this.badgeHydrationRenderPromise === renderPromise) this.badgeHydrationRenderPromise = null;
      });
      this.badgeHydrationRenderPromise = renderPromise;
      return renderPromise;
    }

    hydrateDatasetBadges() {
      if (!this.isTimesheets()) return Promise.resolve({ applied: false, reason: 'non-timesheets' });
      if (this.isRowTransitionHydrationPending()) return Promise.resolve({ applied: false, reason: 'row-transition-owned' });
      this.captureDatasetTruth();
      const datasetRef = this.datasetRef;
      if (!datasetRef) return Promise.resolve({ applied: false, reason: 'no-dataset' });
      if (this.badgeHydrationDatasetRef === datasetRef && this.badgeHydrationPromise) return this.badgeHydrationPromise;
      if (this.badgeHydrationDatasetRef === datasetRef && this.state.__bulk_authorise_badge_hydration_complete === true) {
        const currentRows = this.datasetRows().filter((row) => trim(row?.current_timesheet_id || row?.timesheet_id || row?.requested_timesheet_id));
        let allCurrentRowsVerified = currentRows.length > 0;
        for (const row of currentRows) {
          if (row.__evidence_badges_verified === true) continue;
          const identity = rowKeyOf(row);
          const verified = this.reusableVerifiedBadgeState(row);
          if (!verified) {
            allCurrentRowsVerified = false;
            break;
          }
          this.datasetBadgeTruth.set(identity, clone(verified));
          this.writeDatasetBadgeState(identity, verified, { restoreArtifactHints: true, verified: true });
        }
        if (allCurrentRowsVerified) return Promise.resolve({ applied: true, cached: true, reapplied: true });
      }

      const allRows = this.datasetRows().filter((row) => trim(row?.current_timesheet_id || row?.timesheet_id || row?.requested_timesheet_id));
      if (!allRows.length) return Promise.resolve({ applied: false, reason: 'no-timesheet-rows' });
      const rows = allRows.filter((row) => {
        const identity = rowKeyOf(row);
        const verified = this.reusableVerifiedBadgeState(row);
        if (!verified) {
          row.__evidence_badges_verified = false;
          return true;
        }
        this.datasetBadgeTruth.set(identity, clone(verified));
        this.writeDatasetBadgeState(identity, verified, { restoreArtifactHints: true, verified: true });
        return false;
      });
      if (!rows.length) {
        this.badgeHydrationDatasetRef = datasetRef;
        this.state.__bulk_authorise_badge_hydration_pending = false;
        this.state.__bulk_authorise_badge_hydration_complete = true;
        this.state.__bulk_authorise_badge_hydration_succeeded = 0;
        this.state.__bulk_authorise_badge_hydration_failed = 0;
        const settleCached = async () => {
          if (typeof win.rerenderBulkAuthoriseWorkbench === 'function' && this.isLive()) {
            await win.rerenderBulkAuthoriseWorkbench(this.state, '[TS][BULK-AUTH][EVIDENCE-BADGES:cached-complete]');
            this.stampVisibleRowBadges();
          }
          return { applied: true, cached: true, succeeded: 0, failed: 0 };
        };
        return settleCached();
      }
      const epoch = ++this.badgeHydrationEpoch;
      this.badgeHydrationDatasetRef = datasetRef;
      this.state.__bulk_authorise_badge_hydration_complete = false;
      this.state.__bulk_authorise_badge_hydration_pending = true;
      this.prepareDatasetBadgeHydration(rows);

      const work = (async () => {
        let cursor = 0;
        let succeeded = 0;
        let failed = 0;
        const worker = async () => {
          while (datasetRef === this.datasetRef && epoch === this.badgeHydrationEpoch) {
            const index = cursor;
            cursor += 1;
            if (index >= rows.length) return;
            const row = rows[index];
            const identity = rowKeyOf(row);
            const ok = await this.hydrateDatasetBadgeRow(row, datasetRef, epoch);
            if (datasetRef !== this.datasetRef || epoch !== this.badgeHydrationEpoch) return;
            if (ok) {
              succeeded += 1;
            } else {
              failed += 1;
              const initial = clone(this.datasetInitialBadgeTruth.get(identity) || null);
              if (initial) {
                this.datasetBadgeTruth.set(identity, clone(initial));
                this.writeDatasetBadgeState(identity, initial, { restoreArtifactHints: true, verified: false });
              }
              this.datasetPendingBadgeIdentities.delete(identity);
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(2, rows.length) }, () => worker()));
        if (datasetRef !== this.datasetRef || epoch !== this.badgeHydrationEpoch) return { applied: false, stale: true };

        this.state.__bulk_authorise_badge_hydration_pending = false;
        this.state.__bulk_authorise_badge_hydration_complete = true;
        this.state.__bulk_authorise_badge_hydration_succeeded = succeeded;
        this.state.__bulk_authorise_badge_hydration_failed = failed;
        await this.scheduleDatasetBadgeHydrationRender(datasetRef, epoch, 'complete');
        return { applied: true, succeeded, failed };
      })();
      this.badgeHydrationPromise = work.finally(() => {
        if (datasetRef === this.badgeHydrationDatasetRef) this.badgeHydrationPromise = null;
      });
      return this.badgeHydrationPromise;
    }

    authoritativeEvidence() {
      const state = this.state;
      const context = state.active_context && typeof state.active_context === 'object' ? state.active_context : {};
      const details = state.active_details && typeof state.active_details === 'object' ? state.active_details : {};
      const activeCtx = state.active_ctx && typeof state.active_ctx === 'object' ? state.active_ctx : {};
      const sources = [
        context.evidence,
        context.details?.evidence,
        details.evidence,
        activeCtx.state?.evidence,
        activeCtx.evidence,
        activeCtx.details?.evidence
      ].filter(Array.isArray);
      const profile = trim(
        context.context_profile || context.profile || context.details?.context_profile ||
        details.context_profile || details.profile || activeCtx.context_profile || activeCtx.profile
      ).toLowerCase();
      const authoritative = !!(
        context.evidence_loaded === true || context.details?.evidence_loaded === true ||
        details.evidence_loaded === true || activeCtx.evidence_loaded === true ||
        activeCtx.state?.evidence_loaded === true || profile === 'evidence' || profile === 'full' ||
        sources.some((source) => source.length > 0)
      );
      if (!authoritative) return { authoritative: false, rows: [] };

      const rows = [];
      const seen = new Set();
      for (const source of sources) {
        for (const raw of source) {
          const item = normaliseEvidence(raw);
          if (!item) continue;
          const key = itemKey(item);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          rows.push(item);
        }
      }
      return { authoritative: true, rows: filterNormalisedEvidenceRows(rows) };
    }

    clearFalseTimesheetFallback(rows) {
      const state = this.state;
      const primaryKind = upper(
        state.active_row?.primary_artifact_kind ||
        state.active_context?.row?.primary_artifact_kind ||
        state.active_context?.data_row?.primary_artifact_kind
      );
      const primaryStorage = cleanFileKey(
        state.active_row?.primary_artifact_storage_key ||
        state.active_context?.row?.primary_artifact_storage_key ||
        state.active_context?.data_row?.primary_artifact_storage_key
      );
      if (!primaryStorage || primaryKind === 'TIMESHEET') return;
      const genuineTimesheetUsesPrimary = rows.some((item) => evidenceKindOf(item) === 'TIMESHEET' && evidenceFileKeyOf(item) === primaryStorage);
      if (genuineTimesheetUsesPrimary) return;

      const containers = [
        state.active_row,
        state.active_context,
        state.active_context?.row,
        state.active_context?.data_row,
        state.active_context?.details,
        state.active_context?.details?.timesheet,
        state.active_details,
        state.active_details?.timesheet,
        state.active_ctx,
        state.active_ctx?.row,
        state.active_ctx?.details,
        state.active_ctx?.details?.timesheet,
        state.active_ctx?.state,
        state.active_ctx?.state?.timesheet
      ];
      for (const container of containers) {
        if (!container || typeof container !== 'object') continue;
        if (cleanFileKey(container.manual_pdf_r2_key) === primaryStorage) container.manual_pdf_r2_key = null;
        if (cleanFileKey(container.manualPdfR2Key) === primaryStorage) container.manualPdfR2Key = null;
      }
    }

    applyEvidenceBadges(rows, authoritative) {
      const state = this.state;
      const identity = rowIdentityOf(state);
      if (!identity || !state.active_row) return;

      let badgeState = null;
      if (authoritative) {
        badgeState = {
          evidence_badges: buildBadges(rows),
          has_any_evidence: rows.length > 0,
          attached_evidence_count: rows.length
        };
        this.datasetBadgeTruth.set(identity, clone(badgeState));
        this.rememberVerifiedBadgeState(identity, badgeState, state.active_row);
      } else {
        badgeState = clone(this.datasetBadgeTruth.get(identity) || null);
      }
      if (!badgeState) return;

      const targets = [state.active_row, state.active_context?.row, state.active_context?.data_row];
      for (const row of this.datasetRows()) {
        if (rowKeyOf(row) === identity) targets.push(row);
      }
      for (const target of targets) {
        if (!target || typeof target !== 'object') continue;
        target.evidence_badges = clone(badgeState.evidence_badges);
        target.has_any_evidence = badgeState.has_any_evidence === true;
        target.attached_evidence_count = Number(badgeState.attached_evidence_count || 0) || 0;
      }
    }

    applyAttachedRows(rows, authoritative) {
      const state = this.state;
      const identity = rowIdentityOf(state);
      if (!identity || !authoritative) return false;
      const pane = state.evidence_pane_state && typeof state.evidence_pane_state === 'object'
        ? state.evidence_pane_state
        : (state.evidence_pane_state = {});
      this.rowsByIdentity.set(identity, rows.map(clone));

      const previousItemKey = itemKey(pane.active_attached_item);
      const rememberedKey = this.selectedByIdentity.get(identity) || '';
      const activeItem = rows.find((item) => itemKey(item) === previousItemKey)
        || rows.find((item) => itemKey(item) === rememberedKey)
        || rows[0]
        || null;
      const activeItemKey = itemKey(activeItem);
      if (activeItemKey) this.selectedByIdentity.set(identity, activeItemKey);
      else this.selectedByIdentity.delete(identity);

      pane.attached_rows = rows.map(clone);
      pane.attached_all_rows = rows.map(clone);
      pane.active_attached_item = activeItem ? clone(activeItem) : null;
      pane.active_attached_id = activeItem ? evidenceIdOf(activeItem) : null;
      pane.__bulk_authorise_evidence_identity = identity;
      pane.__evidence_loaded = true;
      pane.__attached_loaded = true;

      const activeTab = trim(pane.active_tab || 'attached').toLowerCase() === 'queue' ? 'queue' : 'attached';
      if (activeTab === 'attached') {
        pane.active_tab = 'attached';
        pane.__queue_manual_override = false;
        const nextSelection = selectionKey(activeItem);
        const currentTarget = trim(pane.__preview_target_key);
        const sameTarget = !!(nextSelection && currentTarget === nextSelection);
        const sameSelection = !!(sameTarget && trim(pane.__preview_signed_url));
        const sameTerminalError = !!(sameTarget && trim(pane.__preview_error));
        const sameInFlightRequest = !!(
          sameTarget &&
          pane.__preview_loading === true &&
          [pane.__preview_load_requested_target_key, pane.__preview_attached_request_key]
            .some((value) => trim(value) === nextSelection)
        );
        if (!sameTarget) {
          pane.__preview_signed_url = '';
          pane.__preview_signed_url_error = '';
          pane.__preview_signed_url_stored_at_ms = 0;
          pane.__preview_signed_url_expires_at_ms = 0;
          pane.__preview_error = '';
        }
        pane.__preview_target_key = nextSelection;
        pane.__preview_load_requested_target_key = (sameSelection || sameInFlightRequest) ? nextSelection : '';
        pane.__active_attached_preview_target = nextSelection;
        pane.__preview_attached_request_key = (sameSelection || sameInFlightRequest) ? nextSelection : '';
        pane.__preview_loading = !!nextSelection && !sameSelection && !sameTerminalError;
      }

      win.modalCtx = win.modalCtx && typeof win.modalCtx === 'object' ? win.modalCtx : {};
      win.modalCtx.timesheetState = win.modalCtx.timesheetState && typeof win.modalCtx.timesheetState === 'object'
        ? win.modalCtx.timesheetState
        : {};
      win.modalCtx.timesheetState.evidence = rows.map(clone);
      return true;
    }

    sanitize(reason = 'sanitize') {
      if (!this.isTimesheets()) return { applied: false, reason: 'non-timesheets' };
      this.captureDatasetTruth();
      const evidence = this.authoritativeEvidence();
      const identity = rowIdentityOf(this.state);
      const rows = evidence.authoritative
        ? evidence.rows
        : (this.rowsByIdentity.get(identity) || []);
      // Bulk Authorise can inherit the shared preview owner's last active item
      // while the newly selected row's evidence context is still loading.  Do
      // not let that row-external item participate in the shared renderer: it
      // can create a synthetic thumbnail, trigger another shell render and
      // repeatedly supersede the dataset-wide badge verification.  Once this
      // row has authoritative evidence (or a row-owned cache), applyAttachedRows
      // below installs the canonical selection normally.
      if (!evidence.authoritative && rows.length === 0) {
        const pane = this.state.evidence_pane_state && typeof this.state.evidence_pane_state === 'object'
          ? this.state.evidence_pane_state
          : (this.state.evidence_pane_state = {});
        pane.attached_rows = [];
        pane.attached_all_rows = [];
        pane.active_attached_id = null;
        pane.active_attached_item = null;
        if (trim(pane.active_tab || 'attached').toLowerCase() === 'attached') {
          pane.__preview_target_key = '';
          pane.__preview_load_requested_target_key = '';
          pane.__preview_attached_request_key = '';
          pane.__active_attached_preview_target = '';
          pane.__preview_signed_url = '';
          pane.__preview_error = '';
          pane.__preview_loading = false;
        }
      }
      this.clearFalseTimesheetFallback(rows);
      this.applyEvidenceBadges(rows, evidence.authoritative);
      const applied = this.applyAttachedRows(rows, evidence.authoritative);
      this.state.__bulk_authorise_evidence_controller = 'v19';
      this.state.__bulk_authorise_evidence_controller_reason = reason;
      return { applied, authoritative: evidence.authoritative, rows: rows.map(clone) };
    }

    installStateBoundary() {
      const current = this.state && this.state.__runPostRenderBindings;
      if (typeof current !== 'function') return;
      if (current.__bulkAuthoriseEvidencePostRenderBoundary === true) {
        this.boundPostRenderBindings = current;
        return;
      }
      this.basePostRenderBindings = current;
      const controller = this;
      this.boundPostRenderBindings = async function bulkAuthoriseEvidencePostRenderBoundary(...args) {
        controller.sanitize('before-post-render-bindings');
        const result = await controller.basePostRenderBindings.apply(this, args);
        controller.sanitize('after-post-render-bindings');
        controller.stamp();
        const pane = controller.state && controller.state.evidence_pane_state ? controller.state.evidence_pane_state : {};
        if (trim(pane.active_tab).toLowerCase() === 'attached') {
          controller.scheduleTerminalGuard(rowIdentityOf(controller.state), selectionKey(pane.active_attached_item));
        }
        return result;
      };
      Object.defineProperty(this.boundPostRenderBindings, '__bulkAuthoriseEvidencePostRenderBoundary', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      });
      this.state.__runPostRenderBindings = this.boundPostRenderBindings;
    }

    settle(reason = 'settle') {
      this.installStateBoundary();
      this.sanitize(reason);
      this.stamp();
      const pane = this.state && this.state.evidence_pane_state ? this.state.evidence_pane_state : {};
      if (trim(pane.active_tab).toLowerCase() === 'attached') {
        this.scheduleTerminalGuard(rowIdentityOf(this.state), selectionKey(pane.active_attached_item));
      }
    }

    stampVisibleRowBadges() {
      if (!doc || typeof doc.querySelectorAll !== 'function' || typeof doc.createElement !== 'function' || !this.isTimesheets()) return false;
      this.captureDatasetTruth();
      const rowsByIdentity = new Map();
      for (const row of this.datasetRows()) {
        const identity = rowKeyOf(row);
        if (identity && !rowsByIdentity.has(identity)) rowsByIdentity.set(identity, row);
      }
      let changed = false;
      const labels = {
        TIMESHEET: 'Timesheet',
        MILEAGE: 'Mileage',
        TRAVEL: 'Travel',
        ACCOMMODATION: 'Accommodation',
        OTHER: 'Other',
        EVIDENCE: 'EVIDENCE'
      };
      const order = ['TIMESHEET', 'MILEAGE', 'TRAVEL', 'ACCOMMODATION', 'OTHER', 'EVIDENCE'];
      const rowElements = doc.querySelectorAll('#bulkAuthoriseWorkbenchRoot [data-bulk-authorise-row="1"][data-row-key]');
      for (const rowElement of rowElements) {
        const identity = trim(rowElement?.getAttribute?.('data-row-key'));
        const row = rowsByIdentity.get(identity) || null;
        if (!row) continue;
        // A shell rerender can replace the row objects after the hydration
        // wrapper's pre-render pass. Reapply only signature-matched verified
        // truth at the final DOM boundary so the fresh row cannot suppress a
        // badge that was already confirmed by the evidence context request.
        if (row.__evidence_badges_verified !== true) {
          const verified = this.reusableVerifiedBadgeState(row);
          if (verified) {
            this.datasetBadgeTruth.set(identity, clone(verified));
            this.writeDatasetBadgeState(identity, verified, { restoreArtifactHints: true, verified: true });
          }
        }
        const badgeTruthReady = this.state.__bulk_authorise_badge_hydration_complete === true
          && row.__evidence_badges_verified === true;
        const truth = badgeTruthReady ? badgeStateFromPayload(row, []) : null;
        const positive = new Set(positiveBadgeKinds(truth?.evidence_badges));
        if (!positive.size && truth?.has_any_evidence === true && Number(truth?.attached_evidence_count || 0) > 0) positive.add('EVIDENCE');
        const desiredKinds = order.filter((kind) => positive.has(kind));
        const existingBadges = Array.from(rowElement.querySelectorAll?.('.bulk-timesheet-evidence-badge') || []);
        const existingKinds = existingBadges.map((badge) => upper(badge?.getAttribute?.('data-evidence-kind'))).filter(Boolean);
        if (desiredKinds.length === existingKinds.length && desiredKinds.every((kind, index) => kind === existingKinds[index])) continue;

        let wrapper = rowElement.querySelector?.('[data-bulk-authorise-evidence-badges="1"]') || existingBadges[0]?.parentElement || null;
        if (!desiredKinds.length) {
          if (wrapper && existingBadges.length) {
            try { wrapper.remove(); changed = true; } catch {}
          }
          continue;
        }
        if (!wrapper) {
          const grid = rowElement.firstElementChild;
          const contentColumn = grid?.children?.[1] || null;
          if (!contentColumn) continue;
          wrapper = doc.createElement('div');
          wrapper.className = 'mini';
          wrapper.setAttribute('data-bulk-authorise-evidence-badges', '1');
          wrapper.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:1px;';
          contentColumn.appendChild(wrapper);
        } else {
          wrapper.setAttribute('data-bulk-authorise-evidence-badges', '1');
        }
        const badges = desiredKinds.map((kind) => {
          const badge = doc.createElement('span');
          badge.className = `bulk-timesheet-evidence-badge${kind === 'TIMESHEET' ? ' bulk-timesheet-evidence-badge--timesheet' : ''}`;
          badge.setAttribute('data-evidence-kind', kind);
          badge.setAttribute('title', `${labels[kind]} evidence attached`);
          badge.textContent = labels[kind];
          badge.style.cssText = 'display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,0.16);border-radius:999px;padding:1px 6px;font-size:9px;font-weight:700;letter-spacing:.02em;background:rgba(255,255,255,0.045);color:rgba(255,255,255,0.9);line-height:1.45;';
          return badge;
        });
        try {
          wrapper.replaceChildren(...badges);
          changed = true;
        } catch {}
      }
      return changed;
    }

    stamp() {
      const root = doc && doc.getElementById('bulkAuthoriseWorkbenchRoot');
      if (!root) return;
      const liveController = controllerFor(liveBulkAuthoriseState()) || this;
      root.dataset.bulkAuthoriseEvidenceController = 'v19';
      if (liveController.isTimesheets()) {
        if (liveController.isRowTransitionHydrationPending()) {
          liveController.stampVisibleRowBadges();
          return;
        }
        liveController.sanitize('stamp-live-boundary');
        liveController.stampVisibleRowBadges();
        liveController.renderAttachedSelection();
        liveController.stampMutationControls();
        liveController.stampQueueNavigationControls();
        liveController.schedulePostRenderSettle();
        void liveController.ensureAttachedPreview(false);
      }
      if (typeof win.MutationObserver === 'function' && root.__bulkAuthoriseEvidenceObserver == null) {
        const observerOptions = { childList: true, subtree: true };
        const observer = new win.MutationObserver(() => {
          if (root.__bulkAuthoriseEvidenceObserverPending === true) return;
          root.__bulkAuthoriseEvidenceObserverPending = true;
          win.setTimeout(() => {
            root.__bulkAuthoriseEvidenceObserverPending = false;
            if (doc.getElementById('bulkAuthoriseWorkbenchRoot') !== root) return;
            const currentState = liveBulkAuthoriseState();
            const currentController = controllerFor(currentState);
            if (!currentController || !currentController.isLive()) return;

            // The settle work can update the same subtree (thumbnail controls,
            // filename text, and preview contents). Disconnecting while it runs
            // prevents those intentional updates from recursively scheduling the
            // observer and starving the modal's render promise.
            try { observer.disconnect(); } catch {}
            try {
              const pane = currentState.evidence_pane_state || {};
              currentController.stampVisibleRowBadges();
              currentController.renderAttachedSelection();
              currentController.stampMutationControls();
              if (trim(pane.active_tab).toLowerCase() !== 'attached') return;
              currentController.sanitize('modal-dom-settle');
              const stage = doc.getElementById('bulkProcessPreviewStage');
              if (trim(pane.__preview_signed_url)) {
                if (stage && /loading/i.test(trim(stage.textContent))) {
                  currentController.renderResolvedPreview(pane.active_attached_item, trim(pane.__preview_signed_url));
                }
              } else if (!trim(pane.__preview_error) && !currentController.previewRequestPromise) {
                void currentController.ensureAttachedPreview(false);
              }
            } finally {
              if (currentController.isLive() && doc.getElementById('bulkAuthoriseWorkbenchRoot') === root) {
                try { observer.observe(root, observerOptions); } catch {}
              }
            }
          }, 0);
        });
        root.__bulkAuthoriseEvidenceObserver = observer;
        observer.observe(root, observerOptions);
      }
      if (root.__bulkAuthoriseEvidenceController === this) return;
      root.__bulkAuthoriseEvidenceController = this;
      root.addEventListener('click', (event) => {
        const target = event.target;
        if (!target || typeof target.closest !== 'function' || !this.isTimesheets()) return;
        const retry = target.closest('[data-bulk-authorise-preview-retry="1"]');
        if (retry) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void this.retryAttached();
          return;
        }
        const thumbnail = target.closest('[data-bp-preview-attached-thumb="1"]');
        if (thumbnail && !target.closest('[data-bp-preview-attached-remove="1"]')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void this.selectFromButton(thumbnail);
          return;
        }
        if (target.closest('#bulkProcessEvidenceTabQueue')) {
          this.rememberAttachedSelection();
          this.scheduleQueueRefreshRender('queue-tab-click');
          return;
        }
        if (target.closest('#bulkProcessEvidenceTabAttached')) {
          this.rememberAttachedSelection();
          this.sanitize('return-attached-tab');
        }
      }, true);
    }

    rememberAttachedSelection() {
      const identity = rowIdentityOf(this.state);
      const pane = this.state.evidence_pane_state || {};
      const key = itemKey(pane.active_attached_item);
      if (identity && key) this.selectedByIdentity.set(identity, key);
    }

    selectAttached(item, reason = 'thumbnail') {
      const state = this.state;
      const identity = rowIdentityOf(state);
      const normalised = normaliseEvidence(item);
      if (!identity || !normalised) return Promise.resolve(false);
      const rows = this.rowsByIdentity.get(identity) || [];
      const chosen = rows.find((row) => itemKey(row) === itemKey(normalised)) || normalised;
      const pane = state.evidence_pane_state && typeof state.evidence_pane_state === 'object'
        ? state.evidence_pane_state
        : (state.evidence_pane_state = {});
      const target = selectionKey(chosen);
      this.selectedByIdentity.set(identity, itemKey(chosen));
      this.selectionEpoch += 1;
      this.pendingGuardKey = '';
      this.lastPointerSelectionKey = target;
      pane.active_tab = 'attached';
      pane.__attached_manual_override = true;
      pane.__queue_manual_override = false;
      pane.active_attached_id = evidenceIdOf(chosen);
      pane.active_attached_item = clone(chosen);
      pane.active_attached_pdf_page = 1;
      pane.__active_attached_preview_target = target;
      pane.__preview_target_key = target;
      pane.__preview_load_requested_target_key = '';
      pane.__preview_attached_request_key = '';
      pane.__preview_signed_url = '';
      pane.__preview_signed_url_error = '';
      pane.__preview_signed_url_stored_at_ms = 0;
      pane.__preview_signed_url_expires_at_ms = 0;
      pane.__preview_loading = true;
      pane.__preview_error = '';
      pane.__bulk_authorise_evidence_selection_epoch = this.selectionEpoch;

      this.sanitize(`select-attached:${reason}`);
      this.renderAttachedSelection();
      this.stamp();
      return this.ensureAttachedPreview(true).then(() => true);
    }

    selectFromButton(button) {
      const identity = rowIdentityOf(this.state);
      const rows = this.rowsByIdentity.get(identity) || [];
      const requestedSelection = trim(button.getAttribute('data-attached-selection-key'));
      const requestedId = trim(button.getAttribute('data-attached-id'));
      const requestedFile = cleanFileKey(button.getAttribute('data-file-key') || button.getAttribute('data-storage-key'));
      let item = rows.find((row) => selectionKey(row) === requestedSelection) || null;
      if (!item && (requestedId || requestedFile)) {
        item = rows.find((row) => (
          (!requestedId || evidenceIdOf(row) === requestedId) &&
          (!requestedFile || evidenceFileKeyOf(row) === requestedFile)
        )) || null;
      }
      if (!item && doc) {
        const buttons = Array.from(doc.querySelectorAll('#bulkAuthoriseWorkbenchRoot [data-bp-preview-attached-thumb="1"]'));
        const index = buttons.indexOf(button);
        if (index >= 0) item = rows[index] || null;
      }
      return item ? this.selectAttached(item, 'thumbnail') : Promise.resolve(false);
    }

    retryAttached() {
      const identity = rowIdentityOf(this.state);
      const rows = this.rowsByIdentity.get(identity) || [];
      const selected = this.selectedByIdentity.get(identity) || '';
      const item = rows.find((row) => itemKey(row) === selected) || rows[0] || null;
      return item ? this.selectAttached(item, 'retry') : Promise.resolve(false);
    }

    navigateAttached(delta) {
      const pane = this.state.evidence_pane_state || {};
      if (trim(pane.active_tab).toLowerCase() !== 'attached') return Promise.resolve(false);
      const identity = rowIdentityOf(this.state);
      const rows = this.rowsByIdentity.get(identity) || [];
      const activeKey = itemKey(pane.active_attached_item) || this.selectedByIdentity.get(identity) || '';
      const index = rows.findIndex((row) => itemKey(row) === activeKey);
      const nextIndex = index + Number(delta || 0);
      const next = index >= 0 && nextIndex >= 0 && nextIndex < rows.length ? rows[nextIndex] : null;
      return next ? this.selectAttached(next, 'navigation') : Promise.resolve(false);
    }

    renderAttachedSelection() {
      if (!doc || typeof doc.querySelectorAll !== 'function') return;
      const pane = this.state.evidence_pane_state || {};
      const active = selectionKey(pane.active_attached_item);
      const buttons = doc.querySelectorAll('#bulkAuthoriseWorkbenchRoot [data-bp-preview-attached-thumb="1"]');
      const identity = rowIdentityOf(this.state);
      const rows = this.rowsByIdentity.get(identity) || [];
      let index = 0;
      for (const button of buttons) {
        const item = rows[index] || null;
        index += 1;
        const buttonSelection = selectionKey(item) || trim(button.getAttribute('data-attached-selection-key'));
        if (item) {
          try { button.setAttribute('data-attached-selection-key', buttonSelection); } catch {}
          try { button.setAttribute('data-file-key', evidenceFileKeyOf(item)); } catch {}
          try { button.setAttribute('data-storage-key', evidenceFileKeyOf(item)); } catch {}
        }
        const selected = !!buttonSelection && buttonSelection === active;
        if (button.__bulkAuthoriseEvidencePointerBound !== true) {
          button.__bulkAuthoriseEvidencePointerBound = true;
          button.addEventListener('pointerdown', (event) => {
            if (event?.target?.closest?.('[data-bp-preview-attached-remove="1"]')) return;
            const currentState = liveBulkAuthoriseState();
            const currentController = controllerFor(currentState);
            if (!currentController || !currentController.isTimesheets()) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            void currentController.selectFromButton(button);
          }, true);
        }
        try { button.setAttribute('aria-pressed', selected ? 'true' : 'false'); } catch {}
        try { button.setAttribute('aria-selected', selected ? 'true' : 'false'); } catch {}
        try { button.classList.toggle('is-active', selected); } catch {}
        try { button.classList.toggle('active', selected); } catch {}
        try { button.classList.toggle('selected', selected); } catch {}
        try { button.style.border = selected ? '2px solid var(--accent,#6ea8fe)' : '1px solid var(--line)'; } catch {}
        try { button.style.background = selected ? 'rgba(110,168,254,0.12)' : 'var(--panel,#0f1115)'; } catch {}
      }
      const root = doc.getElementById('bulkAuthoriseWorkbenchRoot');
      const canQueryRoot = root && typeof root.querySelectorAll === 'function';
      for (const [buttonId, delta] of [['bpQueuePrevBtn', -1], ['bpQueueNextBtn', 1]]) {
        const navButton = doc.getElementById(buttonId);
        if (!navButton || navButton.__bulkAuthoriseAttachedNavigationBound === true) continue;
        navButton.__bulkAuthoriseAttachedNavigationBound = true;
        navButton.addEventListener('click', (event) => {
          const currentState = liveBulkAuthoriseState();
          const currentController = controllerFor(currentState);
          const currentPane = currentState && currentState.evidence_pane_state ? currentState.evidence_pane_state : {};
          const queueTab = doc.getElementById('bulkProcessEvidenceTabQueue');
          const queueIsVisiblySelected = !!(
            queueTab && (
              trim(queueTab.getAttribute?.('aria-selected')).toLowerCase() === 'true' ||
              queueTab.classList?.contains?.('is-active') ||
              queueTab.classList?.contains?.('active')
            )
          );
          if (
            queueIsVisiblySelected ||
            !currentController ||
            !currentController.isTimesheets() ||
            trim(currentPane.active_tab).toLowerCase() !== 'attached'
          ) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          void currentController.navigateAttached(delta);
        }, true);
      }
      for (const queueTab of (canQueryRoot ? root.querySelectorAll('[id="bulkProcessEvidenceTabQueue"]') : [])) {
        if (queueTab.__bulkAuthoriseEvidencePointerBound !== true) {
          queueTab.__bulkAuthoriseEvidencePointerBound = true;
          queueTab.addEventListener('pointerdown', () => {
            const currentState = liveBulkAuthoriseState();
            const currentController = controllerFor(currentState);
            if (currentController && currentController.isTimesheets()) currentController.rememberAttachedSelection();
          }, true);
        }
      }
      for (const attachedTab of (canQueryRoot ? root.querySelectorAll('[id="bulkProcessEvidenceTabAttached"]') : [])) {
        if (attachedTab.__bulkAuthoriseEvidencePointerBound !== true) {
          attachedTab.__bulkAuthoriseEvidencePointerBound = true;
          attachedTab.addEventListener('pointerdown', () => {
            const currentState = liveBulkAuthoriseState();
            const currentController = controllerFor(currentState);
            if (!currentController || !currentController.isTimesheets()) return;
            currentController.rememberAttachedSelection();
            currentController.scheduleAttachedReturn();
          }, true);
        }
      }
      if (trim(pane.active_tab).toLowerCase() === 'attached') this.syncPreviewMetadata(pane.active_attached_item);
    }

    syncPreviewMetadata(item) {
      if (!doc || !this.isTimesheets()) return false;
      const root = doc.getElementById('bulkAuthoriseWorkbenchRoot');
      const label = root?.querySelector?.('#bulkProcessPreviewLabel');
      if (!label) return false;
      const filename = evidenceFilenameOf(item);
      if (!filename) return false;
      if (trim(label.textContent) !== filename) label.textContent = filename;
      if (trim(label.getAttribute?.('title')) !== filename) label.setAttribute('title', filename);
      return true;
    }

    renderPreviewLoading() {
      const stage = doc && doc.getElementById('bulkProcessPreviewStage');
      if (!stage || typeof doc.createElement !== 'function') return;
      const holder = doc.createElement('div');
      holder.style.cssText = 'min-height:220px;display:flex;align-items:center;justify-content:center;text-align:center;';
      const message = doc.createElement('div');
      message.className = 'mini';
      message.textContent = 'Preview is loading…';
      holder.appendChild(message);
      stage.replaceChildren(holder);
    }

    renderPreviewError(message = 'The preview could not be prepared.') {
      const stage = doc && doc.getElementById('bulkProcessPreviewStage');
      if (!stage || typeof doc.createElement !== 'function') return;
      const holder = doc.createElement('div');
      holder.style.cssText = 'min-height:220px;display:flex;align-items:center;justify-content:center;text-align:center;';
      const inner = doc.createElement('div');
      const copy = doc.createElement('div');
      copy.className = 'mini';
      copy.style.opacity = '.85';
      copy.textContent = message;
      const retry = doc.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-outline';
      retry.dataset.bulkAuthorisePreviewRetry = '1';
      retry.style.marginTop = '8px';
      retry.textContent = 'Retry preview';
      retry.addEventListener('pointerdown', (event) => {
        const currentState = liveBulkAuthoriseState();
        const currentController = controllerFor(currentState);
        if (!currentController || !currentController.isTimesheets()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void currentController.retryAttached();
      }, true);
      inner.append(copy, retry);
      holder.appendChild(inner);
      stage.replaceChildren(holder);
    }

    renderResolvedPreview(item, signedUrl) {
      const stage = doc && doc.getElementById('bulkProcessPreviewStage');
      if (!stage || typeof doc.createElement !== 'function' || !trim(signedUrl)) return false;
      this.syncPreviewMetadata(item);
      const fileKey = evidenceFileKeyOf(item);
      const mime = trim(item && (item.mime_type || item.content_type)).toLowerCase();
      const isPdf = mime.includes('pdf') || /\.pdf(?:$|[?#])/i.test(fileKey);
      stage.replaceChildren();
      if (isPdf) {
        const frame = doc.createElement('iframe');
        frame.id = 'bulkProcessPdfPreviewFrame';
        frame.title = trim(item && (item.display_name || item.filename)) || 'Evidence preview';
        frame.src = `${signedUrl}#page=1&zoom=page-width`;
        frame.style.cssText = 'width:100%;min-height:460px;border:0;background:#fff;';
        stage.appendChild(frame);
      } else {
        const image = doc.createElement('img');
        image.id = 'bulkProcessImagePreviewEl';
        image.alt = trim(item && (item.display_name || item.filename)) || 'Evidence preview';
        image.src = signedUrl;
        image.style.cssText = 'display:block;max-width:100%;max-height:640px;margin:0 auto;object-fit:contain;';
        stage.appendChild(image);
      }
      return true;
    }

    ensureAttachedPreview(force = false) {
      if (!this.isLive()) return Promise.resolve(false);
      if (this.isRowTransitionHydrationPending()) return Promise.resolve(false);
      const state = this.state;
      const pane = state.evidence_pane_state || {};
      if (trim(pane.active_tab || 'attached').toLowerCase() !== 'attached') return Promise.resolve(false);
      const identity = rowIdentityOf(state);
      const rows = this.rowsByIdentity.get(identity) || [];
      const remembered = this.selectedByIdentity.get(identity) || '';
      const item = rows.find((row) => itemKey(row) === remembered)
        || rows.find((row) => itemKey(row) === itemKey(pane.active_attached_item))
        || rows[0]
        || null;
      const target = selectionKey(item);
      const fileKey = evidenceFileKeyOf(item);
      if (!identity || !target || !fileKey) return Promise.resolve(false);
      this.syncPreviewMetadata(item);
      const requestKey = `${identity}|${target}`;
      const sharedInflight = (pane.__preview_presign_inflight && typeof pane.__preview_presign_inflight === 'object')
        ? Object.values(pane.__preview_presign_inflight).find((record) => !!(
            record &&
            typeof record === 'object' &&
            record.promise &&
            trim(record.file_key) === fileKey &&
            (!trim(record.preview_selection_key) || trim(record.preview_selection_key) === target)
          ))
        : null;
      if (!force && sharedInflight?.promise) {
        this.previewRequestKey = requestKey;
        const sharedWork = Promise.resolve(sharedInflight.promise)
          .then((sharedSignedUrl) => {
            if (!this.isLive() || rowIdentityOf(state) !== identity) return false;
            const livePane = state.evidence_pane_state || {};
            if (trim(livePane.active_tab).toLowerCase() !== 'attached') return false;
            const signedUrl = trim(livePane.__preview_signed_url || sharedSignedUrl);
            if (!signedUrl) return false;
            livePane.__preview_target_key = target;
            livePane.__preview_signed_url = signedUrl;
            livePane.__preview_loading = false;
            livePane.__preview_error = '';
            return this.renderResolvedPreview(item, signedUrl);
          })
          .catch(() => false)
          .finally(() => {
            if (this.previewRequestKey === requestKey) {
              this.previewRequestKey = '';
              this.previewRequestPromise = null;
            }
          });
        this.previewRequestPromise = sharedWork;
        return sharedWork;
      }
      const sharedRequestTarget = trim(pane.__preview_load_requested_target_key || pane.__preview_attached_request_key);
      if (!force && pane.__preview_loading === true && sharedRequestTarget === target && !this.previewRequestPromise) {
        this.scheduleTerminalGuard(identity, target);
        return Promise.resolve(false);
      }
      if (!force && trim(pane.__preview_target_key) === target && trim(pane.__preview_error)) {
        pane.__preview_loading = false;
        return Promise.resolve(false);
      }
      if (!force && trim(pane.__preview_target_key) === target && trim(pane.__preview_signed_url)) {
        const stage = doc && doc.getElementById('bulkProcessPreviewStage');
        const resolved = stage && stage.querySelector('#bulkProcessImagePreviewEl, #bulkProcessPdfPreviewFrame');
        if (!resolved || /loading/i.test(trim(stage.textContent))) {
          this.renderResolvedPreview(item, trim(pane.__preview_signed_url));
        }
        return Promise.resolve(true);
      }
      if (!force && this.previewRequestKey === requestKey && this.previewRequestPromise) return this.previewRequestPromise;
      try { this.previewAbortController?.abort?.(); } catch {}
      const abortController = typeof win.AbortController === 'function' ? new win.AbortController() : null;
      this.previewAbortController = abortController;
      this.previewRequestKey = requestKey;
      pane.active_attached_id = evidenceIdOf(item);
      pane.active_attached_item = clone(item);
      pane.__preview_target_key = target;
      pane.__active_attached_preview_target = target;
      pane.__preview_load_requested_target_key = target;
      pane.__preview_attached_request_key = target;
      pane.__preview_signed_url = '';
      pane.__preview_loading = true;
      pane.__preview_error = '';
      this.renderPreviewLoading();

      const authFetch = win.authFetch;
      const brokerBaseUrl = trim(win.BROKER_BASE_URL).replace(/\/$/, '');
      const endpoint = brokerBaseUrl ? `${brokerBaseUrl}/api/files/presign-download` : '';
      if (typeof authFetch !== 'function' || !endpoint) {
        this.scheduleTerminalGuard(identity, target);
        this.previewRequestKey = '';
        return Promise.resolve(false);
      }
      const body = {
        key: fileKey,
        owner_kind: 'bulk_authorise',
        owner_identity: trim(state.__bulkAuthoriseRecordIdentity || identity) || null,
        row_key: trim(state.active_row_key || state.active_row?.row_key) || null,
        row_change_seq: Number(state.__bulk_authorise_row_change_seq || 0) || null,
        active_tab: 'attached',
        selection_key: target,
        file_key: fileKey,
        item_id: evidenceIdOf(item) || null
      };
      const work = (async () => {
        try {
          const response = await authFetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            ...(abortController ? { signal: abortController.signal } : {})
          });
          const text = await response.text().catch(() => '');
          if (!response.ok) throw new Error('The preview request failed.');
          const payload = text ? JSON.parse(text) : {};
          const signedUrl = trim(payload.signed_url || payload.url || payload.download_url);
          if (!signedUrl) throw new Error('The preview request returned no file URL.');
          let commitController = this;
          let commitPane = state.evidence_pane_state || {};
          let commitItem = item;
          const guard = {
            live: this.isLive(),
            same_identity: rowIdentityOf(state) === identity,
            attached_tab: trim(commitPane.active_tab).toLowerCase() === 'attached',
            same_target: trim(commitPane.__preview_target_key) === target
          };
          if (!guard.live || !guard.same_identity || !guard.attached_tab || !guard.same_target) {
            const successorState = liveBulkAuthoriseState();
            const successorController = controllerFor(successorState);
            const successorPane = successorState?.evidence_pane_state || {};
            const successorGuard = {
              live: !!successorController?.isLive?.(),
              same_identity: rowIdentityOf(successorState) === identity,
              attached_tab: trim(successorPane.active_tab).toLowerCase() === 'attached',
              same_target: trim(successorPane.__preview_target_key) === target
            };
            if (!successorGuard.live || !successorGuard.same_identity || !successorGuard.attached_tab || !successorGuard.same_target) {
              return false;
            }
            const successorRows = successorController.rowsByIdentity.get(identity) || [];
            commitController = successorController;
            commitPane = successorPane;
            commitItem = successorRows.find((row) => selectionKey(row) === target)
              || successorPane.active_attached_item
              || item;
          }
          commitPane.__preview_signed_url = signedUrl;
          commitPane.__preview_signed_url_stored_at_ms = Date.now();
          commitPane.__preview_loading = false;
          commitPane.__preview_error = '';
          commitPane.__preview_signed_url_error = '';
          commitController.pendingGuardKey = '';
          const rendered = commitController.renderResolvedPreview(commitItem, signedUrl);
          return rendered;
        } catch (error) {
          if (abortController?.signal?.aborted) return false;
          const livePane = state.evidence_pane_state || {};
          if (this.isLive() && rowIdentityOf(state) === identity && trim(livePane.__preview_target_key) === target) {
            livePane.__preview_loading = false;
            livePane.__preview_error = 'The preview could not be prepared.';
            livePane.__preview_signed_url_error = 'The preview could not be prepared.';
            this.renderPreviewError();
          }
          return false;
        } finally {
          if (this.previewRequestKey === requestKey) {
            this.previewRequestKey = '';
            this.previewRequestPromise = null;
          }
        }
      })();
      this.previewRequestPromise = work;
      return work;
    }

    schedulePostRenderSettle() {
      if (typeof win.setTimeout !== 'function') return;
      const epoch = ++this.postRenderSettleEpoch;
      for (const delay of [0, 250, 1000]) {
        win.setTimeout(() => {
          if (epoch !== this.postRenderSettleEpoch || !this.isLive()) return;
          this.sanitize(`post-render-settle:${delay}`);
          this.renderAttachedSelection();
          const pane = this.state.evidence_pane_state || {};
          const stage = doc.getElementById('bulkProcessPreviewStage');
          if (trim(pane.active_tab).toLowerCase() !== 'attached') return;
          if (trim(pane.__preview_signed_url) && stage && /loading/i.test(trim(stage.textContent))) {
            this.renderResolvedPreview(pane.active_attached_item, trim(pane.__preview_signed_url));
          } else if (!trim(pane.__preview_signed_url) && !this.previewRequestPromise) {
            void this.ensureAttachedPreview(false);
          }
        }, delay);
      }
    }

    scheduleAttachedReturn() {
      if (typeof win.setTimeout !== 'function') return;
      for (const delay of [0, 100, 500]) {
        win.setTimeout(() => {
          if (!this.isLive()) return;
          const pane = this.state.evidence_pane_state || {};
          if (trim(pane.active_tab).toLowerCase() !== 'attached') return;
          this.sanitize(`return-attached-settle:${delay}`);
          this.renderAttachedSelection();
          void this.ensureAttachedPreview(false);
        }, delay);
      }
    }

    scheduleTerminalGuard(identity, target) {
      if (!identity || !target) return;
      const guardKey = `${identity}|${target}`;
      if (this.pendingGuardKey === guardKey) return;
      this.pendingGuardKey = guardKey;
      const epoch = ++this.guardEpoch;
      if (typeof win.setTimeout !== 'function') return;
      win.setTimeout(() => {
        if (epoch !== this.guardEpoch || !this.isLive()) { if (this.pendingGuardKey === guardKey) this.pendingGuardKey = ''; return; }
        const pane = this.state.evidence_pane_state || {};
        if (rowIdentityOf(this.state) !== identity || trim(pane.active_tab).toLowerCase() !== 'attached') { if (this.pendingGuardKey === guardKey) this.pendingGuardKey = ''; return; }
        if (trim(pane.__preview_target_key) !== target || trim(pane.__preview_signed_url)) { if (this.pendingGuardKey === guardKey) this.pendingGuardKey = ''; return; }
        const stage = doc.getElementById('bulkProcessPreviewStage');
        if (!stage || !/loading/i.test(trim(stage.textContent))) { if (this.pendingGuardKey === guardKey) this.pendingGuardKey = ''; return; }
        pane.__preview_loading = false;
        pane.__preview_error = 'The preview could not be prepared.';
        pane.__preview_signed_url_error = 'The preview could not be prepared.';
        stage.innerHTML = '<div style="min-height:220px;display:flex;align-items:center;justify-content:center;text-align:center;"><div><div class="mini" style="opacity:.85;">The preview could not be prepared.</div><button type="button" class="btn btn-outline" data-bulk-authorise-preview-retry="1" style="margin-top:8px;">Retry preview</button></div></div>';
        if (this.pendingGuardKey === guardKey) this.pendingGuardKey = '';
      }, 10000);
    }
  }

  const controllerFor = (state) => {
    if (!state || typeof state !== 'object') return null;
    let controller = controllers.get(state);
    if (!controller) {
      controller = new BulkAuthoriseEvidenceController(state);
      controllers.set(state, controller);
    }
    return controller;
  };

  if (typeof legacy.open === 'function') {
    win.openBulkAuthoriseWorkbench = async function openBulkAuthoriseWorkbenchWithEvidenceController(...args) {
      verifiedBadgeTruthForOpenModal.clear();
      clearSharedMutationPolicy();
      const state = await legacy.open.apply(this, args);
      if (state && typeof state === 'object') activeBulkAuthoriseState = state;
      const controller = controllerFor(state);
      if (controller) {
        controller.settle('after-open');
        const hydration = controller.hydrateDatasetBadges();
        const datasetRef = controller.datasetRef;
        const epoch = controller.badgeHydrationEpoch;
        void Promise.resolve(hydration)
          .then(() => controller.scheduleDatasetBadgeHydrationRender(datasetRef, epoch, 'after-open-complete'))
          .catch(() => false);
      }
      return state;
    };
  }

  if (typeof legacy.renderShell === 'function') {
    win.renderBulkAuthoriseShell = function renderBulkAuthoriseShellWithEvidenceController(state, ...args) {
      if (state && typeof state === 'object' && doc?.getElementById?.('bulkAuthoriseWorkbenchRoot')) {
        activeBulkAuthoriseState = state;
      }
      const controller = controllerFor(state);
      if (controller) {
        controller.installStateBoundary();
        controller.sanitize('before-shell-render');
        void controller.hydrateDatasetBadges();
      }
      return legacy.renderShell.call(this, state, ...args);
    };
  }

  if (typeof legacy.refreshContext === 'function') {
    win.refreshBulkAuthoriseActiveContext = async function refreshBulkAuthoriseContextWithEvidenceController(state, ...args) {
      const result = await legacy.refreshContext.call(this, state, ...args);
      const controller = controllerFor(state);
      if (controller) {
        controller.installStateBoundary();
        controller.sanitize('after-context-refresh');
      }
      return result;
    };
  }

  if (typeof legacy.reconcileEvidence === 'function') {
    win.reconcileBulkProcessEvidenceStateAfterContextRefresh = function reconcileEvidenceWithBulkAuthoriseIsolation(state, ...args) {
      const result = legacy.reconcileEvidence.call(this, state, ...args);
      if (state && liveBulkAuthoriseState() === state && classificationOf(state) === 'TIMESHEETS') {
        const controller = controllerFor(state);
        if (controller) controller.sanitize('after-legacy-reconcile');
      }
      return result;
    };
  }

  if (typeof legacy.bindEvidence === 'function') {
    win.bindBulkAuthoriseEvidencePane = async function bindBulkAuthoriseEvidenceWithController(state, ...args) {
      const controller = controllerFor(state);
      if (controller) controller.sanitize('before-evidence-bind');
      const result = await legacy.bindEvidence.call(this, state, ...args);
      if (controller) controller.sanitize('after-evidence-bind');
      return result;
    };
  }

  if (typeof legacy.bindPreview === 'function') {
    win.bindBulkAuthorisePreviewPane = async function bindBulkAuthorisePreviewWithEvidenceController(state, ...args) {
      const controller = controllerFor(state);
      if (controller?.isRowTransitionHydrationPending()) return false;
      if (controller) controller.sanitize('before-preview-bind');
      const result = await legacy.bindPreview.call(this, state, ...args);
      if (controller) {
        controller.sanitize('after-preview-bind');
        controller.stamp();
        const pane = state && state.evidence_pane_state ? state.evidence_pane_state : {};
        if (trim(pane.active_tab).toLowerCase() === 'attached') {
          controller.scheduleTerminalGuard(rowIdentityOf(state), selectionKey(pane.active_attached_item));
        }
      }
      return result;
    };
  }

  const handleMutationControlEvent = (event, controller) => {
    const target = event?.target;
    if (!target || typeof target.closest !== 'function' || !controller) return false;
    const remove = target.closest('[data-bp-preview-attached-remove="1"]');
    const attach = target.closest('#bpQueueAttachBtn');
    const upload = target.closest('#bpUploadEvidenceBtn');
    const control = remove || attach || upload;
    if (!control) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const now = Date.now();
    if (
      event.type === 'click' &&
      controller.lastMutationPointerControl === control &&
      now - controller.lastMutationPointerAt < 1500
    ) {
      controller.lastMutationPointerControl = null;
      controller.lastMutationPointerAt = 0;
      return true;
    }
    if (event.type === 'pointerdown') {
      controller.lastMutationPointerControl = control;
      controller.lastMutationPointerAt = now;
    }
    if (remove) void controller.removeEvidence(remove);
    else if (attach) void controller.attachDisplayedQueueItem();
    else if (upload) void controller.uploadEvidence();
    return true;
  };

  const deferMutationControlEvent = (event, controller) => {
    const target = event?.target;
    if (!target || typeof target.closest !== 'function' || !controller) return false;
    const remove = target.closest('[data-bp-preview-attached-remove="1"]');
    const attach = target.closest('#bpQueueAttachBtn');
    const upload = target.closest('#bpUploadEvidenceBtn');
    const control = remove || attach || upload;
    if (!control) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const epoch = ++controller.deferredMutationEpoch;
    controller.deferredMutationControl = control;
    win.setTimeout(() => {
      if (controller.deferredMutationEpoch !== epoch || controller.deferredMutationControl !== control) return;
      controller.deferredMutationControl = null;
      if (remove) void controller.removeEvidence(remove);
      else if (attach) void controller.attachDisplayedQueueItem();
      else if (upload) void controller.uploadEvidence();
    }, 0);
    return true;
  };

  const handleWindowCapture = (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    const root = target.closest('#bulkAuthoriseWorkbenchRoot');
    const state = liveBulkAuthoriseState();
    const controller = controllerFor(state);
    if (!root || !controller || !controller.isTimesheets()) return;
    const queueNext = target.closest('#bpQueueNextBtn');
    const queuePrevious = target.closest('#bpQueuePrevBtn');
    const queueTab = doc?.getElementById?.('bulkProcessEvidenceTabQueue');
    const queueIsVisiblySelected = !!(
      queueTab && (
        trim(queueTab.getAttribute?.('aria-selected')).toLowerCase() === 'true' ||
        queueTab.classList?.contains?.('is-active') ||
        queueTab.classList?.contains?.('active')
      )
    );
    if ((queueNext || queuePrevious) && (
      trim(state?.evidence_pane_state?.active_tab).toLowerCase() === 'queue' ||
      queueIsVisiblySelected
    )) {
      if (event.type === 'click') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const pane = state.evidence_pane_state || (state.evidence_pane_state = {});
        pane.active_tab = 'queue';
        void controller.navigateQueue(queuePrevious ? -1 : 1);
      }
      return;
    }
    const mutationControl = target.closest('[data-bp-preview-attached-remove="1"],#bpQueueAttachBtn,#bpUploadEvidenceBtn');
    if (mutationControl) {
      if (target.closest('#bpQueueAttachBtn') && queueIsVisiblySelected) {
        const pane = state.evidence_pane_state || (state.evidence_pane_state = {});
        pane.active_tab = 'queue';
      }
      if (event.type === 'pointerup') deferMutationControlEvent(event, controller);
      else if (event.type === 'click' && controller.deferredMutationControl === mutationControl) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else if (event.type === 'click') handleMutationControlEvent(event, controller);
      return;
    }
    if (event.type !== 'pointerdown') return;
    const retry = target.closest('[data-bulk-authorise-preview-retry="1"]');
    const thumbnail = target.closest('[data-bp-preview-attached-thumb="1"]');
    if (target.closest('#bulkProcessEvidenceTabQueue')) {
      if (trim(state?.evidence_pane_state?.active_tab).toLowerCase() === 'queue') {
        controller.rememberQueueSelection('queue-tab-pointerdown');
      }
      controller.rememberAttachedSelection();
      controller.scheduleQueueSelectionStabilization('queue-tab-pointerdown');
      return;
    }
    if (target.closest('#bulkProcessEvidenceTabAttached')) {
      if (trim(state?.evidence_pane_state?.active_tab).toLowerCase() === 'queue') {
        controller.rememberQueueSelection('attached-tab-pointerdown');
      }
      controller.rememberAttachedSelection();
      controller.scheduleAttachedReturn();
      return;
    }
    if (!retry && (!thumbnail || target.closest('[data-bp-preview-attached-remove="1"]'))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (retry) void controller.retryAttached();
    else void controller.selectFromButton(thumbnail);
  };
  if (typeof win.addEventListener === 'function') {
    win.addEventListener('pointerdown', handleWindowCapture, true);
    win.addEventListener('pointerup', handleWindowCapture, true);
    win.addEventListener('click', handleWindowCapture, true);
  }

  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      const root = target.closest('#bulkAuthoriseWorkbenchRoot');
      const state = liveBulkAuthoriseState();
      const controller = controllerFor(state);
      if (!root || !controller || !controller.isTimesheets()) return;
      if (target.closest('[data-bp-preview-attached-remove="1"]')) handleMutationControlEvent(event, controller);
    }, true);
    doc.addEventListener('click', (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      const root = target.closest('#bulkAuthoriseWorkbenchRoot');
      const state = liveBulkAuthoriseState();
      const controller = controllerFor(state);
      if (!root || !controller || !controller.isTimesheets()) return;

      if (handleMutationControlEvent(event, controller)) return;

      const retry = target.closest('[data-bulk-authorise-preview-retry="1"]');
      if (retry) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void controller.retryAttached();
        return;
      }

      const thumbnail = target.closest('[data-bp-preview-attached-thumb="1"]');
      if (thumbnail && !target.closest('[data-bp-preview-attached-remove="1"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void controller.selectFromButton(thumbnail);
        return;
      }

      if (target.closest('#bulkProcessEvidenceTabQueue')) {
        if (trim(state?.evidence_pane_state?.active_tab).toLowerCase() === 'queue') {
          controller.rememberQueueSelection('queue-tab-click');
        }
        controller.rememberAttachedSelection();
        controller.scheduleQueueRefreshRender('document-queue-tab-click');
        controller.scheduleQueueSelectionStabilization('document-queue-tab-click');
        return;
      }
      if (target.closest('#bulkProcessEvidenceTabAttached')) {
        if (trim(state?.evidence_pane_state?.active_tab).toLowerCase() === 'queue') {
          controller.rememberQueueSelection('attached-tab-click');
        }
        controller.rememberAttachedSelection();
        controller.sanitize('return-attached-tab');
      }
    }, true);
  }

  if (typeof win.setInterval === 'function' && !win.__bulkAuthoriseEvidenceWatchdog) {
    win.__bulkAuthoriseEvidenceWatchdog = win.setInterval(() => {
      const root = doc && doc.getElementById('bulkAuthoriseWorkbenchRoot');
      const state = liveBulkAuthoriseState();
      if (!root || !state || classificationOf(state) !== 'TIMESHEETS') return;
      const controller = controllerFor(state);
      if (!controller || !controller.isLive()) return;
      const pane = state.evidence_pane_state || {};
      controller.stampVisibleRowBadges();
      controller.stampMutationControls();
      if (trim(pane.active_tab).toLowerCase() === 'queue') {
        controller.stampQueueNavigationControls();
        const renderedText = trim(root.textContent);
        const queueError = trim(pane.__queue_last_error || pane.queue_error || pane.__queue_error);
        const visiblyComplete = pane.__queue_loaded === true && /Images in Queue\s+\d+\s*\/\s*\d+/i.test(renderedText);
        if (!visiblyComplete && !queueError && controller.queueRefreshRenderPending !== true) {
          controller.scheduleQueueRefreshRender('current-controller-watchdog');
        }
        return;
      }
      controller.renderAttachedSelection();
      if (trim(pane.active_tab).toLowerCase() !== 'attached') return;
      controller.sanitize('lifecycle-watchdog');
      void controller.ensureAttachedPreview(false);
    }, 500);
  }

  win.__bulkAuthoriseEvidenceControllerTest = {
    controllerFor,
    normaliseEvidence,
    filterNormalisedEvidenceRows,
    itemKey,
    selectionKey,
    timesheetIdOf,
    isAuthorisedState,
    SELECT_QUEUE_REPLACEMENT_MESSAGE,
    positiveBadgeKinds,
    badgeStateFromPayload,
    legacy
  };
})(window);

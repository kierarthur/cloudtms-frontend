(() => {
  'use strict';
  const STATES = Object.freeze(['IDLE', 'CHECKING_FRESHNESS', 'PREFLIGHTING', 'SHOWING_DECISION', 'SHOWING_WARNING', 'COLLECTING_REASON', 'CONFIRMING', 'APPLYING_RESULT', 'SUCCEEDED', 'STALE', 'CONFLICT', 'FAILED', 'CANCELLED']);
  const OFFICE_FRONTEND_FORBIDDEN_ACTIONS = new Set([
    ...(window.CloudTMSCandidateOfficeUiPolicy?.MANAGER_JOURNEY_ACTIONS || []),
    ...(window.CloudTMSCandidateOfficeUiPolicy?.CANDIDATE_APP_ACTIONS || []),
    ...(window.CloudTMSCandidateOfficeUiPolicy?.EVIDENCE_TAB_ACTIONS || []),
    ...(window.CloudTMSCandidateOfficeUiPolicy?.OFFICE_HIDDEN_ACTIONS || [])
  ]);
  const TERMINAL_STATES = new Set(['IDLE', 'SUCCEEDED', 'STALE', 'CONFLICT', 'FAILED', 'CANCELLED']);
  function createCandidateOfficeActionController(deps = {}) {
    const api = deps.api || window.CloudTMSCandidateOfficeApi;
    const modals = deps.modals || window.CloudTMSCandidateOfficeModals;
    const normalizeError = error => window.CloudTMSCandidateOfficeContract.normalizeCandidateOfficeError(error);
    const active = new Map();
    const operationKeys = new Map();
    const setState = (key, state) => { if (!STATES.includes(state)) throw new Error(`Invalid Candidate action state: ${state}`); active.set(key, { ...(active.get(key) || {}), state }); deps.onStateChange?.(key, state); };
    const isBusy = key => !TERMINAL_STATES.has(active.get(key)?.state || 'IDLE');
    const keyOf = input => {
      const rowKey = input.identity?.row_key || input.projection?.current_identity?.row_key || 'row';
      const actionCode = input.action?.code || input.action || 'action';
      return `${input.surface || 'OFFICE'}:${rowKey}:${String(actionCode).toUpperCase()}`;
    };
    const idempotency = () => (deps.createIdempotencyKey || (() => crypto.randomUUID()))();
    const operationFingerprint = value => {
      if (Array.isArray(value)) return `[${value.map(operationFingerprint).join(',')}]`;
      if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(name => `${JSON.stringify(name)}:${operationFingerprint(value[name])}`).join(',')}}`;
      return JSON.stringify(value);
    };
    const operationKeyFor = (key, factualRequest) => {
      const fingerprint = operationFingerprint(factualRequest);
      const existing = operationKeys.get(key);
      if (existing?.uncertain) {
        if (existing.fingerprint !== fingerprint) {
          throw Object.assign(new Error('The previous Candidate action has an unknown result. Refresh and retry the exact action before changing its inputs.'), { code: 'CANDIDATE_IDEMPOTENCY_CONFLICT' });
        }
        return existing.idempotencyKey;
      }
      const idempotencyKey = idempotency();
      operationKeys.set(key, { idempotencyKey, fingerprint, uncertain: false });
      return idempotencyKey;
    };
    const finishOperation = key => operationKeys.delete(key);
    const classifyOperationFailure = (key, error) => {
      const attempt = operationKeys.get(key);
      if (!attempt) return;
      const status = Number(error?.status || error?.payload?.status || 0) || 0;
      const code = String(error?.code || error?.payload?.error_code || '').toUpperCase();
      if (!status || status >= 500 || ['CANDIDATE_OFFICE_NETWORK_ERROR', 'CANDIDATE_OFFICE_TRANSPORT_UNAVAILABLE'].includes(code)) {
        operationKeys.set(key, { ...attempt, uncertain: true });
      } else {
        finishOperation(key);
      }
    };
    const reconcile = async (result, context) => {
      deps.invalidateProjection?.(context);
      if (Array.isArray(result?.affected_rows) && result.affected_rows.length) await deps.applyRowPatch?.(result.affected_rows, context);
      const refetch = result?.refresh_hints?.refetch;
      if (refetch === 'AFFECTED_ROWS') await deps.refreshAffectedRows?.(result, context);
      else if (refetch && refetch !== 'NONE') await deps.refetchProjection?.(context);
      else await deps.refetchProjection?.(context);
    };
    const preflight = async (context, key) => {
      setState(key, 'CHECKING_FRESHNESS');
      if (context.dirtyGuard) {
        const clean = await deps.runDirtyGuard?.(context);
        if (clean === false) throw Object.assign(new Error('Save or discard the current edits before performing this Candidate action.'), { code: 'CANDIDATE_OFFICE_DIRTY' });
      }
      const fresh = await deps.ensureFresh?.(context);
      if (fresh === false) throw Object.assign(new Error('This timesheet has changed.'), { code: 'CANDIDATE_CONTEXT_STALE' });
      if (fresh?.projection) context.projection = fresh.projection;
      if (fresh?.action) context.action = fresh.action;
      setState(key, 'PREFLIGHTING');
    };
    const handleFailure = async (error, context, key) => {
      classifyOperationFailure(key, error);
      const normalized = normalizeError(error);
      setState(key, normalized.code === 'CANDIDATE_IDEMPOTENCY_CONFLICT' ? 'CONFLICT' : normalized.stale ? 'STALE' : 'FAILED');
      if (normalized.stale || normalized.code === 'CANDIDATE_PROVIDER_HANDOFF_IN_PROGRESS') {
        const choice = await modals.openCandidateConflictModal({ error: normalized, trigger: context.trigger });
        if (choice.value === 'refresh') await deps.refetchProjection?.(context);
      } else deps.showToast?.(normalized.message, 'fail');
      return { ok: false, error: normalized };
    };
    async function runRouteAction(context) {
      const key = keyOf(context);
      if (isBusy(key)) return { ok: false, busy: true };
      try {
        window.CloudTMSCandidateOfficeUiPolicy.assertOfficeButtonApproved(context.surface, `ROUTE:${context.action}`);
        await preflight(context, key);
        const preview = await api.previewCandidateRouteChange({ timesheetId: context.identity.timesheet_id, action: context.action });
        if (preview.intervention_choice?.required === true) {
          setState(key, 'SHOWING_DECISION');
          const decision = await modals.openCandidateDecisionModal({ decision: preview.intervention_choice, trigger: context.trigger });
          if (!decision.confirmed) { setState(key, 'CANCELLED'); return { ok: false, cancelled: true }; }
          if (decision.value === 'reject') {
            setState(key, 'CANCELLED');
            return runRejection({ ...context, projection: context.projection, rejectionAction: { invocation: preview.intervention_choice.reject_action } });
          }
        }
        const warningCodes = Array.isArray(preview.warning_codes) ? preview.warning_codes : [preview.warning_code || preview.warning].filter(Boolean);
        let inputs = {};
        for (const warningCode of warningCodes) {
          setState(key, 'SHOWING_WARNING');
          const response = await modals.openCandidateRouteWarningModal({ preview, warningCode, trigger: context.trigger });
          if (!response.confirmed) { setState(key, 'CANCELLED'); return { ok: false, cancelled: true }; }
          inputs = { ...inputs, ...(response.inputs || {}) };
        }
        if (!warningCodes.length) {
          setState(key, 'SHOWING_WARNING');
          const response = await modals.openCandidateRouteWarningModal({ preview, warningCode: context.defaultWarning || 'W01', trigger: context.trigger });
          if (!response.confirmed) { setState(key, 'CANCELLED'); return { ok: false, cancelled: true }; }
          inputs = response.inputs || {};
        }
        setState(key, 'CONFIRMING');
        const requestKey = operationKeyFor(key, {
          action: preview.permitted_action,
          context_sha256: preview.context_sha256,
          expected_timesheet_id: preview.expected_timesheet_id,
          expected_row_signature: preview.expected_row_signature,
          reason_code: inputs.reasonCode || null,
          reason_note: inputs.reasonNote || null,
          allow_manual_only: context.allowManualOnly === true
        });
        setState(key, 'APPLYING_RESULT');
        const result = await api.confirmCandidateRouteChange({ timesheetId: context.identity.timesheet_id, preview, reasonCode: inputs.reasonCode, reasonNote: inputs.reasonNote, allowManualOnly: context.allowManualOnly === true, idempotencyKey: requestKey });
        await reconcile(result, context);
        finishOperation(key);
        setState(key, 'SUCCEEDED');
        deps.showToast?.('Candidate route updated.', 'ok');
        return { ok: true, result };
      } catch (error) { return handleFailure(error, context, key); }
    }
    async function runRejection(context) {
      const key = keyOf({ ...context, action: { code: 'REJECT_CANDIDATE_SUBMISSION' } });
      if (isBusy(key)) return { ok: false, busy: true };
      try {
        window.CloudTMSCandidateOfficeUiPolicy.assertOfficeButtonApproved(context.surface, 'REJECT_CANDIDATE_SUBMISSION');
        await preflight(context, key);
        const timesheetId = context.projection?.current_identity?.timesheet_id || context.identity?.timesheet_id;
        const preview = await api.previewCandidateRejection({ invocation: context.rejectionAction?.invocation, timesheetId });
        if (!preview.permitted) throw Object.assign(new Error(preview.disabled_reason || 'This Candidate submission cannot currently be rejected.'), { code: preview.disabled_reason_code || 'CANDIDATE_ACTION_NOT_ELIGIBLE' });
        setState(key, 'COLLECTING_REASON');
        const response = await modals.openCandidateRejectionModal({ preview, context: context.displayContext || {}, trigger: context.trigger });
        if (!response.confirmed) { setState(key, 'CANCELLED'); return { ok: false, cancelled: true }; }
        setState(key, 'APPLYING_RESULT');
        const requestKey = operationKeyFor(key, {
          action: 'REJECT_CANDIDATE_SUBMISSION',
          context_sha256: preview.context_sha256,
          expected_timesheet_id: preview.expected_timesheet_id,
          expected_row_signature: preview.expected_row_signature,
          reason: response.inputs.reason
        });
        const result = await api.confirmCandidateRejection({ timesheetId, preview, reason: response.inputs.reason, idempotencyKey: requestKey });
        await reconcile(result, context);
        finishOperation(key);
        setState(key, 'SUCCEEDED');
        deps.showToast?.('Candidate submission rejected.', 'ok');
        return { ok: true, result };
      } catch (error) { return handleFailure(error, context, key); }
    }
    async function runTypedAction(context) {
      let action = window.CloudTMSCandidateOfficeContract.normalizeOfficeCandidateAction(context.action);
      if (OFFICE_FRONTEND_FORBIDDEN_ACTIONS.has(action.code)) {
        try {
          window.CloudTMSCandidateOfficeUiPolicy.assertOfficeButtonApproved(context.surface, action.code);
        } catch (error) {
          return handleFailure(error, context, keyOf({ ...context, action }));
        }
      }
      try {
        window.CloudTMSCandidateOfficeUiPolicy.assertOfficeButtonApproved(context.surface, action.code);
      } catch (error) {
        return handleFailure(error, context, keyOf({ ...context, action }));
      }
      const key = keyOf({ ...context, action });
      if (action.code === 'REJECT_CANDIDATE_SUBMISSION') return runRejection({ ...context, rejectionAction: action });
      if (action.code === 'ISSUE_REPLACEMENT_PAPER_PACK') {
        const routeAction = new URL(action.invocation.path, window.location.origin).searchParams.get('action') || 'REISSUE_QR';
        return runRouteAction({ ...context, action: routeAction, defaultWarning: 'W12' });
      }
      if (isBusy(key)) return { ok: false, busy: true };
      try {
        await preflight(context, key);
        action = window.CloudTMSCandidateOfficeContract.normalizeOfficeCandidateAction(context.action || action);
        if (action.invocation.kind === 'CLIENT_DESTINATION') throw Object.assign(new Error('Candidate-app destinations cannot be executed by the Office frontend.'), { code: 'CANDIDATE_OFFICE_CANDIDATE_ACTION_FORBIDDEN' });
        let inputs = {};
        setState(key, 'COLLECTING_REASON');
        const confirmedOfficeCodes = new Set(['SEND_MANAGER_REMINDER', 'RENEW_MANAGER_REQUEST', 'RETRY_FINALISATION', 'RETRY_PAPER_PREPARATION', 'ISSUE_REPLACEMENT_PAPER_PACK']);
        const response = confirmedOfficeCodes.has(action.code)
          ? await modals.openCandidateManagerActionModal({ action, projection: context.projection, trigger: context.trigger })
          : await modals.openCandidateTypedActionModal({ action, projection: context.projection, trigger: context.trigger });
        if (!response.confirmed) { setState(key, 'CANCELLED'); return { ok: false, cancelled: true }; }
        inputs = response.inputs || {};
        setState(key, 'APPLYING_RESULT');
        const requestKey = action.invocation.idempotency === 'REQUIRED'
          ? operationKeyFor(key, { code: action.code, path: action.invocation.path, fixed_body: action.invocation.fixed_body, user_inputs: inputs })
          : null;
        let result = await api.invokeOfficeCandidateAction({ action, userInputs: inputs, idempotencyKey: requestKey });
        if (result instanceof Blob) {
          const url = URL.createObjectURL(result);
          window.open(url, '_blank', 'noopener,noreferrer');
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          result = { ok: true, downloaded: true };
        }
        await reconcile(result, context);
        finishOperation(key);
        setState(key, 'SUCCEEDED');
        deps.showToast?.(`${action.label} completed.`, 'ok');
        return { ok: true, result };
      } catch (error) { return handleFailure(error, context, key); }
    }
    async function runReminderBatch(context) {
      const key = `TIMESHEET_SUMMARY:REMINDER_BATCH`;
      if (isBusy(key)) return { ok: false, busy: true };
      try {
        window.CloudTMSCandidateOfficeUiPolicy.assertOfficeButtonApproved('TIMESHEET_SUMMARY', 'SEND_MANAGER_REMINDER_BATCH');
        if (!context.rows?.length) return { ok: false, cancelled: true };
        setState(key, 'PREFLIGHTING');
        const preview = await api.previewManagerReminderBatch({ identities: context.rows });
        const response = await modals.openCandidateReminderBatchModal({ preview, trigger: context.trigger });
        if (!response.confirmed) { setState(key, 'CANCELLED'); return { ok: false, cancelled: true }; }
        setState(key, 'APPLYING_RESULT');
        const batchId = operationKeyFor(key, {
          action: 'SEND_MANAGER_REMINDER_BATCH',
          preview_context_hash: preview.preview_context_hash,
          selection_fingerprint: preview.selection_fingerprint
        });
        const result = await api.executeManagerReminderBatch({ identities: context.rows, preview, batchId, idempotencyKey: batchId });
        await modals.openCandidateBatchResultModal({ result, trigger: context.trigger });
        await reconcile(result, context);
        finishOperation(key);
        setState(key, 'SUCCEEDED');
        return { ok: true, result };
      } catch (error) { return handleFailure(error, context, key); }
    }
    return Object.freeze({ STATES, getState: key => active.get(key)?.state || 'IDLE', runRouteAction, runTypedAction, runRejection, runReminderBatch });
  }
  Object.assign(window, { CloudTMSCandidateOfficeController: Object.freeze({ STATES, OFFICE_FRONTEND_FORBIDDEN_ACTIONS, createCandidateOfficeActionController }) });
})();

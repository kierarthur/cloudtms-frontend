(() => {
  'use strict';

  const VERSIONS = Object.freeze({
    office: 'CLOUDTMS_OFFICE_CANDIDATE_API_V1',
    capabilities: 'OFFICE_CANDIDATE_CAPABILITIES_V1',
    projection: 'OFFICE_CANDIDATE_TIMESHEET_V1',
    projectionBatch: 'OFFICE_CANDIDATE_PROJECTION_BATCH_V1',
    action: 'OFFICE_CANDIDATE_ACTION_V1',
    rejectionPreview: 'OFFICE_CANDIDATE_REJECTION_PREVIEW_V1',
    reminderEligibility: 'OFFICE_CANDIDATE_REMINDER_ELIGIBILITY_PAGE_V1',
    reminderPreview: 'OFFICE_CANDIDATE_REMINDER_BATCH_PREVIEW_V1',
    reminderResult: 'OFFICE_CANDIDATE_REMINDER_BATCH_RESULT_V1',
    mutation: 'OFFICE_CANDIDATE_MUTATION_RESULT_V1'
  });
  const SURFACES = Object.freeze([
    'SIMPLE_TIMESHEET', 'TIMESHEET_SUMMARY', 'BULK_PROCESS',
    'BULK_AUTHORISE', 'INVOICE_GENERATOR', 'INVOICE_ISSUER'
  ]);
  const PAPER_STATES = new Set([
    'NOT_APPLICABLE', 'PREPARING', 'BACKOFF', 'READY', 'RETURN_RECEIVED',
    'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'RETIRED', 'STALE'
  ]);
  const HTTP_METHODS = new Set(['GET', 'POST']);
  const IDEMPOTENCY = new Set(['NONE', 'REQUIRED']);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SHA_RE = /^[a-f0-9]{64}$/;
  const CANONICAL_ACTION_LABELS = Object.freeze({
    REJECT_CANDIDATE_SUBMISSION: 'Reject Candidate Submission',
    SEND_MANAGER_REMINDER: 'Send manager reminder',
    RENEW_MANAGER_REQUEST: 'Request manager approval again',
    CANCEL_MANAGER_REQUEST: 'Cancel manager approval request'
  });

  class CandidateOfficeContractError extends Error {
    constructor(code, message, details = null) {
      super(message);
      this.name = 'CandidateOfficeContractError';
      this.code = code;
      this.details = details;
    }
  }

  const fail = (code, message, details) => { throw new CandidateOfficeContractError(code, message, details); };
  const object = (value, name) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', `${name} must be an object.`);
    return value;
  };
  const text = (value, name, { nullable = false, max = 4096 } = {}) => {
    if (nullable && value == null) return null;
    if (typeof value !== 'string' || !value.trim() || value.length > max) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', `${name} is invalid.`);
    return value.trim();
  };
  const boolean = (value, name) => {
    if (typeof value !== 'boolean') fail('CANDIDATE_OFFICE_CONTRACT_INVALID', `${name} must be a boolean.`);
    return value;
  };
  const integer = (value, name, minimum = 0) => {
    if (!Number.isInteger(value) || value < minimum) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', `${name} must be an integer of at least ${minimum}.`);
    return value;
  };
  const optionalInteger = (value, name, minimum = 0) => {
    if (value == null) return null;
    return integer(value, name, minimum);
  };
  const version = (value, expected, name = 'contract_version') => {
    if (value !== expected) fail('CANDIDATE_OFFICE_CONTRACT_VERSION_UNSUPPORTED', `${name} is not supported.`, { expected, actual: value ?? null });
    return value;
  };
  const optionalUuid = (value, name) => {
    if (value == null || value === '') return null;
    const normalized = text(value, name, { max: 36 });
    if (!UUID_RE.test(normalized)) fail('CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID', `${name} is invalid.`);
    return normalized;
  };
  const optionalSha = (value, name) => {
    if (value == null || value === '') return null;
    const normalized = text(value, name, { max: 64 }).toLowerCase();
    if (!SHA_RE.test(normalized)) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', `${name} is invalid.`);
    return normalized;
  };
  const optionalText = (value, name, max) => {
    if (value == null || value === '') return null;
    return text(value, name, { max });
  };
  const freeze = (value) => Object.freeze(value);
  const canonicalJson = value => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  };

  function assertCandidateOfficeContractVersion(value) {
    return version(value, VERSIONS.office, 'office_contract_version');
  }

  function normalizeOfficeCandidateIdentity(raw, { requireRowKey = true } = {}) {
    const src = object(raw, 'identity');
    const rowKey = src.row_key == null ? '' : String(src.row_key).trim();
    if (requireRowKey && (!rowKey || rowKey.length > 256)) fail('CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID', 'row_key is required.');
    const timesheetId = optionalUuid(src.timesheet_id, 'timesheet_id');
    const contractWeekId = optionalUuid(src.contract_week_id, 'contract_week_id');
    if (!timesheetId && !contractWeekId) fail('CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID', 'A timesheet or contract-week identity is required.');
    return freeze({
      row_key: rowKey || timesheetId || contractWeekId,
      timesheet_id: timesheetId,
      contract_week_id: contractWeekId,
      expected_row_signature: optionalText(src.expected_row_signature, 'expected_row_signature', 256)
    });
  }

  function normalizeOfficeCandidateCapabilities(raw) {
    const src = object(raw, 'capabilities');
    if (src.ok !== true) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Capabilities were not accepted.');
    version(src.contract_version, VERSIONS.office);
    version(src.office_contract_version, VERSIONS.office, 'office_contract_version');
    version(src.capabilities_version, VERSIONS.capabilities, 'capabilities_version');
    if (src.mode !== 'ENABLED' || src.required_office_role !== 'admin' || src.permission_source !== 'OFFICE_ADMIN_ROLE_V1') {
      fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Office capability authority is not the frozen admin contract.');
    }
    const surfaces = object(src.surfaces, 'surfaces');
    const permissions = object(src.permissions, 'permissions');
    const normalizedSurfaces = {};
    for (const surface of SURFACES) {
      const key = surface.toLowerCase();
      normalizedSurfaces[key] = boolean(surfaces[key], `surfaces.${key}`);
    }
    const requiredPermissions = [
      'view_candidate_state', 'change_route', 'reject_submission', 'resubmit_rejected',
      'send_manager_reminder', 'send_manager_reminder_batch', 'renew_manager_request',
      'cancel_manager_request', 'manage_phone_approval', 'manage_paper',
      'retry_finalisation', 'mark_no_work'
    ];
    const normalizedPermissions = {};
    requiredPermissions.forEach(key => { normalizedPermissions[key] = boolean(permissions[key], `permissions.${key}`); });
    return freeze({
      ...src,
      authority_applies: boolean(src.authority_applies, 'authority_applies'),
      mode: 'ENABLED',
      surfaces: freeze(normalizedSurfaces),
      permissions: freeze(normalizedPermissions)
    });
  }

  function normalizeOfficeCandidateAction(raw) {
    const src = object(raw, 'action');
    version(src.contract_version, VERSIONS.action);
    const invocation = object(src.invocation, 'action.invocation');
    integer(invocation.version, 'action.invocation.version', 1);
    if (invocation.version !== 1) fail('CANDIDATE_OFFICE_CONTRACT_VERSION_UNSUPPORTED', 'Action invocation version is not supported.');
    const kind = text(invocation.kind, 'action.invocation.kind', { max: 32 }).toUpperCase();
    if (!['HTTP', 'CLIENT_DESTINATION'].includes(kind)) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Action invocation kind is invalid.');
    const method = invocation.method == null ? null : String(invocation.method).trim().toUpperCase();
    if ((kind === 'HTTP' && !HTTP_METHODS.has(method)) || (kind === 'CLIENT_DESTINATION' && method != null)) {
      fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Action invocation method is invalid.');
    }
    const path = text(invocation.path, 'action.invocation.path', { max: 2048 });
    if (kind === 'HTTP' && !path.startsWith('/api/candidate-app/')) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Action path is outside the frozen Office API.');
    const requiredUserInputs = Array.isArray(invocation.required_user_inputs) ? invocation.required_user_inputs.map((item, index) => freeze({ ...object(item, `required_user_inputs[${index}]`) })) : fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'required_user_inputs must be an array.');
    const idempotency = text(invocation.idempotency, 'action.invocation.idempotency', { max: 16 }).toUpperCase();
    if (!IDEMPOTENCY.has(idempotency)) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Action idempotency contract is invalid.');
    const code = text(src.code, 'action.code', { max: 128 }).toUpperCase();
    return freeze({
      contract_version: VERSIONS.action,
      code,
      label: CANONICAL_ACTION_LABELS[code] || text(src.label, 'action.label', { max: 256 }),
      group: text(src.group, 'action.group', { max: 128 }).toUpperCase(),
      prominent: src.prominent === true,
      enabled: boolean(src.enabled, 'action.enabled'),
      disabled_reason_code: src.disabled_reason_code == null ? null : String(src.disabled_reason_code).trim() || null,
      disabled_reason: src.disabled_reason == null ? null : String(src.disabled_reason).trim() || null,
      requires_confirmation: src.requires_confirmation === true,
      requires_reason: src.requires_reason === true,
      invocation: freeze({
        version: 1,
        kind,
        method,
        path,
        fixed_body: freeze({ ...object(invocation.fixed_body, 'action.invocation.fixed_body') }),
        required_user_inputs: freeze(requiredUserInputs),
        idempotency
      })
    });
  }

  function normalizeOfficeCandidateProjection(raw, { surface = null, rowIdentity = null } = {}) {
    const src = object(raw, 'projection');
    if (src.ok !== true) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Projection was not accepted.');
    version(src.contract_version, VERSIONS.projection);
    version(src.office_contract_version, VERSIONS.office, 'office_contract_version');
    if (surface && !SURFACES.includes(String(surface).toUpperCase())) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Projection surface is invalid.');
    const currentIdentity = object(src.current_identity, 'current_identity');
    const currentTimesheetId = optionalUuid(currentIdentity.timesheet_id, 'current_identity.timesheet_id');
    const currentContractWeekId = optionalUuid(currentIdentity.contract_week_id, 'current_identity.contract_week_id');
    if (!currentTimesheetId && !currentContractWeekId) fail('CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID', 'Projection is missing its current timesheet or contract-week identity.');
    const status = object(src.candidate_status, 'candidate_status');
    const statusCode = text(status.code, 'candidate_status.code', { max: 128 }).toUpperCase();
    const actions = Array.isArray(src.available_actions) ? src.available_actions.map(normalizeOfficeCandidateAction) : fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'available_actions must be an array.');
    const actionCodes = new Set();
    actions.forEach(action => {
      if (actionCodes.has(action.code)) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'available_actions contains a duplicate action code.');
      actionCodes.add(action.code);
    });
    const enabledRejection = actions.find(action => action.code === 'REJECT_CANDIDATE_SUBMISSION' && action.enabled);
    if (enabledRejection && ['AUTHORISED', 'INVOICED_NOT_PAID', 'PAID'].includes(statusCode)) {
      fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'A financially protected or authorised submission cannot expose an enabled Office rejection action.');
    }
    const diagnostics = Array.isArray(src.diagnostics) ? src.diagnostics.map((item, index) => freeze({ ...object(item, `diagnostics[${index}]`) })) : fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'diagnostics must be an array.');
    const paper = src.paper_pack == null ? { state: 'NOT_APPLICABLE' } : object(src.paper_pack, 'paper_pack');
    const paperState = String(paper.state || '').toUpperCase();
    if (!PAPER_STATES.has(paperState)) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'QR Pack state is unknown.');
    if (paper.retryable === true && paperState !== 'FAILED_RETRYABLE') fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Only an explicitly retryable QR Pack failure may be retried.');
    if (rowIdentity) {
      const requested = normalizeOfficeCandidateIdentity(rowIdentity);
      if (currentIdentity.moved === true) fail('CANDIDATE_TIMESHEET_MOVED', 'The requested timesheet has moved to another current version.');
      const returnedSignature = String(currentIdentity.row_signature || '').trim();
      if (requested.expected_row_signature && (currentIdentity.stale_signature === true || !returnedSignature || returnedSignature !== requested.expected_row_signature)) {
        fail('CANDIDATE_CONTEXT_STALE', 'The requested timesheet has changed since it was loaded.');
      }
      const returnedRowKey = String(currentIdentity.row_key || '').trim();
      if (!returnedRowKey) fail('CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID', 'Projection is missing its requested row identity.');
      if (returnedRowKey && requested.row_key && returnedRowKey !== requested.row_key) fail('CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID', 'Projection row identity does not match the request.');
      if (requested.timesheet_id && currentTimesheetId !== requested.timesheet_id) fail('CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID', 'Projection timesheet identity does not match the request.');
      if (requested.contract_week_id && currentContractWeekId !== requested.contract_week_id) fail('CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID', 'Projection contract-week identity does not match the request.');
    }
    const primaryAction = src.primary_action == null ? null : normalizeOfficeCandidateAction(src.primary_action);
    if (primaryAction) {
      const available = actions.find(action => action.code === primaryAction.code);
      if (!primaryAction.enabled || !primaryAction.prominent || !available || canonicalJson(primaryAction) !== canonicalJson(available)) {
        fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'primary_action must exactly match one enabled prominent available action.');
      }
    }
    const rejections = (Array.isArray(src.rejections) ? src.rejections : []).map((item, index) => {
      const rejection = object(item, `rejections[${index}]`);
      const actionable = boolean(rejection.rejection_actionable, `rejections[${index}].rejection_actionable`);
      const replacementWorkflowId = optionalUuid(rejection.replacement_workflow_id, `rejections[${index}].replacement_workflow_id`);
      if ((!actionable || replacementWorkflowId) && rejection.recovery_action != null) {
        fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Historical or replaced rejection cannot expose a recovery action.');
      }
      return freeze({
        ...rejection,
        rejection_actionable: actionable,
        replacement_workflow_id: replacementWorkflowId,
        recovery_action: rejection.recovery_action == null ? null : normalizeOfficeCandidateAction(rejection.recovery_action)
      });
    });
    const manager = src.manager_approval == null ? null : object(src.manager_approval, 'manager_approval');
    let normalizedManager = null;
    if (manager) {
      const method = text(manager.method, 'manager_approval.method', { max: 16 }).toUpperCase();
      if (!['EMAIL', 'PHONE'].includes(method)) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager approval method is unknown.');
      if (method === 'PHONE' && actions.some(action => action.enabled && ['SEND_MANAGER_REMINDER', 'RENEW_MANAGER_REQUEST', 'CANCEL_MANAGER_REQUEST'].includes(action.code))) {
        fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'A PHONE approval workflow cannot expose EMAIL request actions to Office.');
      }
      normalizedManager = freeze({
        ...manager,
        method,
        request_id: optionalUuid(manager.request_id, 'manager_approval.request_id'),
        request_generation: integer(manager.request_generation, 'manager_approval.request_generation', 1),
        state: text(manager.state, 'manager_approval.state', { max: 64 }).toUpperCase(),
        resend_count: optionalInteger(manager.resend_count, 'manager_approval.resend_count', 0),
        resends_remaining: optionalInteger(manager.resends_remaining, 'manager_approval.resends_remaining', 0)
      });
    }
    return freeze({
      ...src,
      current_identity: freeze({ ...currentIdentity, timesheet_id: currentTimesheetId, contract_week_id: currentContractWeekId }),
      candidate_status: freeze({
        ...status,
        code: statusCode,
        label: text(status.label, 'candidate_status.label', { max: 256 }),
        tone: String(status.tone || 'neutral').trim().toLowerCase()
      }),
      workflow: src.workflow == null ? null : freeze({ ...object(src.workflow, 'workflow') }),
      manager_approval: normalizedManager,
      paper_pack: freeze({ ...paper, state: paperState }),
      rejections: freeze(rejections),
      primary_action: primaryAction,
      available_actions: freeze(actions),
      diagnostics: freeze(diagnostics),
      refresh_hints: freeze({ ...object(src.refresh_hints, 'refresh_hints') })
    });
  }

  function normalizeOfficeCandidateProjectionBatch(raw, { surface, identities = [] } = {}) {
    const src = object(raw, 'projection batch');
    if (src.ok !== true) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Projection batch was not accepted.');
    version(src.contract_version, VERSIONS.projectionBatch);
    const normalizedSurface = text(src.surface, 'surface', { max: 64 }).toUpperCase();
    if (!SURFACES.includes(normalizedSurface) || (surface && normalizedSurface !== String(surface).toUpperCase())) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Projection batch surface does not match.');
    if (!Array.isArray(identities) || identities.length < 1 || identities.length > 100) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Projection batch request cardinality is invalid.');
    if (!Array.isArray(src.results) || src.results.length !== identities.length || src.result_count !== src.results.length) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Projection batch cardinality is invalid.');
    const identityMap = new Map();
    identities.forEach((item, index) => {
      const identity = normalizeOfficeCandidateIdentity(item);
      if (identityMap.has(identity.row_key)) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', `Projection batch request contains duplicate row_key at index ${index}.`);
      identityMap.set(identity.row_key, identity);
    });
    const returnedKeys = new Set();
    const results = src.results.map((item, index) => {
      const row = object(item, `results[${index}]`);
      const correlationKey = String(row.correlation_key || '').trim();
      if (!correlationKey) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Projection batch result is missing its correlation key.');
      if (!identityMap.has(correlationKey)) fail('CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID', 'Projection batch returned an unrequested correlation key.');
      if (returnedKeys.has(correlationKey)) fail('CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID', 'Projection batch returned a duplicate correlation key.');
      returnedKeys.add(correlationKey);
      if (row.ok === true) {
        const projection = normalizeOfficeCandidateProjection(row.projection, {
          surface: normalizedSurface,
          rowIdentity: identityMap.get(correlationKey) || null
        });
        return freeze({ ok: true, correlation_key: correlationKey, projection });
      }
      return freeze({
        ok: false,
        correlation_key: correlationKey,
        error: freeze({ ...object(row.error, `results[${index}].error`) })
      });
    });
    if (returnedKeys.size !== identityMap.size) fail('CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID', 'Projection batch did not return every requested row exactly once.');
    return freeze({ ...src, surface: normalizedSurface, results: freeze(results) });
  }

  function normalizeCandidateRoutePreview(raw) {
    const src = object(raw, 'route preview');
    const expectedTimesheetId = optionalUuid(src.expected_timesheet_id || src.current_timesheet_id, 'expected_timesheet_id');
    if (!expectedTimesheetId) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Route preview is missing the current timesheet identity.');
    const permission = src.permitted_action;
    if (typeof permission === 'boolean' && permission !== true) {
      fail('CANDIDATE_ACTION_NOT_ELIGIBLE', 'This route change is not currently available.');
    }
    const action = text(
      typeof permission === 'string' ? permission : src.action,
      'permitted_action',
      { max: 64 }
    ).toUpperCase();
    const context = optionalSha(src.context_sha256 || src.expected_context_sha256, 'context_sha256');
    if (!context) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Route preview is missing its context hash.');
    const rowSignature = text(src.expected_row_signature || src.row_signature, 'expected_row_signature', { max: 256 });
    return freeze({ ...src, expected_timesheet_id: expectedTimesheetId, expected_row_signature: rowSignature, permitted_action: action, context_sha256: context });
  }

  function normalizeCandidateRejectPreview(raw) {
    const src = object(raw, 'rejection preview');
    version(src.contract_version, VERSIONS.rejectionPreview);
    const contextSha256 = optionalSha(src.context_sha256, 'context_sha256');
    const expectedTimesheetId = optionalUuid(src.expected_timesheet_id, 'expected_timesheet_id');
    if (!contextSha256 || !expectedTimesheetId) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Rejection preview is missing its exact current identity or context hash.');
    return freeze({
      ...src,
      permitted: boolean(src.permitted, 'permitted'),
      context_sha256: contextSha256,
      expected_timesheet_id: expectedTimesheetId,
      expected_row_signature: text(src.expected_row_signature, 'expected_row_signature', { max: 256 })
    });
  }

  function normalizeManagerReminderEligibilityPage(raw) {
    const src = object(raw, 'manager reminder eligibility page');
    if (src.ok !== true) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder eligibility was not accepted.');
    version(src.contract_version, VERSIONS.reminderEligibility);
    const page = integer(src.page, 'page', 1);
    const pageSize = integer(src.page_size, 'page_size', 1);
    const pageCount = integer(src.page_count, 'page_count', 0);
    const totalItems = integer(src.total_items, 'total_items', 0);
    const catalogueTotalItems = integer(src.catalogue_total_items, 'catalogue_total_items', 0);
    const surnameQuery = src.surname_query == null ? '' : String(src.surname_query);
    const sortBy = String(src.sort_by || '').trim().toUpperCase();
    const sortDirection = String(src.sort_direction || '').trim().toUpperCase();
    if (pageSize > 100 || totalItems > catalogueTotalItems || catalogueTotalItems > 1000
        || surnameQuery.length > 100 || !['CANDIDATE_SURNAME', 'LAST_MANAGER_EMAIL'].includes(sortBy)
        || !['ASC', 'DESC'].includes(sortDirection)
        || (totalItems === 0 ? page !== 1 || pageCount !== 0 : page > pageCount)) {
      fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder pagination is inconsistent.');
    }
    const catalogueRevision = optionalSha(src.catalogue_revision, 'catalogue_revision');
    if (!catalogueRevision) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder catalogue revision is missing.');
    const keys = new Set();
    const items = (Array.isArray(src.items) ? src.items : fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder items must be an array.')).map((rawItem, index) => {
      const item = object(rawItem, `items[${index}]`);
      const selectionKey = text(item.selection_key, `items[${index}].selection_key`, { max: 256 });
      if (keys.has(selectionKey)) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder page contains a duplicate selection key.');
      keys.add(selectionKey);
      const identity = normalizeOfficeCandidateIdentity(item.identity || item);
      return freeze({
        selection_key: selectionKey,
        identity,
        candidate_name: text(item.candidate_name, `items[${index}].candidate_name`, { max: 300 }),
        candidate_surname: text(item.candidate_surname, `items[${index}].candidate_surname`, { max: 200 }),
        last_manager_email_at_utc: text(item.last_manager_email_at_utc, `items[${index}].last_manager_email_at_utc`, { max: 64 })
      });
    });
    const matchingSelectionKeys = (Array.isArray(src.matching_selection_keys)
      ? src.matching_selection_keys
      : fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder matching selection keys must be an array.'))
      .map((value, index) => optionalUuid(value, `matching_selection_keys[${index}]`));
    if (new Set(matchingSelectionKeys).size !== matchingSelectionKeys.length
        || matchingSelectionKeys.length !== totalItems
        || matchingSelectionKeys.some(value => !value)
        || items.some(item => !matchingSelectionKeys.includes(item.selection_key))
        || items.length > pageSize || (totalItems === 0 && items.length)) {
      fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder page size or filtered selection is inconsistent.');
    }
    return freeze({
      ...src,
      contract_version: VERSIONS.reminderEligibility,
      catalogue_revision: catalogueRevision,
      page,
      page_size: pageSize,
      page_count: pageCount,
      total_items: totalItems,
      catalogue_total_items: catalogueTotalItems,
      surname_query: surnameQuery,
      sort_by: sortBy,
      sort_direction: sortDirection,
      matching_selection_keys: freeze(matchingSelectionKeys),
      items: freeze(items)
    });
  }

  function normalizeManagerReminderBatchPreview(raw) {
    const src = object(raw, 'manager reminder batch preview');
    if (src.ok !== true) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder preview was not accepted.');
    version(src.contract_version, VERSIONS.reminderPreview);
    const previewContextHash = optionalSha(src.preview_context_hash, 'preview_context_hash');
    const selectionFingerprint = optionalSha(src.selection_fingerprint, 'selection_fingerprint');
    if (!previewContextHash || !selectionFingerprint) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder preview is missing its frozen selection authority.');
    const selectedRows = (Array.isArray(src.selected_rows)
      ? src.selected_rows
      : fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder preview is missing its frozen selected rows.'))
      .map(normalizeOfficeCandidateIdentity);
    const selectedCount = integer(src.selected_count, 'selected_count', 1);
    if (selectedRows.length !== selectedCount || selectedRows.length > 1000) {
      fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder preview selection is inconsistent.');
    }
    return freeze({
      ...src,
      preview_context_hash: previewContextHash,
      selection_fingerprint: selectionFingerprint,
      selected_count: selectedCount,
      selected_rows: freeze(selectedRows)
    });
  }

  function normalizeManagerReminderBatchResult(raw) {
    const src = object(raw, 'manager reminder batch result');
    version(src.contract_version, VERSIONS.reminderResult);
    if (src.ok !== true) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder batch result is not durable.');
    const status = text(src.status, 'status', { max: 32 }).toUpperCase();
    if (!['COMPLETED', 'PARTIAL', 'FAILED'].includes(status)) fail('CANDIDATE_OFFICE_CONTRACT_INVALID', 'Manager reminder batch status is invalid.');
    return freeze({
      ...src,
      status,
      batch_id: optionalUuid(src.batch_id, 'batch_id'),
      success_count: integer(src.success_count, 'success_count', 0),
      failure_count: integer(src.failure_count, 'failure_count', 0),
      skipped_count: integer(src.skipped_count, 'skipped_count', 0)
    });
  }

  function normalizeCandidateOfficeError(errorOrResponse) {
    const src = errorOrResponse?.payload || errorOrResponse?.json || errorOrResponse || {};
    const code = String(src.error_code || src.code || errorOrResponse?.code || 'CANDIDATE_OFFICE_UNKNOWN').trim().toUpperCase();
    const safeMessages = {
      OFFICE_AUTH_REQUIRED: 'Your CloudTMS session has expired. Sign in again, then review the current state.',
      CANDIDATE_OFFICE_PERMISSION_DENIED: 'You do not have permission to perform this Candidate action.',
      CANDIDATE_CONTEXT_STALE: 'This timesheet has changed since it was loaded.',
      CANDIDATE_TIMESHEET_MOVED: 'This timesheet has moved to a new current version.',
      CANDIDATE_REQUEST_GENERATION_STALE: 'The manager approval request has changed.',
      CANDIDATE_REQUIRES_UNAUTHORISE: 'Unauthorise this timesheet before continuing.',
      CANDIDATE_PROTECTED_FINANCIAL_HISTORY: 'This timesheet has protected financial history and cannot be changed.',
      CANDIDATE_IMPORT_AUTHORITATIVE: 'This timesheet is controlled by an import.',
      CANDIDATE_PROVIDER_HANDOFF_IN_PROGRESS: 'The provider is currently processing this request. Try again when that handoff has completed.',
      CANDIDATE_IDEMPOTENCY_CONFLICT: 'This action no longer matches the original request. Refresh and review the current state.',
      CANDIDATE_REMINDER_BATCH_SELECTION_CHANGED: 'The eligible manager reminder list changed. Refresh and review the current state before sending.',
      CANDIDATE_REMINDER_BATCH_SELECTION_INVALID: 'The manager reminder selection is no longer valid. Refresh and make the selection again.',
      CANDIDATE_REMINDER_CATALOGUE_TOO_LARGE: 'CloudTMS found more than 1,000 eligible reminders. No reminders were sent; contact support to split the operation safely.',
      CANDIDATE_REMINDER_CATALOGUE_UNAVAILABLE: 'CloudTMS could not build the current eligible reminder list. No reminders were sent.'
    };
    const message = safeMessages[code] || (typeof src.message === 'string' && !/[{}]|SQLSTATE|stack|constraint|function /i.test(src.message) ? src.message.trim() : '') || 'CloudTMS could not complete this Candidate action. Refresh the current state and try again.';
    return freeze({
      code,
      message,
      retryable: src.retryable === true,
      request_id: src.request_id == null ? null : String(src.request_id),
      status: Number(errorOrResponse?.status || src.status || 0) || null,
      stale: ['CANDIDATE_CONTEXT_STALE', 'CANDIDATE_TIMESHEET_MOVED', 'CANDIDATE_REQUEST_GENERATION_STALE', 'CANDIDATE_IDEMPOTENCY_CONFLICT', 'CANDIDATE_REMINDER_BATCH_SELECTION_CHANGED', 'CANDIDATE_REMINDER_BATCH_SELECTION_INVALID'].includes(code),
      auth: code === 'OFFICE_AUTH_REQUIRED' || Number(errorOrResponse?.status) === 401
    });
  }

  Object.assign(window, {
    CloudTMSCandidateOfficeContract: freeze({
      VERSIONS, SURFACES, CandidateOfficeContractError,
      assertCandidateOfficeContractVersion,
      normalizeOfficeCandidateIdentity,
      normalizeOfficeCandidateCapabilities,
      normalizeOfficeCandidateAction,
      normalizeOfficeCandidateProjection,
      normalizeOfficeCandidateProjectionBatch,
      normalizeCandidateRoutePreview,
      normalizeCandidateRejectPreview,
      normalizeManagerReminderEligibilityPage,
      normalizeManagerReminderBatchPreview,
      normalizeManagerReminderBatchResult,
      normalizeCandidateOfficeError
    })
  });
})();

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'candidate-office-contract-v1.js'), 'utf8');

function contract() {
  const context = vm.createContext({ window: {}, Object, Set, Map, String, Number, Array, JSON, Error });
  new vm.Script(source, { filename: 'candidate-office-contract-v1.js' }).runInContext(context);
  return context.window.CloudTMSCandidateOfficeContract;
}

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';

function action(code = 'SEND_MANAGER_REMINDER', overrides = {}) {
  return {
    contract_version: 'OFFICE_CANDIDATE_ACTION_V1',
    code,
    label: code.replaceAll('_', ' '),
    group: 'MANAGER_APPROVAL',
    prominent: true,
    enabled: true,
    requires_confirmation: true,
    requires_reason: false,
    invocation: {
      version: 1,
      kind: 'HTTP',
      method: 'POST',
      path: `/api/candidate-app/workflows/${UUID_A}/actions/remind`,
      fixed_body: { expected_generation: 1 },
      required_user_inputs: [],
      idempotency: 'REQUIRED'
    },
    ...overrides
  };
}

function projection(rowKey, timesheetId, availableActions = []) {
  return {
    ok: true,
    contract_version: 'OFFICE_CANDIDATE_TIMESHEET_V1',
    office_contract_version: 'CLOUDTMS_OFFICE_CANDIDATE_API_V1',
    current_identity: { row_key: rowKey, timesheet_id: timesheetId, contract_week_id: null },
    candidate_status: { code: 'AWAITING_MANAGER_APPROVAL', label: 'Awaiting Manager Approval', tone: 'danger' },
    workflow: null,
    manager_approval: null,
    paper_pack: { state: 'NOT_APPLICABLE' },
    rejections: [],
    primary_action: availableActions[0] || null,
    available_actions: availableActions,
    diagnostics: [],
    refresh_hints: { refetch: 'ROW' },
    observed_at_utc: '2026-08-13T08:00:00Z'
  };
}

test('primary action must exactly match one enabled prominent available action', () => {
  const api = contract();
  const available = action();
  assert.equal(api.normalizeOfficeCandidateProjection(projection('row-a', UUID_A, [available])).primary_action.code, available.code);

  const mismatched = projection('row-a', UUID_A, [available]);
  mismatched.primary_action = action('SEND_MANAGER_REMINDER', {
    invocation: { ...available.invocation, path: `/api/candidate-app/workflows/${UUID_B}/actions/remind` }
  });
  assert.throws(
    () => api.normalizeOfficeCandidateProjection(mismatched),
    error => error.code === 'CANDIDATE_OFFICE_CONTRACT_INVALID'
  );

  const disabled = action('SEND_MANAGER_REMINDER', { enabled: false, disabled_reason: 'Not eligible' });
  assert.throws(
    () => api.normalizeOfficeCandidateProjection(projection('row-a', UUID_A, [disabled])),
    error => error.code === 'CANDIDATE_OFFICE_CONTRACT_INVALID'
  );
});

test('projection rejects duplicate action codes and normalizes rejection recovery envelopes', () => {
  const api = contract();
  assert.throws(
    () => api.normalizeOfficeCandidateProjection(projection('row-a', UUID_A, [action(), action()])),
    error => error.code === 'CANDIDATE_OFFICE_CONTRACT_INVALID'
  );

  const input = projection('row-a', UUID_A, []);
  input.rejections = [{ state: 'REJECTED', rejection_actionable: true, recovery_action: action('RESUBMIT_REJECTED', {
    group: 'RECOVERY',
    prominent: false,
    invocation: {
      version: 1,
      kind: 'CLIENT_DESTINATION',
      method: null,
      path: `/candidate/submissions/${UUID_A}/resubmit`,
      fixed_body: {},
      required_user_inputs: [],
      idempotency: 'NONE'
    }
  }) }];
  const normalized = api.normalizeOfficeCandidateProjection(input);
  assert.equal(normalized.rejections[0].recovery_action.code, 'RESUBMIT_REJECTED');
  assert.equal(normalized.rejections[0].recovery_action.invocation.kind, 'CLIENT_DESTINATION');

  const historical = projection('row-a', UUID_A, []);
  historical.rejections = [{
    state: 'REJECTED',
    rejection_actionable: false,
    replacement_workflow_id: UUID_B,
    recovery_action: action('RESUBMIT_REJECTED')
  }];
  assert.throws(
    () => api.normalizeOfficeCandidateProjection(historical),
    error => error.code === 'CANDIDATE_OFFICE_CONTRACT_INVALID'
  );
});

test('authorised or financially protected submissions cannot expose enabled Office rejection', () => {
  const api = contract();
  const rejection = action('REJECT_CANDIDATE_SUBMISSION', {
    group: 'REJECTION',
    invocation: {
      version: 1,
      kind: 'HTTP',
      method: 'GET',
      path: `/api/candidate-app/timesheets/${UUID_A}/reject-preview`,
      fixed_body: {},
      required_user_inputs: [],
      idempotency: 'NONE'
    }
  });

  for (const code of ['AUTHORISED', 'INVOICED_NOT_PAID', 'PAID']) {
    const input = projection('row-a', UUID_A, [rejection]);
    input.candidate_status = { code, label: code, tone: 'warning' };
    assert.throws(
      () => api.normalizeOfficeCandidateProjection(input),
      error => error.code === 'CANDIDATE_OFFICE_CONTRACT_INVALID'
    );
  }

  const disabled = { ...rejection, enabled: false, prominent: false, disabled_reason: 'Unauthorise this timesheet first.' };
  const input = projection('row-a', UUID_A, [disabled]);
  input.primary_action = null;
  input.candidate_status = { code: 'AUTHORISED', label: 'Authorised', tone: 'success' };
  assert.equal(api.normalizeOfficeCandidateProjection(input).available_actions[0].enabled, false);
});

test('manager and PAPER facts are validated before presentation', () => {
  const api = contract();
  const input = projection('row-a', UUID_A, []);
  input.manager_approval = {
    method: 'email',
    request_id: UUID_B,
    request_generation: 3,
    state: 'pending',
    resend_count: 2,
    resends_remaining: 3
  };
  input.paper_pack = { state: 'PREPARING', retryable: false };
  const normalized = api.normalizeOfficeCandidateProjection(input);
  assert.equal(normalized.manager_approval.method, 'EMAIL');
  assert.equal(normalized.manager_approval.request_generation, 3);
  assert.equal(normalized.paper_pack.state, 'PREPARING');

  const invalidPaper = projection('row-a', UUID_A, []);
  invalidPaper.paper_pack = { state: 'PREPARING', retryable: true };
  assert.throws(
    () => api.normalizeOfficeCandidateProjection(invalidPaper),
    error => error.code === 'CANDIDATE_OFFICE_CONTRACT_INVALID'
  );
});

test('PHONE workflows fail closed if EMAIL request controls are advertised', () => {
  const api = contract();
  for (const code of ['SEND_MANAGER_REMINDER', 'RENEW_MANAGER_REQUEST', 'CANCEL_MANAGER_REQUEST']) {
    const input = projection('row-a', UUID_A, [action(code)]);
    input.manager_approval = {
      method: 'PHONE', request_id: UUID_B, request_generation: 1,
      state: 'PENDING', resend_count: 0, resends_remaining: 0
    };
    assert.throws(
      () => api.normalizeOfficeCandidateProjection(input),
      error => error.code === 'CANDIDATE_OFFICE_CONTRACT_INVALID'
    );
  }
});

test('bounded batch returns every requested identity exactly once', () => {
  const api = contract();
  const identities = [
    { row_key: 'row-a', timesheet_id: UUID_A },
    { row_key: 'row-b', timesheet_id: UUID_B }
  ];
  const good = {
    ok: true,
    contract_version: 'OFFICE_CANDIDATE_PROJECTION_BATCH_V1',
    surface: 'TIMESHEET_SUMMARY',
    result_count: 2,
    results: [
      { ok: true, correlation_key: 'row-a', projection: projection('row-a', UUID_A) },
      { ok: true, correlation_key: 'row-b', projection: projection('row-b', UUID_B) }
    ]
  };
  assert.equal(api.normalizeOfficeCandidateProjectionBatch(good, { surface: 'TIMESHEET_SUMMARY', identities }).results.length, 2);

  const duplicate = structuredClone(good);
  duplicate.results[1].correlation_key = 'row-a';
  duplicate.results[1].projection.current_identity.row_key = 'row-a';
  assert.throws(
    () => api.normalizeOfficeCandidateProjectionBatch(duplicate, { surface: 'TIMESHEET_SUMMARY', identities }),
    error => error.code === 'CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID'
  );

  const foreign = structuredClone(good);
  foreign.results[1].correlation_key = 'row-c';
  foreign.results[1].projection.current_identity.row_key = 'row-c';
  assert.throws(
    () => api.normalizeOfficeCandidateProjectionBatch(foreign, { surface: 'TIMESHEET_SUMMARY', identities }),
    error => error.code === 'CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID'
  );

  const missing = structuredClone(good);
  missing.result_count = 1;
  missing.results.pop();
  assert.throws(
    () => api.normalizeOfficeCandidateProjectionBatch(missing, { surface: 'TIMESHEET_SUMMARY', identities }),
    error => error.code === 'CANDIDATE_OFFICE_CONTRACT_INVALID'
  );
});

test('single projection requires the exact requested timesheet and contract-week identity', () => {
  const api = contract();
  const input = projection('row-a', UUID_A, []);
  input.current_identity.contract_week_id = UUID_B;
  const requested = { row_key: 'row-a', timesheet_id: UUID_A, contract_week_id: UUID_B };
  assert.equal(api.normalizeOfficeCandidateProjection(input, { rowIdentity: requested }).current_identity.timesheet_id, UUID_A);

  assert.throws(
    () => api.normalizeOfficeCandidateProjection(input, {
      rowIdentity: { row_key: 'row-a', timesheet_id: '00000000-0000-4000-8000-000000000009', contract_week_id: UUID_B }
    }),
    error => error.code === 'CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID'
  );
});

test('single projection rejects stale or moved identity before presentation', () => {
  const api = contract();
  const base = projection('row-a', UUID_A);
  assert.throws(
    () => api.normalizeOfficeCandidateProjection(base, {
      surface: 'SIMPLE_TIMESHEET',
      rowIdentity: { ...base.current_identity, expected_row_signature: 'old-signature' }
    }),
    error => error.code === 'CANDIDATE_CONTEXT_STALE'
  );
  assert.throws(
    () => api.normalizeOfficeCandidateProjection({
      ...base,
      current_identity: { ...base.current_identity, row_signature: 'new-signature', stale_signature: true }
    }, {
      surface: 'SIMPLE_TIMESHEET',
      rowIdentity: { ...base.current_identity, expected_row_signature: 'old-signature' }
    }),
    error => error.code === 'CANDIDATE_CONTEXT_STALE'
  );
  assert.throws(
    () => api.normalizeOfficeCandidateProjection({
      ...base,
      current_identity: { ...base.current_identity, moved: true }
    }, { surface: 'SIMPLE_TIMESHEET', rowIdentity: base.current_identity }),
    error => error.code === 'CANDIDATE_TIMESHEET_MOVED'
  );
});

test('route preview keeps the server action separate from its boolean permission gate', () => {
  const api = contract();
  const preview = {
    ok: true,
    action: 'REISSUE_QR',
    permitted_action: true,
    expected_timesheet_id: UUID_A,
    expected_row_signature: 'current-row-signature',
    context_sha256: 'a'.repeat(64)
  };

  const normalized = api.normalizeCandidateRoutePreview(preview);
  assert.equal(normalized.permitted_action, 'REISSUE_QR');
  assert.equal(normalized.expected_timesheet_id, UUID_A);

  assert.throws(
    () => api.normalizeCandidateRoutePreview({ ...preview, permitted_action: false }),
    error => error.code === 'CANDIDATE_ACTION_NOT_ELIGIBLE'
  );
});

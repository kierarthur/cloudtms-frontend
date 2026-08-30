const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';

function projection() {
  return {
    ok: true,
    contract_version: 'OFFICE_CANDIDATE_TIMESHEET_V1',
    office_contract_version: 'CLOUDTMS_OFFICE_CANDIDATE_API_V1',
    current_identity: { row_key: 'row-a', timesheet_id: UUID_A, contract_week_id: UUID_B, row_signature: 'row-signature-a' },
    candidate_status: { code: 'AWAITING_MANAGER_APPROVAL', label: 'Awaiting Manager Approval', tone: 'danger' },
    workflow: null,
    manager_approval: null,
    paper_pack: { state: 'NOT_APPLICABLE', retryable: false },
    rejections: [],
    primary_action: null,
    available_actions: [],
    diagnostics: [],
    refresh_hints: { refetch: 'CURRENT_ROW' },
    observed_at_utc: '2026-08-13T08:00:00Z'
  };
}

function load(authFetch, { windowApi = true, globalApi = false } = {}) {
  const window = { authFetch };
  if (windowApi) window.API = value => `https://test.example${value}`;
  const globals = { window, Object, Set, Map, String, Number, Array, JSON, Error, URL, URLSearchParams, encodeURIComponent };
  if (globalApi) globals.API = value => `https://test.example${value}`;
  const context = vm.createContext(globals);
  for (const file of ['candidate-office-contract-v1.js', 'candidate-office-api-v1.js']) {
    new vm.Script(fs.readFileSync(path.join(root, 'js', file), 'utf8'), { filename: file }).runInContext(context);
  }
  return context.window.CloudTMSCandidateOfficeApi;
}

test('transport resolves the existing lexical API helper without requiring window.API', async () => {
  let requestedUrl = '';
  const api = load(async url => {
    requestedUrl = url;
    return { ok: true, status: 200, text: async () => JSON.stringify({
      ok: true,
      contract_version: 'CLOUDTMS_OFFICE_CANDIDATE_API_V1',
      office_contract_version: 'CLOUDTMS_OFFICE_CANDIDATE_API_V1',
      capabilities_version: 'OFFICE_CANDIDATE_CAPABILITIES_V1',
      authority_applies: true,
      mode: 'ENABLED',
      required_office_role: 'admin',
      permission_source: 'OFFICE_ADMIN_ROLE_V1',
      surfaces: { simple_timesheet: true, timesheet_summary: true, bulk_process: true, bulk_authorise: true, invoice_generator: true, invoice_issuer: true },
      permissions: { view_candidate_state: true, change_route: true, reject_submission: true, resubmit_rejected: true, send_manager_reminder: true, send_manager_reminder_batch: true, renew_manager_request: true, cancel_manager_request: true, manage_phone_approval: true, manage_paper: true, retry_finalisation: true, mark_no_work: true }
    }) };
  }, { windowApi: false, globalApi: true });
  const capabilities = await api.fetchOfficeCandidateCapabilities();
  assert.equal(requestedUrl, 'https://test.example/api/candidate-app/office-capabilities');
  assert.equal(capabilities.authority_applies, true);
});

test('single projection sends the expected signature and verifies exact returned identity', async () => {
  let requestedUrl = '';
  const api = load(async url => {
    requestedUrl = url;
    return { ok: true, status: 200, text: async () => JSON.stringify(projection()) };
  });
  const result = await api.fetchOfficeCandidateProjection({
    timesheetId: UUID_A,
    rowIdentity: {
      row_key: 'row-a',
      timesheet_id: UUID_A,
      contract_week_id: UUID_B,
      expected_row_signature: 'row-signature-a'
    }
  });
  assert.match(requestedUrl, /expected_row_signature=row-signature-a/);
  assert.match(requestedUrl, /row_key=row-a/);
  assert.match(requestedUrl, new RegExp(`contract_week_id=${UUID_B}`));
  assert.equal(result.current_identity.contract_week_id, UUID_B);
});

test('single projection rejects an inconsistent path and row identity before transport', async () => {
  let calls = 0;
  const api = load(async () => { calls += 1; return { ok: true, status: 200, text: async () => JSON.stringify(projection()) }; });
  await assert.rejects(
    () => api.fetchOfficeCandidateProjection({
      timesheetId: UUID_B,
      rowIdentity: { row_key: 'row-a', timesheet_id: UUID_A, contract_week_id: UUID_B }
    }),
    error => error.code === 'CANDIDATE_OFFICE_PROJECTION_IDENTITY_INVALID'
  );
  assert.equal(calls, 0);
});

test('required mutation idempotency key is enforced before transport', async () => {
  let calls = 0;
  const api = load(async () => { calls += 1; return { ok: true, status: 200, text: async () => '{}' }; });
  const action = {
    contract_version: 'OFFICE_CANDIDATE_ACTION_V1',
    code: 'SEND_MANAGER_REMINDER',
    label: 'Send manager reminder',
    group: 'MANAGER_APPROVAL',
    prominent: false,
    enabled: true,
    requires_confirmation: true,
    requires_reason: false,
    invocation: {
      version: 1,
      kind: 'HTTP',
      method: 'POST',
      path: `/api/candidate-app/workflows/${UUID_A}/actions/remind`,
      fixed_body: { generation: 1 },
      required_user_inputs: [],
      idempotency: 'REQUIRED'
    }
  };
  await assert.rejects(
    () => api.invokeOfficeCandidateAction({ action, idempotencyKey: '' }),
    error => error.code === 'CANDIDATE_IDEMPOTENCY_KEY_REQUIRED'
  );
  assert.equal(calls, 0);
});

test('durable PARTIAL reminder result is returned as structured batch truth', async () => {
  const api = load(async () => ({
    ok: true,
    status: 202,
    text: async () => JSON.stringify({
      ok: true,
      contract_version: 'OFFICE_CANDIDATE_REMINDER_BATCH_RESULT_V1',
      batch_id: UUID_A,
      status: 'PARTIAL',
      success_count: 2,
      failure_count: 1,
      skipped_count: 1,
      items: []
    })
  }));
  const result = await api.executeManagerReminderSelection({
    selection: { mode: 'EXPLICIT', included_row_keys: ['row-a'], excluded_row_keys: [] },
    catalogueRevision: 'a'.repeat(64),
    preview: {
      selected_rows: [{ row_key: 'row-a', timesheet_id: UUID_A, contract_week_id: null }],
      preview_context_hash: 'b'.repeat(64),
      selection_fingerprint: 'c'.repeat(64)
    },
    batchId: UUID_A,
    idempotencyKey: UUID_A
  });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.success_count, 2);
  assert.equal(result.failure_count, 1);
  assert.equal(result.skipped_count, 1);
});

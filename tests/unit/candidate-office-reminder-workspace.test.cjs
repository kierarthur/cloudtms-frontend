const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const source = name => fs.readFileSync(path.join(root, 'js', name), 'utf8');

function load(...names) {
  const context = vm.createContext({
    window: {}, console, Date, Intl, Object, Set, String, URLSearchParams, AbortController,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' }
  });
  names.forEach(name => new vm.Script(source(name), { filename: name }).runInContext(context));
  return context.window;
}

test('Tools places the approved manager reminder workspace immediately after Bulk Process', () => {
  const main = source('main.js');
  const blockStart = main.indexOf("addBtn('Bulk Process'");
  const reminder = main.indexOf("addBtn('Send Manager Reminders'", blockStart);
  const bulkAuthorise = main.indexOf("addBtn('Bulk Authorise'", reminder);
  assert.ok(blockStart > -1 && reminder > blockStart && bulkAuthorise > reminder);
  assert.match(main.slice(reminder, bulkAuthorise), /send_manager_reminder_batch/);
  assert.match(main.slice(reminder, bulkAuthorise), /openCandidateManagerReminderWorkspace/);
});

test('reminder workspace contains only the agreed catalogue fields, paging and actions', () => {
  const workspace = source('candidate-office-reminder-workspace-v1.js');
  assert.match(workspace, />Candidate name\s*</);
  assert.match(workspace, />Last request or reminder sent\s*</);
  assert.match(workspace, /Search by Candidate surname/);
  assert.match(workspace, /data-reminder-sort="CANDIDATE_SURNAME"/);
  assert.match(workspace, /data-reminder-sort="LAST_MANAGER_EMAIL"/);
  assert.match(workspace, />Previous</);
  assert.match(workspace, />Next</);
  assert.match(workspace, /Page \$\{state\.page\} of \$\{state\.pageCount\}/);
  assert.match(workspace, />Cancel</);
  assert.match(workspace, />\$\{state\.sending \? 'Sending reminders…' : 'Send Reminders'\}</);
  assert.match(workspace, />Refresh current state</);
  assert.match(workspace, /openCandidateReminderBatchModal/);
  assert.match(workspace, /if \(!confirmation\?\.confirmed\) return/);
  assert.doesNotMatch(workspace, /Cancel Manager Approval Request|PHONE_APPROVE|PHONE_REFUSE|signature/i);
});

test('preview freezes the exact server-selected rows and execute reuses them for durable replay', () => {
  const window = load('candidate-office-contract-v1.js');
  const selectedRow = {
    row_key: 'row-1',
    timesheet_id: '00000000-0000-4000-8000-000000000321',
    contract_week_id: null,
    expected_row_signature: 'row-signature'
  };
  const preview = window.CloudTMSCandidateOfficeContract.normalizeManagerReminderBatchPreview({
    ok: true,
    contract_version: 'OFFICE_CANDIDATE_REMINDER_BATCH_PREVIEW_V1',
    preview_context_hash: 'a'.repeat(64),
    selection_fingerprint: 'b'.repeat(64),
    selected_count: 1,
    selected_rows: [selectedRow]
  });
  assert.equal(preview.selected_rows.length, 1);
  assert.equal(preview.selected_rows[0].timesheet_id, selectedRow.timesheet_id);
  assert.throws(() => window.CloudTMSCandidateOfficeContract.normalizeManagerReminderBatchPreview({
    ...preview, selected_count: 2
  }), /selection is inconsistent/i);
  assert.match(source('candidate-office-api-v1.js'), /selected_rows:\s*preview\.selected_rows/);
});

test('select all is a genuine all-pages selection with exclusions', () => {
  const window = load('candidate-office-reminder-workspace-v1.js');
  const api = window.CloudTMSCandidateOfficeReminderWorkspace;
  const state = {
    catalogueTotalItems: 73,
    matchingSelectionKeys: ['row-1', 'row-7', 'row-42'],
    selectionMode: 'ALL_ELIGIBLE',
    included: new Set(),
    excluded: new Set(['row-7', 'row-42'])
  };
  assert.equal(api.selectedCount(state), 71);
  assert.equal(api.isSelected(state, 'row-1'), true);
  assert.equal(api.isSelected(state, 'row-7'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(api.selectionBody(state))), {
    mode: 'ALL_ELIGIBLE', included_row_keys: [], excluded_row_keys: ['row-42', 'row-7']
  });
});

test('filter selections remain durable when the surname result set changes', () => {
  const window = load('candidate-office-reminder-workspace-v1.js');
  const api = window.CloudTMSCandidateOfficeReminderWorkspace;
  const state = {
    catalogueTotalItems: 53,
    matchingSelectionKeys: ['baines', 'barker'],
    selectionMode: 'EXPLICIT',
    included: new Set(['baines', 'smith']),
    excluded: new Set()
  };
  assert.equal(api.selectedCount(state), 2);
  assert.equal(api.matchingSelectedCount(state), 1);
  state.matchingSelectionKeys = ['smith'];
  assert.equal(api.selectedCount(state), 2);
  assert.equal(api.matchingSelectedCount(state), 1);
  assert.equal(api.isSelected(state, 'baines'), true);
});

test('manager request timing uses the existing UK 24-hour date-time format', () => {
  const window = load('candidate-office-reminder-workspace-v1.js');
  assert.match(
    window.CloudTMSCandidateOfficeReminderWorkspace.formatDateTime('2026-08-13T17:04:09Z'),
    /^13\/08\/2026 18:04:09$/
  );
});

test('API selection contract forbids ambiguous or empty explicit selections', () => {
  const window = load('candidate-office-contract-v1.js', 'candidate-office-api-v1.js');
  const normalize = window.CloudTMSCandidateOfficeApi.normalizeManagerReminderSelection;
  assert.deepEqual(JSON.parse(JSON.stringify(normalize({
    mode: 'EXPLICIT', included_row_keys: ['row-2', 'row-1', 'row-2'], excluded_row_keys: []
  }))), { mode: 'EXPLICIT', included_row_keys: ['row-2', 'row-1'], excluded_row_keys: [] });
  assert.throws(() => normalize({ mode: 'EXPLICIT', included_row_keys: [], excluded_row_keys: [] }), /inconsistent/i);
  assert.throws(() => normalize({ mode: 'ALL_ELIGIBLE', included_row_keys: ['row-1'], excluded_row_keys: [] }), /inconsistent/i);
});

test('eligibility page contract validates pagination, exact identity and frozen catalogue revision', () => {
  const window = load('candidate-office-contract-v1.js');
  const result = window.CloudTMSCandidateOfficeContract.normalizeManagerReminderEligibilityPage({
    ok: true,
    contract_version: 'OFFICE_CANDIDATE_REMINDER_ELIGIBILITY_PAGE_V1',
    catalogue_revision: 'a'.repeat(64),
    page: 2,
    page_size: 25,
    page_count: 3,
    total_items: 53,
    catalogue_total_items: 53,
    surname_query: '',
    sort_by: 'CANDIDATE_SURNAME',
    sort_direction: 'ASC',
    matching_selection_keys: Array.from({ length: 53 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
    items: [{
      selection_key: '00000000-0000-4000-8000-000000000026',
      candidate_name: 'Candidate Twenty Six',
      candidate_surname: 'Six',
      last_manager_email_at_utc: '2026-08-13T09:00:00Z',
      identity: {
        row_key: 'row-26',
        timesheet_id: '00000000-0000-4000-8000-000000000026',
        contract_week_id: null,
        expected_row_signature: 'sig-26'
      }
    }]
  });
  assert.equal(result.page, 2);
  assert.equal(result.items[0].candidate_name, 'Candidate Twenty Six');
  assert.equal(result.items[0].candidate_surname, 'Six');
  assert.equal(result.items[0].identity.row_key, 'row-26');
  assert.throws(() => window.CloudTMSCandidateOfficeContract.normalizeManagerReminderEligibilityPage({
    ...result,
    catalogue_revision: 'not-a-sha'
  }), /catalogue_revision is invalid/i);
});

test('lost response recovery reads a durable partial result without creating a new batch', async () => {
  const window = load(
    'candidate-office-contract-v1.js',
    'candidate-office-reminder-workspace-v1.js'
  );
  let executeCalls = 0;
  window.CloudTMSCandidateOfficeApi = {
    fetchManagerReminderBatch: async ({ batchId }) => ({
      ok: true,
      contract_version: 'OFFICE_CANDIDATE_REMINDER_BATCH_RESULT_V1',
      batch_id: batchId,
      status: 'PARTIAL',
      success_count: 2,
      failure_count: 1,
      skipped_count: 1,
      items: []
    }),
    executeManagerReminderSelection: async () => { executeCalls += 1; }
  };
  const activeBatch = { batchId: '00000000-0000-4000-8000-000000000001' };
  const result = await window.CloudTMSCandidateOfficeReminderWorkspace.recoverReminderBatch(activeBatch);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(executeCalls, 0);
});

for (const status of [403, 429]) {
  test(`a ${status} status-read failure preserves the unresolved batch`, async () => {
    const window = load(
      'candidate-office-contract-v1.js',
      'candidate-office-reminder-workspace-v1.js'
    );
    let executeCalls = 0;
    window.CloudTMSCandidateOfficeApi = {
      fetchManagerReminderBatch: async () => {
        const error = new Error(`status lookup failed with ${status}`);
        error.status = status;
        error.code = status === 403 ? 'OFFICE_PERMISSION_REQUIRED' : 'RATE_LIMITED';
        throw error;
      },
      executeManagerReminderSelection: async () => { executeCalls += 1; }
    };
    const activeBatch = Object.freeze({
      batchId: '00000000-0000-4000-8000-000000000001',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      selection: Object.freeze({ mode: 'EXPLICIT' }),
      exactRetryConsumed: false
    });
    await assert.rejects(
      window.CloudTMSCandidateOfficeReminderWorkspace.recoverReminderBatch(activeBatch),
      error => error.status === status && error.reminderBatchOutcomeUncertain === true
    );
    assert.equal(executeCalls, 0);
  });
}

test('a later authoritative 404 after an ambiguous status failure uses the one exact retry', async () => {
  const window = load(
    'candidate-office-contract-v1.js',
    'candidate-office-reminder-workspace-v1.js'
  );
  let statusCalls = 0;
  const seen = [];
  window.CloudTMSCandidateOfficeApi = {
    fetchManagerReminderBatch: async () => {
      statusCalls += 1;
      const error = new Error(statusCalls === 1 ? 'rate limited' : 'not found');
      error.status = statusCalls === 1 ? 429 : 404;
      error.code = statusCalls === 1 ? 'RATE_LIMITED' : 'CANDIDATE_REMINDER_BATCH_NOT_FOUND';
      throw error;
    },
    executeManagerReminderSelection: async request => {
      seen.push(request);
      return { status: 'PARTIAL', success_count: 1, failure_count: 1, skipped_count: 0 };
    }
  };
  const activeBatch = Object.freeze({
    batchId: '00000000-0000-4000-8000-000000000001',
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    selection: Object.freeze({ mode: 'EXPLICIT' }),
    exactRetryConsumed: false
  });
  await assert.rejects(
    window.CloudTMSCandidateOfficeReminderWorkspace.recoverReminderBatch(activeBatch),
    error => error.status === 429 && error.reminderBatchOutcomeUncertain === true
  );
  let updatedBatch = null;
  const result = await window.CloudTMSCandidateOfficeReminderWorkspace.recoverReminderBatch(activeBatch, {
    onBatchUpdate: batch => { updatedBatch = batch; }
  });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].batchId, activeBatch.batchId);
  assert.equal(seen[0].idempotencyKey, activeBatch.idempotencyKey);
  assert.equal(updatedBatch.exactRetryConsumed, true);
});

test('PARTIAL and FAILED are rendered as structured durable results with exact counts', () => {
  const window = load('candidate-office-reminder-workspace-v1.js');
  const render = window.CloudTMSCandidateOfficeReminderWorkspace.renderResult;
  const partial = render({ result: { status: 'PARTIAL', success_count: 2, skipped_count: 1, failure_count: 1 } });
  assert.match(partial, /Some reminders could not be sent/);
  assert.match(partial, /<strong>2<\/strong> sent/);
  assert.match(partial, /<strong>1<\/strong> no longer eligible/);
  assert.match(partial, /<strong>1<\/strong> failed/);
  assert.doesNotMatch(partial, /candidate-reminder-workspace__error/);

  const failed = render({ result: { status: 'FAILED', success_count: 0, skipped_count: 0, failure_count: 3 } });
  assert.match(failed, /Manager reminders were not sent/);
  assert.match(failed, /<strong>0<\/strong> sent/);
  assert.match(failed, /<strong>0<\/strong> no longer eligible/);
  assert.match(failed, /<strong>3<\/strong> failed/);
  assert.doesNotMatch(failed, /candidate-reminder-workspace__error/);
});

test('missing receipt recovery retries the exact frozen batch identity once', async () => {
  const window = load(
    'candidate-office-contract-v1.js',
    'candidate-office-reminder-workspace-v1.js'
  );
  const seen = [];
  window.CloudTMSCandidateOfficeApi = {
    fetchManagerReminderBatch: async () => {
      const error = new Error('not found');
      error.status = 404;
      error.code = 'CANDIDATE_REMINDER_BATCH_NOT_FOUND';
      throw error;
    },
    executeManagerReminderSelection: async request => {
      seen.push(request);
      return { status: 'FAILED', success_count: 0, failure_count: 3, skipped_count: 0 };
    }
  };
  const activeBatch = Object.freeze({
    batchId: '00000000-0000-4000-8000-000000000001',
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    selection: Object.freeze({ mode: 'EXPLICIT' })
  });
  let updatedBatch = null;
  const result = await window.CloudTMSCandidateOfficeReminderWorkspace.recoverReminderBatch(activeBatch, {
    onBatchUpdate: batch => { updatedBatch = batch; }
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].batchId, seen[0].idempotencyKey);
  assert.equal(seen[0].batchId, activeBatch.batchId);
  assert.equal(seen[0].exactRetryConsumed, true);
  assert.equal(updatedBatch, seen[0]);
});

test('a consumed exact retry makes every later 404 recovery status-only', async () => {
  const window = load(
    'candidate-office-contract-v1.js',
    'candidate-office-reminder-workspace-v1.js'
  );
  let executeCalls = 0;
  window.CloudTMSCandidateOfficeApi = {
    fetchManagerReminderBatch: async () => {
      const error = new Error('not found');
      error.status = 404;
      error.code = 'CANDIDATE_REMINDER_BATCH_NOT_FOUND';
      throw error;
    },
    executeManagerReminderSelection: async () => { executeCalls += 1; }
  };
  const activeBatch = Object.freeze({
    batchId: '00000000-0000-4000-8000-000000000001',
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    selection: Object.freeze({ mode: 'EXPLICIT' }),
    exactRetryConsumed: true
  });
  await assert.rejects(
    window.CloudTMSCandidateOfficeReminderWorkspace.recoverReminderBatch(activeBatch),
    error => error.reminderBatchOutcomeUncertain === true
  );
  assert.equal(executeCalls, 0);
});

test('continued uncertainty renders a recovery-only workspace with no ordinary actions', () => {
  const window = load('candidate-office-reminder-workspace-v1.js');
  const html = window.CloudTMSCandidateOfficeReminderWorkspace.renderRecovery({
    sending: false,
    error: { message: 'The durable result is not available yet.' },
    activeBatch: {
      exactRetryConsumed: true,
      preview: { selected_count: 3 }
    }
  });
  assert.match(html, /Reminder result pending/);
  assert.match(html, /Refresh current state/);
  assert.match(html, /exact original reminder batch/);
  assert.doesNotMatch(html, /data-reminder-send|data-reminder-cancel|data-reminder-search|data-reminder-select-all|data-reminder-sort|data-reminder-page/);
});

test('the send function hard-guards a retained operation before generating a new UUID', () => {
  const workspace = source('candidate-office-reminder-workspace-v1.js');
  const start = workspace.indexOf('async function sendReminders(state)');
  const end = workspace.indexOf('const isUncertainBatchError', start);
  const body = workspace.slice(start, end);
  const retainedGuard = body.indexOf('state.activeBatch || restoredUnresolvedBatch()');
  const returnFromGuard = body.indexOf('return;', retainedGuard);
  const uuid = body.indexOf('crypto.randomUUID()');
  assert.ok(retainedGuard > -1 && returnFromGuard > retainedGuard && uuid > returnFromGuard);
});

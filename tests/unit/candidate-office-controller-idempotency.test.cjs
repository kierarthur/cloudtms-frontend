const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'js', 'candidate-office-controller-v1.js'), 'utf8');

function loadController() {
  const window = {
    CloudTMSCandidateOfficeUiPolicy: {
      MANAGER_JOURNEY_ACTIONS: [],
      CANDIDATE_APP_ACTIONS: [],
      assertOfficeButtonApproved: () => true
    },
    CloudTMSCandidateOfficeContract: {
      normalizeOfficeCandidateAction: action => action,
      normalizeCandidateOfficeError: error => ({
        code: error.code || 'CANDIDATE_OFFICE_UNKNOWN',
        message: error.message,
        stale: error.code === 'CANDIDATE_CONTEXT_STALE'
      })
    },
    CloudTMSCandidateOfficeApi: {},
    CloudTMSCandidateOfficeModals: {
      openCandidateManagerActionModal: async () => ({ confirmed: true, inputs: {} }),
      openCandidateTypedActionModal: async () => ({ confirmed: true, inputs: {} })
    },
    location: { origin: 'https://testmode.example' },
    open: () => null
  };
  const context = vm.createContext({ window, Object, Set, Map, String, Number, Array, JSON, Error, URL, Blob, setTimeout, crypto });
  new vm.Script(source, { filename: 'candidate-office-controller-v1.js' }).runInContext(context);
  return context.window.CloudTMSCandidateOfficeController;
}

function action(fixedBody = { generation: 1 }) {
  return {
    code: 'SEND_MANAGER_REMINDER',
    label: 'Send manager reminder',
    enabled: true,
    requires_confirmation: false,
    requires_reason: false,
    invocation: {
      kind: 'HTTP',
      path: '/api/candidate-app/workflows/example/actions/remind',
      fixed_body: fixedBody,
      required_user_inputs: [],
      idempotency: 'REQUIRED'
    }
  };
}

test('an unknown transport result reuses the same operation key on exact retry', async () => {
  const module = loadController();
  const seen = [];
  let attempt = 0;
  const controller = module.createCandidateOfficeActionController({
    api: {
      invokeOfficeCandidateAction: async input => {
        seen.push(input.idempotencyKey);
        attempt += 1;
        if (attempt === 1) throw Object.assign(new Error('Connection lost'), { code: 'CANDIDATE_OFFICE_NETWORK_ERROR' });
        return { ok: true, refresh_hints: { refetch: 'NONE' } };
      }
    },
    createIdempotencyKey: () => 'operation-key-1',
    ensureFresh: async () => true,
    refetchProjection: async () => {},
    showToast: () => {}
  });
  const context = { surface: 'SIMPLE_TIMESHEET', identity: { row_key: 'row-a' }, action: action() };

  assert.equal((await controller.runTypedAction(context)).ok, false);
  assert.equal((await controller.runTypedAction(context)).ok, true);
  assert.deepEqual(seen, ['operation-key-1', 'operation-key-1']);
});

test('changed factual input cannot replace an unresolved operation under the same logical action', async () => {
  const module = loadController();
  let calls = 0;
  const controller = module.createCandidateOfficeActionController({
    api: {
      invokeOfficeCandidateAction: async () => {
        calls += 1;
        throw Object.assign(new Error('Connection lost'), { code: 'CANDIDATE_OFFICE_NETWORK_ERROR' });
      }
    },
    createIdempotencyKey: () => 'operation-key-1',
    ensureFresh: async () => true,
    refetchProjection: async () => {},
    showToast: () => {}
  });
  const base = { surface: 'SIMPLE_TIMESHEET', identity: { row_key: 'row-a' } };
  await controller.runTypedAction({ ...base, action: action({ generation: 1 }) });
  const changed = await controller.runTypedAction({ ...base, action: action({ generation: 2 }) });
  assert.equal(changed.ok, false);
  assert.equal(changed.error.code, 'CANDIDATE_IDEMPOTENCY_CONFLICT');
  assert.equal(calls, 1);
});

test('a duplicate click cannot start a second in-flight mutation', async () => {
  const module = loadController();
  let calls = 0;
  let release;
  const firstResult = new Promise(resolve => { release = resolve; });
  const controller = module.createCandidateOfficeActionController({
    api: {
      invokeOfficeCandidateAction: async () => {
        calls += 1;
        await firstResult;
        return { ok: true, refresh_hints: { refetch: 'NONE' } };
      }
    },
    createIdempotencyKey: () => 'operation-key-1',
    ensureFresh: async () => true,
    refetchProjection: async () => {},
    showToast: () => {}
  });
  const context = { surface: 'SIMPLE_TIMESHEET', identity: { row_key: 'row-a' }, action: action() };
  const first = controller.runTypedAction(context);
  await new Promise(resolve => setImmediate(resolve));
  const second = await controller.runTypedAction(context);
  assert.equal(second.ok, false);
  assert.equal(second.busy, true);
  assert.equal(calls, 1);
  release();
  assert.equal((await first).ok, true);
});

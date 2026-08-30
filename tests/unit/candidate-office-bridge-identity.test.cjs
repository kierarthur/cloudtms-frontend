const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const bridgeSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'candidate-office-bridge-v1.js'),
  'utf8'
);

const projectionFor = row => ({
  current_identity: {
    row_key: row.row_key,
    timesheet_id: row.timesheet_id,
    contract_week_id: row.contract_week_id,
    row_signature: row.expected_row_signature
  },
  available_actions: [],
  rejections: []
});

function slotFor(signature, { surface = 'TIMESHEET_SUMMARY', timesheetId = `00000000-0000-4000-8000-00000000000${signature === 'old' ? '1' : '2'}` } = {}) {
  return {
    dataset: {
      candidateOfficeSurface: surface,
      candidateOfficeVariant: 'compact',
      rowKey: 'row-1',
      timesheetId,
      contractWeekId: '00000000-0000-4000-8000-000000000010',
      rowSignature: signature
    },
    innerHTML: '',
    isConnected: true,
    closest: () => null,
    remove() { this.isConnected = false; },
    replaceChildren() { this.innerHTML = ''; }
  };
}

function harness(api) {
  const slots = [];
  const document = {
    body: {},
    documentElement: { removeAttribute() {} },
    addEventListener() {},
    querySelectorAll(selector) {
      if (!selector.includes('[data-candidate-office-slot="1"]')) return [];
      return slots.filter(slot => {
        const surface = selector.match(/data-candidate-office-surface="([^"]+)"/)?.[1];
        const rowKey = selector.match(/data-row-key="([^"]+)"/)?.[1];
        return slot.isConnected
          && (!surface || slot.dataset.candidateOfficeSurface === surface)
          && (!rowKey || slot.dataset.rowKey === rowKey);
      });
    }
  };
  const window = {
    CloudTMSCandidateOfficeApi: api,
    CloudTMSCandidateOfficeContract: {
      normalizeCandidateOfficeError: error => ({ code: error.code || 'ERROR', message: error.message || 'error' })
    },
    CloudTMSCandidateOfficePresenter: {
      presentCandidateOfficeSummary: projection => projection,
      presentCandidateOfficeDetail: projection => projection
    },
    CloudTMSCandidateOfficeSurface: {
      renderCandidateUnavailable: error => `error:${error.code}`,
      renderCandidateFragment: projection => projection.current_identity.row_signature
    },
    CloudTMSCandidateOfficeController: { createCandidateOfficeActionController: () => ({}) },
    CloudTMSCandidateOfficeModals: {},
    CloudTMSCandidateOfficeUiPolicy: {},
    dispatchEvent() {}
  };
  const sandbox = {
    window,
    document,
    console,
    CSS: { escape: value => String(value) },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    MutationObserver: class MutationObserver { observe() {} },
    requestAnimationFrame: callback => callback(),
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000099' }
  };
  vm.createContext(sandbox);
  new vm.Script(bridgeSource, { filename: 'candidate-office-bridge-v1.js' }).runInContext(sandbox);
  window.CloudTMSCandidateOfficeBridge.initialize({
    contract_version: 'CLOUDTMS_OFFICE_CANDIDATE_API_V1',
    authority_applies: true,
    permissions: { view_candidate_state: true },
    surfaces: { simple_timesheet: true, timesheet_summary: true }
  });
  return { window, slots };
}

test('batch hydration never reuses one row key across changed exact timesheet identity', async () => {
  let calls = 0;
  const h = harness({
    fetchOfficeCandidateProjections: async ({ surface, identities }) => {
      calls += 1;
      return {
        surface,
        results: identities.map(row => ({ ok: true, correlation_key: row.row_key, projection: projectionFor(row) }))
      };
    }
  });
  const oldSlot = slotFor('old');
  h.slots.push(oldSlot);
  await h.window.CloudTMSCandidateOfficeBridge.hydrateBatch('TIMESHEET_SUMMARY', [oldSlot]);
  assert.equal(oldSlot.innerHTML, 'old');

  const newSlot = slotFor('new');
  h.slots.push(newSlot);
  await h.window.CloudTMSCandidateOfficeBridge.hydrateBatch('TIMESHEET_SUMMARY', [newSlot]);

  assert.equal(calls, 2, 'changed exact identity must cause a fresh bounded projection request');
  assert.equal(oldSlot.innerHTML, 'old', 'new projection must not repaint the old exact identity');
  assert.equal(newSlot.innerHTML, 'new');
});

test('simultaneous batch slots with one row key retain independent exact signatures', async () => {
  const calls = [];
  const h = harness({
    fetchOfficeCandidateProjections: async ({ surface, identities }) => {
      calls.push(identities.map(row => row.expected_row_signature));
      return {
        surface,
        results: identities.map(row => ({ ok: true, correlation_key: row.row_key, projection: projectionFor(row) }))
      };
    }
  });
  const oldSlot = slotFor('old');
  const newSlot = slotFor('new');
  h.slots.push(oldSlot, newSlot);

  await h.window.CloudTMSCandidateOfficeBridge.hydrateBatch('TIMESHEET_SUMMARY', [oldSlot, newSlot]);

  assert.equal(JSON.stringify(calls), JSON.stringify([['old'], ['new']]), 'duplicate correlation keys must be isolated into bounded requests');
  assert.equal(oldSlot.innerHTML, 'old');
  assert.equal(newSlot.innerHTML, 'new');
  assert.equal(h.window.CloudTMSCandidateOfficeBridge.findProjection('TIMESHEET_SUMMARY', 'row-1', {
    row_key: 'row-1',
    timesheet_id: oldSlot.dataset.timesheetId,
    contract_week_id: oldSlot.dataset.contractWeekId,
    expected_row_signature: 'old'
  }).current_identity.row_signature, 'old');
  assert.equal(h.window.CloudTMSCandidateOfficeBridge.findProjection('TIMESHEET_SUMMARY', 'row-1', {
    row_key: 'row-1',
    timesheet_id: newSlot.dataset.timesheetId,
    contract_week_id: newSlot.dataset.contractWeekId,
    expected_row_signature: 'new'
  }).current_identity.row_signature, 'new');
});

test('Candidate Submission sorting isolates duplicate row keys by exact identity', async () => {
  const calls = [];
  const h = harness({
    buildIdentity: row => row,
    fetchOfficeCandidateProjections: async ({ surface, identities }) => {
      calls.push(identities.map(row => row.expected_row_signature));
      return {
        surface,
        results: identities.map(row => ({
          ok: true,
          correlation_key: row.row_key,
          projection: { ...projectionFor(row), status_label: row.expected_row_signature === 'old' ? 'Manager Approved' : 'Awaiting Candidate Submission' }
        }))
      };
    }
  });
  h.window.CloudTMSCandidateOfficePresenter.presentCandidateOfficeSummary = projection => ({ status: { label: projection.status_label } });
  const rows = [
    {
      id: 'old-row', row_key: 'row-1', timesheet_id: '00000000-0000-4000-8000-000000000001',
      contract_week_id: '00000000-0000-4000-8000-000000000010', expected_row_signature: 'old', candidate_name: 'Alpha'
    },
    {
      id: 'new-row', row_key: 'row-1', timesheet_id: '00000000-0000-4000-8000-000000000002',
      contract_week_id: '00000000-0000-4000-8000-000000000010', expected_row_signature: 'new', candidate_name: 'Beta'
    }
  ];

  const sorted = await h.window.CloudTMSCandidateOfficeBridge.sortSummaryRowsByCandidateStatus(rows, 'asc');

  assert.equal(JSON.stringify(calls), JSON.stringify([['old'], ['new']]), 'duplicate correlation keys must never share a projection request');
  assert.deepEqual(Array.from(sorted, row => row.id), ['new-row', 'old-row']);
});

test('every Office surface renders no Candidate slot and performs no identity work for a server-marked non-applicable row', () => {
  let identityBuilds = 0;
  const h = harness({
    buildIdentity: row => {
      identityBuilds += 1;
      return row;
    }
  });
  const manual = {
    row_key: 'manual-row',
    timesheet_id: '00000000-0000-4000-8000-000000000111',
    candidate_office_projection_not_applicable: true
  };
  for (const surface of ['TIMESHEET_SUMMARY', 'SIMPLE_TIMESHEET', 'BULK_PROCESS', 'BULK_AUTHORISE']) {
    assert.equal(h.window.CloudTMSCandidateOfficeBridge.slotHtml(surface, manual), '', surface);
  }
  assert.equal(identityBuilds, 0, 'the marker is checked before identity construction or projection work');

  assert.equal(h.window.CloudTMSCandidateOfficeBridge.slotHtml('SIMPLE_TIMESHEET', {
    row_key: 'nested-manual-row',
    timesheet_id: '00000000-0000-4000-8000-000000000112',
    timesheet: { candidate_office_projection_not_applicable: true }
  }), '');
  assert.equal(identityBuilds, 0, 'nested detail markers are also authoritative');
});

test('a late old single-row response cannot overwrite or repaint the newer exact identity', async () => {
  const pending = new Map();
  const h = harness({
    fetchOfficeCandidateProjection: ({ rowIdentity }) => new Promise(resolve => {
      pending.set(rowIdentity.expected_row_signature, () => resolve(projectionFor(rowIdentity)));
    })
  });
  const oldSlot = slotFor('old', { surface: 'SIMPLE_TIMESHEET' });
  const newSlot = slotFor('new', { surface: 'SIMPLE_TIMESHEET' });
  h.slots.push(oldSlot, newSlot);

  const oldLoad = h.window.CloudTMSCandidateOfficeBridge.loadSlot(oldSlot, { force: true });
  const newLoad = h.window.CloudTMSCandidateOfficeBridge.loadSlot(newSlot, { force: true });
  pending.get('new')();
  await newLoad;
  pending.get('old')();
  await oldLoad;

  assert.equal(newSlot.innerHTML, 'new');
  assert.equal(oldSlot.innerHTML, '', 'obsolete response must not repaint its superseded slot');
  assert.equal(
    h.window.CloudTMSCandidateOfficeBridge.findProjection('SIMPLE_TIMESHEET', 'row-1', {
      row_key: 'row-1',
      timesheet_id: newSlot.dataset.timesheetId,
      contract_week_id: newSlot.dataset.contractWeekId,
      expected_row_signature: 'new'
    }).current_identity.row_signature,
    'new'
  );
});

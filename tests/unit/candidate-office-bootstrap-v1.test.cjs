const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'candidate-office-bootstrap-v1.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const listeners = new Map();
  const requests = [];
  const initialized = [];
  let deactivated = 0;
  const window = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    CloudTMSCandidateOfficeApi: {
      fetchOfficeCandidateCapabilities() {
        const request = deferred();
        requests.push(request);
        return request.promise;
      }
    },
    CloudTMSCandidateOfficeBridge: {
      initialize(value) { initialized.push(value); },
      deactivate() { deactivated += 1; }
    },
    CloudTMSCandidateOfficeContract: {
      normalizeCandidateOfficeError(error) {
        return { code: error?.code || 'ERROR', status: Number(error?.status || 0), auth: false };
      }
    }
  };
  const document = {
    readyState: 'loading',
    documentElement: { dataset: {} },
    addEventListener() {}
  };
  vm.runInNewContext(source, { window, document, console, Object }, { filename: 'candidate-office-bootstrap-v1.js' });
  return {
    window,
    requests,
    initialized,
    listeners,
    get deactivated() { return deactivated; }
  };
}

const capabilities = generation => ({
  authority_applies: true,
  permissions: { view_candidate_state: true },
  contract_version: `contract-${generation}`
});

test('a replaced capabilities request cannot overwrite the current Office session authority', async () => {
  const h = harness();
  const bootstrap = h.window.CloudTMSCandidateOfficeBootstrap.bootstrapCandidateOffice;
  const first = bootstrap();
  const second = bootstrap({ force: true });

  h.requests[1].resolve(capabilities('new'));
  assert.equal((await second).active, true);
  assert.deepEqual(h.initialized.map(item => item.contract_version), ['contract-new']);

  h.requests[0].resolve(capabilities('old'));
  const stale = await first;
  assert.equal(stale.stale, true);
  assert.deepEqual(h.initialized.map(item => item.contract_version), ['contract-new']);
  assert.equal(h.window.CloudTMSCandidateOfficeBridge != null, true);
  assert.equal(h.deactivated, 1, 'only the deliberate force reset should deactivate authority');
});

test('logout invalidates an in-flight capabilities response before it can initialize Office state', async () => {
  const h = harness();
  const bootstrap = h.window.CloudTMSCandidateOfficeBootstrap.bootstrapCandidateOffice;
  const pending = bootstrap();
  h.listeners.get('cloudtms:office-session-cleared')();
  h.requests[0].resolve(capabilities('logged-out'));

  const result = await pending;
  assert.equal(result.stale, true);
  assert.equal(h.initialized.length, 0);
  assert.equal(h.deactivated, 1);
});

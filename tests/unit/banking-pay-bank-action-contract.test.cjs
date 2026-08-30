const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

const helperStart = mainSource.indexOf('const parseBlockerCodes =');
const helperEnd = mainSource.indexOf('const getFriendlyBlockerText =', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Banking Pay bank-action helpers must be present');

const helperSource = mainSource.slice(helperStart, helperEnd);

function installHarness(candidates = []) {
  const context = {
    Array,
    JSON,
    Map,
    Object,
    Set,
    String,
    allCandidates: candidates,
    asBool: (value) => value === true || String(value || '').toLowerCase() === 'true',
    enc: (value) => String(value),
    getCandidateActionDisabledAttrs: () => '',
    getPreviewRowId: (value) => String(value?.preview_row_id || '').trim(),
    isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    pv: {
      settings: {
        rail: {
          env_default: 'PROD',
          provider_default: 'REVOLUT'
        }
      }
    },
    trimStr: (value) => String(value || '').trim(),
    upperTrim: (value) => String(value || '').trim().toUpperCase()
  };
  vm.runInNewContext(
    `${helperSource}
this.__bankActionHelpers = {
  getLineBankActionMeta,
  renderAcceptBankDetailsButton
};`,
    context,
    { filename: 'banking-pay-bank-action-contract-helpers.js' }
  );
  return context.__bankActionHelpers;
}

test('delta-projected blocked row exposes its reasons and existing readiness action', () => {
  const helpers = installHarness();
  const row = {
    candidate_id: 'candidate-1',
    preview_row_id: 'preview-row-1',
    pay_channel: 'PAYE',
    is_ready_for_draft: false,
    blockers: [],
    blocked_reason_codes: ['BLOCKED_NAME_CHECK', 'BLOCKED_NO_PAYEE_MAP'],
    payee_context: {
      payee_entity_kind: 'CANDIDATE',
      payee_entity_id: 'candidate-1',
      payee_bank_hash: 'current-bank-hash',
      name_check_status: 'UNVERIFIED',
      name_check_has_override: false,
      payee_map_present: false
    }
  };

  const meta = helpers.getLineBankActionMeta(row);
  assert.deepEqual(
    Array.from(meta.blockers),
    ['BLOCKED_NAME_CHECK', 'BLOCKED_NO_PAYEE_MAP']
  );
  assert.equal(meta.payee_entity_kind, 'CANDIDATE');
  assert.equal(meta.payee_entity_id, 'candidate-1');
  assert.equal(meta.bank_details_hash, 'current-bank-hash');
  assert.equal(meta.name_check_status, 'UNVERIFIED');
  assert.equal(meta.name_check_has_override, false);
  assert.equal(meta.payee_map_present, false);

  const actionHtml = helpers.renderAcceptBankDetailsButton(meta);
  assert.match(actionHtml, /data-action="banking:pay:runBankNameCheck"/);
  assert.match(actionHtml, />Run bank\/name check<\/button>/);
  assert.match(actionHtml, /data-bank-details-hash="current-bank-hash"/);
});

test('legacy top-level blocker and readiness fields remain compatible', () => {
  const helpers = installHarness();
  const row = {
    candidate_id: 'candidate-2',
    preview_row_id: 'preview-row-2',
    blockers: ['BLOCKED_NO_PAYEE_MAP'],
    payee_entity_kind: 'CANDIDATE',
    payee_entity_id: 'candidate-2',
    bank_details_hash: 'legacy-bank-hash',
    name_check_status: 'PASS',
    name_check_has_override: false,
    payee_map_present: false
  };

  const meta = helpers.getLineBankActionMeta(row);
  assert.deepEqual(Array.from(meta.blockers), ['BLOCKED_NO_PAYEE_MAP']);
  assert.equal(meta.bank_details_hash, 'legacy-bank-hash');
  assert.match(
    helpers.renderAcceptBankDetailsButton(meta),
    /data-action="banking:pay:ensurePayeeMap"/
  );
});

test('the rendered action remains wired to the established payee-readiness route', () => {
  assert.match(
    mainSource,
    /if \(a === 'banking:pay:runBankNameCheck' \|\| a === 'banking:pay:ensurePayeeReadiness'\)[\s\S]*apiPostJson\('\/api\/banking\/pay\/payee-readiness\/ensure'/
  );
});

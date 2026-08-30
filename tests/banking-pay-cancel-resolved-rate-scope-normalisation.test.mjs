import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(repoRoot, 'js', 'main.js'), 'utf8');
const normaliserStartMarker = 'function normaliseResolvedRateClearRefreshScopeV1(clearResult, requestContext = {}) {';
const modalStartMarker = 'async function openBankingPayCancelResolvedRatesModal(seed = {}) {';
const modalEndMarker = '\n// Full replacement  for attachBankingModalDelegatedHandlers';
const normaliserStart = source.indexOf(normaliserStartMarker);
const modalStart = source.indexOf(modalStartMarker, normaliserStart);
const modalEnd = source.indexOf(modalEndMarker, modalStart);

assert.ok(normaliserStart >= 0, 'clear scope normaliser must exist');
assert.ok(modalStart > normaliserStart, 'clear modal must follow the normaliser');
assert.ok(modalEnd > modalStart, 'clear modal must have a stable end marker');

const normaliserSource = source.slice(normaliserStart, modalStart);
const modalSource = source.slice(modalStart, modalEnd);

const SESSION = '11111111-1111-4111-8111-111111111111';
const CANDIDATE = '22222222-2222-4222-8222-222222222222';
const ANCHOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINKED_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LINKED_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FOREIGN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function json(value) {
  return JSON.parse(JSON.stringify(value));
}

function createNormaliser() {
  const context = vm.createContext({});
  vm.runInContext(`${normaliserSource}\nglobalThis.normalise = normaliseResolvedRateClearRefreshScopeV1;`, context);
  return (result, expected = {}) => json(context.normalise(result, {
    session_id: SESSION,
    candidate_id: CANDIDATE,
    anchor_timesheet_id: ANCHOR,
    expected_affected_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B],
    ...expected
  }));
}

function baseResult(overrides = {}) {
  return {
    ok: true,
    session_id: SESSION,
    session_version: 12,
    candidate_id: CANDIDATE,
    anchor_timesheet_id: ANCHOR,
    targeted_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B],
    linked_timesheet_ids: [LINKED_A, LINKED_B],
    eligible_linked_timesheet_count: 2,
    total_affected_timesheet_count: 3,
    ...overrides
  };
}

test('verifies the current clear response with anchor excluded from linked rows', () => {
  const result = createNormaliser()(baseResult());
  assert.equal(result.scopeVerified, true);
  assert.deepEqual(result.canonicalAffectedTimesheetIds, [ANCHOR, LINKED_A, LINKED_B].sort());
  assert.deepEqual(result.canonicalLinkedTimesheetIds, [LINKED_A, LINKED_B].sort());
});

test('allows the anchor in a linked or family representation when the complete set is exact', () => {
  const result = createNormaliser()(baseResult({ linked_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B] }));
  assert.equal(result.scopeVerified, true);
  assert.deepEqual(result.canonicalLinkedTimesheetIds, [LINKED_A, LINKED_B].sort());
});

test('accepts an authoritative affected set without optional count evidence', () => {
  const result = createNormaliser()({
    ok: true,
    session_id: SESSION,
    session_version: 13,
    candidate_id: CANDIDATE,
    anchor_timesheet_id: ANCHOR,
    affected_timesheet_ids: [LINKED_B, ANCHOR, LINKED_A],
    linked_timesheet_ids: [LINKED_A, LINKED_B]
  });
  assert.equal(result.scopeVerified, true);
  assert.equal(result.verificationDetail.complete_set_source, 'affected_timesheet_ids');
});

test('accepts the supported refresh-target alias as a complete set', () => {
  const result = createNormaliser()({
    ok: true,
    session_id: SESSION,
    session_version: 13,
    candidate_id: CANDIDATE,
    anchor_timesheet_id: ANCHOR,
    refresh_target_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B],
    eligible_linked_timesheet_ids: [LINKED_A, LINKED_B]
  });
  assert.equal(result.scopeVerified, true);
  assert.equal(result.verificationDetail.complete_set_source, 'refresh_target_timesheet_ids');
});

test('canonicalises case variants and duplicate UUIDs before comparing sets', () => {
  const result = createNormaliser()(baseResult({
    targeted_timesheet_ids: [LINKED_B.toUpperCase(), ANCHOR, LINKED_A, LINKED_A.toUpperCase()],
    linked_timesheet_ids: [ANCHOR.toUpperCase(), ANCHOR, LINKED_B, LINKED_A, LINKED_A.toUpperCase()]
  }));
  assert.equal(result.scopeVerified, true);
  assert.deepEqual(result.canonicalAffectedTimesheetIds, [ANCHOR, LINKED_A, LINKED_B].sort());
  assert.deepEqual(result.canonicalLinkedTimesheetIds, [LINKED_A, LINKED_B].sort());
});

test('rejects count evidence that disagrees with the canonical set', () => {
  const result = createNormaliser()(baseResult({ eligible_linked_timesheet_count: 3 }));
  assert.equal(result.scopeVerified, false);
  assert.ok(result.verificationDetail.issues.includes('LINKED_TIMESHEET_COUNT_MISMATCH'));
});

test('rejects a complete affected set that omits the anchor', () => {
  const result = createNormaliser()(baseResult({
    targeted_timesheet_ids: [LINKED_A, LINKED_B],
    total_affected_timesheet_count: 2
  }));
  assert.equal(result.scopeVerified, false);
  assert.ok(result.verificationDetail.issues.includes('AFFECTED_SET_ANCHOR_MISSING'));
});

test('rejects an unknown affected timesheet', () => {
  const result = createNormaliser()(baseResult({
    targeted_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B, FOREIGN],
    total_affected_timesheet_count: 4
  }));
  assert.equal(result.scopeVerified, false);
  assert.ok(result.verificationDetail.issues.includes('AFFECTED_SET_UNEXPECTED_TARGET'));
});

test('rejects foreign candidate and session identities', () => {
  const normalise = createNormaliser();
  const foreignCandidate = normalise(baseResult({ candidate_id: FOREIGN }));
  const foreignSession = normalise(baseResult({ session_id: FOREIGN }));
  assert.equal(foreignCandidate.scopeVerified, false);
  assert.ok(foreignCandidate.verificationDetail.issues.includes('RETURNED_CANDIDATE_ID_MISMATCH'));
  assert.equal(foreignSession.scopeVerified, false);
  assert.ok(foreignSession.verificationDetail.issues.includes('RETURNED_SESSION_ID_MISMATCH'));
});

test('rejects an invalid UUID in the authoritative set', () => {
  const result = createNormaliser()(baseResult({
    targeted_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B, 'not-a-uuid'],
    total_affected_timesheet_count: 3
  }));
  assert.equal(result.scopeVerified, false);
  assert.ok(result.verificationDetail.issues.includes('RETURNED_AFFECTED_TIMESHEET_IDS_INVALID_UUID'));
});

test('a committed clear returns accepted when optional scope verification is inconclusive', async () => {
  let discoveryCalls = 0;
  let mutationCalls = 0;
  const warnings = [];
  const context = vm.createContext({
    escapeHtml: (value) => String(value),
    console: { warn: (...args) => warnings.push(args) },
    openUiConfirmModal: async () => ({ confirmed: true }),
    bankingPayWorkbenchSessionClearCaseResolution: async () => {
      discoveryCalls += 1;
      return {
        ok: true,
        operation: 'LIST_CLEARABLE',
        session_id: SESSION,
        session_version: 11,
        progress_counter_version: 7,
        candidate_id: CANDIDATE,
        anchor_timesheet_id: ANCHOR,
        anchor_case_key: `timesheet:${ANCHOR}`,
        clearable_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B],
        clearable_linked_timesheet_ids: [LINKED_A, LINKED_B],
        eligible_linked_timesheet_count: 2,
        total_affected_timesheet_count: 3,
        excluded_linked_timesheets: [],
        excluded_linked_timesheet_count: 0
      };
    }
  });
  vm.runInContext(
    `${normaliserSource}\n${modalSource}\nglobalThis.openCancel = openBankingPayCancelResolvedRatesModal;`,
    context
  );

  const result = await context.openCancel({
    workbench_session_id: SESSION,
    session_version: 11,
    expected_progress_counter_version: 7,
    candidate_id: CANDIDATE,
    clicked_timesheet_id: ANCHOR,
    clicked_case_key: `timesheet:${ANCHOR}`,
    onConfirm: async () => {
      mutationCalls += 1;
      return baseResult({
        session_version: 12,
        targeted_timesheet_ids: [ANCHOR, LINKED_A, LINKED_B, FOREIGN],
        total_affected_timesheet_count: 4
      });
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(result.mutation_accepted, true);
  assert.equal(result.refresh_scope_verified, false);
  assert.equal(result.requires_canonical_refresh, true);
  assert.equal(result.verification_code, 'BANKING_PAY_RESOLVED_RATE_CLEAR_SCOPE_UNVERIFIED_AFTER_COMMIT');
  assert.equal(discoveryCalls, 1);
  assert.equal(mutationCalls, 1, 'the clear mutation must never be replayed');
  assert.equal(warnings.length, 1, 'one structured post-commit diagnostic must be recorded');
});

test('post-commit timeout copy preserves the accepted-clear distinction and the control is disabled', () => {
  assert.match(source, /clearAccepted = modalResult\?\.mutation_accepted === true \|\| modalResult\?\.accepted === true/);
  assert.match(source, /el\.disabled = true;[\s\S]{0,200}el\.setAttribute\('aria-disabled', 'true'\)/);
  assert.match(source, /The resolved rate was cancelled, but the current preview pages are still refreshing\. Refresh Banking Pay to read the latest state\./);
  assert.match(source, /expectedSessionId:\s*workbenchSessionId/);
  assert.match(source, /minimumSessionVersion,/);
  assert.match(source, /requirePreviewSectionsAfterReady:\s*true/);
  assert.doesNotMatch(source, /returned refresh scope did not reconcile/);
});

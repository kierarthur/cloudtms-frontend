import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(repoRoot, 'js', 'main.js'), 'utf8');
const startMarker = 'async function bankingPayWorkbenchSessionApplyCaseResolution(sessionId, payload = {}) {';
const start = source.indexOf(startMarker);
const end = source.indexOf('\n// SHA-256 suffix:', start);

assert.ok(start >= 0, 'case-resolution helper must exist');
assert.ok(end > start, 'case-resolution helper must have a stable end marker');

const functionSource = source.slice(start, end);

function createHarness(responses) {
  const calls = [];
  const context = vm.createContext({
    API: (value) => value,
    bankingBuildEnrichedFriendlyError: (error) => error,
    bankingPayAugmentWorkbenchFreshnessPayload: (_sessionId, payload) => ({ ...payload }),
    authFetch: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      const response = responses.shift();
      assert.ok(response, 'unexpected extra request');
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        text: async () => JSON.stringify(response.body)
      };
    }
  });
  vm.runInContext(`${functionSource}\nglobalThis.caseResolution = bankingPayWorkbenchSessionApplyCaseResolution;`, context);
  return { calls, caseResolution: context.caseResolution };
}

test('retries one progress-only conflict using the server current counter', async () => {
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const { calls, caseResolution } = createHarness([
    {
      status: 409,
      body: {
        ok: false,
        code: 'WORKBENCH_SESSION_PROGRESS_CHANGED',
        current_session_version: 7,
        current_progress_counter_version: 42
      }
    },
    {
      status: 200,
      body: {
        operation: 'DISCOVER',
        session_id: sessionId,
        candidate_id: '22222222-2222-4222-8222-222222222222',
        session_version: 7
      }
    }
  ]);

  const result = await caseResolution(sessionId, {
    operation: 'DISCOVER',
    candidate_id: '22222222-2222-4222-8222-222222222222',
    expected_session_version: 7,
    expected_progress_counter_version: 41
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].expected_progress_counter_version, 41);
  assert.equal(calls[1].expected_session_version, 7);
  assert.equal(calls[1].expected_progress_counter_version, 42);
});

test('does not retry a changed decision session version', async () => {
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const { calls, caseResolution } = createHarness([
    {
      status: 409,
      body: {
        ok: false,
        code: 'STALE_SESSION',
        current_session_version: 8,
        current_progress_counter_version: 42
      }
    }
  ]);

  await assert.rejects(
    caseResolution(sessionId, {
      operation: 'APPLY',
      candidate_id: '22222222-2222-4222-8222-222222222222',
      expected_session_version: 7,
      expected_progress_counter_version: 41
    }),
    (error) => error?.code === 'STALE_SESSION'
  );
  assert.equal(calls.length, 1);
});

test('suggested-rate apply uses the exact fence returned by its immediate discovery', () => {
  assert.match(
    source,
    /bucket_resolutions:\s*deep\(bucketResolutions\),\s*expected_session_version:\s*authoritativeScope\.session_version,\s*expected_progress_counter_version:\s*authoritativeScope\.progress_counter_version/
  );
});

test('single-candidate resolution success adopts the candidate refresh without waiting for unrelated work', () => {
  assert.match(
    source,
    /const refreshCandidateId = affectedCandidateIds\.length === 1 \? affectedCandidateIds\[0\] : '';\s*settledResult = await pollPayWorkbenchCandidateUntilSettled\(sessionId, refreshCandidateId,/
  );
  assert.match(
    source,
    /queued\.needs_full_session_refresh === true[\s\S]*queued\.full_session_refresh_required === true[\s\S]*refresh_scope/
  );
  assert.doesNotMatch(
    source,
    /shouldForceFullSessionRefreshAfterMutation[\s\S]{0,1200}Array\.isArray\(queued\.case_resolution_ids\)/
  );
  assert.match(
    source,
    /settled:\s*true,\s*ready:\s*true,\s*required_preview_sections_loaded:\s*true,\s*session_id:\s*sessionIdText/
  );
  assert.match(source, /while \(candidatePreviewPageCount < 100\)/);
  assert.match(source, /atomic_candidate_refresh_complete:\s*true/);
  assert.equal(
    (source.match(/mergePayWorkbenchCandidatePreviewIntoState\(candidatePreview\)/g) || []).length,
    1,
    'the fully paged candidate authority must be merged once'
  );
});

test('accepted resolved-rate clear always reaches canonical session polling without replaying the POST', () => {
  assert.match(
    source,
    /clearAccepted = modalResult\?\.mutation_accepted === true \|\| modalResult\?\.accepted === true;[\s\S]{0,2600}pollPayWorkbenchCandidateUntilSettled\(workbenchSessionId, '', \{/
  );
  assert.match(source, /expectedSessionId:\s*workbenchSessionId/);
  assert.match(source, /minimumSessionVersion,/);
  assert.match(source, /requirePreviewSectionsAfterReady:\s*true/);
  assert.match(source, /returnedSessionId && returnedSessionId !== workbenchSessionId\.toLowerCase\(\)/);
  assert.equal(
    (source.slice(source.indexOf("if (a === 'banking:pay:clearCaseResolution')"), source.indexOf("if (a === 'banking:pay:componentClearResolution')"))
      .match(/bankingPayWorkbenchSessionClearCaseResolution\(workbenchSessionId/g) || []).length,
    1,
    'the delegated clear branch must send one mutation request and use polling for adoption'
  );
});

test('overpayment presentation uses resolved target-channel amounts after a pay-method change', () => {
  assert.match(
    source,
    /const original = toMagnitude\(\s*component\?\.resolved_target_amount_ex_vat,[\s\S]*component\?\.target_pay_ex_vat,[\s\S]*component\?\.source_amount,/
  );
  assert.match(
    source,
    /const outstanding = toMagnitude\(\s*component\?\.target_outstanding_ex_vat,[\s\S]*component\?\.remaining_source_amount,/
  );
});

test('bucketed custom rate remains reachable when no single suggestion is honest', () => {
  assert.match(
    source,
    /const hasManualRateBasis = \([\s\S]*Number\.isFinite\(sourceUnits\)[\s\S]*Number\.isFinite\(sourceRate\)[\s\S]*Number\.isFinite\(sourceChargeRate\)/
  );
  assert.match(
    source,
    /\|\| hasManualRateBasis/
  );
  assert.match(
    source,
    /const toNum = \(v\) => \{\s*if \(v == null\) return null;\s*if \(typeof v === 'string' && !trimStr\(v\)\) return null;/
  );
});

test('taxable restructure renders the installed ERNI, VAT and inclusive-total aliases', () => {
  assert.match(source, /suggestedArrangement\.erni_rate_pct/);
  assert.match(source, /suggestedArrangement\.vat_rate_pct/);
  assert.match(source, /suggestedArrangement\.target_remaining_balance_vat/);
  assert.match(source, /suggestedArrangement\.target_remaining_balance_inc_vat/);
  assert.match(source, /r\.target_remaining_amount_vat/);
});

test('effective pay date survives a validation rerender after being entered in UK format', () => {
  assert.match(
    source,
    /value="\$\{enc\(toUk\(parseToIso\(state\.new_start_week_start\) \|\| state\.new_start_week_start\)\)\}"/
  );
});

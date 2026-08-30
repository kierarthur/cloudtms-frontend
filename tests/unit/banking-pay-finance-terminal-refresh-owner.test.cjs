const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
const SESSION_ID = '01245cf8-6819-41de-a9a7-f6641a34ad26';
const TARGET_ID = '6e8493ae-c207-497e-8d83-0b518753f590';
const OTHER_ID = '11111111-1111-4111-8111-111111111111';

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} must exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return source.slice(start, end);
}

const helperSource = sliceBetween(
  'function finalisePayWorkbenchCandidateRefreshOwnershipV1(sessionId, candidateIds, options = {}) {',
  'async function pollPayWorkbenchCandidateUntilSettled(sessionId, candidateId, options = {}) {'
);
const finaliseRefreshOwnership = vm.runInNewContext(`(() => {
  ${helperSource}
  return finalisePayWorkbenchCandidateRefreshOwnershipV1;
})()`, { Array, String, Number, Object, Set, WeakSet, Date });

function refreshingRow(candidateId, rowId) {
  return {
    preview_row_id: rowId,
    candidate_id: candidateId,
    status: 'READY',
    __heartbeat_refreshing: true,
    __candidate_refreshing: true,
    candidate_refresh_pending: true,
    pending_refresh: true,
    refreshing: true,
    row_json: { candidate_id: candidateId }
  };
}

function buildRefreshOwner(candidateId, otherId) {
  return {
    session_id: SESSION_ID,
    session_version: 49,
    pending_candidate_ids: [candidateId, otherId],
    dirty_candidate_ids: [candidateId, otherId],
    failed_candidate_ids: [candidateId, otherId],
    refreshing_candidate_ids: [candidateId, otherId],
    __heartbeat_refreshing_candidate_ids: [candidateId, otherId],
    __candidate_refresh_stale_ids: [candidateId, otherId],
    pending_candidate_rows: [refreshingRow(candidateId, 'target-pending'), refreshingRow(otherId, 'other-pending')],
    failed_candidate_rows: [refreshingRow(candidateId, 'target-failed'), refreshingRow(otherId, 'other-failed')],
    pending_candidate_jobs: [refreshingRow(candidateId, 'target-job'), refreshingRow(otherId, 'other-job')],
    candidate_sample_rows: [refreshingRow(candidateId, 'target-sample'), refreshingRow(otherId, 'other-sample')],
    candidate_status_rows: [refreshingRow(candidateId, 'target-status'), refreshingRow(otherId, 'other-status')],
    active_jobs: [refreshingRow(candidateId, 'target-active'), refreshingRow(otherId, 'other-active')],
    candidate_jobs: [refreshingRow(candidateId, 'target-candidate-job'), refreshingRow(otherId, 'other-candidate-job')]
  };
}

function makeFixture() {
  const targetPageRow = refreshingRow(TARGET_ID, 'target-page-row');
  const otherPageRow = refreshingRow(OTHER_ID, 'other-page-row');
  const workbench = buildRefreshOwner(TARGET_ID, OTHER_ID);
  workbench.progress = buildRefreshOwner(TARGET_ID, OTHER_ID);
  workbench.progress_counts = buildRefreshOwner(TARGET_ID, OTHER_ID);
  workbench.preview_pages = {
    canonical_preview_lines: { rows: [targetPageRow, otherPageRow], items: [targetPageRow, otherPageRow] }
  };

  const decisions = buildRefreshOwner(TARGET_ID, OTHER_ID);
  decisions.progress = buildRefreshOwner(TARGET_ID, OTHER_ID);
  decisions.progress_counts = buildRefreshOwner(TARGET_ID, OTHER_ID);

  const previewData = buildRefreshOwner(TARGET_ID, OTHER_ID);
  previewData.progress = buildRefreshOwner(TARGET_ID, OTHER_ID);
  previewData.session = buildRefreshOwner(TARGET_ID, OTHER_ID);
  previewData.session.progress = buildRefreshOwner(TARGET_ID, OTHER_ID);
  previewData.preview = buildRefreshOwner(TARGET_ID, OTHER_ID);
  previewData.preview.session_version = 48;
  previewData.preview.progress = buildRefreshOwner(TARGET_ID, OTHER_ID);
  previewData.preview.canonical_preview_lines = [refreshingRow(TARGET_ID, 'target-ready'), refreshingRow(OTHER_ID, 'other-ready')];

  return {
    pay: {
      draftWizard: {
        workbench,
        decisions,
        preview: {
          loading: false,
          progress_only: true,
          data: previewData,
          componentStateCache: {
            ready_to_pay_now: [refreshingRow(TARGET_ID, 'target-cache'), refreshingRow(OTHER_ID, 'other-cache')]
          }
        }
      }
    }
  };
}

function candidateIdFromRow(row) {
  return String(row?.candidate_id || row?.candidateId || row?.row_json?.candidate_id || '').trim();
}

const idKeys = [
  'pending_candidate_ids', 'dirty_candidate_ids', 'failed_candidate_ids',
  'refreshing_candidate_ids', '__heartbeat_refreshing_candidate_ids', '__candidate_refresh_stale_ids'
];
const refreshRowKeys = [
  'pending_candidate_rows', 'failed_candidate_rows', 'pending_candidate_jobs',
  'candidate_sample_rows', 'candidate_status_rows', 'active_jobs', 'candidate_jobs'
];
const rowMarkerKeys = [
  '__heartbeat_refreshing', '__candidate_refreshing', 'candidate_refresh_pending', 'pending_refresh', 'refreshing'
];

function assertOwnerClearedForTarget(owner, label) {
  for (const key of idKeys) {
    assert.equal(owner[key].includes(TARGET_ID), false, `${label}.${key} target`);
    assert.equal(owner[key].includes(OTHER_ID), true, `${label}.${key} unrelated`);
  }
  for (const key of refreshRowKeys) {
    assert.equal(owner[key].some((row) => candidateIdFromRow(row) === TARGET_ID), false, `${label}.${key} target`);
    assert.equal(owner[key].some((row) => candidateIdFromRow(row) === OTHER_ID), true, `${label}.${key} unrelated`);
  }
}

test('terminal candidate ownership clears every target refresh alias and preserves unrelated work', () => {
  const state = makeFixture();
  const result = finaliseRefreshOwnership(SESSION_ID, [TARGET_ID], {
    state,
    expectedSessionVersion: 49
  });

  assert.equal(result.applied, true);
  assert.equal(result.cleared_candidate_count, 1);
  assert.equal(result.remaining_target_refresh_markers, 0);
  assert.ok(result.removed_id_references > 0);
  assert.ok(result.removed_refresh_rows > 0);
  assert.ok(result.cleared_row_markers > 0);

  const wiz = state.pay.draftWizard;
  for (const [label, owner] of [
    ['workbench', wiz.workbench],
    ['workbench.progress', wiz.workbench.progress],
    ['workbench.progress_counts', wiz.workbench.progress_counts],
    ['decisions', wiz.decisions],
    ['decisions.progress', wiz.decisions.progress],
    ['decisions.progress_counts', wiz.decisions.progress_counts],
    ['preview.data', wiz.preview.data],
    ['preview.data.progress', wiz.preview.data.progress],
    ['preview.data.session', wiz.preview.data.session],
    ['preview.data.session.progress', wiz.preview.data.session.progress],
    ['preview.data.preview', wiz.preview.data.preview],
    ['preview.data.preview.progress', wiz.preview.data.preview.progress]
  ]) assertOwnerClearedForTarget(owner, label);

  for (const targetRow of [
    wiz.workbench.preview_pages.canonical_preview_lines.rows[0],
    wiz.preview.data.preview.canonical_preview_lines[0],
    wiz.preview.componentStateCache.ready_to_pay_now[0]
  ]) {
    assert.equal(candidateIdFromRow(targetRow), TARGET_ID);
    for (const key of rowMarkerKeys) assert.equal(Object.hasOwn(targetRow, key), false, `${key} removed`);
  }
  for (const otherRow of [
    wiz.workbench.preview_pages.canonical_preview_lines.rows[1],
    wiz.preview.data.preview.canonical_preview_lines[1],
    wiz.preview.componentStateCache.ready_to_pay_now[1]
  ]) {
    assert.equal(candidateIdFromRow(otherRow), OTHER_ID);
    for (const key of rowMarkerKeys) assert.equal(otherRow[key], true, `${key} preserved`);
  }
});

test('terminal ownership refuses stale session or version cleanup', () => {
  for (const [sessionId, expectedSessionVersion] of [
    ['22222222-2222-4222-8222-222222222222', 49],
    [SESSION_ID, 50]
  ]) {
    const state = makeFixture();
    const before = structuredClone(state);
    const result = finaliseRefreshOwnership(sessionId, [TARGET_ID], { state, expectedSessionVersion });
    assert.equal(result.applied, false);
    assert.deepEqual(state, before);
  }
});

test('primary settle path finalises refresh ownership after exact candidate and section adoption, before terminal render', () => {
  const poll = sliceBetween(
    'async function pollPayWorkbenchCandidateUntilSettled(sessionId, candidateId, options = {}) {',
    'async function bankingPayWorkbenchSessionOpen(payload = {}) {'
  );
  const mergeIndex = poll.indexOf('mergePayWorkbenchCandidatePreviewIntoState(candidatePreview);');
  const progressIndex = poll.indexOf('writeProgressIntoState(normalized);', mergeIndex);
  const finaliseIndex = poll.indexOf('finalisePayWorkbenchCandidateRefreshOwnershipV1(', progressIndex);
  const stopIndex = poll.indexOf('markProgressPollStopped();', finaliseIndex);
  const renderIndex = poll.indexOf('await rerenderQuietly();', stopIndex);

  assert.ok(mergeIndex >= 0, 'candidate replacement must be adopted');
  assert.ok(progressIndex > mergeIndex, 'terminal progress must follow candidate adoption');
  assert.ok(finaliseIndex > progressIndex, 'refresh ownership must clear after candidate/progress adoption');
  assert.ok(stopIndex > finaliseIndex, 'poll flags must stop after refresh ownership clears');
  assert.ok(renderIndex > stopIndex, 'the terminal render must be last');
  assert.match(poll, /expectedSessionVersion:\s*candidatePreviewVersion/);
  assert.match(poll, /settledSectionPages\.all_required_sections_loaded !== true/);
});

test('candidate publication waits for READY progress and bypasses the missing-status session fallback', () => {
  const poll = sliceBetween(
    'async function pollPayWorkbenchCandidateUntilSettled(sessionId, candidateId, options = {}) {',
    'async function bankingPayWorkbenchSessionOpen(payload = {}) {'
  );

  assert.match(
    poll,
    /if \(progressLooksReady\(progress\) && !normalized\.isAnyWatchedPending && minimumCandidateVersionReached\)/,
    'candidate authority must not be fetched while session progress still reports active refresh work'
  );
  assert.match(
    poll,
    /const requiresSessionLevelFallback = !candidateScopedPoll && \([\s\S]*progressRequiresFullRefresh \|\| !normalized\.targetCandidateStatus[\s\S]*\);/,
    'omitted candidate-status rows must not divert a known candidate away from exact candidate authority'
  );
  assert.match(poll, /if \(forceFullSessionRefresh \|\| requiresSessionLevelFallback\)/);
});

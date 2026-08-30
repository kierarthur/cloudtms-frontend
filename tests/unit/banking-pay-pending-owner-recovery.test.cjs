const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

test('authoritative progress contract requires owner-recovery state', () => {
  const start = mainSource.indexOf('const hasFullAuthoritativeProgressContract =');
  const end = mainSource.indexOf('\n  const getAuthoritativeProgressContract =', start);
  assert.ok(start >= 0 && end > start);
  const source = mainSource.slice(start, end);
  assert.match(source, /hasOwnProgressField\(progress, 'recovery_required'\)/);
  assert.match(source, /hasOwnProgressField\(progress, 'recovery_scheduled'\)/);
  assert.match(source, /Array\.isArray\(progress\.pending_owner_failures\)/);
});

test('ownerless pending scope is terminal while a valid successor remains recoverable', () => {
  const start = mainSource.indexOf('const getAuthoritativeWorkbenchProgressState =');
  const end = mainSource.indexOf('\n const candidateStatusRowsFromProgressLike =', start);
  assert.ok(start >= 0 && end > start);
  const source = mainSource.slice(start, end);
  assert.match(source, /recoveryRequired/);
  assert.match(source, /recoveryScheduled/);
  assert.match(source, /pendingOwnerFailures/);
  assert.match(source, /failure[\s\S]*recoveryRequired/);
});

test('terminal owner failure clears stale preview rows and uses CloudTMS confirmation UI', () => {
  const start = mainSource.indexOf('const applyAuthoritativePreviewVisualState =');
  const end = mainSource.indexOf('\n  const finalisePreviewVisualStateAfterRowsApplied =', start);
  assert.ok(start >= 0 && end > start);
  const source = mainSource.slice(start, end);
  assert.match(source, /WORKBENCH_PENDING_SCOPE_WITHOUT_ACTIVE_JOB/);
  assert.match(source, /wiz\.workbench\.canonical_preview_lines = \[\]/);
  assert.match(source, /wiz\.decisions\.ready_to_pay_now = \[\]/);
  assert.match(source, /openUiConfirmModal\(\{/);
  assert.match(source, /kind:\s*'banking-pay-owner-recovery-notice'/);
  assert.doesNotMatch(source, /window\.confirm/);
});

test('progress fingerprint includes visible recovery transitions', () => {
  const start = mainSource.indexOf('const startOrResumeWorkbenchSessionPoll =');
  const end = mainSource.indexOf(
    '\n  const refreshAuthoritativeProgressAfterSessionAcquisition =',
    start
  );
  assert.ok(start >= 0 && end > start);
  const source = mainSource.slice(start, end);
  assert.match(source, /recovery_required_count/);
  assert.match(source, /recovery_scheduled_count/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

test('Banking Pay keeps display readiness separate from backend draft safety', () => {
  assert.match(source, /const displayReady = contractPresent && asBool\(raw\.display_ready\)/);
  assert.match(source, /const draftSafe = contractPresent && asBool\(raw\.draft_safe\)/);
  assert.match(source, /const readyForDraft = contractPresent && asBool\(raw\.ready_for_draft\) && draftSafe/);
  assert.match(source, /The current materialised rows remain available/);
});

test('the central Banking Pay action gate fails closed on backend draft_safe', () => {
  assert.match(
    source,
    /hasOwnProperty\.call\(progress, 'draft_safe'\)[\s\S]*progress\.draft_safe !== true[\s\S]*BACKEND_DRAFT_UNSAFE/
  );
  assert.match(source, /wizard\.createDraftDisabled = createDraftBlocked/);
});

test('Banking Pay explains authoritative shadow and recovery blockers without hiding rows', () => {
  assert.match(source, /SCOPE_RECONCILIATION_SHADOW_MODE/);
  assert.match(source, /running in verification mode/);
  assert.match(source, /UPSTREAM_SCOPE_FAILURE_UNRESOLVED/);
  assert.match(source, /has not yet been recovered/);
  assert.match(source, /CANDIDATE_REFRESH_FAILED/);
  assert.match(source, /Retry or recover it before creating a draft/);
  assert.match(source, /authoritativeRenderState\.displayReady && !authoritativeRenderState\.draftSafe/);
  assert.match(source, /const statusText = backendDraftBlockMessage/);
});

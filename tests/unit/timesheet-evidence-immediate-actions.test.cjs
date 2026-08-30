const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
const blockStart = mainSource.indexOf("if (this.entity === 'timesheets' && k === 'evidence') {");
const blockEnd = mainSource.indexOf('// Finalise setTab', blockStart);

assert.ok(blockStart >= 0 && blockEnd > blockStart, 'timesheet Evidence wiring block must exist');

const evidenceBlock = mainSource.slice(blockStart, blockEnd);

test('Evidence actions are delegated before the awaited source-of-truth refresh', () => {
  const delegateInstall = evidenceBlock.indexOf("root.addEventListener('click', root.__tsEvidenceViewDelegate)");
  const refreshAwait = evidenceBlock.indexOf('await refreshTimesheetEvidenceIntoModalState(tsId)');

  assert.ok(delegateInstall >= 0, 'the immediate Evidence action delegate must be installed');
  assert.ok(refreshAwait >= 0, 'the Evidence source-of-truth refresh must remain present');
  assert.ok(
    delegateInstall < refreshAwait,
    'visible Evidence controls must be wired before the refresh can delay tab readiness'
  );
});

test('the immediate delegate covers every Evidence control exposed before hydration completes', () => {
  for (const selector of [
    'button[data-evidence-view]',
    'button[data-evidence-manage]',
    'button[data-evidence-add]',
    'button[data-evidence-return]',
    'button[data-evidence-remove]'
  ]) {
    assert.match(evidenceBlock, new RegExp(selector.replace(/[\[\]]/g, '\\$&')));
  }

  assert.match(evidenceBlock, /btn\.textContent = 'Opening…'/);
  assert.match(evidenceBlock, /btn\.textContent = 'Preparing…'/);
  assert.match(evidenceBlock, /__tsEvidenceViewOpening/);
  assert.match(evidenceBlock, /__tsPendingEvidenceAction/);
});

test('repainted controls keep one owner and queued sensitive actions reuse existing handlers', () => {
  assert.doesNotMatch(evidenceBlock, /__tsEvViewWired/);
  assert.doesNotMatch(evidenceBlock, /__tsEvManageWired/);
  assert.match(evidenceBlock, /if \(btn\.hasAttribute\('data-evidence-return'\) && !btn\.__tsEvReturnWired\)/);
  assert.match(evidenceBlock, /if \(btn\.hasAttribute\('data-evidence-remove'\) && !btn\.__tsEvRemoveWired\)/);
  assert.match(evidenceBlock, /if \(replayButton\.isConnected\) replayButton\.click\(\)/);
});

test('the ordinary evidence viewer opens its loading shell before awaiting the signed preview URL', () => {
  const viewerStart = mainSource.indexOf('async function openTimesheetEvidenceViewerExisting(evidenceItem)');
  const viewerEnd = mainSource.indexOf('async function openTimesheetPaymentSnoozeModal', viewerStart);
  assert.ok(viewerStart >= 0 && viewerEnd > viewerStart, 'ordinary Evidence viewer must exist');

  const viewerBlock = mainSource.slice(viewerStart, viewerEnd);
  const startPresign = viewerBlock.indexOf('signedUrlPromise = presignDownload(storageKey)');
  const showViewer = viewerBlock.lastIndexOf('showModal(');
  const awaitPresign = viewerBlock.indexOf('signedUrl = await signedUrlPromise');

  assert.ok(startPresign >= 0, 'the signed URL request must start without blocking the viewer shell');
  assert.ok(showViewer > startPresign, 'the viewer must be constructed after starting the request');
  assert.ok(awaitPresign > showViewer, 'the signed URL must only be awaited after the child modal is visible');
  assert.match(viewerBlock, /Preparing preview…/);
  assert.match(viewerBlock, /previewObjectUrl = URL\.createObjectURL\(previewBlob\)/);
  assert.match(viewerBlock, /iframe\.src = previewObjectUrl/);
  assert.match(viewerBlock, /URL\.revokeObjectURL\(previewObjectUrl\)/);
});

test('the Evidence table wraps long labels and provides responsive cell semantics', () => {
  assert.match(mainSource, /class="ts-evidence-table ctms-timesheet-evidence-table"/);
  for (const label of ['Filename', 'Type', 'Source', 'Pages', 'Date uploaded', 'Time', 'Uploaded by', 'Actions']) {
    assert.match(mainSource, new RegExp(`data-ctms-label="${label}"`));
  }
  assert.match(mainSource, /class="ctms-evidence-actions"/);
});

test('electronic signature evidence uses friendly labels without destructive image filtering', () => {
  const signatureStart = mainSource.indexOf('async function openTimesheetEvidenceViewerSignatures(ev)');
  const signatureEnd = mainSource.indexOf('async function openTimesheetEvidenceViewerExisting(evidenceItem)', signatureStart);
  assert.ok(signatureStart >= 0 && signatureEnd > signatureStart, 'signature viewer must exist');
  const signatureBlock = mainSource.slice(signatureStart, signatureEnd);
  assert.match(signatureBlock, /Candidate signature/);
  assert.match(signatureBlock, /Manager signature/);
  assert.match(signatureBlock, /ctms-evidence-signature-sheet/);
  assert.doesNotMatch(signatureBlock, /filter:brightness\(0\)/);
});

test('electronic signature evidence does not add a white signature box', () => {
  const candidateCss = fs.readFileSync(path.resolve(__dirname, '../../css/candidate-office-v1.css'), 'utf8');
  assert.match(candidateCss, /\.ctms-evidence-signature-sheet\s*\{[^}]*background:transparent/);
  assert.match(candidateCss, /\.ctms-evidence-signature-sheet\s*\{[^}]*border:0/);
  assert.doesNotMatch(candidateCss, /\.ctms-evidence-signature-sheet\s*\{[^}]*background:#fff/);
  assert.match(mainSource, /id="ctms-signature-ink-filter"/);
  assert.match(mainSource, /0 0 0 0 0\.0902[\s\S]*0 0 0 0 0\.2471[\s\S]*0 0 0 0 0\.4588/);
  assert.match(mainSource, /class="ctms-evidence-signature-ink"/);
  assert.match(candidateCss, /img\.ctms-evidence-signature-ink\s*\{[^}]*filter:url\(#ctms-signature-ink-filter\)/);
});

test('returning from a child restores the parent anchor before its asynchronous render', () => {
  const syncStart = mainSource.indexOf('const syncParentChromeAfterChildReturn = (fr) => {');
  const syncEnd = mainSource.indexOf('const resumeParentAfterChildReturn = (closing) => {', syncStart);
  assert.ok(syncStart >= 0 && syncEnd > syncStart, 'parent return synchronisation must exist');

  const syncBlock = mainSource.slice(syncStart, syncEnd);
  const restoreAnchor = syncBlock.indexOf("const anchor = getSavedModalAnchor(fr.kind)");
  const renderParent = syncBlock.indexOf('renderTop()');

  assert.ok(restoreAnchor >= 0, 'the returned parent must recover its per-kind anchor');
  assert.ok(renderParent > restoreAnchor, 'the parent anchor must be restored before renderTop can await tab content');
});

test('an awaited parent Evidence refresh cannot overwrite a child modal', () => {
  const setTabStart = mainSource.indexOf('async setTab(k) {');
  const setTabEnd = mainSource.indexOf('function setFrameMode', setTabStart);
  assert.ok(setTabStart >= 0 && setTabEnd > setTabStart, 'modal setTab implementation must exist');

  const setTabBlock = mainSource.slice(setTabStart, setTabEnd);
  assert.match(setTabBlock, /const stillOwnsModalSurface = \(\) => currentFrame\(\) === this/);
  assert.match(setTabBlock, /if \(abortIfModalSurfaceOwnershipChanged\(\)\) return/);

  const evidenceRefresh = setTabBlock.indexOf('await refreshTimesheetEvidenceIntoModalState(tsId)');
  const ownershipCheck = setTabBlock.indexOf('if (!stillOwnsModalSurface())', evidenceRefresh);
  const evidenceRepaint = setTabBlock.indexOf("evidenceBody.innerHTML = this.renderTab('evidence', evidenceMerged)", evidenceRefresh);

  assert.ok(evidenceRefresh >= 0, 'Evidence source-of-truth refresh must exist');
  assert.ok(ownershipCheck > evidenceRefresh, 'modal ownership must be checked after the awaited refresh');
  assert.ok(evidenceRepaint > ownershipCheck, 'the parent repaint must occur only after ownership is confirmed');
});

test('Timesheet child frames cannot be mistaken for the primary Timesheet lifecycle owner', () => {
  const activeFrameStart = mainSource.indexOf('function getActiveTimesheetFrame()');
  const activeFrameEnd = mainSource.indexOf('async function rerenderActiveTimesheetTabAfterSecondary', activeFrameStart);
  assert.ok(activeFrameStart >= 0 && activeFrameEnd > activeFrameStart, 'active Timesheet frame helper must exist');
  const activeFrameBlock = mainSource.slice(activeFrameStart, activeFrameEnd);
  assert.match(activeFrameBlock, /fr\.entity === 'timesheets' && fr\.kind === 'timesheets'/);

  const rerenderStart = mainSource.indexOf('async function safeRerenderTimesheetModal(');
  const rerenderEnd = mainSource.indexOf('// New Phase 3 helper functions', rerenderStart);
  assert.ok(rerenderStart >= 0 && rerenderEnd > rerenderStart, 'safe Timesheet rerender helper must exist');
  const rerenderBlock = mainSource.slice(rerenderStart, rerenderEnd);
  assert.match(rerenderBlock, /fr\.entity !== 'timesheets' \|\| fr\.kind !== 'timesheets'/);
  assert.match(rerenderBlock, /currentFr\.kind === 'timesheets'/);
});

test('read-only Evidence children do not inherit the primary Timesheet lifecycle', () => {
  const viewerStart = mainSource.indexOf('async function openTimesheetEvidenceViewerExisting(evidenceItem)');
  const viewerEnd = mainSource.indexOf('async function openTimesheetPaymentSnoozeModal', viewerStart);
  assert.ok(viewerStart >= 0 && viewerEnd > viewerStart, 'Evidence viewer family must exist');

  const viewerBlock = mainSource.slice(viewerStart, viewerEnd);
  const viewerFrames = viewerBlock.match(/kind:\s*'timesheet-evidence-viewer'/g) || [];
  const isolatedViewerFrames = viewerBlock.match(/kind:\s*'timesheet-evidence-viewer',[\s\S]{0,120}?frameEntity:\s*'timesheet-evidence'/g) || [];

  assert.equal(viewerFrames.length, 3, 'all three Evidence viewer variants must remain present');
  assert.equal(isolatedViewerFrames.length, viewerFrames.length, 'every Evidence viewer must use its own lifecycle entity');
  assert.match(mainSource, /kind:\s*'timesheet-evidence-signatures',[\s\S]{0,120}?frameEntity:\s*'timesheet-evidence'/);
});

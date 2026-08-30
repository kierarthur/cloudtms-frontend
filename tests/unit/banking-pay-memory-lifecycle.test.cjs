const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');

test('Banking Pay graph cloning preserves shared aliases and cycles', () => {
  const start = main.indexOf('function createBankingPayGraphCloneV1()');
  const end = main.indexOf('\n\nfunction didPayWorkbenchSessionIdentityChangeV1', start);
  assert.ok(start >= 0);
  assert.ok(end > start);

  const outcome = vm.runInNewContext(`
    const createClone = (${main.slice(start, end)});
    const clone = createClone();
    const row = { preview_row_id: 'row-1', amount: 43 };
    const source = { canonical_preview_lines: [row], ready_preview_lines: [row] };
    source.self = source;
    const copied = clone(source);
    ({
      copied: copied !== source,
      cycle: copied.self === copied,
      alias: copied.canonical_preview_lines[0] === copied.ready_preview_lines[0],
      memo: clone(source) === copied
    });
  `);
  assert.deepEqual(
    JSON.parse(JSON.stringify(outcome)),
    { copied: true, cycle: true, alias: true, memo: true }
  );
});

test('full and candidate preview state application use the bounded graph clone', () => {
  const fullStart = main.indexOf('function applyPayWorkbenchPreviewToState(');
  const mergeStart = main.indexOf('function mergePayWorkbenchCandidatePreviewIntoState(');
  const mergeEnd = main.indexOf('\n\nasync function bankingPayWorkbench', mergeStart);
  assert.ok(fullStart >= 0);
  assert.ok(mergeStart > fullStart);
  assert.ok(mergeEnd > mergeStart);

  const fullBody = main.slice(fullStart, fullStart + 600);
  const mergeBody = main.slice(mergeStart, mergeStart + 600);
  assert.match(fullBody, /const cloneJson = createBankingPayGraphCloneV1\(\);/);
  assert.match(mergeBody, /const cloneJson = createBankingPayGraphCloneV1\(\);/);
  assert.doesNotMatch(fullBody, /JSON\.parse\(JSON\.stringify\(value\)\)/);
  assert.doesNotMatch(mergeBody, /JSON\.parse\(JSON\.stringify\(value\)\)/);
});

test('a version-only selection update preserves unfetched workbench sections', () => {
  const start = main.indexOf('function didPayWorkbenchSessionIdentityChangeV1(');
  const end = main.indexOf('\n\nfunction applyPayWorkbenchPreviewToState', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const helperSource = main.slice(start, end);
  const result = vm.runInNewContext(`
    ${helperSource}
    ({
      sameIdentity: didPayWorkbenchSessionIdentityChangeV1(
        { pay_date: '2026-07-24', week_ending_cutoff_date: '2026-07-19', session_id: 'session-1', session_signature: 'signature-1', session_version: 7 },
        { pay_date: '2026-07-24', week_ending_cutoff_date: '2026-07-19', session_id: 'session-1', session_signature: 'signature-1', session_version: 8 }
      ),
      replacementIdentity: didPayWorkbenchSessionIdentityChangeV1(
        { pay_date: '2026-07-24', week_ending_cutoff_date: '2026-07-19', session_id: 'session-1', session_signature: 'signature-1' },
        { pay_date: '2026-07-24', week_ending_cutoff_date: '2026-07-19', session_id: 'session-2', session_signature: 'signature-2' }
      )
    });
  `);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    { sameIdentity: false, replacementIdentity: true }
  );

  const applyStart = main.indexOf('function applyPayWorkbenchPreviewToState(');
  const applyEnd = main.indexOf('\nfunction ', applyStart + 1);
  const applyBody = main.slice(applyStart, applyEnd);
  assert.match(applyBody, /activeSessionChanged = didPayWorkbenchSessionIdentityChangeV1/);
  assert.doesNotMatch(applyBody, /activeSessionChanged[\s\S]{0,500}sessionVersionRaw/);
  assert.match(applyBody, /mergeSectionRowsPreservingUnfetchedSections\(previousRowsBySection, incomingPreviewPageRowsBySection, fetchedPreviewSections\)/);
});

test('same-session page reloads cannot regress the accepted workbench version', () => {
  const start = main.indexOf('function resolvePayWorkbenchSessionVersionV1(');
  const end = main.indexOf('\n\nfunction applyPayWorkbenchPreviewToState', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const helperSource = main.slice(start, end);
  const result = vm.runInNewContext(`
    ${helperSource}
    ({
      sameSession: resolvePayWorkbenchSessionVersionV1([12, 11, null], 10, false),
      advancedSession: resolvePayWorkbenchSessionVersionV1([12, 11], 13, false),
      replacementSession: resolvePayWorkbenchSessionVersionV1([12, 11], 1, true)
    });
  `);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    { sameSession: 12, advancedSession: 13, replacementSession: 1 }
  );

  const applyStart = main.indexOf('function applyPayWorkbenchPreviewToState(');
  const applyEnd = main.indexOf('\nfunction ', applyStart + 1);
  const applyBody = main.slice(applyStart, applyEnd);
  assert.match(applyBody, /effectiveSessionVersion = resolvePayWorkbenchSessionVersionV1/);
  assert.match(applyBody, /wiz\.decisions\.session_version = effectiveSessionVersion/);
  assert.match(applyBody, /wiz\.workbench\.session_version = effectiveSessionVersion/);
});

test('candidate refresh builds one successor graph without cloning the installed envelope first', () => {
  const start = main.indexOf('function mergePayWorkbenchCandidatePreviewIntoState(');
  const end = main.indexOf('\n\nasync function bankingPayWorkbench', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const body = main.slice(start, end);

  assert.match(
    body,
    /const currentEnvelope = isPlainObject\(wiz\.preview\.data\) \? wiz\.preview\.data : \{\};/
  );
  assert.match(body, /const nextPreview = cloneJson\(currentPreview\) \|\| \{\};/);
  assert.doesNotMatch(
    body,
    /const currentEnvelope = isPlainObject\(wiz\.preview\.data\) \? \(cloneJson\(wiz\.preview\.data\)/
  );
});

test('workbench page-cache compatibility keys share one bounded graph', () => {
  const start = main.indexOf('const applyMergedPreviewPagesToState = (targetEnvelope = null) => {');
  const end = main.indexOf('  const responseMutationContext =', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const body = main.slice(start, end);

  assert.match(body, /const attachPageMapAliases = \(target\) => \{/);
  for (const key of [
    'preview_pages',
    'previewPages',
    'preview_page_cache',
    'previewPageCache',
    'page_cache',
    'pageCache'
  ]) {
    assert.match(body, new RegExp(`target\\.${key} = pageMap;`));
  }
  assert.doesNotMatch(body, /target\.(?:previewPages|preview_page_cache|previewPageCache|page_cache|pageCache) = cloneJson\(pageMap\)/);
});

test('candidate settle compares completed progress with the pre-adoption snapshot', () => {
  const start = main.indexOf('const scheduleWorkbenchCandidateSettlePoll =');
  const end = main.indexOf('        const refreshWorkbenchAfterHeartbeatSignal =', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const body = main.slice(start, end);

  const snapshotAt = body.indexOf('const beforeProgressAdoption = getWorkbenchProgressSnapshot(afterRead);');
  const stateApplyAt = body.indexOf('applyWorkbenchCandidateRefreshingState(watchContext, nextProgress');
  const settleMergeAt = body.indexOf('refreshWorkbenchVisiblePageAfterProgress(watchContext, nextProgress, beforeProgressAdoption');
  assert.ok(snapshotAt >= 0);
  assert.ok(stateApplyAt > snapshotAt);
  assert.ok(settleMergeAt > stateApplyAt);
  assert.doesNotMatch(
    body,
    /refreshWorkbenchVisiblePageAfterProgress\(watchContext,\s*nextProgress,\s*getWorkbenchProgressSnapshot\(watchContext\)/
  );
});

test('Banking modal dismissal releases the paged workbench graph', () => {
  const start = main.indexOf("async function openBanking(startTabKey = 'pay')");
  const end = main.indexOf('\nasync function ', start + 1);
  const body = main.slice(start, end);
  assert.match(body, /for \(const key of Object\.keys\(wizard\)\) delete wizard\[key\]/);
  assert.match(body, /payState\.draftWizard = null/);
  assert.match(body, /st\.settings\.raw = null/);
  assert.match(body, /st\.caps\.raw = null/);
});

test('Banking Pay selection changes are serialized until the server result is adopted', () => {
  const start = main.indexOf('function attachBankingModalDelegatedHandlers()');
  const end = main.indexOf('function timesheetDiagSanitiseForConsole', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const body = main.slice(start, end);

  assert.match(body, /const runPreviewSelectionMutation = async \(mutation\) => \{/);
  assert.match(body, /let previewSelectionMutationTail = Promise\.resolve\(\)/);
  assert.match(body, /queuedPreviewSelectionMutationCount \+= 1/);
  assert.match(body, /previewSelectionMutationTail\.then\(executeMutation, executeMutation\)/);
  assert.match(body, /if \(queuedPreviewSelectionMutationCount === 0\)/);
  assert.doesNotMatch(body, /data-banking-selection-mutation-pending'\) === '1'[\s\S]{0,120}return false/);
  assert.match(body, /data-banking-selection-mutation-pending/);
  assert.match(body, /setPreviewSelectionControlsBusy\(true\)/);
  assert.match(body, /setPreviewSelectionControlsBusy\(false\)/);
  assert.match(body, /const selectAllChildren = !!\(el && el\.checked === true\)/);
  assert.doesNotMatch(
    body,
    /const currentState = String\(ds\('groupSelectionState'\)[\s\S]{0,200}const selectAllChildren = currentState !== 'ALL'/
  );
});

test('the exact mutation snapshot is applied once and refreshed row contracts are not overwritten', () => {
  const start = main.indexOf('const togglePreviewRowSelection = async');
  const end = main.indexOf('    const normalisePayPreviewPageUiSection =', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const body = main.slice(start, end);

  assert.match(body, /const acceptedAuthority = applySelectionPayloadSummaryToWizard\(result, \{ selectionEpoch \}\);[\s\S]*?reloadCanonicalPreviewAfterSelectionMutation\(\{ acceptedAuthority \}\)/);
  assert.doesNotMatch(body, /reloadCanonicalPreviewAfterSelectionMutation\([\s\S]{0,200}applySelectionPayloadSummaryToWizard\(result/);
  assert.match(
    main,
    /selectionMembershipSnapshotProvided[\s\S]*writePreviewSelectionState\(decisions, selectedIds, authoritativeMode\);[\s\S]*updatePreviewRowSelectionInLoadedState\(getRenderedPreviewRowIds\(\), false\);\s*updatePreviewRowSelectionInLoadedState\(selectedIds, true\);/
  );
  assert.match(main, /await Promise\.all\(\[[\s\S]*loadPayWorkbenchPreviewPageForSection\('canonical_preview_lines', 'reload', \{[\s\S]*loadPayWorkbenchPreviewPageForSection\('blocked_for_pay', 'reload', \{/);
  assert.equal((main.match(/adoptSelectionMutationReadyBlockedPagesV1\(\{/g) || []).length, 1);
});

test('modal global listener cleanup retains the existing drag cleanup chain', () => {
  assert.match(
    main,
    /const previousDetachGlobal = \(typeof top\._detachGlobal === 'function'\) \? top\._detachGlobal : null;/
  );
  assert.match(
    main,
    /if \(previousDetachGlobal\) \{\s*try \{ previousDetachGlobal\(\); \} catch \{\}\s*\}/
  );
});

test('a hidden Banking Pay batch child remains a valid refresh target under its progress modal', () => {
  const start = main.indexOf('const currentChildStateMatches = () => {');
  const end = main.indexOf('  const topChildFrameConflictsWithThisChild', start);
  assert.ok(start >= 0);
  assert.ok(end > start);

  const outcome = vm.runInNewContext(`
    const id = 'batch-1';
    const KIND = 'banking-pay-batch-child';
    const child = { batchId: id, openToken: 'child-token', __modalShown: true };
    const getFrameOpenTokenSafe = (frame) => String(frame?.childOpenToken || frame?._childOpenToken || frame?.openToken || '');
    const getFrameBatchIdSafe = (frame) => String(frame?.payBatchId || frame?.batchId || '');
    const window = {
      modalCtx: { entity: 'banking-operation-progress' },
      __modalStack: [{
        kind: KIND,
        childOpenToken: child.openToken,
        payBatchId: id,
        _ctxRef: {
          entity: 'banking',
          banking: { pay: { child } }
        }
      }, {
        kind: 'banking-operation-progress',
        _ctxRef: { entity: 'banking-operation-progress' }
      }]
    };
    ${main.slice(start, end)}
    ({
      hiddenParentMatches: currentChildStateMatches(),
      wrongTokenRejected: (() => {
        window.__modalStack[0].childOpenToken = 'other-token';
        return currentChildStateMatches();
      })(),
      orphanWithoutFrameRejected: (() => {
        window.__modalStack = [];
        window.modalCtx = {
          entity: 'banking',
          banking: { pay: { child } }
        };
        return currentChildStateMatches();
      })(),
      boundedPreOpenContextAccepted: (() => {
        child.__modalShown = false;
        return currentChildStateMatches();
      })()
    });
  `);

  assert.deepEqual(
    JSON.parse(JSON.stringify(outcome)),
    { hiddenParentMatches: true, wrongTokenRejected: false, orphanWithoutFrameRejected: false, boundedPreOpenContextAccepted: true }
  );
});

test('an orphaned Pay Batch child cannot receive late refreshes and its shared Close has a narrow recovery', () => {
  const orphanStart = main.indexOf('function dismissOrphanedBankingPayBatchChildV1(');
  const orphanEnd = main.indexOf('\n\nasync function openBankingPayBatchChildModal', orphanStart);
  assert.ok(orphanStart >= 0);
  assert.ok(orphanEnd > orphanStart);
  const orphanBody = main.slice(orphanStart, orphanEnd);
  assert.match(orphanBody, /banking-pay-batch-child/);
  assert.match(orphanBody, /Array\.isArray\(options\?\.stackSnapshot\)/);
  assert.match(orphanBody, /if \(stack\.some\([\s\S]*\)\) return false/);
  assert.match(orphanBody, /child\.__dismissOwnedChild/);
  assert.match(orphanBody, /pay\.child = null/);
  assert.match(orphanBody, /back\.style\.display = 'none'/);
  assert.doesNotMatch(orphanBody, /discardAllModalsAndState/);

  const closeStart = main.indexOf('  const onCloseClick = (ev) => {');
  const closeEnd = main.indexOf('    const bindClose = (btn, fr) => {', closeStart);
  assert.ok(closeStart >= 0);
  assert.ok(closeEnd > closeStart);
  const closeBody = main.slice(closeStart, closeEnd);
  assert.match(closeBody,
    /if \(!topNow\)[\s\S]*dismissOrphanedBankingPayBatchChildV1\(\{ source: 'shared-header-close', stackSnapshot: stack\(\) \}\)/);
  assert.match(closeBody,
    /if \(bound !== topNow\._token\)[\s\S]*dismissOrphanedBankingPayBatchChildV1\(\{ source: 'shared-header-owner-mismatch', stackSnapshot: stack\(\) \}\)/);

  const refreshStart = main.indexOf('async function forceRefreshBankingPayBatchChildModalAfterOperation(');
  const refreshEnd = main.indexOf('\n\nfunction ', refreshStart + 1);
  assert.ok(refreshStart >= 0);
  assert.ok(refreshEnd > refreshStart);
  const refreshBody = main.slice(refreshStart, refreshEnd);
  assert.match(refreshBody, /const childHasOwnerFrame = \(child\) => \{/);
  assert.match(refreshBody, /childHasOwnerFrame\(child\) \? child : null/);
});

test('successful Banking reauthentication closes the verified child through its owner-bound close path', () => {
  const start = main.indexOf('    const finishVerified = (token) => {');
  const end = main.indexOf('    const onDismiss =', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const body = main.slice(start, end);

  assert.match(body, /frame\.isDirty = false/);
  assert.match(body, /frame\._snapshot = null/);
  assert.match(body, /closeTop\(\)/);
  assert.match(body, /restoreParentModalCtx\(\)/);
  assert.doesNotMatch(body, /closeModal\(\)/);
});

test('cancellation completion is owned by the open batch watcher, not the progress child timer', () => {
  const scheduleStart = main.indexOf('function scheduleBankingPayCancellationProgressPoll(');
  const scheduleEnd = main.indexOf('\n\nfunction statusPollDelay', scheduleStart);
  assert.ok(scheduleStart >= 0);
  assert.ok(scheduleEnd > scheduleStart);
  const scheduleBody = main.slice(scheduleStart, scheduleEnd);
  assert.match(scheduleBody, /startBankingPayBatchLiveWatch\(state\.payBatchId/);
  assert.match(scheduleBody, /interval_ms:\s*2000/);
  assert.match(scheduleBody, /forceCancellationStatusPoll:\s*true/);
  assert.match(scheduleBody, /allowAnyBankingModal:\s*true/);
  assert.match(scheduleBody, /stopWhenClosed:\s*true/);
  assert.doesNotMatch(scheduleBody, /setTimeout\(/);
  assert.doesNotMatch(scheduleBody, /state\.visible/);

  const closeStart = main.indexOf('function closeBankingPayCancellationProgressModal()');
  const closeEnd = main.indexOf('\n\nfunction bankingPayCancellationProgressIsFinanciallyTerminal', closeStart);
  const closeBody = main.slice(closeStart, closeEnd);
  assert.doesNotMatch(closeBody, /stopBankingPayBatchLiveWatch/);
});

test('the batch watcher force-polls an active cancellation until terminal view refresh succeeds', () => {
  const start = main.indexOf('function startBankingPayBatchLiveWatch(');
  const end = main.indexOf('\n\nfunction buildBankingPayBatchHeartbeatWatches', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const body = main.slice(start, end);
  assert.match(body, /forceCancellationStatusPoll/);
  assert.match(body, /root\?\.watchers\?\.\[id\]\?\.options/);
  assert.match(body, /currentOpts\.allowAnyBankingModal/);
  assert.match(body, /forceCancellationRefresh/);
  assert.match(body, /\{ force: forceCancellationRefresh \}/);
  assert.match(body, /bankingPayCancellationWorkbenchIsCurrent/);
  assert.match(body, /!cancellationWorkbenchCurrent/);
  assert.match(body, /cancellationState\.financialRefreshDone !== true/);
});

test('a terminal cancellation reloads the open Current Payment Status child from server truth', () => {
  const start = main.indexOf('async function refreshBankingPayCancellationFinancialViews()');
  const end = main.indexOf('\n\nasync function syncBankingPayCancellationFromBatchSignal', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const body = main.slice(start, end);
  assert.match(body, /getBankingPayStage3Context/);
  assert.match(body, /stage3StatusPageLoaded === true/);
  assert.match(body, /loadBankingPayStage3StatusPage/);
  assert.match(body, /resetHistory: true/);
});

test('the 45-second heartbeat carries batch watermarks and reuses the same quiet watcher consumer', () => {
  const buildStart = main.indexOf('function buildBankingPayBatchHeartbeatWatches()');
  const buildEnd = main.indexOf('\n\nasync function consumeBankingPayBatchHeartbeatSignals', buildStart);
  assert.ok(buildStart >= 0);
  assert.ok(buildEnd > buildStart);
  const buildBody = main.slice(buildStart, buildEnd);
  for (const field of [
    'known_version',
    'known_payment_status_version',
    'known_correction_progress_version',
    'known_alert_version',
    'known_overview_version'
  ]) assert.match(buildBody, new RegExp(field));

  assert.match(main, /payload\.watched_pay_batches = batchWatches/);
  assert.match(main, /consumeBankingPayBatchHeartbeatSignals\(json\.watched_batch_signals\)/);
  assert.match(main, /watcher\.consumeSignal\(signal, \{ source: 'changes-heartbeat' \}\)/);
  assert.doesNotMatch(buildBody, /openUiConfirmModal|alert\(/);
});

test('missing or different selected batch state is a quiet cancellation projection no-op', () => {
  const start = main.indexOf('function applyBankingPayCancellationActiveProjection(');
  const end = main.indexOf('\n\nasync function refreshBankingPayCancellationFinancialViews', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const body = main.slice(start, end);
  assert.match(body, /modal_state_reason = 'NO_SELECTED_PAYMENT_BATCH'/);
  assert.match(body, /modal_state_reason = 'DIFFERENT_PAYMENT_BATCH_SELECTED'/);
  assert.doesNotMatch(body, /Cancellation needs attention/);
  assert.doesNotMatch(body, /refreshed payment batch is not available/i);
  assert.doesNotMatch(body, /openUiConfirmModal|alert\(/);
});

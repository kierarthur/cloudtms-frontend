const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

test('post-execution refresh is queued behind an already active batch load', () => {
  const start = source.indexOf('const loadBatch = async (opts = {}) =>');
  const end = source.indexOf('const firstRefreshText =', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /mustRunAfterCurrentLoad/);
  assert.match(body, /opts\.executionRefresh === true/);
  assert.match(body, /child\.__loadIdleWaiters\.push\(resolve\)/);
  assert.match(body, /return loadBatch\(\{ \.\.\.opts, __queuedAfterInFlight: true \}\)/);
  assert.match(body, /idleWaiters[\s\S]*resolve\(child\.data \|\| null\)/);
});

test('an explicit stale post-execution flag is sufficient to run the authoritative refresh', () => {
  const start = source.indexOf("const forceChildExecutionRefresh = async");
  const end = source.indexOf('child.__forceRefreshAfterPaymentOperation', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /hasPaymentExecuteRefreshRequiredFlag\(\) \? 'PAYMENT_EXECUTE'/);
  assert.match(body, /detail_mode: 'AUTO'/);
  assert.match(body, /applyPaymentExecutionRefreshFlagsToBatch/);
});

test('Refresh Batch recovers the stale post-execution screen even if operation identity was lost', () => {
  assert.match(
    source,
    /if \(hasPaymentExecuteRefreshContext\(\) \|\| hasPaymentExecuteRefreshRequiredFlag\(\)\) \{[\s\S]*forceChildExecutionRefresh/
  );
});

test('payment execution does not start a full child refresh before the operation is terminal', () => {
  const start = source.indexOf("markPaymentExecuteRefreshDirty(operationId, activeOperationPayload, 'execute-start-mark-dirty')");
  const end = source.indexOf('await rerenderChild();', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /forceChildExecutionRefresh/);
});

test('terminal observation and progress-modal close share one authoritative refresh', () => {
  const start = source.indexOf('const createPaymentExecutionTerminalCallbacks =');
  const end = source.indexOf('const executePaymentPipeline =', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /let terminalRefreshPromise = null/);
  assert.match(body, /if \(terminalRefreshPromise && typeof terminalRefreshPromise\.then === 'function'\) return terminalRefreshPromise/);
  assert.match(body, /onTerminalObserved:[\s\S]*applyTerminalOnce/);
  assert.match(body, /onTerminalClose:[\s\S]*isPaymentExecuteRefreshTerminalState/);
  assert.match(body, /onClose:[\s\S]*isPaymentExecuteRefreshTerminalState/);
});

test('bootstrap Overview does not recursively enqueue while its terminal refresh is already running', () => {
  const start = source.indexOf('const executionRefreshAlreadyRunning =');
  const end = source.indexOf('if (isBootstrapOnly && executionRefreshRequired)', start);
  assert.ok(start >= 0 && end > start);
  const setup = source.slice(start, end);
  assert.match(setup, /child\.__paymentExecutionRefreshInFlight/);
  assert.match(setup, /executionRefreshOperationTerminal/);
  const branch = source.slice(end, source.indexOf('if (isBootstrapOnly) {', end));
  assert.match(branch, /executionRefreshOperationTerminal === true/);
  assert.match(branch, /executionRefreshAlreadyRunning !== true/);
});

test('Pay Batch Overview uses a renderer-local terminal-state helper', () => {
  const rendererStart = source.indexOf('function renderBankingPayBatchChildModalOverview()');
  const rendererEnd = source.indexOf('function renderBankingPayBatchChildModalPaymentIssues', rendererStart);
  assert.ok(rendererStart >= 0 && rendererEnd > rendererStart);
  const renderer = source.slice(rendererStart, rendererEnd);
  assert.match(renderer, /const isOverviewPaymentExecuteRefreshTerminalState =/);
  assert.match(renderer, /const executionRefreshOperationTerminal = isOverviewPaymentExecuteRefreshTerminalState\(/);
  assert.doesNotMatch(renderer, /const executionRefreshOperationTerminal = isPaymentExecuteRefreshTerminalState\(/);
});

test('Pay Batch child renders a recoverable error card instead of stranding the modal', () => {
  const childStart = source.indexOf('async function openBankingPayBatchChildModal');
  const rendererStart = source.indexOf('function renderBankingPayBatchChildModalOverview()', childStart);
  assert.ok(childStart >= 0 && rendererStart > childStart);
  const childOwner = source.slice(childStart, rendererStart);
  assert.match(childOwner, /data-banking-pay-child-overview-render-error="1"/);
  assert.match(childOwner, /data-action="banking:pay:child:refresh"/);
  assert.match(childOwner, /data-action="modal:close"/);
});

test('post-execution Overview render failure retries the authoritative refresh without looping forever', () => {
  const childStart = source.indexOf('async function openBankingPayBatchChildModal');
  const rendererStart = source.indexOf('function renderBankingPayBatchChildModalOverview()', childStart);
  assert.ok(childStart >= 0 && rendererStart > childStart);
  const childOwner = source.slice(childStart, rendererStart);
  assert.match(childOwner, /postExecutionRecoveryRequired/);
  assert.match(childOwner, /recoveryAttempts < 3/);
  assert.match(childOwner, /!hasPaymentExecuteRefreshRequiredFlag\(\) && !child\.__overviewRenderRecoveryTimer/);
  assert.match(childOwner, /overview-render-recovery/);
  assert.match(childOwner, /await forceChildExecutionRefresh/);
  assert.match(childOwner, /data-banking-pay-child-overview-render-recovering="1"/);
  assert.match(childOwner, /Payment execution completed\. CloudTMS is reloading the latest batch details automatically\./);
});

test('closing a Pay Batch child reattaches the Banking parent delegated controls', () => {
  const resumeStart = source.indexOf('const resumeParentAfterChildReturn =');
  const resumeEnd = source.indexOf('bindClose(btnClose, top);', resumeStart);
  assert.ok(resumeStart >= 0 && resumeEnd > resumeStart);
  const resumeOwner = source.slice(resumeStart, resumeEnd);
  assert.match(resumeOwner, /String\(p\.kind \|\| ''\) === 'banking'/);
  assert.match(resumeOwner, /activeParent !== p/);
  assert.match(resumeOwner, /delegated && typeof delegated\.detach === 'function'/);
  assert.match(resumeOwner, /parentCtx\.__bankingDelegated = null/);
  assert.match(resumeOwner, /attachBankingModalDelegatedHandlers\(\)/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(repoRoot, 'js', 'main.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

test('progress modal is read-only, closeable and reopenable from durable request state', () => {
  const modal = slice('const bankingPayCancellationProgressState', 'function getBankingPaymentIssueActionLabel');
  assert.match(modal, /function closeBankingPayCancellationProgressModal/);
  assert.match(modal, /async function openLatestBankingPayCancellationProgress/);
  assert.match(modal, /bankingPayPaymentCorrectionStatus/);
  assert.doesNotMatch(modal, /\/process[`'"?]/);
  assert.doesNotMatch(modal, /localStorage|sessionStorage/);
});

test('financial completion is not obscured by internal Workbench refresh detail', () => {
  const modal = slice('function renderBankingPayCancellationProgressModal', 'async function refreshBankingPayCancellationFinancialViews');
  const renderedStart = modal.indexOf('root.innerHTML = `');
  const renderedEnd = modal.indexOf("root.querySelector('[data-banking-pay-cancellation-close=", renderedStart);
  assert.ok(renderedStart >= 0 && renderedEnd > renderedStart);
  const renderedTemplate = modal.slice(renderedStart, renderedEnd);
  assert.match(modal, /status\.financial_complete === true/);
  assert.match(modal, /const terminalSuccess = terminal/);
  assert.match(modal, /Payment cancellation complete/);
  assert.doesNotMatch(renderedTemplate, /Payment availability|workbench_refresh|NOT_STAGED|STAGED|PENDING|CURRENT/);
});

test('financial completion refreshes Overview, Current Payment Status and PAYE authority without candidate fan-out', () => {
  const refresh = slice('async function refreshBankingPayCancellationFinancialViews', 'async function syncBankingPayCancellationFromBatchSignal');
  const completeProjection = slice('async function loadCompleteBankingPayCancellationProjectionStatus', 'function buildBankingPayCancellationActiveProjection');
  assert.match(refresh, /bankingPayBatchGet/);
  assert.match(refresh, /loadCompleteBankingPayCancellationProjectionStatus/);
  assert.match(completeProjection, /bankingPayPaymentStatusPage/);
  assert.match(refresh, /bankingPayBatchesList/);
  assert.match(refresh, /bankingRerender/);
  assert.match(source, /active_paye_schedule_line_count/);
  assert.match(completeProjection, /limit: 100/);
  assert.match(completeProjection, /rows\.length < 10000/);
  assert.match(completeProjection, /projection_complete: true/);
  assert.match(refresh, /applyBankingPayCancellationActiveProjection/);
  assert.ok(refresh.indexOf('applyBankingPayCancellationActiveProjection') < refresh.indexOf("if (typeof bankingRerender === 'function')"));
  assert.ok(refresh.indexOf("if (typeof bankingRerender === 'function')") < refresh.indexOf('await bankingPayBatchesList'));
  assert.match(refresh, /state\.financialRefreshDone = true;\s*}\s*$/);
  assert.doesNotMatch(`${refresh}\n${completeProjection}`, /for\s*\([^)]*candidate|Promise\.all/);
});

test('terminal refresh continues through the bounded batch-owned watcher after the progress modal closes', () => {
  const polling = slice('function scheduleBankingPayCancellationProgressPoll', 'async function openBankingPayCancellationProgressModal');
  assert.match(polling, /startBankingPayBatchLiveWatch/);
  assert.match(polling, /interval_ms: 2000/);
  assert.match(polling, /forceCancellationStatusPoll: true/);
  assert.match(polling, /stopWhenClosed: true/);
  assert.match(polling, /serverValue == null \? fallback : serverValue/);
  assert.match(polling, /Math\.min\(5000, Math\.max\(1000/);
});

test('historical browser process helper reads status and never advances cancellation work', () => {
  const compatibility = slice('async function bankingPayPaymentCorrectionProcess', 'async function bankingPayPaymentStatusPage');
  assert.match(compatibility, /return bankingPayPaymentCorrectionStatus\(id\)/);
  assert.doesNotMatch(compatibility, /authFetch|method:\s*'POST'/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'main.js'),
  'utf8'
);

function section(from, to) {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `missing section start: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `missing section end: ${to}`);
  return source.slice(start, end);
}

test('candidate finance failures remain errors and never become an authoritative zero report', () => {
  const fetcher = section(
    'async function fetchCandidateAdvances',
    'async function openCandidateLoansOverpaymentsModal'
  );

  assert.match(fetcher, /authFetch\(reportUrl,\s*\{\s*cache:\s*'no-store'\s*\}\)/);
  assert.match(fetcher, /status:\s*'error'/);
  assert.match(fetcher, /Nothing has been treated as zero/);
  assert.match(fetcher, /throw safeError/);
  assert.doesNotMatch(fetcher, /let report = \{\s*candidate:\s*\{\},\s*summary:\s*\{/);
});

test('candidate finance report is a safe view action with a visible retry path', () => {
  const updater = section(
    'function updateCandidateAdvancesUI',
    'async function openCandidate(row)'
  );
  const readOnly = section(
    'function setFormReadOnly',
    '// Timesheet domain-level lock overrides (existing)'
  );

  assert.match(updater, /data-view-action="candidate-finance-report"/);
  assert.match(updater, /candidateFinanceReportRetryBtn/);
  assert.match(updater, /report \? renderAdvancesSummary\(summary\) : ''/);
  assert.doesNotMatch(updater, /\balert\(/);

  const reportModal = section(
    'async function openCandidateLoansOverpaymentsModal',
    'function renderOutboxRunsTab'
  );
  assert.match(reportModal, /data-action="candidateFinance:retry" data-view-action="candidate-finance-report"/);

  assert.match(readOnly, /viewAction === 'candidate-finance-report'/);
  assert.match(readOnly, /top\?\.entity === 'candidates'/);
  assert.match(readOnly, /el\.disabled = false/);
});

test('opening Payment details always refreshes current finance truth', () => {
  const payTab = section(
    '// ───────────────────── Candidates: Pay tab (Finance report launcher + Umbrella wiring)',
    '// ───────────────────── Candidates: Rates tab (Rota Roles + overrides)'
  );

  assert.match(payTab, /if \(cache\[candId\]\) updateCandidateAdvancesUI\(candId\)/);
  assert.match(payTab, /fetchCandidateAdvances\(candId\)\.catch/);
  assert.doesNotMatch(payTab, /else\s*\{\s*\/\/ First time on this candidate/);
  assert.doesNotMatch(payTab, /\balert\(/);
});

test('finance-case state fields survive normalisation for accurate summaries and rows', () => {
  const fetcher = section(
    'async function fetchCandidateAdvances',
    'async function openCandidateLoansOverpaymentsModal'
  );

  for (const field of [
    'is_mixed_case',
    'open_taxable_count',
    'open_reimbursement_count',
    'unresolved_taxable_count',
    'stale_count',
    'component_resolution_summary_json',
    'payout_or_recovery_status'
  ]) {
    assert.match(fetcher, new RegExp(`${field}:`), `${field} must be normalised`);
  }
  assert.match(fetcher, /rawSummary\.component_totals/);
});

test('candidate finance report defaults to active outstanding cases and updates immediately', () => {
  const reportModal = section(
    'async function openCandidateLoansOverpaymentsModal',
    'function renderOutboxRunsTab'
  );

  assert.match(reportModal, /active_only:\s*true/);
  assert.match(
    reportModal,
    /Number\(row\?\.outstanding_amount \|\| 0\) > 0\.004[\s\S]*!isWrittenOffFinanceCase\(row\)/
  );
  assert.match(
    reportModal,
    /state\.active_only \? items\.filter\(isActiveFinanceCase\) : items/
  );
  assert.match(reportModal, /data-action="candidateFinance:activeOnly"/);
  assert.match(reportModal, /data-view-action="candidate-finance-report-filter"/);
  assert.match(reportModal, /activeOnly\.addEventListener\('change'/);
  assert.match(reportModal, /state\.active_only = activeOnly\.checked === true/);

  const readOnly = section(
    'function setFormReadOnly',
    '// Timesheet domain-level lock overrides (existing)'
  );
  assert.match(readOnly, /top\?\.kind === 'candidate-finance-report'/);
  assert.match(readOnly, /viewAction === 'candidate-finance-report-filter'/);
});

test('candidate finance report uses plain labels and tidy non-wrapping status pills', () => {
  const reportModal = section(
    'async function openCandidateLoansOverpaymentsModal',
    'function renderOutboxRunsTab'
  );

  assert.match(reportModal, /General \/ no specific client/);
  assert.match(reportModal, /Recovered from taxable pay/);
  assert.match(reportModal, /Reimbursement carried forward/);
  assert.match(reportModal, /finance-report-pill[\s\S]*white-space:\s*nowrap/);
  assert.match(reportModal, /<th>Status<\/th>/);
  assert.match(reportModal, /<th>Latest communication<\/th>/);
  assert.doesNotMatch(reportModal, /Lifecycle \/ state/);
  assert.doesNotMatch(reportModal, /Not snoozed/);
  assert.doesNotMatch(reportModal, /stale_count:/);
  assert.doesNotMatch(reportModal, /is_mixed_case:/);
  assert.doesNotMatch(reportModal, /open_taxable_count:/);
});

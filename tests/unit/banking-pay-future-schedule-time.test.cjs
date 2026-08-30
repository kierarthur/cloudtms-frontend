const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'js', 'main.js'), 'utf8');

test('future Banking Pay schedules default to a native 02:00 hour/minute control', () => {
  assert.match(source, /schedule_kind: 'IMMEDIATE',[\s\S]{0,120}time_uk: '02:00'/);
  assert.match(source, /id="payExecTimeUk"[\s\S]{0,220}type="time"[\s\S]{0,220}value="\$\{enc\(state\.time_uk \|\| '02:00'\)\}"[\s\S]{0,220}step="60"/);
  assert.match(source, /Time \(UK, 24-hour\)/);
  assert.match(source, /Seconds are always 00\./);
  assert.doesNotMatch(source, /id="payExecTimeUk"[^>]*type="text"/);
});

test('future schedule parsing accepts colon-delimited 24-hour time without seconds', () => {
  assert.match(source, /const m = s\.match\(\/\^\(\\d\{2\}\):\?\(\\d\{2\}\)\$\//);
  assert.match(source, /if \(hh < 0 \|\| hh > 23 \|\| mm < 0 \|\| mm > 59\) return null/);
  assert.match(source, /Scheduled time is required in 24-hour HH:MM format \(e\.g\. 02:00, 23:11\)\./);
  assert.doesNotMatch(source, /sanitizeTimeDigits/);
});

test('switching to scheduled execution restores the 02:00 default if time is empty', () => {
  assert.match(source, /state\.schedule_kind === 'SCHEDULED' && !parseTimeHm\(state\.time_uk\)\) state\.time_uk = '02:00'/);
});

test('payment reauthentication carries the exact future schedule into its purpose-bound token request', () => {
  assert.match(source, /const scheduleKind = String\(opts\.scheduleKind \|\| opts\.schedule_kind \|\| ''\)/);
  assert.match(source, /const scheduledAtUtc = String\(opts\.scheduledAtUtc \|\| opts\.scheduled_at_utc \|\| ''\)/);
  assert.match(source, /execution_mode: executionMode \|\| null,[\s\S]{0,180}schedule_kind: scheduleKind \|\| null,[\s\S]{0,180}scheduled_at_utc: scheduledAtUtc \|\| null/);
  assert.match(source, /purpose: 'PAYMENT_SCHEDULE',[\s\S]{0,180}executionMode: execution_mode,[\s\S]{0,180}scheduleKind,[\s\S]{0,180}scheduledAtUtc/);
});

test('scheduled payment display uses abbreviated UK date and compact 24-hour UK time', () => {
  const start = source.indexOf('function formatBankingPayScheduledAtUkDisplay');
  const end = source.indexOf('\n\nfunction renderPayBatchListPanel', start);
  assert.ok(start >= 0 && end > start, 'scheduled payment formatter must be present');
  const formatter = new Function(`${source.slice(start, end)}; return formatBankingPayScheduledAtUkDisplay;`)();
  assert.equal(formatter('2026-01-01T02:00:00.000Z'), '1 Jan 2026 at 0200hrs');
  assert.equal(formatter('2026-08-13T01:00:00.000Z'), '13 Aug 2026 at 0200hrs');
  assert.equal(formatter('2026-01-22T14:09:00.000Z'), '22 Jan 2026 at 1409hrs');
});

test('scheduled payment is prominent in both the main batch list and batch overview', () => {
  const list = source.slice(source.indexOf('function renderPayBatchListPanel'), source.indexOf('function deriveTimesheetModalInvoicingState'));
  const overviewStart = source.indexOf('function renderBankingPayBatchChildModalOverview');
  const overview = source.slice(overviewStart, source.indexOf('function openBulkTimesheetActionProgressModal', overviewStart));
  assert.match(list, /banking-pay-batch-timing/);
  assert.match(list, />Timing<\/th>/);
  assert.match(list, /Scheduled for/);
  assert.doesNotMatch(list, /<th>ID<\/th>/);
  assert.doesNotMatch(list, /<th>Rail<\/th>/);
  assert.match(overview, /banking-pay-scheduled-payment-banner/);
  assert.match(overview, /scheduledPaymentBannerHtml/);
  assert.match(overview, /UK time/);
});

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const mainSource = readFileSync(resolve(__dirname, '../../js/main.js'), 'utf8');

test('summary rendering clears stale rows before an Outbox request and owns failures', () => {
  const start = mainSource.indexOf('async function renderAll(){');
  const end = mainSource.indexOf('function isTestmodeE2eModalOpenAllowed', start);
  assert.ok(start >= 0 && end > start, 'renderAll source should be present');
  const source = mainSource.slice(start, end);

  assert.match(source, /renderSummarySectionLoadState\(sectionKey, \{ error: false \}\);/);
  assert.match(source, /try\s*\{\s*data = await loadSection\(\);\s*\}\s*catch/);
  assert.match(source, /renderSummarySectionLoadState\(sectionKey, \{ error: true \}\);/);
  assert.match(source, /__summarySectionRenderGeneration/);
  assert.ok(
    source.indexOf('renderSummarySectionLoadState(sectionKey, { error: false });') < source.indexOf('data = await loadSection();'),
    'the old summary must be cleared before the next section request starts'
  );
});

test('Outbox load state is friendly, retryable and never exposes the raw service error', () => {
  const start = mainSource.indexOf('function renderSummarySectionLoadState(sectionKey, options = {})');
  const end = mainSource.indexOf('// ===== Boot =====', start);
  assert.ok(start >= 0 && end > start, 'summary load-state renderer should be present');
  const source = mainSource.slice(start, end);

  assert.match(source, /contentEl\.innerHTML = '';/);
  assert.match(source, /Outbox is temporarily unavailable\. Try again in a moment\./);
  assert.match(source, /retry\.textContent = 'Try again';/);
  assert.match(source, /void renderAll\(\);/);
  assert.doesNotMatch(source, /INVOICE_ASYNC_TEMPORARILY_UNAVAILABLE/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

const refreshStart = source.indexOf("const refreshPayWorkbench = async ({");
const refreshEnd = source.indexOf("const refreshBankingPayAll = async ({", refreshStart);

assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'Banking Pay refresh helper must be present');

const refreshBody = source.slice(refreshStart, refreshEnd);

test('a successful authoritative Banking Pay refresh clears a stale Draft failure banner', () => {
  assert.match(refreshBody, /const refreshedPreview = await bankingPayPreview\(/);
  assert.match(refreshBody, /if \(refreshedPreview && refreshedPreview\.ok !== false\)/);
  assert.match(refreshBody, /refreshedWizard\.createDraftError = '';/);
  assert.match(refreshBody, /refreshedWizard\.createDraftFriendlyError = null;/);
  assert.match(refreshBody, /return refreshedPreview;/);
});

test('a failed refresh cannot clear the prior Draft failure context', () => {
  const previewCallAt = refreshBody.indexOf('const refreshedPreview = await bankingPayPreview(');
  const successGuardAt = refreshBody.indexOf('if (refreshedPreview && refreshedPreview.ok !== false)');
  const clearAt = refreshBody.indexOf("refreshedWizard.createDraftError = '';");
  assert.ok(previewCallAt >= 0 && successGuardAt > previewCallAt && clearAt > successGuardAt);
});

test('an authoritative READY progress update clears a stale Draft failure banner', () => {
  assert.match(source, /if \(progressReady\) \{\s*wiz\.createDraftError = '';\s*wiz\.createDraftFriendlyError = null;\s*\}/);
});

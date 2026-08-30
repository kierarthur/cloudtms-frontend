const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const modalJs = fs.readFileSync(path.join(root, 'js', 'modal-modernisation.js'), 'utf8');
const summaryJs = fs.readFileSync(path.join(root, 'js', 'summary-modernisation.js'), 'utf8');
const summaryCss = fs.readFileSync(path.join(root, 'css', 'summary-modernisation.css'), 'utf8');

test('mobile summary sheets retain a usable scrollable records viewport', () => {
  assert.match(summaryJs, /document\.documentElement\.classList\.toggle\('ctms-summary-proposal', active\)/);
  assert.match(summaryCss, /@media\(max-width:900px\)[\s\S]*?height:clamp\(420px,60dvh,640px\);min-height:420px/);
  assert.match(summaryCss, /@media\(max-width:900px\)[\s\S]*?height:auto;min-height:calc\(100dvh - 58px\)[\s\S]*?grid-template-rows:auto auto/);
  assert.match(summaryCss, /height:clamp\(400px,66dvh,640px\);min-height:400px/);
  assert.match(summaryCss, /grid-template-rows:auto auto/);
  assert.match(summaryCss, /-webkit-overflow-scrolling:touch/);
  assert.match(summaryCss, /overscroll-behavior-x:contain/);
  assert.match(summaryCss, /touch-action:pan-x pan-y/);
  assert.doesNotMatch(summaryCss, /touch-action:pan-y(?:[;}])/);
  assert.match(summaryCss, /body\.ctms-summary-proposal \.summary-body \.grid\{display:block/);
  assert.doesNotMatch(summaryCss, /body\.ctms-summary-proposal \.grid\{display:block/);
});

test('Outbox uses readable cards through wide-phone and portrait-tablet widths', () => {
  assert.match(summaryJs, /key === 'outbox' \? '\(max-width:900px\)' : '\(max-width:620px\)'/);
  assert.match(summaryJs, /bar\.classList\.add\('ctms-outbox-controls'\)/);
  assert.match(summaryJs, /outboxClearSelection\.dataset\.ctmsVisualSyncWired/);
  assert.match(summaryCss, /@media\(max-width:900px\)[\s\S]*?data-summary-proposal-section="outbox"[\s\S]*?tbody tr\[data-outbox-key\]/);
  assert.match(summaryCss, /content:"Select all visible messages"/);
  assert.match(summaryCss, /data-summary-proposal-section="outbox"[\s\S]*?word-break:normal!important/);
  assert.match(summaryCss, /@media\(min-width:901px\)[\s\S]*?width:1600px!important;min-width:1600px!important/);
});

test('mobile summary navigation keeps Logout outside the scrolling navigation', () => {
  assert.match(summaryCss, /@media\(max-width:900px\)[\s\S]*?\.userbox\{[\s\S]*?display:flex!important/);
  assert.match(summaryCss, /\.userbox \.chip\{display:none!important\}/);
  assert.match(summaryCss, /\.userbox #btnLogout\{/);
});

test('dirty create modals use the CloudTMS confirmation UI', () => {
  assert.match(main, /kind: 'create-record-discard-confirm'/);
  assert.match(main, /title: 'Discard new record\?'/);
  assert.doesNotMatch(main, /window\.confirm\('You have unsaved changes\. Discard them and close\?'\)/);
});

test('contract modal decoration tolerates picker and confirmation child frames', () => {
  assert.match(modalJs, /form\?\.id === 'contractForm'/);
  assert.doesNotMatch(modalJs, /body\.querySelector\('#contractForm'\)\?\.dataset\.ctmsEnhanced !== '1'/);
});

test('internal identifier cleanup cannot hide or contaminate the shared modal shell', () => {
  assert.match(modalJs, /node\.id === 'modalBody'/);
  assert.match(modalJs, /isSharedModalStructure\(node\)/);
  assert.match(modalJs, /body\.dataset\.ctmsInternalIdHidden === '1'/);
  assert.match(modalJs, /body\.removeAttribute\('aria-hidden'\)/);
  assert.match(modalJs, /utilityBodyFamilyClasses\.forEach/);
  assert.match(modalJs, /workflowBodyFamilyClasses\.forEach/);
});

test('universal table decoration does not merge nested table headers into the parent table', () => {
  assert.match(modalJs, /table\.querySelectorAll\(':scope > thead > tr:last-child > th'\)/);
  assert.match(modalJs, /table\.querySelectorAll\(':scope > tbody > tr'\)/);
  assert.doesNotMatch(modalJs, /table\.querySelectorAll\('thead tr:last-child th'\)/);
});

test('contract candidate and client fields show inline filtered suggestions while Pick remains available', () => {
  assert.match(main, /typed\.length >= 3/);
  assert.match(main, /id="candidateInlineSuggestions" role="listbox"/);
  assert.match(main, /id="clientInlineSuggestions" role="listbox"/);
  assert.match(main, /endpoint: '\/api\/search\/candidates'/);
  assert.match(main, /endpoint: '\/api\/search\/clients'/);
  assert.match(main, /params\.set\('format', 'picker'\)/);
  assert.match(main, /class="ctms-contract-suggestion"/);
  assert.match(main, /applyContractCandidateSelection\(\{ id: row\?\.id \|\| row\?\.candidate_id, label, candidate: null \}\)/);
  assert.match(main, /applyContractClientSelection\(\{ id: row\?\.id \|\| row\?\.client_id, label \}\)/);
  assert.match(main, /seed_query: String\(seedQuery \|\| ''\)\.trim\(\)/);
  assert.match(main, /compositionstart/);
  assert.match(main, /compositionend/);
  assert.match(main, /hasChosenId = '';/);
  assert.doesNotMatch(main, /\{ openerName, typed, chosen, hiddenName \}/);
  assert.doesNotMatch(main, /await launchFn\(latest\)/);
});

test('picker dirty propagation cannot overwrite picker modal chrome with the parent state', () => {
  assert.match(main, /The picker owns the shared modal chrome while it is open/);
  assert.match(main, /p\.isDirty = true;\s*\/\/ The picker owns[\s\S]*?fr\._updateButtons && fr\._updateButtons\(\)/);
  assert.match(main, /A background parent must never[\s\S]*?if \(currentFrame\(\) !== top\) return;/);
  assert.match(main, /top\.kind === 'candidate-picker' \|\| top\.kind === 'client-picker'[\s\S]*?btnClose\.textContent = 'Close'/);
});

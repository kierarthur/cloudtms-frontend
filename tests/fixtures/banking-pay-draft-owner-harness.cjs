// Test only: execute the existing Draft readers and request projection verbatim.
// Network/page adoption are explicit in-memory seams. No application script,
// authentication, Worker, database, Draft or payment operation is executed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { parse, freeNames } = require('./banking-detail-syntax.cjs');
const source = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');
const owner = parse(source).body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'bankingPayCreateDraft');
assert.ok(owner, 'Existing Draft owner must remain available');
const declarations = new Map();
for (const statement of owner.body.body) {
  if (statement.type !== 'VariableDeclaration') continue;
  for (const declaration of statement.declarations) {
    if (declaration.id.type === 'Identifier') declarations.set(declaration.id.name, { statement, declaration });
  }
}
const roots = ['refreshCurrentSelectedPreviewRowsForCreateDraft', 'isCurrentCanonicalPageAppliedForCreateDraft',
  'buildCreateDraftPreviewDecisionsFromLoadedSections', 'normaliseDraftScopeForCreate'];
const seams = new Set(['wiz', 'pd', 'cutoffIso', 'sessionId', 'activeCandidateFilterIdForCreate', 'activeClientFilterIdForCreate']);
const builtins = new Set(['Array', 'Boolean', 'JSON', 'Math', 'Number', 'Object', 'Set', 'String', 'undefined']);
const externals = new Set(['bankingPayWorkbenchSessionGetPreviewPage', 'applyPayWorkbenchPreviewToState']);
const required = new Set();
function visit(name) {
  if (required.has(name) || seams.has(name) || builtins.has(name) || externals.has(name)) return;
  const entry = declarations.get(name);
  assert.ok(entry, `Review a new Draft harness dependency before execution: ${name}`);
  required.add(name);
  for (const dependency of freeNames(entry.declaration.init)) visit(dependency);
}
roots.forEach(visit);
const helperSource = [...required].map(name => declarations.get(name)).sort((a,b) => a.statement.start-b.statement.start)
  .map(entry => { assert.equal(entry.statement.declarations.length, 1); return source.slice(entry.statement.start,entry.statement.end); }).join('\n');

let requestBlock;
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'BlockStatement' && node.body.some(st => st.type === 'VariableDeclaration'
    && st.declarations.some(d => d.id.name === 'applyDraftSubsetForScope'))) requestBlock = node;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk(value);
  }
}
walk(owner);
assert.ok(requestBlock, 'Existing Draft request construction must remain');
const statementFor = name => requestBlock.body.find(st => st.type === 'VariableDeclaration' && st.declarations.some(d => d.id.name === name));
const requestStart = statementFor('createDraftPreviewDecisions');
const requestEnd = statementFor('applyDraftSubsetForScope');
assert.ok(requestStart && requestEnd && requestEnd.start > requestStart.end);
const requestSource = source.slice(requestStart.start, requestEnd.end);
const clone = value => JSON.parse(JSON.stringify(value));

function install({ wizard, readPage, candidateFilter = '', clientFilter = '' }) {
  const applied = [];
  const context = { wiz: wizard, sessionId: wizard.workbench.session_id, pd: '2026-08-28', cutoffIso: '2026-08-23',
    activeCandidateFilterIdForCreate: candidateFilter, activeClientFilterIdForCreate: clientFilter,
    bankingPayWorkbenchSessionGetPreviewPage: readPage,
    applyPayWorkbenchPreviewToState: page => applied.push(clone(page)) };
  vm.runInNewContext(`${helperSource}\nthis.api = {
    refresh: refreshCurrentSelectedPreviewRowsForCreateDraft,
    canonicalPageCurrent: isCurrentCanonicalPageAppliedForCreateDraft,
    projectRequest: (currentSelectionBeforeSubmit, payChannelScope, callerDecisionSource = {}) => {
      let syncedSelectedRows = [...currentSelectionBeforeSubmit.selected_preview_row_ids];
      let selectedPreviewRowIdsForServer = [...syncedSelectedRows];
      const selectedPreviewSelection = { selected_preview_row_ids: [...syncedSelectedRows],
        selected_preview_row_mode: currentSelectionBeforeSubmit.selected_preview_row_mode };
      const requestSummary = {};
      ${requestSource}
      return { ok: applyDraftSubsetForScope(payChannelScope), request: reqBody };
    }
  };`, context, { filename: 'unchanged-banking-draft-owners.js', timeout: 5000 });
  return { ...context.api, applied, helperCount: required.size };
}
module.exports = { install, clone, source,
  ownerHash: crypto.createHash('sha256').update(source.slice(owner.start,owner.end).replaceAll('\r\n','\n')).digest('hex') };

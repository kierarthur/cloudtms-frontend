const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
const authorisers = fs.readFileSync(path.join(root, 'js', 'manager-authorisers.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'modal-modernisation.css'), 'utf8');

const section = (startMarker, endMarker) => {
  const start = main.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = main.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return main.slice(start, end);
};

test('Contract settings are a child draft and only Apply dirties the parent', () => {
  const source = section('function openContractSettingsModal()', 'function computePayWorkbenchSessionSignature');
  assert.match(source, /const localMainDraft = clonePlain\(parentMainDraft/);
  assert.match(source, /const parentCtx = \(parentContractFrame\?\._ctxRef/);
  assert.match(source, /const liveParentMainDraft =/);
  assert.match(source, /Object\.assign\(liveParentMainDraft, clonePlain\(localMainDraft\)\)/);
  assert.doesNotMatch(source, /Object\.assign\(parentMainDraft, clonePlain\(localMainDraft\)\)/);
  assert.match(source, /primaryLabel: 'Apply'/);
  assert.match(source, /dirtyClosePolicy: 'confirm-discard-close'/);
  assert.match(source, /disabledPaperPolicy = viewOnly/);
  assert.match(source, /class="ctms-switch/);
  assert.match(source, /overrideOn \? `/);
  assert.match(source, /Reset to Client settings/);
  assert.match(source, /clearOverrideValuesToNull/);
  assert.match(source, /seedFromClientSettingsSnapshot/);
  assert.match(source, /localOverrideStash/);
  assert.doesNotMatch(source, /Staged only until/);
});

test('Returning from a Contract child restores the parent tab titles', () => {
  assert.match(main, /btn\.textContent = tab\.label \|\| tab\.title \|\| tab\.key \|\| '';/);
});

test('Candidate Bookings opens Contract as an independently editable record modal', () => {
  const openContract = section('function openContract(row, openOptions = {})', 'function formatCandidateLabel');
  assert.match(openContract, /noParentGate: !!isSuccessorCreate \|\| openOptions\?\.noParentGate === true/);

  const bookings = section('async function fetchAndRenderCandidateCalendar', 'function renderCandidateContractList');
  assert.match(bookings, /openContract\(fresh, \{ noParentGate: true \}\)/);

  const editHandler = section('btnEdit.onclick = async ()=>', 'const restoreFrameSnapshot');
  assert.match(editHandler, /isChildNow && !top\.noParentGate/);
  assert.doesNotMatch(editHandler, /\(isChildNow \|\| top\.kind === 'advanced-search'\)/);

  const buttonState = section('const parentEditable = top.noParentGate', "if (top.entity !== 'timesheets')");
  assert.match(buttonState, /const ownsPrimaryRecordWorkflow =/);
  assert.match(buttonState, /top\.noParentGate === true && isPrimaryRecordFrame\(top\)/);
  assert.match(buttonState, /ownsPrimaryRecordWorkflow && top\.kind === 'contracts'/);

  const relatedStart = main.indexOf('// Related button (unchanged)');
  assert.notEqual(relatedStart, -1);
  const relatedState = main.slice(relatedStart, relatedStart + 6_000);
  assert.match(relatedState, /ownsPrimaryRecordWorkflow &&[\s\S]*top\.hasId/);

  const saveFlow = section('async function saveForFrame(fr)', 'const onSaveClick = async');
  assert.match(saveFlow, /const ownsPrimaryRecordWorkflow =/);
  assert.match(saveFlow, /fr\.noParentGate === true && isPrimaryRecordFrame\(fr\)/);
  assert.match(saveFlow, /if \(isChildNow && !ownsPrimaryRecordWorkflow\)/);
});

test('Inherited Contract settings are omitted from unrelated safe updates', () => {
  const saveFlow = section('function openContract(row, openOptions = {})', 'function formatCandidateLabel');
  assert.match(saveFlow, /overrideClientSettingsWasExplicitlyDisabled/);
  assert.match(saveFlow, /Only an explicit ON -> OFF transition persists the NULL reset/);
  assert.match(saveFlow, /overrideclientsettings !== true && !overrideClientSettingsWasExplicitlyDisabled/);
  assert.match(saveFlow, /'self_bill'/);
  assert.match(saveFlow, /'auto_invoice'/);
  assert.match(saveFlow, /delete data\[field\]/);
});

test('Contract placement uses its picker fields as the single selection display', () => {
  const render = section('function renderContractMainTab(ctx)', 'function renderContractRatesTab(ctx)');
  assert.doesNotMatch(render, /candidatePickLabel/);
  assert.doesNotMatch(render, /clientPickLabel/);
  assert.doesNotMatch(render, /Chosen:/);
});

test('Contract saves preserve joined display names when narrow mutation responses omit them', () => {
  const merge = section('function mergeContractAuthoritativeIntoModal', 'function openContractSettingsModal');
  assert.match(merge, /sameIdentity\('candidate_id'\)/);
  assert.match(merge, /candidate_display/);
  assert.match(merge, /sameIdentity\('client_id'\)/);
  assert.match(merge, /client_name/);

  const saveFlow = section('function openContract(row, openOptions = {})', 'function formatCandidateLabel');
  assert.match(saveFlow, /const freshResult = await getContract\(data\.id\)/);
  assert.match(saveFlow, /const fresh = freshResult\?\.contract \|\| freshResult \|\| null/);
  assert.match(saveFlow, /mergeContractAuthoritativeIntoModal\(window\.modalCtx\.data, fresh\)/);
  assert.match(saveFlow, /window\.modalCtx\.data = mergeContractAuthoritativeIntoModal\(/);
});

test('Contract lifecycle protects very-high fields after start but locks rates only after worked timesheets exist', () => {
  const locks = section('function getContractLifecycleLocks', 'function markContractParentDirty');
  assert.match(locks, /veryHighLocked: hasProtectedHistory \|\| startedByDate/);
  assert.match(locks, /ratesLocked: hasProtectedHistory/);

  const mainTab = section('function renderContractMainTab', 'function renderContractRatesTab');
  assert.match(mainTab, /candidate_name_display[\s\S]*veryHighReadonly/);
  assert.match(mainTab, /client_name_display[\s\S]*veryHighReadonly/);
  assert.match(mainTab, /name="role"[\s\S]*veryHighReadonly/);
  assert.match(mainTab, /name="band"[\s\S]*veryHighReadonly/);
  assert.match(mainTab, /ctms-readonly-setting/);
  assert.match(mainTab, /Contract override/);
  assert.match(mainTab, /Client default/);

  const ratesTab = section('function renderContractRatesTab', 'async function openMyEmailSignatureModal');
  assert.match(ratesTab, /<fieldset class="ctms-contract-protected-fields" \$\{ratesLocked \? 'disabled data-ctms-intentional-lock="1"' : ''\}/);

  const additionalRatesTab = section('function renderContractAdditionalRatesTab', 'function closeModal');
  assert.match(additionalRatesTab, /<fieldset class="ctms-contract-protected-fields" \$\{ratesLocked \? 'disabled data-ctms-intentional-lock="1"' : ''\}/);
});

test('View and Edit Contract actions are separated and use branded confirmation', () => {
  const dirty = section('function markContractParentDirty', 'function contractModifyIsParentClean');
  assert.match(dirty, /reverse\(\)\.find\(item => item\?\.kind === 'contracts'\)/);
  assert.match(dirty, /frame\.isDirty = true/);

  const source = section('async function runContractModifyAction', 'function renderContractMainTab');
  assert.match(source, /stageAddMissingWeeks/);
  assert.match(source, /removeAllUnsubmittedWeeks/);
  assert.match(source, /openUiConfirmModal/);
  assert.match(source, /Save the Contract to apply/);
  assert.doesNotMatch(source, /window\.confirm|\bconfirm\(/);

  const mainTab = section('function renderContractMainTab', 'function renderContractRatesTab');
  assert.doesNotMatch(mainTab, /ctms-contract-modify-card/);

  const footer = section('// Contract workflow controls live in the shared footer', '(function dragWire()');
  assert.match(footer, /contractFooterModify/);
  assert.match(footer, /Extend to new contract/);
  assert.match(footer, /Duplicate contract/);
  assert.match(footer, /btnContractAddMissingWeeks/);
  assert.match(footer, /btnContractUnassignAll/);

  const buttonState = section('const isExistingContractFrame', "if (top.entity !== 'timesheets')");
  assert.match(buttonState, /top\.mode === 'view'/);
  assert.match(buttonState, /top\.mode === 'edit'/);
});

test('Deferred Contract wiring cannot erase a newly staged dirty state', () => {
  const safeRestores = main.match(/if \(prevDirty === true\) fr\.isDirty = true/g) || [];
  assert.equal(safeRestores.length, 2);
  assert.doesNotMatch(main, /fr\.isDirty = prevDirty/);
});

test('Extend refresh unwraps and safely merges the authoritative source Contract', () => {
  assert.match(main, /const freshSourceResult = await getContract\(sourceId\)/);
  assert.match(main, /const freshSource = freshSourceResult\?\.contract \|\| freshSourceResult \|\| null/);
  assert.match(main, /parentContractCtx\.data = mergeContractAuthoritativeIntoModal\(parentContractCtx\.data, freshSource\)/);
  assert.doesNotMatch(main, /parentContractCtx\.data = freshSource;/);
});

test('Discarding Contract edits uses the branded confirmation instead of a native dialog', () => {
  assert.doesNotMatch(main, /window\.confirm\('Discard changes and return to view\?'\)/);
  assert.match(main, /kind: 'edit-record-discard-confirm'/);
  assert.match(main, /cancel_label: 'Keep editing'/);
});

test('Calendar Save includes remove-all staging and never uses a native overlap warning', () => {
  const source = section('async function commitContractCalendarStageIfPending', 'function wireContractCalendarSaveControls');
  assert.match(source, /st\.add\.size[\s\S]*!!st\.removeAll/);
  assert.match(source, /contract-calendar-overlap-confirm/);
  assert.match(source, /openUiConfirmModal/);
  assert.doesNotMatch(source, /Proceed anyway and save with overlapping windows\?`\)/);
});

test('Extend commits from its independent child while manager authorisers stage into the parent', () => {
  const extend = section('function openContractCloneAndExtend', 'async function openUiConfirmModal');
  assert.match(extend, /performStagedContractExtension/);
  assert.match(extend, /Successor Contract created/);
  assert.match(extend, /getContract\(sourceId\)/);
  assert.doesNotMatch(extend, /__stagedCloneExtendPlan/);
  assert.match(extend, /showWorkflowIssue/);
  assert.doesNotMatch(extend.slice(0, extend.indexOf('return { ok:true, saved:null }')), /window\.prompt|window\.confirm/);

  const stagedRunner = section('async function performStagedContractExtension', 'async function openUiConfirmModal');
  assert.match(stagedRunner, /contract-extend-schedule-clash/);
  assert.match(stagedRunner, /contract-extend-split-week/);
  assert.match(stagedRunner, /openUiPromptModal/);
  assert.doesNotMatch(stagedRunner, /window\.prompt|window\.confirm|\balert\(/);

  assert.match(authorisers, /__stagedManagerAuthoriserPolicy/);
  assert.match(authorisers, /Save the Contract to apply/);
  assert.doesNotMatch(authorisers, /#contractSettingsForm/);
});

test('Duplicate Contract Studio supports polished responsive candidate assignment', () => {
  const start = main.indexOf('function openContractDuplicateStudio');
  assert.notEqual(start, -1);
  const source = main.slice(start, start + 25_000);
  assert.match(source, /Duplicate Contract/);
  assert.match(source, /Find candidates/);
  assert.match(source, /Primary job title/);
  assert.match(source, /data-duplicate-sort="last_name"/);
  assert.match(source, /data-duplicate-sort="first_name"/);
  assert.match(source, /data-duplicate-sort="primary_job_title"/);
  assert.match(source, /data-duplicate-sort="city"/);
  assert.match(source, /const wireLiveRoot = \(\) =>/);
  assert.match(source, /forceEdit:true, runOnRender:true/);
  assert.match(source, /Create contracts/);
  assert.match(css, /\.ctms-contract-duplicate-grid/);
  assert.match(css, /@media \(max-width: 1024px\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /-webkit-overflow-scrolling: touch/);
});

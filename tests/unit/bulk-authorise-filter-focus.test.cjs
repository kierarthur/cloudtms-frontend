const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/main.js'),
  'utf8'
);

const helperStart = mainSource.indexOf('function captureBulkAuthoriseToolbarFocus()');
const helperEnd = mainSource.indexOf('async function rerenderBulkAuthoriseWorkbench', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Bulk Authorise toolbar focus helpers must be present');

const helperSource = mainSource.slice(helperStart, helperEnd);

function installHarness(document) {
  const context = { document, String, Number, Math };
  vm.runInNewContext(helperSource, context, { filename: 'bulk-authorise-toolbar-focus-helpers.js' });
  return context;
}

test('captures and restores the Bulk Authorise text filter caret after its DOM node is replaced', () => {
  const originalInput = {
    id: 'bulkAuthoriseToolbarTextInput',
    selectionStart: 2,
    selectionEnd: 4,
    selectionDirection: 'backward',
    scrollLeft: 17,
    isConnected: true
  };
  const replacementInput = {
    id: 'bulkAuthoriseToolbarTextInput',
    value: 'berry',
    scrollLeft: 0,
    isConnected: true,
    focusOptions: null,
    selection: null,
    focus(options) {
      this.focusOptions = options;
      document.activeElement = this;
    },
    setSelectionRange(start, end, direction) {
      this.selection = { start, end, direction };
    }
  };
  const document = {
    activeElement: originalInput,
    body: { id: 'body', isConnected: true },
    documentElement: { id: 'html', isConnected: true },
    getElementById(id) {
      return id === 'bulkAuthoriseToolbarTextInput' ? replacementInput : null;
    }
  };
  const helpers = installHarness(document);

  const snapshot = helpers.captureBulkAuthoriseToolbarFocus();
  document.activeElement = document.body;
  const restored = helpers.restoreBulkAuthoriseToolbarFocus(snapshot);

  assert.equal(restored, true);
  assert.equal(document.activeElement, replacementInput);
  assert.equal(replacementInput.focusOptions?.preventScroll, true);
  assert.equal(replacementInput.selection?.start, 2);
  assert.equal(replacementInput.selection?.end, 4);
  assert.equal(replacementInput.selection?.direction, 'backward');
  assert.equal(replacementInput.scrollLeft, 17);
});

test('does not steal focus when the user has moved to another live control', () => {
  const otherControl = { id: 'bulkAuthoriseToolbarClientSelect', isConnected: true };
  const replacementInput = {
    id: 'bulkAuthoriseToolbarTextInput',
    value: 'berry',
    isConnected: true,
    focusCalled: false,
    focus() { this.focusCalled = true; },
    setSelectionRange() {}
  };
  const document = {
    activeElement: otherControl,
    body: { id: 'body', isConnected: true },
    documentElement: { id: 'html', isConnected: true },
    getElementById(id) {
      return id === 'bulkAuthoriseToolbarTextInput' ? replacementInput : null;
    }
  };
  const helpers = installHarness(document);

  const restored = helpers.restoreBulkAuthoriseToolbarFocus({
    element_id: 'bulkAuthoriseToolbarTextInput',
    selection_start: 5,
    selection_end: 5,
    selection_direction: 'none'
  });

  assert.equal(restored, false);
  assert.equal(replacementInput.focusCalled, false);
  assert.equal(document.activeElement, otherControl);
});

test('the Bulk Authorise rerender restores filter focus immediately and after layout settles', () => {
  assert.match(mainSource, /const toolbarFocusSnapshot = captureBulkAuthoriseToolbarFocus\(\);/);
  assert.match(mainSource, /const restoreTransientUiState = \(\) => \{[\s\S]*restoreBulkAuthoriseToolbarFocus\(toolbarFocusSnapshot\);[\s\S]*\};/);
  assert.match(mainSource, /restoreTransientUiState\(\);[\s\S]*requestAnimationFrame\(finish\)/);
});

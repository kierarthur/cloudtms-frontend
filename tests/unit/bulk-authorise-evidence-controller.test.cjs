const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../js/bulk-authorise-evidence-controller.js'),
  'utf8'
);

const clone = (value) => JSON.parse(JSON.stringify(value));

function evidence(id, kind, storageKey, extra = {}) {
  return {
    id,
    evidence_id: id,
    kind,
    display_name: 'same-file.jpg',
    filename: 'same-file.jpg',
    storage_key: storageKey,
    r2_key: storageKey,
    source_label: 'Attached',
    ...extra
  };
}

function badges(...positiveKinds) {
  return ['TIMESHEET', 'MILEAGE', 'TRAVEL', 'ACCOMMODATION', 'OTHER'].map((kind) => ({
    kind,
    present: positiveKinds.includes(kind),
    has_evidence: positiveKinds.includes(kind),
    count: positiveKinds.includes(kind) ? 1 : 0
  }));
}

function thumbnailButton(item, initialClasses = []) {
  const attributes = {
    'data-attached-id': item.evidence_id || item.id || ''
  };
  const classes = new Set(['btn', 'btn-outline', ...initialClasses]);
  return {
    style: {},
    __listeners: {},
    getAttribute(name) { return attributes[name] || ''; },
    setAttribute(name, value) { attributes[name] = String(value); },
    addEventListener(type, handler) { this.__listeners[type] = handler; },
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    }
  };
}

function actionButton() {
  const listeners = {};
  return {
    dataset: {},
    disabled: false,
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    async dispatch(type = 'click') {
      const event = {
        defaultPrevented: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; }
      };
      for (const handler of listeners[type] || []) await handler(event);
      return event;
    }
  };
}

function badgeDomElement(tagName = 'div') {
  const attributes = {};
  const element = {
    tagName: String(tagName).toUpperCase(),
    attributes,
    children: [],
    parentElement: null,
    style: {},
    className: '',
    textContent: '',
    get firstElementChild() { return this.children[0] || null; },
    getAttribute(name) { return attributes[name] || ''; },
    setAttribute(name, value) { attributes[name] = String(value); },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    replaceChildren(...children) {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
      for (const child of children) this.appendChild(child);
    },
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    },
    querySelectorAll(selector) {
      const matches = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          if (selector === '.bulk-timesheet-evidence-badge' && String(child.className).split(/\s+/).includes('bulk-timesheet-evidence-badge')) matches.push(child);
          visit(child);
        }
      };
      visit(this);
      return matches;
    },
    querySelector(selector) {
      if (selector === '[data-bulk-authorise-evidence-badges="1"]') {
        const visit = (node) => {
          for (const child of node.children || []) {
            if (child.getAttribute?.('data-bulk-authorise-evidence-badges') === '1') return child;
            const nested = visit(child);
            if (nested) return nested;
          }
          return null;
        };
        return visit(this);
      }
      return null;
    }
  };
  return element;
}

function badgeDomRow(identity) {
  const row = badgeDomElement('div');
  row.setAttribute('data-row-key', identity);
  const grid = badgeDomElement('div');
  grid.appendChild(badgeDomElement('div'));
  grid.appendChild(badgeDomElement('div'));
  grid.appendChild(badgeDomElement('div'));
  row.appendChild(grid);
  return row;
}

function makeState(rows) {
  const activeRow = {
    row_key: 'timesheet:eduardo',
    timesheet_id: 'eduardo',
    current_timesheet_id: 'eduardo',
    bulk_authorise_classification: 'TIMESHEETS',
    bulk_authorise_section: 'authorised_eligible',
    primary_artifact_kind: null,
    primary_artifact_storage_key: 'files/accommodation.jpg',
    evidence_badges: badges('TRAVEL', 'ACCOMMODATION'),
    has_any_evidence: true,
    attached_evidence_count: 2
  };
  return {
    classification: 'TIMESHEETS',
    dataset: { rows: [clone(activeRow)] },
    active_row_key: activeRow.row_key,
    active_row: clone(activeRow),
    active_context: {
      profile: 'full',
      context_profile: 'full',
      evidence_loaded: true,
      row: clone(activeRow),
      evidence: clone(rows),
      details: {
        evidence_loaded: true,
        evidence: clone(rows),
        manual_pdf_r2_key: 'files/accommodation.jpg',
        timesheet: { manual_pdf_r2_key: 'files/accommodation.jpg' }
      }
    },
    active_details: {
      evidence_loaded: true,
      evidence: clone(rows),
      manual_pdf_r2_key: 'files/accommodation.jpg',
      timesheet: { manual_pdf_r2_key: 'files/accommodation.jpg' }
    },
    active_ctx: {
      profile: 'full',
      evidence_loaded: true,
      state: { evidence_loaded: true, evidence: clone(rows) }
    },
    evidence_pane_state: {
      active_tab: 'attached',
      queue_rows: [{ id: 'queue:one', storage_key: 'queue/one.jpg' }],
      attached_rows: clone(rows),
      attached_all_rows: clone(rows),
      active_attached_id: null,
      active_attached_item: null,
      __preview_target_key: '',
      __preview_load_requested_target_key: '',
      __preview_signed_url: ''
    }
  };
}

function install(state, options = {}) {
  const timers = [];
  const intervals = [];
  const listeners = {};
  const windowListeners = {};
  const mutationObservers = [];
  const thumbnailButtons = Array.isArray(options.thumbnailButtons) ? options.thumbnailButtons : [];
  const badgeRows = Array.isArray(options.badgeRows) ? options.badgeRows : [];
  const elements = options.elements && typeof options.elements === 'object' ? options.elements : {};
  const previewLabel = options.previewLabel || null;
  const root = {
    dataset: {},
    addEventListener() {},
    querySelector(selector) {
      return selector === '#bulkProcessPreviewLabel' ? previewLabel : null;
    },
    querySelectorAll() { return []; }
  };
  const stage = { textContent: 'Preview is loading…', innerHTML: '' };
  let rerenders = 0;
  const document = {
    addEventListener(type, handler) { listeners[type] = handler; },
    getElementById(id) {
      if (id === 'bulkAuthoriseWorkbenchRoot') return root;
      if (id === 'bulkProcessPreviewStage') return stage;
      if (Object.prototype.hasOwnProperty.call(elements, id)) return elements[id];
      return null;
    },
    querySelectorAll(selector) {
      if (String(selector).includes('[data-bulk-authorise-row="1"]')) return badgeRows;
      return String(selector).includes('[data-bp-preview-attached-thumb="1"]') ? thumbnailButtons : [];
    },
    ...(options.withBadgeDom === true ? { createElement: (tagName) => badgeDomElement(tagName) } : {})
  };
  const win = {
    document,
    modalCtx: { entity: 'bulk-authorise', bulkAuthoriseState: state },
    BROKER_BASE_URL: options.brokerBaseUrl || '',
    authFetch: options.authFetch,
    async openBulkAuthoriseWorkbench() { return state; },
    renderBulkAuthoriseShell() { return '<div id="bulkAuthoriseWorkbenchRoot"></div>'; },
    refreshBulkAuthoriseActiveContext: options.refreshBulkAuthoriseActiveContext || (async () => true),
    refreshTimesheetImportsQueue: options.refreshTimesheetImportsQueue,
    async bindBulkAuthoriseEvidencePane() { return true; },
    async bindBulkAuthorisePreviewPane() { return true; },
    async rerenderBulkAuthoriseWorkbench() { rerenders += 1; return true; },
    addEventListener(type, handler) { windowListeners[type] = handler; },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    setInterval(callback) { intervals.push(callback); return intervals.length; }
  };
  if (options.withMutationObserver === true) {
    win.MutationObserver = class FakeMutationObserver {
      constructor(callback) {
        this.callback = callback;
        this.observeCalls = 0;
        this.disconnectCalls = 0;
        mutationObservers.push(this);
      }
      observe() { this.observeCalls += 1; }
      disconnect() { this.disconnectCalls += 1; }
      trigger() { this.callback([]); }
    };
  }
  const context = {
    window: win,
    console,
    Promise,
    WeakMap,
    Map,
    Set,
    JSON,
    Date,
    Math,
    Object,
    Array,
    String,
    Number
  };
  vm.runInNewContext(source, context, { filename: 'bulk-authorise-evidence-controller.js' });
  return {
    win,
    root,
    stage,
    timers,
    intervals,
    listeners,
    windowListeners,
    mutationObservers,
    get rerenders() { return rerenders; },
    controller: win.__bulkAuthoriseEvidenceControllerTest.controllerFor(state),
    api: win.__bulkAuthoriseEvidenceControllerTest
  };
}

test('verified dataset badges are stamped into stale Bulk Authorise row markup', () => {
  const state = makeState([]);
  const rowElement = badgeDomRow(state.dataset.rows[0].row_key);
  const harness = install(state, { withBadgeDom: true, badgeRows: [rowElement] });

  harness.controller.captureDatasetTruth();
  state.__bulk_authorise_badge_hydration_complete = true;
  state.dataset.rows[0].__evidence_badges_verified = true;
  assert.equal(rowElement.querySelectorAll('.bulk-timesheet-evidence-badge').length, 0);
  assert.equal(harness.controller.stampVisibleRowBadges(), true);
  assert.deepEqual(
    rowElement.querySelectorAll('.bulk-timesheet-evidence-badge').map((badge) => badge.getAttribute('data-evidence-kind')),
    ['TRAVEL', 'ACCOMMODATION']
  );

  state.dataset.rows[0].evidence_badges = badges('TIMESHEET');
  state.dataset.rows[0].attached_evidence_count = 1;
  harness.controller.datasetBadgeTruth.set(state.dataset.rows[0].row_key, {
    evidence_badges: badges('TRAVEL', 'ACCOMMODATION'),
    has_any_evidence: true,
    attached_evidence_count: 2
  });
  assert.equal(harness.controller.stampVisibleRowBadges(), true);
  assert.deepEqual(
    rowElement.querySelectorAll('.bulk-timesheet-evidence-badge').map((badge) => badge.getAttribute('data-evidence-kind')),
    ['TIMESHEET']
  );
});

test('row-transition skeleton does not start policy or preview hydration', async () => {
  const state = makeState([evidence('ev-1', 'TIMESHEET', 'files/timesheet.jpg')]);
  state.__bulk_authorise_v2_transition_loading = true;
  state.__bulk_authorise_row_context_ready = false;
  let policyRequests = 0;
  const harness = install(state, {
    brokerBaseUrl: 'https://example.invalid',
    async authFetch() {
      policyRequests += 1;
      return {
        ok: true,
        async text() { return JSON.stringify({ ok: true, can_manage_evidence: true }); }
      };
    }
  });

  harness.controller.settle('row-transition-skeleton');
  assert.equal(harness.controller.isRowTransitionHydrationPending(), true);
  const badgeHydration = await harness.controller.hydrateDatasetBadges();
  assert.equal(badgeHydration.applied, false);
  assert.equal(badgeHydration.reason, 'row-transition-owned');
  assert.equal(await harness.controller.ensureAttachedPreview(false), false);
  assert.equal(await harness.win.bindBulkAuthorisePreviewPane(state), false);
  await Promise.resolve();
  assert.equal(policyRequests, 0);

  state.__bulk_authorise_row_context_ready = true;
  harness.controller.stampMutationControls();
  await Promise.resolve();
  assert.equal(harness.controller.isRowTransitionHydrationPending(), true);
  assert.equal(policyRequests, 0);

  state.__bulk_authorise_v2_transition_loading = false;
  harness.controller.stampMutationControls();
  await Promise.resolve();
  assert.equal(policyRequests, 1);
});

test('same-row successor controllers share one evidence policy request', async () => {
  const state = makeState([evidence('ev-1', 'TIMESHEET', 'files/timesheet.jpg')]);
  let policyRequests = 0;
  let releasePolicy;
  const harness = install(state, {
    brokerBaseUrl: 'https://example.invalid',
    async authFetch(resource) {
      if (/bulk-authorise-evidence-policy/i.test(String(resource || ''))) {
        policyRequests += 1;
        return new Promise((resolve) => { releasePolicy = resolve; });
      }
      return {
        ok: true,
        async text() { return JSON.stringify({ signed_url: 'https://example.invalid/file' }); }
      };
    }
  });

  const firstPolicy = harness.controller.ensureMutationPolicy(false);
  const successorState = makeState([evidence('ev-1', 'TIMESHEET', 'files/timesheet.jpg')]);
  harness.win.modalCtx.bulkAuthoriseState = successorState;
  const successorController = harness.api.controllerFor(successorState);
  const successorPolicy = successorController.ensureMutationPolicy(false);

  assert.equal(policyRequests, 1);
  releasePolicy({
    ok: true,
    async text() { return JSON.stringify({ ok: true, can_manage_evidence: true }); }
  });
  const [firstResult, successorResult] = await Promise.all([firstPolicy, successorPolicy]);

  assert.equal(firstResult.can_manage_evidence, true);
  assert.equal(successorResult.can_manage_evidence, true);
  assert.equal(successorState.active_context.can_manage_evidence, true);
  assert.equal(policyRequests, 1);
  assert.equal((await successorController.ensureMutationPolicy(false)).can_manage_evidence, true);
  assert.equal(policyRequests, 1);
});

test('stamp reapplies verified badge truth after a late same-dataset row replacement', () => {
  const state = makeState([]);
  state.dataset.rows[0].backend_row_signature = 'signature:late-replacement';
  const rowElement = badgeDomRow(state.dataset.rows[0].row_key);
  const harness = install(state, { withBadgeDom: true, badgeRows: [rowElement] });
  harness.controller.captureDatasetTruth();
  harness.controller.rememberVerifiedBadgeState(
    state.dataset.rows[0].row_key,
    {
      evidence_badges: badges('TIMESHEET'),
      has_any_evidence: true,
      attached_evidence_count: 1
    },
    state.dataset.rows[0]
  );
  state.__bulk_authorise_badge_hydration_complete = true;
  state.dataset.rows = [{
    ...clone(state.dataset.rows[0]),
    evidence_badges: badges(),
    has_any_evidence: false,
    attached_evidence_count: 0,
    __evidence_badges_verified: false
  }];

  assert.equal(harness.controller.stampVisibleRowBadges(), true);
  assert.deepEqual(
    rowElement.querySelectorAll('.bulk-timesheet-evidence-badge').map((badge) => badge.getAttribute('data-evidence-kind')),
    ['TIMESHEET']
  );
  assert.equal(state.dataset.rows[0].__evidence_badges_verified, true);
});

test('verified badge truth crosses a same-modal state/controller replacement', () => {
  const firstState = makeState([]);
  firstState.dataset.rows[0].backend_row_signature = 'signature:successor-controller';
  const harness = install(firstState);
  harness.controller.captureDatasetTruth();
  harness.controller.rememberVerifiedBadgeState(
    firstState.dataset.rows[0].row_key,
    {
      evidence_badges: badges('TIMESHEET'),
      has_any_evidence: true,
      attached_evidence_count: 1
    },
    firstState.dataset.rows[0]
  );

  const successorState = makeState([]);
  successorState.dataset.rows[0].backend_row_signature = 'signature:successor-controller';
  harness.win.modalCtx.bulkAuthoriseState = successorState;
  const successorController = harness.api.controllerFor(successorState);
  successorController.captureDatasetTruth();

  assert.deepEqual(
    Array.from(successorController.reusableVerifiedBadgeState(successorState.dataset.rows[0]).evidence_badges),
    Array.from(badges('TIMESHEET'))
  );
  assert.equal(successorState.dataset.rows[0].__evidence_badges_verified, true);
});

test('DOM observer coalesces mutations and disconnects while applying evidence UI state', () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([travel]);
  const harness = install(state, { withMutationObserver: true });
  harness.controller.sanitize('initial');
  state.evidence_pane_state.__preview_target_key = harness.api.selectionKey(travel);
  state.evidence_pane_state.__preview_loading = false;
  state.evidence_pane_state.__preview_error = 'The preview could not be prepared.';
  harness.controller.stamp();

  const observer = harness.mutationObservers[0];
  assert.ok(observer);
  assert.equal(observer.observeCalls, 1);
  const baselineTimers = harness.timers.length;
  let previewAttempts = 0;
  harness.controller.ensureAttachedPreview = async () => {
    previewAttempts += 1;
    return false;
  };
  observer.trigger();
  observer.trigger();

  assert.equal(harness.timers.length, baselineTimers + 1, 'synchronous DOM mutations must schedule one settle only');
  harness.timers[baselineTimers]();

  assert.equal(observer.disconnectCalls, 1);
  assert.equal(observer.observeCalls, 2, 'the observer should resume after the guarded settle');
  assert.equal(previewAttempts, 0, 'a terminal preview error must wait for an explicit Retry');
});

test('a completed asynchronous Queue load triggers the missing Bulk Authorise completion render', async () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([travel]);
  state.evidence_pane_state.active_tab = 'queue';
  state.evidence_pane_state.__queue_loaded = false;
  const harness = install(state);
  const baselineTimers = harness.timers.length;

  assert.equal(harness.controller.scheduleQueueRefreshRender('unit'), true);
  assert.equal(harness.timers.length, baselineTimers + 1);

  state.evidence_pane_state.__queue_loaded = true;
  state.evidence_pane_state.queue_rows = [{ id: 'queue:returned', storage_key: 'queue/returned.jpg' }];
  await harness.timers[baselineTimers]();

  assert.equal(harness.rerenders, 1);
});

test('Queue completion uses the active Bulk Authorise forced rerender boundary', async () => {
  const state = makeState([evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg')]);
  state.evidence_pane_state.active_tab = 'queue';
  state.evidence_pane_state.__queue_loaded = true;
  const renderOptions = [];
  state.__rerenderWorkbench = async (options) => { renderOptions.push(options); return true; };
  const harness = install(state);
  const baselineTimers = harness.timers.length;

  harness.controller.scheduleQueueRefreshRender('forced-unit');
  await harness.timers[baselineTimers]();

  assert.equal(renderOptions.length, 1);
  assert.equal(renderOptions[0].force, true);
  assert.match(renderOptions[0].reason, /evidence-refresh-queue-loaded-forced-unit/);
  assert.equal(harness.rerenders, 0);
});

test('a stale shared Queue binding is recovered by the Bulk Authorise-only fallback loader', async () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([travel]);
  state.evidence_pane_state.active_tab = 'queue';
  state.evidence_pane_state.queue_rows = [];
  state.evidence_pane_state.__queue_loaded = false;
  state.evidence_pane_state.__queue_loading = false;
  let refreshCalls = 0;
  const harness = install(state, {
    async refreshTimesheetImportsQueue(pane, options) {
      refreshCalls += 1;
      assert.equal(options.owner_kind, 'bulk_authorise');
      assert.equal(options.queue_scope, 'global:QUEUED');
      assert.equal(options.force, true);
      pane.queue_rows = [{ id: 'queue:returned', storage_key: 'queue/returned.jpg' }];
      pane.__queue_loaded = true;
      pane.__queue_loaded_scope = 'global:QUEUED';
      return pane;
    }
  });
  const baselineTimers = harness.timers.length;

  assert.equal(harness.controller.scheduleQueueRefreshRender('stale-binding-unit'), true);
  await harness.timers[baselineTimers]();
  await harness.timers[baselineTimers + 1]();
  await harness.timers[baselineTimers + 2]();
  await harness.timers[baselineTimers + 3]();

  assert.equal(refreshCalls, 1);
  assert.equal(state.evidence_pane_state.__queue_loaded, true);
  assert.equal(state.evidence_pane_state.active_queue_id, 'queue:returned');
  assert.equal(state.evidence_pane_state.active_queue_item.storage_key, 'queue/returned.jpg');
  assert.equal(harness.rerenders, 1);
});

test('the document-level Queue click schedules rendering on the current controller', () => {
  const state = makeState([evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg')]);
  const harness = install(state);
  const queueControl = {};
  const target = {
    closest(selector) {
      if (selector === '#bulkAuthoriseWorkbenchRoot') return harness.root;
      if (selector === '#bulkProcessEvidenceTabQueue') return queueControl;
      return null;
    }
  };
  const beforeEpoch = harness.controller.queueRefreshRenderEpoch;

  harness.listeners.click({ target });

  assert.equal(harness.controller.queueRefreshRenderEpoch, beforeEpoch + 1);
});

test('the watchdog recovers Queue work on the current controller with a single-flight guard', async () => {
  const state = makeState([evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg')]);
  state.evidence_pane_state.active_tab = 'queue';
  state.evidence_pane_state.queue_rows = [];
  state.evidence_pane_state.__queue_loaded = false;
  let refreshCalls = 0;
  const harness = install(state, {
    async refreshTimesheetImportsQueue(pane) {
      refreshCalls += 1;
      pane.queue_rows = [{ id: 'queue:current', storage_key: 'queue/current.jpg' }];
      pane.__queue_loaded = true;
      return pane;
    }
  });
  assert.equal(harness.intervals.length, 1);
  const baselineTimers = harness.timers.length;

  harness.intervals[0]();
  harness.intervals[0]();
  assert.equal(harness.controller.queueRefreshRenderPending, true);
  assert.equal(harness.timers.length, baselineTimers + 1, 'a second watchdog tick must not start duplicate Queue work');

  await harness.timers[baselineTimers]();
  await harness.timers[baselineTimers + 1]();
  await harness.timers[baselineTimers + 2]();
  assert.equal(refreshCalls, 1);
});

test('Bulk Authorise Queue navigation advances locally without invoking the Bulk Process owner refresh', async () => {
  const state = makeState([evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg')]);
  state.evidence_pane_state.active_tab = 'queue';
  state.evidence_pane_state.__queue_loaded = true;
  state.evidence_pane_state.__queue_scope = 'global:QUEUED';
  state.evidence_pane_state.queue_rows = [
    { id: 'queue:one', storage_key: 'queue/one.jpg' },
    { id: 'queue:two', storage_key: 'queue/two.jpg' }
  ];
  state.evidence_pane_state.active_queue_id = 'queue:one';
  state.evidence_pane_state.active_queue_item = { id: 'queue:one', storage_key: 'queue/one.jpg' };
  let sharedRefreshCalls = 0;
  const previous = actionButton();
  const next = actionButton();
  const harness = install(state, {
    elements: { bpQueuePrevBtn: previous, bpQueueNextBtn: next },
    async refreshTimesheetImportsQueue() {
      sharedRefreshCalls += 1;
    }
  });

  assert.equal(harness.controller.stampQueueNavigationControls(), true);
  assert.equal(previous.disabled, true);
  assert.equal(next.disabled, false);

  assert.equal(await harness.controller.navigateQueue(1), true);

  assert.equal(sharedRefreshCalls, 0);
  assert.equal(state.evidence_pane_state.active_queue_id, 'queue:two');
  assert.equal(state.evidence_pane_state.active_queue_item.storage_key, 'queue/two.jpg');
  assert.equal(state.evidence_pane_state.__preview_target_key, 'queue|queue:two|queue/two.jpg');
  assert.equal(harness.rerenders, 1);
  assert.equal(harness.controller.stampQueueNavigationControls(), true);
  assert.equal(previous.disabled, false);
  assert.equal(next.disabled, true);
});

test('Queue selection survives a shared Attached-to-Queue tab reset', () => {
  const state = makeState([evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg')]);
  const pane = state.evidence_pane_state;
  pane.active_tab = 'queue';
  pane.__queue_loaded = true;
  pane.queue_rows = [1, 2, 3, 4].map((n) => ({ id: `queue:${n}`, storage_key: `queue/${n}.jpg` }));
  pane.active_queue_id = 'queue:3';
  pane.active_queue_item = clone(pane.queue_rows[2]);
  const harness = install(state);

  harness.controller.rememberQueueSelection('before-attached');
  pane.active_tab = 'attached';
  pane.active_queue_id = 'queue:1';
  pane.active_queue_item = clone(pane.queue_rows[0]);
  pane.active_tab = 'queue';

  const restored = harness.controller.restoreRememberedQueueSelection('after-queue');
  assert.equal(restored.restored, true);
  assert.equal(restored.changed, true);
  assert.equal(restored.index, 2);
  assert.equal(pane.active_queue_id, 'queue:3');
  assert.equal(pane.__preview_target_key, 'queue|queue:3|queue/3.jpg');
});

test('Queue selection falls back to the same numeric position when its remembered item disappears', () => {
  const state = makeState([evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg')]);
  const pane = state.evidence_pane_state;
  pane.active_tab = 'queue';
  pane.__queue_loaded = true;
  pane.queue_rows = [1, 2, 3, 4, 5].map((n) => ({ id: `queue:${n}`, storage_key: `queue/${n}.jpg` }));
  pane.active_queue_id = 'queue:3';
  pane.active_queue_item = clone(pane.queue_rows[2]);
  const harness = install(state);
  harness.controller.rememberQueueSelection('before-removal');

  pane.queue_rows = [1, 2, 4, 5].map((n) => ({ id: `queue:${n}`, storage_key: `queue/${n}.jpg` }));
  pane.active_queue_id = 'queue:1';
  pane.active_queue_item = clone(pane.queue_rows[0]);

  const restored = harness.controller.restoreRememberedQueueSelection('after-removal');
  assert.equal(restored.index, 2);
  assert.equal(pane.active_queue_id, 'queue:4');
  assert.equal(pane.__preview_target_key, 'queue|queue:4|queue/4.jpg');
});

test('Queue refresh preserves the current item when another item is added', async () => {
  const state = makeState([evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg')]);
  const pane = state.evidence_pane_state;
  pane.active_tab = 'queue';
  pane.__queue_loaded = false;
  pane.queue_rows = [1, 2, 3, 4, 5].map((n) => ({ id: `queue:${n}`, storage_key: `queue/${n}.jpg` }));
  pane.active_queue_id = 'queue:3';
  pane.active_queue_item = clone(pane.queue_rows[2]);
  const harness = install(state, {
    async refreshTimesheetImportsQueue(target, options) {
      assert.equal(options.preserve_last_viewed_queue, true);
      target.queue_rows = [
        { id: 'queue:new', storage_key: 'queue/new.jpg' },
        ...[1, 2, 3, 4, 5].map((n) => ({ id: `queue:${n}`, storage_key: `queue/${n}.jpg` }))
      ];
      target.__queue_loaded = true;
    }
  });

  assert.equal(await harness.controller.ensureQueueLoadedForBulkAuthorise('added-item'), true);
  assert.equal(pane.active_queue_id, 'queue:3');
  assert.equal(pane.queue_rows.length, 6);
});

test('Queue refresh keeps the same numeric position when the current item disappears', async () => {
  const state = makeState([evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg')]);
  const pane = state.evidence_pane_state;
  pane.active_tab = 'queue';
  pane.__queue_loaded = false;
  pane.queue_rows = [1, 2, 3, 4, 5].map((n) => ({ id: `queue:${n}`, storage_key: `queue/${n}.jpg` }));
  pane.active_queue_id = 'queue:3';
  pane.active_queue_item = clone(pane.queue_rows[2]);
  const harness = install(state, {
    async refreshTimesheetImportsQueue(target) {
      target.queue_rows = [1, 2, 4, 5].map((n) => ({ id: `queue:${n}`, storage_key: `queue/${n}.jpg` }));
      target.__queue_loaded = true;
    }
  });

  assert.equal(await harness.controller.ensureQueueLoadedForBulkAuthorise('removed-item'), true);
  assert.equal(pane.active_queue_id, 'queue:4');
  assert.equal(pane.__remembered_queue_index, 2);
  assert.equal(pane.queue_rows.length, 4);
});

test('an unissued draft invoice policy unlocks evidence only and forces a control rerender', async () => {
  const state = makeState([evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg')]);
  state.active_context.can_manage_evidence = false;
  state.active_context.evidence_document_locked = true;
  state.active_context.evidence_lock_reason = 'INVOICE_DOCUMENT_LOCKED';
  state.active_row.locked = true;
  const harness = install(state, {
    brokerBaseUrl: 'https://isolated.test',
    async authFetch() {
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            ok: true,
            can_manage_evidence: true,
            has_mutable_unissued_invoice: true,
            invoice_blocked: false
          });
        }
      };
    }
  });

  const policy = await harness.controller.ensureMutationPolicy(true);

  assert.equal(policy.can_manage_evidence, true);
  assert.equal(state.active_context.can_manage_evidence, true);
  assert.equal(state.active_context.evidence_document_locked, false);
  assert.equal(state.active_context.evidence_lock_reason, null);
  assert.equal(state.active_row.locked, true, 'hours and financial locking must remain untouched');
  assert.equal(state.__bulk_authorise_mutable_unissued_invoice, true);
  assert.equal(harness.rerenders, 1);
});

test('window pointer-up defers an attached remove until the physical click has completed', () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([travel]);
  const harness = install(state);
  let removeCalls = 0;
  const removeControl = {};
  harness.controller.removeEvidence = async (control) => {
    removeCalls += 1;
    assert.equal(control, removeControl);
  };
  const target = {
    closest(selector) {
      if (selector === '#bulkAuthoriseWorkbenchRoot') return harness.root;
      if (selector === '[data-bp-preview-attached-remove="1"],#bpQueueAttachBtn,#bpUploadEvidenceBtn') return removeControl;
      if (selector === '[data-bp-preview-attached-remove="1"]') return removeControl;
      return null;
    }
  };
  const event = {
    type: 'pointerdown',
    target,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.propagationStopped = true; }
  };

  harness.windowListeners.pointerdown(event);

  assert.equal(removeCalls, 0);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);

  event.type = 'pointerup';
  harness.windowListeners.pointerup(event);

  assert.equal(removeCalls, 0);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);

  event.type = 'click';
  harness.windowListeners.click(event);
  assert.equal(removeCalls, 0);

  harness.timers.at(-1)();

  assert.equal(removeCalls, 1);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test('authoritative server badge flags remain usable when attachment normalisation yields no rows', () => {
  const state = makeState([]);
  const harness = install(state);
  const badgeState = harness.api.badgeStateFromPayload({
    evidence_badges: badges('TIMESHEET'),
    has_any_evidence: true,
    attached_evidence_count: 1
  }, []);

  assert.deepEqual(Array.from(harness.api.positiveBadgeKinds(badgeState.evidence_badges), String), ['TIMESHEET']);
  assert.equal(badgeState.has_any_evidence, true);
  assert.equal(badgeState.attached_evidence_count, 1);
});

test('authoritative context removes synthetic Timesheet evidence and derives matching badges', () => {
  const accommodation = evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg');
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const syntheticTimesheet = evidence('synthetic-attached:primary', 'TIMESHEET', 'files/accommodation.jpg', {
    evidence_id: null,
    __synthetic_attached_fallback: true,
    is_synthetic_attached_fallback: true
  });
  const state = makeState([syntheticTimesheet, accommodation, travel]);
  const { win, api } = install(state);

  win.renderBulkAuthoriseShell(state);

  assert.deepEqual(
    Array.from(state.evidence_pane_state.attached_rows, (item) => String(item.kind)),
    ['ACCOMMODATION', 'TRAVEL']
  );
  assert.deepEqual(Array.from(api.positiveBadgeKinds(state.active_row.evidence_badges), String), ['TRAVEL', 'ACCOMMODATION']);
  assert.equal(state.active_details.manual_pdf_r2_key, null);
  assert.equal(state.active_details.timesheet.manual_pdf_r2_key, null);
  assert.equal(state.active_context.details.manual_pdf_r2_key, null);
  assert.equal(state.active_context.details.timesheet.manual_pdf_r2_key, null);
  assert.equal(state.active_row.attached_evidence_count, 2);
  assert.equal(state.active_row.has_any_evidence, true);
});

test('an inherited preview item is suppressed until the Bulk Authorise row owns authoritative evidence', () => {
  const inherited = evidence('synthetic-attached:previous-row', 'TIMESHEET', 'files/previous-row.jpg', {
    evidence_id: null,
    __synthetic_attached_fallback: true,
    is_synthetic_attached_fallback: true
  });
  const state = makeState([]);
  state.active_context = {};
  state.active_details = {};
  state.active_ctx = {};
  state.evidence_pane_state.attached_rows = [clone(inherited)];
  state.evidence_pane_state.attached_all_rows = [clone(inherited)];
  state.evidence_pane_state.active_attached_id = inherited.id;
  state.evidence_pane_state.active_attached_item = clone(inherited);
  state.evidence_pane_state.__preview_target_key = 'attached|previous-row';
  state.evidence_pane_state.__preview_signed_url = 'https://example.invalid/previous-row';
  state.evidence_pane_state.__preview_loading = true;
  const harness = install(state);

  harness.controller.sanitize('row-context-pending');

  assert.deepEqual(Array.from(state.evidence_pane_state.attached_rows), []);
  assert.deepEqual(Array.from(state.evidence_pane_state.attached_all_rows), []);
  assert.equal(state.evidence_pane_state.active_attached_id, null);
  assert.equal(state.evidence_pane_state.active_attached_item, null);
  assert.equal(state.evidence_pane_state.__preview_target_key, '');
  assert.equal(state.evidence_pane_state.__preview_signed_url, '');
  assert.equal(state.evidence_pane_state.__preview_loading, false);
});

test('a thumbnail selection remains canonical without rerendering the whole modal', async () => {
  const accommodation = evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg');
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([accommodation, travel]);
  const harness = install(state);
  harness.controller.sanitize('initial');
  const travelSelection = harness.api.selectionKey(travel);
  const button = {
    getAttribute(name) {
      const values = {
        'data-attached-selection-key': travelSelection,
        'data-attached-id': travel.evidence_id,
        'data-file-key': travel.storage_key,
        'data-storage-key': travel.storage_key
      };
      return values[name] || '';
    }
  };

  await harness.controller.selectFromButton(button);
  harness.controller.sanitize('simulated-rerender');

  assert.equal(harness.rerenders, 0);
  assert.equal(state.evidence_pane_state.active_attached_id, travel.evidence_id);
  assert.equal(state.evidence_pane_state.active_attached_item.kind, 'TRAVEL');
  assert.equal(state.evidence_pane_state.__preview_target_key, travelSelection);
  assert.equal(state.evidence_pane_state.__preview_load_requested_target_key, travelSelection);
});

test('the active thumbnail border moves with the selected evidence item', async () => {
  const accommodation = evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg');
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const accommodationButton = thumbnailButton(accommodation);
  const travelButton = thumbnailButton(travel, ['active', 'selected']);
  const state = makeState([accommodation, travel]);
  const harness = install(state, { thumbnailButtons: [accommodationButton, travelButton] });

  harness.controller.sanitize('initial');
  harness.controller.renderAttachedSelection();

  assert.equal(accommodationButton.style.border, '2px solid var(--accent,#6ea8fe)');
  assert.equal(travelButton.style.border, '1px solid var(--line)');
  assert.equal(accommodationButton.getAttribute('aria-selected'), 'true');
  assert.equal(accommodationButton.classList.contains('active'), true);
  assert.equal(accommodationButton.classList.contains('selected'), true);
  assert.equal(travelButton.classList.contains('active'), false);
  assert.equal(travelButton.classList.contains('selected'), false);

  await harness.controller.selectFromButton(travelButton);

  assert.equal(accommodationButton.style.border, '1px solid var(--line)');
  assert.equal(travelButton.style.border, '2px solid var(--accent,#6ea8fe)');
  assert.equal(accommodationButton.getAttribute('aria-selected'), 'false');
  assert.equal(travelButton.getAttribute('aria-selected'), 'true');
  assert.equal(accommodationButton.classList.contains('active'), false);
  assert.equal(accommodationButton.classList.contains('selected'), false);
  assert.equal(travelButton.classList.contains('active'), true);
  assert.equal(travelButton.classList.contains('selected'), true);
});

test('a database UUID in id is retained as the real evidence id', () => {
  const state = makeState([]);
  const harness = install(state);
  const id = '11111111-1111-4111-8111-111111111111';
  const item = harness.api.normaliseEvidence({
    id,
    kind: 'ACCOMMODATION',
    display_name: 'receipt.png',
    storage_key: 'files/receipt.png'
  });

  assert.equal(item.evidence_id, id);
  assert.equal(item.__synthetic_attached_fallback, false);
});

test('an evidence mutation overwrites stale compatibility evidence arrays with the server snapshot', async () => {
  const accommodation = evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg');
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([accommodation, travel]);
  state.active_row.evidence = [clone(accommodation), clone(travel)];
  state.active_context.row.evidence = [clone(accommodation), clone(travel)];
  state.dataset.rows[0].evidence = [clone(accommodation), clone(travel)];
  const harness = install(state, {
    async refreshBulkAuthoriseActiveContext() {
      state.active_ctx.state.evidence = [clone(accommodation), clone(travel)];
      return true;
    }
  });

  await harness.controller.refreshAfterMutation({ evidence: [travel] }, 'remove');

  assert.deepEqual(Array.from(state.active_context.evidence, (item) => String(item.kind)), ['TRAVEL']);
  assert.deepEqual(Array.from(state.active_context.details.evidence, (item) => String(item.kind)), ['TRAVEL']);
  assert.deepEqual(Array.from(state.active_details.evidence, (item) => String(item.kind)), ['TRAVEL']);
  assert.deepEqual(Array.from(state.active_ctx.evidence, (item) => String(item.kind)), ['TRAVEL']);
  assert.deepEqual(Array.from(state.active_ctx.state.evidence, (item) => String(item.kind)), ['TRAVEL']);
  assert.deepEqual(Array.from(state.active_row.evidence, (item) => String(item.kind)), ['TRAVEL']);
  assert.deepEqual(Array.from(state.active_context.row.evidence, (item) => String(item.kind)), ['TRAVEL']);
  assert.deepEqual(Array.from(state.dataset.rows[0].evidence, (item) => String(item.kind)), ['TRAVEL']);
  assert.deepEqual(Array.from(state.evidence_pane_state.attached_rows, (item) => String(item.kind)), ['TRAVEL']);
});

test('an evidence mutation uses the refreshed canonical context when an older response omits evidence', async () => {
  const accommodation = evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg');
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([accommodation, travel]);
  const harness = install(state, {
    async refreshBulkAuthoriseActiveContext() {
      state.active_context.evidence = [clone(accommodation)];
      state.active_context.evidence_loaded = true;
      state.active_ctx.state.evidence = [clone(accommodation), clone(travel)];
      return true;
    }
  });

  await harness.controller.refreshAfterMutation({ action: 'REMOVE' }, 'remove');

  assert.deepEqual(Array.from(state.active_ctx.state.evidence, (item) => String(item.kind)), ['ACCOMMODATION']);
  assert.deepEqual(Array.from(state.evidence_pane_state.attached_rows, (item) => String(item.kind)), ['ACCOMMODATION']);
});

test('a successful remove excludes the requested evidence even if a compatibility response is stale', async () => {
  const accommodation = evidence('11111111-1111-4111-8111-111111111111', 'ACCOMMODATION', 'files/accommodation.jpg', {
    evidence_id: '11111111-1111-4111-8111-111111111111'
  });
  const travel = evidence('22222222-2222-4222-8222-222222222222', 'TRAVEL', 'files/travel.jpg', {
    evidence_id: '22222222-2222-4222-8222-222222222222'
  });
  const state = makeState([accommodation, travel]);
  const harness = install(state);

  await harness.controller.refreshAfterMutation(
    { action: 'REMOVE', evidence: [accommodation, travel] },
    'remove',
    { action: 'remove', evidence_id: accommodation.evidence_id }
  );

  assert.deepEqual(Array.from(state.evidence_pane_state.attached_rows, (item) => String(item.kind)), ['TRAVEL']);
});

test('a mutation result is reconciled into a replacement live state created during context refresh', async () => {
  const accommodation = evidence('11111111-1111-4111-8111-111111111111', 'ACCOMMODATION', 'files/accommodation.jpg', {
    evidence_id: '11111111-1111-4111-8111-111111111111'
  });
  const travel = evidence('22222222-2222-4222-8222-222222222222', 'TRAVEL', 'files/travel.jpg', {
    evidence_id: '22222222-2222-4222-8222-222222222222'
  });
  const state = makeState([accommodation, travel]);
  const replacement = makeState([accommodation, travel]);
  let harness;
  harness = install(state, {
    async refreshBulkAuthoriseActiveContext() {
      harness.win.modalCtx.bulkAuthoriseState = replacement;
      return true;
    }
  });

  await harness.controller.refreshAfterMutation(
    { action: 'REMOVE', evidence: [travel] },
    'remove',
    { action: 'remove', evidence_id: accommodation.evidence_id }
  );

  assert.deepEqual(Array.from(replacement.active_context.evidence, (item) => String(item.kind)), ['TRAVEL']);
  assert.deepEqual(Array.from(replacement.evidence_pane_state.attached_rows, (item) => String(item.kind)), ['TRAVEL']);
});

test('a thumbnail does not consume pointer-down from its remove X control', () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const travelButton = thumbnailButton(travel);
  const state = makeState([travel]);
  const harness = install(state, { thumbnailButtons: [travelButton] });
  harness.controller.sanitize('initial');
  harness.controller.renderAttachedSelection();
  let selections = 0;
  harness.controller.selectFromButton = async () => { selections += 1; };
  const removeControl = {};
  const event = {
    target: {
      closest(selector) {
        return selector === '[data-bp-preview-attached-remove="1"]' ? removeControl : null;
      }
    },
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.propagationStopped = true; }
  };

  travelButton.__listeners.pointerdown(event);

  assert.equal(selections, 0);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
});

test('the preview heading uses the real filename instead of a generic PDF-style label', async () => {
  const timesheet = evidence('evidence:timesheet', 'TIMESHEET', 'files/TIMESHEET.jpg', {
    filename: 'TIMESHEET.jpg',
    display_name: 'Uploaded timesheet PDF',
    mime_type: 'image/jpeg'
  });
  let textWrites = 0;
  let labelText = '';
  const previewLabel = {
    attributes: {},
    get textContent() { return labelText; },
    set textContent(value) { textWrites += 1; labelText = String(value); },
    getAttribute(name) { return this.attributes[name] || ''; },
    setAttribute(name, value) { this.attributes[name] = String(value); }
  };
  const state = makeState([timesheet]);
  const harness = install(state, { previewLabel });

  harness.controller.sanitize('initial');
  await harness.controller.selectAttached(timesheet, 'test-filename');
  harness.controller.syncPreviewMetadata(timesheet);

  assert.equal(previewLabel.textContent, 'TIMESHEET.jpg');
  assert.equal(previewLabel.attributes.title, 'TIMESHEET.jpg');
  assert.equal(textWrites, 1);
});

test('Attached Previous and Next use the controller selection while Queue navigation remains untouched', async () => {
  const accommodation = evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg');
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const previous = actionButton();
  const next = actionButton();
  const state = makeState([accommodation, travel]);
  const harness = install(state, {
    elements: {
      bpQueuePrevBtn: previous,
      bpQueueNextBtn: next
    }
  });
  harness.controller.sanitize('initial');
  harness.controller.renderAttachedSelection();

  const attachedNextEvent = await next.dispatch();
  assert.equal(attachedNextEvent.defaultPrevented, true);
  assert.equal(attachedNextEvent.immediatePropagationStopped, true);
  assert.equal(state.evidence_pane_state.active_attached_id, travel.evidence_id);
  assert.equal(state.evidence_pane_state.__preview_target_key, harness.api.selectionKey(travel));

  const attachedPreviousEvent = await previous.dispatch();
  assert.equal(attachedPreviousEvent.defaultPrevented, true);
  assert.equal(attachedPreviousEvent.immediatePropagationStopped, true);
  assert.equal(state.evidence_pane_state.active_attached_id, accommodation.evidence_id);
  assert.equal(state.evidence_pane_state.__preview_target_key, harness.api.selectionKey(accommodation));

  state.evidence_pane_state.active_tab = 'queue';
  state.evidence_pane_state.active_queue_id = 'queue:one';
  const queueEvent = await next.dispatch();
  assert.equal(queueEvent.defaultPrevented, false);
  assert.equal(queueEvent.immediatePropagationStopped, false);
  assert.equal(state.evidence_pane_state.active_tab, 'queue');
  assert.equal(state.evidence_pane_state.active_queue_id, 'queue:one');
});

test('a visibly selected Queue tab wins over stale Attached state and preserves shared Queue navigation', async () => {
  const accommodation = evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg');
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const next = actionButton();
  const state = makeState([accommodation, travel]);
  const harness = install(state, {
    elements: {
      bpQueueNextBtn: next,
      bulkProcessEvidenceTabQueue: {
        getAttribute(name) { return name === 'aria-selected' ? 'true' : ''; },
        classList: { contains() { return false; } }
      }
    }
  });
  harness.controller.sanitize('initial');
  harness.controller.renderAttachedSelection();

  const event = await next.dispatch();

  assert.equal(event.defaultPrevented, false);
  assert.equal(event.immediatePropagationStopped, false);
  assert.equal(state.evidence_pane_state.active_attached_id, accommodation.evidence_id);
});

test('window Queue navigation repairs stale Attached state before moving the visible Queue', async () => {
  const next = actionButton();
  const queueTab = {
    getAttribute(name) { return name === 'aria-selected' ? 'true' : ''; },
    classList: { contains() { return false; } }
  };
  const state = makeState([]);
  state.evidence_pane_state.active_tab = 'attached';
  state.evidence_pane_state.queue_rows = [
    { id: 'queue:one', storage_key: 'queue/one.jpg' },
    { id: 'queue:two', storage_key: 'queue/two.jpg' }
  ];
  state.evidence_pane_state.__queue_loaded = true;
  state.evidence_pane_state.active_queue_id = 'queue:one';
  state.evidence_pane_state.active_queue_item = clone(state.evidence_pane_state.queue_rows[0]);
  const harness = install(state, { elements: { bpQueueNextBtn: next, bulkProcessEvidenceTabQueue: queueTab } });
  const event = {
    type: 'click',
    defaultPrevented: false,
    immediatePropagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; },
    target: {
      closest(selector) {
        if (selector === '#bulkAuthoriseWorkbenchRoot') return harness.root;
        if (selector === '#bpQueueNextBtn') return next;
        return null;
      }
    }
  };

  harness.windowListeners.click(event);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.immediatePropagationStopped, true);
  assert.equal(state.evidence_pane_state.active_tab, 'queue');
  assert.equal(state.evidence_pane_state.active_queue_id, 'queue:two');
});

test('a shared Attached navigation selection survives controller reconciliation', () => {
  const accommodation = evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg');
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([accommodation, travel]);
  const harness = install(state);
  harness.controller.sanitize('initial');
  state.evidence_pane_state.active_attached_id = travel.evidence_id;
  state.evidence_pane_state.active_attached_item = clone(travel);
  state.evidence_pane_state.__preview_target_key = harness.api.selectionKey(travel);

  harness.controller.sanitize('after-shared-navigation');

  assert.equal(state.evidence_pane_state.active_attached_id, travel.evidence_id);
  assert.equal(state.evidence_pane_state.__preview_target_key, harness.api.selectionKey(travel));
  assert.equal(harness.controller.selectedByIdentity.get(state.active_row_key), harness.api.itemKey(travel));
});

test('Queue preview remains separate and Attached restores the row selection and badges', async () => {
  const accommodation = evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg');
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([accommodation, travel]);
  const harness = install(state);
  harness.controller.sanitize('initial');
  await harness.controller.selectAttached(travel, 'test');

  const pane = state.evidence_pane_state;
  pane.active_tab = 'queue';
  pane.active_queue_id = 'queue:one';
  pane.active_queue_item = { id: 'queue:one', storage_key: 'queue/one.jpg' };
  pane.__preview_target_key = 'queue|queue:one|queue/one.jpg';
  pane.__preview_load_requested_target_key = 'queue|queue:one|queue/one.jpg';
  pane.__preview_signed_url = 'https://example.invalid/queue-one';
  state.active_row.evidence_badges = badges('TIMESHEET', 'TRAVEL', 'ACCOMMODATION');

  harness.controller.sanitize('queue-open');

  assert.equal(pane.active_tab, 'queue');
  assert.equal(pane.active_queue_id, 'queue:one');
  assert.equal(pane.__preview_target_key, 'queue|queue:one|queue/one.jpg');
  assert.equal(pane.__preview_signed_url, 'https://example.invalid/queue-one');
  assert.deepEqual(Array.from(harness.api.positiveBadgeKinds(state.active_row.evidence_badges), String), ['TRAVEL', 'ACCOMMODATION']);

  pane.active_tab = 'attached';
  harness.controller.sanitize('return-attached');

  assert.equal(pane.active_queue_id, 'queue:one');
  assert.equal(pane.active_attached_id, travel.evidence_id);
  assert.equal(pane.active_attached_item.kind, 'TRAVEL');
  assert.equal(pane.__preview_target_key, harness.api.selectionKey(travel));
});

test('dataset badges stay hidden until all authoritative corrections settle', async () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const accommodation = evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg');
  const state = makeState([travel]);
  state.dataset.rows[0].evidence_badges = badges('TIMESHEET');
  state.dataset.rows[0].has_any_evidence = true;
  state.dataset.rows[0].attached_evidence_count = 1;
  state.active_row.evidence_badges = badges('TIMESHEET');
  state.dataset.rows.push({
    ...clone(state.dataset.rows[0]),
    row_key: 'timesheet:second',
    timesheet_id: 'second',
    current_timesheet_id: 'second',
    requested_timesheet_id: 'second',
    expected_timesheet_id: 'second',
    evidence_badges: badges('TIMESHEET')
  });

  let releaseSecondResponse;
  const secondResponseGate = new Promise((resolve) => { releaseSecondResponse = resolve; });
  const authFetch = async (url) => {
    if (String(url).includes('/second/')) await secondResponseGate;
    const rowEvidence = String(url).includes('/second/') ? [accommodation] : [travel];
    return {
      ok: true,
      async text() {
        return JSON.stringify({
          ok: true,
          profile: 'evidence',
          context_profile: 'evidence',
          evidence_loaded: true,
          evidence: rowEvidence
        });
      }
    };
  };
  const harness = install(state, {
    brokerBaseUrl: 'https://test-worker.invalid',
    authFetch
  });

  const hydration = harness.controller.hydrateDatasetBadges();
  assert.deepEqual(Array.from(harness.api.positiveBadgeKinds(state.dataset.rows[0].evidence_badges), String), ['TIMESHEET']);
  assert.deepEqual(Array.from(harness.api.positiveBadgeKinds(state.dataset.rows[1].evidence_badges), String), ['TIMESHEET']);
  for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();
  assert.deepEqual(Array.from(harness.api.positiveBadgeKinds(state.dataset.rows[0].evidence_badges), String), ['TRAVEL']);
  assert.deepEqual(Array.from(harness.api.positiveBadgeKinds(state.dataset.rows[1].evidence_badges), String), ['TIMESHEET']);
  assert.equal(state.__bulk_authorise_badge_hydration_complete, false);
  assert.equal(harness.rerenders, 0, 'partial badge truth must not be painted into the list');
  releaseSecondResponse();
  const result = await hydration;

  assert.deepEqual(Array.from(harness.api.positiveBadgeKinds(state.dataset.rows[0].evidence_badges), String), ['TRAVEL']);
  assert.deepEqual(Array.from(harness.api.positiveBadgeKinds(state.dataset.rows[1].evidence_badges), String), ['ACCOMMODATION']);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 0);
  assert.equal(state.__bulk_authorise_badge_hydration_complete, true);
  assert.ok(harness.rerenders >= 1);
});

test('a badge correction that finishes before the modal is live is rendered after open', async () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([travel]);
  state.dataset.rows[0].evidence_badges = badges('TIMESHEET');
  state.dataset.rows[0].has_any_evidence = true;
  state.dataset.rows[0].attached_evidence_count = 1;
  const harness = install(state, {
    brokerBaseUrl: 'https://test-worker.invalid',
    async authFetch() {
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            ok: true,
            profile: 'evidence',
            context_profile: 'evidence',
            evidence_loaded: true,
            evidence: [travel]
          });
        }
      };
    }
  });

  harness.win.modalCtx.bulkAuthoriseState = null;
  const result = await harness.controller.hydrateDatasetBadges();

  assert.equal(result.succeeded, 1);
  assert.equal(harness.rerenders, 0);
  assert.deepEqual(Array.from(harness.api.positiveBadgeKinds(state.dataset.rows[0].evidence_badges), String), ['TRAVEL']);

  harness.win.modalCtx.bulkAuthoriseState = state;
  await harness.win.openBulkAuthoriseWorkbench();
  for (let attempt = 0; attempt < 20 && harness.rerenders === 0; attempt += 1) await Promise.resolve();

  assert.ok(harness.rerenders >= 1, 'the settled badge truth should render once the modal is live');
});

test('an unresolved loading state becomes an explicit retryable error', () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([travel]);
  const harness = install(state);
  harness.controller.sanitize('initial');
  const target = harness.api.selectionKey(travel);

  harness.controller.scheduleTerminalGuard(state.active_row_key, target);
  harness.timers.at(-1)();

  assert.equal(state.evidence_pane_state.__preview_loading, false);
  assert.equal(state.evidence_pane_state.__preview_error, 'The preview could not be prepared.');
  assert.match(harness.stage.innerHTML, /Retry preview/);
  assert.doesNotMatch(harness.stage.innerHTML, /Preview is loading/);
});

test('a failed attached preview remains terminal until an explicit retry', async () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/missing-travel.jpg');
  const state = makeState([travel]);
  let requests = 0;
  const harness = install(state, {
    brokerBaseUrl: 'https://isolated.test.invalid',
    authFetch: async () => {
      requests += 1;
      return {
        ok: false,
        async text() { return ''; }
      };
    }
  });
  harness.controller.sanitize('initial');

  await harness.controller.ensureAttachedPreview(false);
  assert.equal(requests, 1);
  assert.equal(state.evidence_pane_state.__preview_error, 'The preview could not be prepared.');
  assert.equal(state.evidence_pane_state.__preview_loading, false);

  harness.controller.sanitize('observer-reconcile');
  await harness.controller.ensureAttachedPreview(false);

  assert.equal(requests, 1);
  assert.equal(state.evidence_pane_state.__preview_error, 'The preview could not be prepared.');
  assert.equal(state.evidence_pane_state.__preview_loading, false);
});

test('an in-flight shared preview is preserved and does not start a duplicate presign request', async () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([travel]);
  let requests = 0;
  const harness = install(state, {
    brokerBaseUrl: 'https://isolated.test.invalid',
    authFetch: async () => {
      requests += 1;
      return { ok: true, async text() { return JSON.stringify({ signed_url: 'https://example.invalid/file' }); } };
    }
  });
  const target = harness.api.selectionKey(travel);
  state.evidence_pane_state.active_attached_item = clone(travel);
  state.evidence_pane_state.active_attached_id = travel.evidence_id;
  state.evidence_pane_state.__preview_target_key = target;
  state.evidence_pane_state.__preview_load_requested_target_key = target;
  state.evidence_pane_state.__preview_attached_request_key = target;
  state.evidence_pane_state.__preview_loading = true;

  harness.controller.sanitize('shared-preview-in-flight');
  await harness.controller.ensureAttachedPreview(false);

  assert.equal(requests, 0);
  assert.equal(state.evidence_pane_state.__preview_load_requested_target_key, target);
  assert.equal(state.evidence_pane_state.__preview_attached_request_key, target);
  assert.equal(state.evidence_pane_state.__preview_loading, true);
});

test('the controller joins the shared preview presign instead of issuing a second request', async () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([travel]);
  let requests = 0;
  const harness = install(state, {
    brokerBaseUrl: 'https://isolated.test.invalid',
    authFetch: async () => {
      requests += 1;
      return { ok: true, async text() { return JSON.stringify({ signed_url: 'https://example.invalid/duplicate' }); } };
    }
  });
  harness.controller.sanitize('shared-presign-record');
  const target = harness.api.selectionKey(travel);
  state.evidence_pane_state.__preview_presign_inflight = {
    shared: {
      file_key: travel.storage_key,
      preview_selection_key: target,
      promise: Promise.resolve('https://example.invalid/shared')
    }
  };

  await harness.controller.ensureAttachedPreview(false);

  assert.equal(requests, 0);
  assert.equal(state.evidence_pane_state.__preview_signed_url, 'https://example.invalid/shared');
  assert.equal(state.evidence_pane_state.__preview_loading, false);
});

test('a completed attached presign hands off to a successor state with the same row and preview target', async () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([travel]);
  let releaseResponse;
  const harness = install(state, {
    brokerBaseUrl: 'https://isolated.test.invalid',
    authFetch: async () => new Promise(resolve => { releaseResponse = resolve; })
  });
  harness.controller.sanitize('initial');
  const target = harness.api.selectionKey(travel);
  const request = harness.controller.ensureAttachedPreview(true);

  const successor = makeState([travel]);
  harness.win.modalCtx.bulkAuthoriseState = successor;
  const successorController = harness.api.controllerFor(successor);
  successorController.sanitize('successor');
  successor.evidence_pane_state.active_tab = 'attached';
  successor.evidence_pane_state.active_attached_id = travel.evidence_id;
  successor.evidence_pane_state.active_attached_item = clone(travel);
  successor.evidence_pane_state.__preview_target_key = target;
  successor.evidence_pane_state.__preview_load_requested_target_key = target;
  successor.evidence_pane_state.__preview_loading = true;
  successor.evidence_pane_state.__preview_error = 'The preview could not be prepared.';

  releaseResponse({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ signed_url: 'https://example.invalid/file' }); }
  });
  await request;

  assert.equal(state.evidence_pane_state.__preview_signed_url, '');
  assert.equal(successor.evidence_pane_state.__preview_signed_url, 'https://example.invalid/file');
  assert.equal(successor.evidence_pane_state.__preview_loading, false);
  assert.equal(successor.evidence_pane_state.__preview_error, '');
});

test('the post-render boundary is installed once when proxied function reads change identity', async () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const rawState = makeState([travel]);
  let baseCalls = 0;
  rawState.__runPostRenderBindings = async () => { baseCalls += 1; };
  const state = new Proxy(rawState, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === '__runPostRenderBindings' && typeof value === 'function') return new Proxy(value, {});
      return value;
    }
  });
  const harness = install(state);
  let sanitizeCalls = 0;
  harness.controller.sanitize = () => { sanitizeCalls += 1; return { applied: true }; };
  harness.controller.stamp = () => {};

  for (let attempt = 0; attempt < 25; attempt += 1) harness.controller.installStateBoundary();
  await rawState.__runPostRenderBindings();

  assert.equal(baseCalls, 1);
  assert.equal(sanitizeCalls, 2);
});

test('non-Timesheets classifications are not changed', () => {
  const travel = evidence('evidence:travel', 'TRAVEL', 'files/travel.jpg');
  const state = makeState([travel]);
  state.classification = 'NHSP';
  const before = clone(state);
  const harness = install(state);

  const result = harness.controller.sanitize('non-timesheets');

  assert.equal(result.applied, false);
  assert.deepEqual(state, before);
});

test('a genuine synthetic Timesheet primary artifact remains replaceable', () => {
  const syntheticTimesheet = evidence('synthetic-attached:primary', 'TIMESHEET', 'files/manual-timesheet.jpg', {
    evidence_id: null,
    __synthetic_attached_fallback: true,
    is_synthetic_attached_fallback: true
  });
  const accommodation = evidence('evidence:accommodation', 'ACCOMMODATION', 'files/accommodation.jpg');
  const state = makeState([syntheticTimesheet, accommodation]);
  const harness = install(state);

  const rows = harness.api.filterNormalisedEvidenceRows([
    harness.api.normaliseEvidence(syntheticTimesheet),
    harness.api.normaliseEvidence(accommodation)
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'TIMESHEET');
  assert.equal(rows[0].evidence_id, null);
  assert.equal(rows[0].is_synthetic_attached_fallback, true);
});

test('the authorised replacement empty-queue message is exact and UI-friendly', () => {
  const state = makeState([]);
  const harness = install(state);
  assert.equal(
    harness.api.SELECT_QUEUE_REPLACEMENT_MESSAGE,
    'Please select an image from the queue to replace this evidence with'
  );
});

test('authorised state is recognised without relying on checkbox selection', () => {
  const state = makeState([]);
  const harness = install(state);
  state.active_row.bulk_authorise_section = 'authorised_eligible';
  assert.equal(harness.api.isAuthorisedState(state), true);
  state.active_row.bulk_authorise_section = 'processed_eligible';
  state.active_row.authorised_at_server = null;
  state.active_row.authorised = false;
  assert.equal(harness.api.isAuthorisedState(state), false);
});

test('a stamped remove control remains identifiable after Queue navigation rebuilds the state cache', () => {
  const state = makeState([]);
  const harness = install(state);
  const attrs = new Map([
    ['data-attached-selection-key', 'attached|sys:timesheet:test|files/TIMESHEET.jpg'],
    ['data-attached-id', 'sys:timesheet:test'],
    ['data-evidence-id', ''],
    ['data-file-key', 'files/TIMESHEET.jpg'],
    ['data-kind', 'TIMESHEET'],
    ['data-display-name', 'TIMESHEET.jpg'],
    ['data-synthetic', '1']
  ]);
  const item = harness.controller.itemForRemoveControl({
    getAttribute(name) { return attrs.get(name) || ''; }
  });

  assert.equal(item.kind, 'TIMESHEET');
  assert.equal(item.display_name, 'TIMESHEET.jpg');
  assert.equal(item.storage_key, 'files/TIMESHEET.jpg');
  assert.equal(item.is_synthetic_attached_fallback, true);
});

test('returning evidence to the queue invalidates the cached global Queue rows', () => {
  const state = makeState([]);
  state.evidence_pane_state.queue_rows = [{ queue_id: 'old-queue-item' }];
  state.evidence_pane_state.__queue_loaded = true;
  state.evidence_pane_state.__queue_scope = 'global:QUEUED';
  state.evidence_pane_state.__queue_loaded_scope = 'global:QUEUED';
  state.evidence_pane_state.__queue_loading = true;
  state.evidence_pane_state.__queue_loading_scope = 'global:QUEUED';
  state.evidence_pane_state.__queue_refresh_inflight = Promise.resolve();
  state.evidence_pane_state.__queue_refresh_inflight_by_owner = { owner: Promise.resolve() };
  state.evidence_pane_state.__queue_refresh_last_result = 'applied';
  const harness = install(state);

  const invalidated = harness.controller.invalidateQueueAfterReturn({
    workbench_queue_created: true,
    returned_queue_id: 'returned-queue-item'
  });

  assert.equal(invalidated, true);
  assert.equal(state.evidence_pane_state.queue_rows.length, 0);
  assert.equal(state.evidence_pane_state.__queue_loaded, false);
  assert.equal(state.evidence_pane_state.__queue_loading, false);
  assert.equal(state.evidence_pane_state.__queue_loading_scope, '');
  assert.equal(state.evidence_pane_state.__queue_refresh_inflight, null);
  assert.equal(Object.keys(state.evidence_pane_state.__queue_refresh_inflight_by_owner).length, 0);
  assert.equal(state.evidence_pane_state.__queue_scope, 'global:QUEUED');
  assert.equal(state.evidence_pane_state.__queue_loaded_scope, 'global:QUEUED');
  assert.equal(state.evidence_pane_state.__queue_refresh_last_result, '');
});

test('attaching a Queue item invalidates the cached Queue membership', () => {
  const state = makeState([]);
  state.evidence_pane_state.queue_rows = [{ queue_id: 'attached-queue-item' }];
  state.evidence_pane_state.__queue_loaded = true;
  const harness = install(state);

  const invalidated = harness.controller.invalidateQueueAfterReturn({
    action: 'ATTACH',
    queue_id: 'attached-queue-item',
    workbench_queue_created: false
  });

  assert.equal(invalidated, true);
  assert.equal(state.evidence_pane_state.queue_rows.length, 0);
  assert.equal(state.evidence_pane_state.__queue_loaded, false);
});

test('an evidence mutation that does not create a queue item preserves the Queue cache', () => {
  const state = makeState([]);
  const cachedRows = [{ queue_id: 'cached-queue-item' }];
  state.evidence_pane_state.queue_rows = cachedRows;
  state.evidence_pane_state.__queue_loaded = true;
  const harness = install(state);

  const invalidated = harness.controller.invalidateQueueAfterReturn({
    workbench_queue_created: false,
    evidence: []
  });

  assert.equal(invalidated, false);
  assert.equal(state.evidence_pane_state.queue_rows, cachedRows);
  assert.equal(state.evidence_pane_state.__queue_loaded, true);
});

test('verified badge truth is reused across an unchanged canonical dataset replacement', async () => {
  const state = makeState([]);
  state.dataset.rows[0].backend_row_signature = 'signature:unchanged';
  let contextRequests = 0;
  const harness = install(state, {
    brokerBaseUrl: 'https://example.invalid',
    async authFetch(url) {
      if (!String(url).includes('/bulk-authorise-context')) {
        return {
          ok: true,
          async text() { return JSON.stringify({ ok: true, can_manage_evidence: true }); }
        };
      }
      contextRequests += 1;
      throw new Error('A cached row must not be fetched again.');
    }
  });
  harness.controller.captureDatasetTruth();
  harness.controller.rememberVerifiedBadgeState(
    state.dataset.rows[0].row_key,
    {
      evidence_badges: badges('TIMESHEET'),
      has_any_evidence: true,
      attached_evidence_count: 1
    },
    state.dataset.rows[0]
  );

  state.dataset = {
    rows: [{
      ...clone(state.dataset.rows[0]),
      evidence_badges: badges(),
      has_any_evidence: false,
      attached_evidence_count: 0
    }]
  };
  harness.controller.captureDatasetTruth();
  const result = await harness.controller.hydrateDatasetBadges();

  assert.equal(result.cached, true);
  assert.equal(contextRequests, 0);
  assert.deepEqual(harness.api.positiveBadgeKinds(state.dataset.rows[0].evidence_badges), ['TIMESHEET']);
  assert.equal(state.dataset.rows[0].attached_evidence_count, 1);
});

test('verified truth is reapplied when rerender replaces rows inside the same dataset container', async () => {
  const state = makeState([]);
  state.dataset.rows[0].backend_row_signature = 'dataset:unchanged';
  let contextRequests = 0;
  const harness = install(state, {
    brokerBaseUrl: 'https://example.invalid',
    async authFetch(url) {
      if (!String(url).includes('/bulk-authorise-context')) {
        return {
          ok: true,
          async text() { return JSON.stringify({ ok: true, can_manage_evidence: true }); }
        };
      }
      contextRequests += 1;
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            ok: true,
            profile: 'evidence',
            context_profile: 'evidence',
            evidence_loaded: true,
            row: { backend_row_signature: 'evidence-layer:different' },
            evidence: []
          });
        }
      };
    }
  });

  const first = await harness.controller.hydrateDatasetBadges();
  assert.equal(first.succeeded, 1);
  assert.equal(contextRequests, 1);
  assert.equal(state.dataset.rows[0].__evidence_badges_verified, true);
  assert.equal(
    harness.controller.verifiedBadgeTruth.get(state.dataset.rows[0].row_key)?.row_signature,
    'dataset:unchanged'
  );

  state.dataset.rows = [{
      ...clone(state.dataset.rows[0]),
      __evidence_badges_verified: false
    }];
  assert.ok(harness.controller.reusableVerifiedBadgeState(state.dataset.rows[0]));
  const second = await harness.controller.hydrateDatasetBadges();

  assert.equal(second.cached, true);
  assert.equal(second.reapplied, true);
  assert.equal(contextRequests, 1);
  assert.equal(state.dataset.rows[0].__evidence_badges_verified, true);
});

test('verified badge truth is invalidated when the canonical row signature changes', () => {
  const state = makeState([]);
  state.dataset.rows[0].backend_row_signature = 'signature:before';
  const harness = install(state);
  harness.controller.rememberVerifiedBadgeState(
    state.dataset.rows[0].row_key,
    {
      evidence_badges: badges('TRAVEL'),
      has_any_evidence: true,
      attached_evidence_count: 1
    },
    state.dataset.rows[0]
  );

  const changedRow = { ...clone(state.dataset.rows[0]), backend_row_signature: 'signature:after' };

  assert.equal(harness.controller.reusableVerifiedBadgeState(changedRow), null);
  assert.equal(harness.controller.verifiedBadgeTruth.has(changedRow.row_key), false);
});

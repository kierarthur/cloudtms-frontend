const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..', '..');
const batchSource = fs.readFileSync(path.join(repoRoot, 'js', 'invoice-batch-modal.js'), 'utf8');
const diagnosticSource = fs.readFileSync(path.join(repoRoot, 'js', 'invoice-diagnostic-catalog.js'), 'utf8');
const batchRuntimeSource = `${diagnosticSource}\n${batchSource}`;
const asyncSource = fs.readFileSync(path.join(repoRoot, 'js', 'invoice-async-ui.js'), 'utf8');

function storage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function baseDocument() {
  return {
    readyState: 'loading',
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({
      dataset: {},
      classList: { toggle() {} },
      setAttribute() {},
      click() {},
      insertAdjacentElement() {}
    })
  };
}

function loadScript(source, additions = {}) {
  const local = storage();
  const session = storage();
  const document = additions.document || baseDocument();
  const window = {
    location: { host: 'testmode.arthur-rai.co.uk', origin: 'https://testmode.arthur-rai.co.uk' },
    localStorage: local,
    sessionStorage: session,
    document,
    addEventListener() {},
    ...additions.window
  };
  const context = {
    window,
    document,
    localStorage: local,
    sessionStorage: session,
    URL,
    URLSearchParams,
    Blob,
    AbortController,
    Intl,
    Date: additions.Date || Date,
    Math,
    JSON,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    Promise,
    RegExp,
    Error,
    structuredClone,
    crypto: webcrypto,
    CSS: { escape: value => String(value) },
    setTimeout: additions.setTimeout || setTimeout,
    clearTimeout: additions.clearTimeout || clearTimeout,
    queueMicrotask: additions.queueMicrotask || (() => {}),
    console
  };
  window.window = window;
  vm.runInNewContext(source, context, { filename: 'invoice-ui.js' });
  return { window, context, local, session };
}

const UUID_A = '42f1f62c-7d11-437e-85b0-7b135be865e3';
const UUID_B = '241fc420-cbb9-4ed5-b92b-fc3c2ae03078';
const UUID_C = '4ed82adf-da4d-4de6-866b-492d06ba1a77';

test('blocked candidates never receive a checkbox while delivery-blocked issue rows remain selectable', () => {
  const { window } = loadScript(batchRuntimeSource);
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('ISSUE');
  const blocked = {
    selection_key: 'blocked',
    invoice_number: 'INV-1',
    selectable: false,
    issue_blocker_codes: ['DOCUMENT_STALE'],
    client_id: UUID_A,
    candidate_ids: [UUID_B]
  };
  const deliveryBlocked = {
    selection_key: 'delivery',
    invoice_number: 'INV-2',
    selectable: true,
    blocked_for_sending: true,
    delivery_blocker_codes: ['DELIVERY_BLOCKED'],
    client_id: UUID_A,
    candidate_ids: [UUID_B]
  };
  const blockedHtml = window.InvoiceBatchModalV8.renderInvoiceBatchRow(blocked, state);
  const deliveryHtml = window.InvoiceBatchModalV8.renderInvoiceBatchRow(deliveryBlocked, state);
  assert.doesNotMatch(blockedHtml, /type="checkbox"/);
  assert.match(deliveryHtml, /type="checkbox"/);
  assert.match(deliveryHtml, /Blocked for sending/);
});

test('eligible not-generated rows remain selectable without a redundant generation badge', () => {
  const { window } = loadScript(batchRuntimeSource);
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('GENERATE');
  const row = {
    selection_key: 'generate:ready',
    selectable: true,
    generation_state: 'NOT_GENERATED',
    client_name: 'TEST client',
    client_id: UUID_A,
    candidate_ids: [UUID_B]
  };
  const html = window.InvoiceBatchModalV8.renderInvoiceBatchRow(row, state);
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, /Not generated/);
});

test('Generate hides document-not-ready noise but preserves stale and failed document warnings', () => {
  const { window } = loadScript(batchRuntimeSource);
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('GENERATE');
  const row = {
    selection_key: 'generate:stale',
    selectable: false,
    generation_state: 'STALE',
    document_dependency_codes: ['DOCUMENT_NOT_READY', 'DOCUMENT_STALE'],
    client_name: 'TEST client',
    client_id: UUID_A,
    candidate_ids: [UUID_B]
  };
  const html = window.InvoiceBatchModalV8.renderInvoiceBatchRow(row, state);
  assert.doesNotMatch(html, /Not generated/);
  assert.match(html, /Stale/);
});

test('batch candidates render in a semantic flat table with fixed aligned columns', () => {
  const { window } = loadScript(batchRuntimeSource);
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('GENERATE');
  state.candidate_page = {
    rows: [{
      selection_key: 'scope:nested',
      selectable: true,
      generation_state: 'NOT_GENERATED',
      row_status: 'READY',
      client_id: UUID_A,
      client_name: 'TEST client',
      candidate_ids: [UUID_B],
      candidate_names: ['TEST candidate'],
      week_ending_date: '2026-07-26'
    }]
  };
  const html = window.renderInvoiceBatchGroups(state);
  assert.match(html, /<table class="invbatch-candidate-table">/);
  assert.match(html, /<thead>/);
  assert.match(html, /<tbody>/);
  assert.match(html, /<th[^>]*>Week ending<\/th>[\s\S]*<th[^>]*>Trust \/ client<\/th>[\s\S]*<th[^>]*>Candidate \/ worker<\/th>[\s\S]*<th[^>]*>Status<\/th>/);
  assert.doesNotMatch(html, /invbatch-group-header|toggle-group|group-selection/);
  assert.match(html, /data-selection-key="scope:nested"/);
  assert.match(html, /TEST candidate/);
  assert.match(html, /type="checkbox"/);
});

test('sort priority defaults to week, client, candidate and status and reorders by drag authority', () => {
  const { window } = loadScript(batchRuntimeSource);
  const defaultState = window.InvoiceBatchModalV8.createInvoiceBatchModalState('GENERATE');
  assert.deepEqual(
    JSON.parse(JSON.stringify(defaultState.group_order)),
    ['WEEK', 'CLIENT', 'CANDIDATE', 'STATUS']
  );
  assert.equal(
    window.InvoiceBatchModalV8.moveInvoiceBatchGroupDimension(defaultState, 'STATUS', 'WEEK'),
    true
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(defaultState.group_order)),
    ['STATUS', 'WEEK', 'CLIENT', 'CANDIDATE']
  );
  assert.equal(defaultState.sort.sort_key, 'STATUS');
  assert.equal(defaultState.sort.group_preset, 'STATUS_WEEK_CLIENT');
  const toolbar = window.renderInvoiceBatchToolbar(defaultState);
  assert.match(toolbar, /Sort priority \(drag only\)/);
  assert.match(toolbar, /draggable="true"/);
  assert.doesNotMatch(toolbar, /group-up|group-down|↑|↓/);
  assert.doesNotMatch(toolbar, /Primary sort|data-batch-field="sort-key"/);
});

test('drag sort priority is the sole authority and automatically reloads PAGE and SUMMARY', async () => {
  const requestBodies = [];
  const snapshot = {
    contract_version: 'INVOICE_BATCH_SNAPSHOT_V2',
    action: 'GENERATE',
    revision: 1,
    at_utc: '2026-07-29T12:00:00.000Z',
    expires_at_utc: '2026-07-29T13:00:00.000Z',
    key_id: 'test-key',
    token: 'opaque.snapshot'
  };
  const { window } = loadScript(batchRuntimeSource, {
    window: {
      authFetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        requestBodies.push(body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            contract_version: 'INVOICE_BATCH_CANDIDATES_V2',
            action: 'GENERATE',
            mode: body.mode,
            snapshot,
            query_hash: '1'.repeat(64),
            filter_hash: '2'.repeat(64),
            selection_hash: '3'.repeat(64),
            rows: [],
            page: { next_cursor: null, total_count: 0 },
            totals: {},
            selection_summary: {
              exact: true,
              eligible_total: 0,
              selected_total: 0,
              blocked_total: 0
            },
            group_selection: [],
            facets: {},
            normalised_filter: body.filters,
            normalised_sort: body.sort
          })
        };
      }
    }
  });
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('GENERATE');
  const changed = await window.InvoiceBatchModalV8.applyInvoiceBatchSortPriorityChange(
    state,
    'STATUS',
    'WEEK'
  );
  assert.equal(changed, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.group_order)),
    ['STATUS', 'WEEK', 'CLIENT', 'CANDIDATE']
  );
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].mode, 'PAGE');
  assert.equal(requestBodies[1].mode, 'SUMMARY');
  assert.equal(requestBodies[0].sort.sort_key, 'STATUS');
  assert.equal(requestBodies[0].sort.group_preset, 'STATUS_WEEK_CLIENT');
  assert.equal(requestBodies[0].sort.sort_direction, 'DESC');
  assert.deepEqual(JSON.parse(JSON.stringify(state.page_history)), []);
});

test('flat table SUMMARY requests exact totals without obsolete group selectors', async () => {
  const snapshot = {
    contract_version: 'INVOICE_BATCH_SNAPSHOT_V2',
    action: 'GENERATE',
    at_utc: '2026-07-26T12:00:00.000Z',
    revision: 7,
    expires_at_utc: '2026-07-26T12:30:00.000Z',
    key_id: 'test-key',
    token: 'opaque'
  };
  const row = {
    selection_key: 'scope:summary',
    selectable: true,
    row_status: 'READY',
    client_id: UUID_A,
    candidate_ids: [UUID_B],
    week_ending_date: '2026-07-26'
  };
  let call = 0;
  const requestBodies = [];
  const { window } = loadScript(batchRuntimeSource, {
    window: {
      authFetch: async (_url, options) => {
        call += 1;
        requestBodies.push(JSON.parse(options.body));
        return {
          ok: true,
          status: 200,
          json: async () => call === 1 ? {
            contract_version: 'INVOICE_BATCH_CANDIDATES_V2',
            action: 'GENERATE',
            mode: 'PAGE',
            snapshot,
            query_hash: '1'.repeat(64),
            filter_hash: '2'.repeat(64),
            selection_hash: '3'.repeat(64),
            rows: [row],
            page: { total_count: 1, has_more: false, next_cursor: null },
            totals: {},
            selection_summary: { exact: false },
            facets: {},
            group_selection: [{
              selector: { type: 'WEEK', week_ending_date: '2026-07-26' },
              group_key: 'page-leaf',
              eligible_total: 1,
              selected_total: 1,
              state: 'CHECKED',
              has_hidden_override: false
            }],
            normalised_filter: {},
            normalised_sort: {
              group_preset: 'WEEK_CLIENT_CANDIDATE',
              sort_key: 'WEEK_ENDING_DATE',
              sort_direction: 'DESC'
            }
          } : {
            contract_version: 'INVOICE_BATCH_CANDIDATES_V2',
            action: 'GENERATE',
            mode: 'SUMMARY',
            snapshot,
            query_hash: '1'.repeat(64),
            filter_hash: '2'.repeat(64),
            selection_hash: '3'.repeat(64),
            rows: [],
            page: { total_count: 1, has_more: false, next_cursor: null },
            totals: {},
            selection_summary: { exact: true, eligible_total: 1, selected_total: 1, blocked_total: 0 },
            group_selection: [],
            facets: {}
          }
        };
      }
    }
  });
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('GENERATE');
  const page = await window.loadInvoiceBatchCandidatePage(state);
  assert.ok(page);
  assert.equal(state.selection_summary_pending, true);
  assert.deepEqual(JSON.parse(JSON.stringify(state.group_selection)), []);
  const summary = await window.loadInvoiceBatchSelectionSummary(state);
  assert.ok(summary);
  assert.equal(state.selection_summary_error, null);
  assert.equal(state.selection_summary_pending, false);
  assert.deepEqual(requestBodies[1].group_selectors, []);
});

test('implicit-all selection persists exclusions and later child rules override group rules', () => {
  const { window } = loadScript(batchRuntimeSource);
  const selection = window.InvoiceBatchModalV8.createInvoiceBatchSelectionState();
  const row = {
    selection_key: 'scope:a',
    selectable: true,
    week_ending_date: '2026-07-26',
    client_id: UUID_A,
    candidate_ids: [UUID_B]
  };
  assert.equal(window.InvoiceBatchModalV8.isInvoiceBatchRowSelected(selection, row), true);
  window.InvoiceBatchModalV8.applyInvoiceBatchSelectionRule(
    selection,
    'EXCLUDE',
    { type: 'WEEK', week_ending_date: '2026-07-26' }
  );
  assert.equal(window.InvoiceBatchModalV8.isInvoiceBatchRowSelected(selection, row), false);
  window.InvoiceBatchModalV8.applyInvoiceBatchSelectionRule(
    selection,
    'INCLUDE',
    { type: 'ROW', selection_key: 'scope:a' }
  );
  assert.equal(window.InvoiceBatchModalV8.isInvoiceBatchRowSelected(selection, row), true);
  assert.equal(
    window.InvoiceBatchModalV8.deriveInvoiceBatchGroupSelectionState(
      selection,
      [row],
      { type: 'WEEK', week_ending_date: '2026-07-26' },
      [{
        selector: { type: 'WEEK', week_ending_date: '2026-07-26' },
        eligible_total: 2,
        selected_total: 1,
        state: 'INDETERMINATE',
        has_hidden_override: true
      }]
    ),
    'INDETERMINATE'
  );
});

test('a later hidden descendant rule keeps its parent group indeterminate', () => {
  const { window } = loadScript(batchRuntimeSource);
  const selection = window.InvoiceBatchModalV8.createInvoiceBatchSelectionState();
  const visibleRow = {
    selection_key: 'scope:visible',
    selectable: true,
    week_ending_date: '2026-07-26',
    client_id: UUID_A,
    candidate_ids: [UUID_B]
  };
  window.InvoiceBatchModalV8.applyInvoiceBatchSelectionRule(
    selection,
    'INCLUDE',
    { type: 'WEEK', week_ending_date: '2026-07-26' }
  );
  window.InvoiceBatchModalV8.applyInvoiceBatchSelectionRule(
    selection,
    'EXCLUDE',
    { type: 'WEEK_CLIENT', week_ending_date: '2026-07-26', client_id: UUID_C }
  );
  assert.equal(
    window.InvoiceBatchModalV8.deriveInvoiceBatchGroupSelectionState(
      selection,
      [visibleRow],
      { type: 'WEEK', week_ending_date: '2026-07-26' },
      [{
        selector: { type: 'WEEK', week_ending_date: '2026-07-26' },
        eligible_total: 3,
        selected_total: 2,
        state: 'INDETERMINATE',
        has_hidden_override: true
      }]
    ),
    'INDETERMINATE'
  );
});

test('selection submission uses the locked query and implicit selection contracts', () => {
  const { window } = loadScript(batchRuntimeSource);
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('GENERATE');
  state.snapshot = {
    contract_version: 'INVOICE_BATCH_SNAPSHOT_V2',
    action: 'GENERATE',
    at_utc: '2026-07-26T12:00:00.000Z',
    revision: 7,
    expires_at_utc: '2026-07-26T12:30:00.000Z',
    key_id: 'test-key',
    token: 'opaque'
  };
  state.filter.allow_early = false;
  state.display_mode = 'BLOCKED';
  const contract = window.InvoiceBatchModalV8.buildInvoiceBatchSelectionContract(state);
  assert.equal(contract.contract_version, 'INVOICE_BATCH_SELECTION_ROOT_V2');
  assert.equal(contract.query.contract_version, 'INVOICE_BATCH_QUERY_V2');
  assert.equal(contract.query.action, 'GENERATE');
  assert.deepEqual(JSON.parse(JSON.stringify(contract.query.snapshot)), state.snapshot);
  assert.equal(contract.query.filters.allow_early, false);
  assert.equal(contract.query.filters.display_mode, 'BLOCKED');
  assert.equal(contract.selection.mode, 'IMPLICIT_ALL');
  assert.equal(contract.selection.default_selected, true);
});

test('Generate and view starts document preparation only after the invoice record exists', async () => {
  const calls = [];
  const { window } = loadScript(batchRuntimeSource, {
    window: {
      authFetch: async (url, init) => {
        calls.push({ url, init });
        return {
          status: 200,
          json: async () => ({
            contract_version: 'INVOICE_VIEWER_V2',
            viewer_state: 'READY',
            purpose: 'DRAFT_PREVIEW',
            document_version_id: UUID_B
          })
        };
      },
      openExactReadyDocument: async documentVersionId => ({
        document_version_id: documentVersionId,
        blob_url: 'blob:test-preview'
      })
    }
  });
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('GENERATE');
  state.viewer_request = {
    open: true,
    selection_key: 'scope:generated',
    request_serial: 1,
    blob_url: null
  };
  await window.prepareGeneratedInvoiceForBatchViewer(UUID_A, state);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp(`/api/invoices/${UUID_A}/render$`));
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[0].init.body, /VIEW_NOW/);
  assert.equal(state.viewer_request.document_version_id, UUID_B);
  assert.equal(state.viewer_request.blob_url, 'blob:test-preview');
});

test('capabilities reject contract drift and arbitrary UUID objects are not operations', () => {
  const { window } = loadScript(asyncSource);
  const valid = {
    contract_version: 'INVOICE_ASYNC_BACKEND_V8',
    backend_contract_version: 'INVOICE_ASYNC_BACKEND_V8',
    database_contract_ready: true,
    deployment_contract_ready: true,
    pipeline_enabled: true,
    processor_enabled: true,
    enabled_for_user: true,
    controlled_cohort: true,
    scheduled_enabled: false,
    supported_media_types: ['application/pdf', 'image/jpeg', 'image/png'],
    document_view_contract_version: 'INVOICE_DOCUMENT_VERSION_ACCESS_V1',
    heartbeat_supported: true,
    feature_flags: {
      batch_candidate_paging_v2: true,
      batch_selection_rules_v2: true,
      batch_selection_summary_v2: true,
      batch_facets_v2: true,
      batch_result_paging_v2: true,
      generate_and_view_v2: true,
      exact_document_version_access_v1: true,
      separate_issue_delivery_state_v2: true,
      bounded_viewer_contract_v2: true
    }
  };
  assert.equal(window.validateInvoiceAsyncCapabilities(valid).enabled_for_user, true);
  assert.throws(
    () => window.validateInvoiceAsyncCapabilities({
      ...valid,
      supported_media_types: [...valid.supported_media_types, 'image/webp']
    }),
    /INVOICE_ASYNC_MEDIA_CONTRACT_MISMATCH/
  );
  assert.equal(window.normaliseInvoiceOperationWatch({ id: UUID_A, invoice_number: 'INV-1' }), null);
  assert.equal(window.normaliseInvoiceOperationWatch(UUID_A), null);
  assert.equal(
    window.normaliseInvoiceOperationWatch(UUID_A, {
      explicit_operation_ids: true,
      operation_type: 'BATCH_GENERATE',
      purpose: 'BATCH_GENERATE'
    }).operation_id,
    UUID_A
  );
});

test('disabled capability preserves the stable batch installer and enabled capability installs V8 idempotently', async () => {
  const legacyRender = () => 'legacy-render';
  const legacyEmail = () => 'legacy-email';
  let batchInstalls = 0;
  const { window } = loadScript(asyncSource, {
    window: {
      handleInvoiceRenderPdf: legacyRender,
      handleInvoiceEmail: legacyEmail,
      renderInvoiceModalContent: () => '<div>legacy</div>',
      InvoiceBatchModalV8: { install: () => { batchInstalls += 1; } }
    }
  });
  window.__invoiceAsyncCapability = { enabled_for_user: false };
  assert.equal(window.installInvoiceAsyncOverrides(), false);
  assert.notEqual(window.handleInvoiceRenderPdf, legacyRender);
  assert.notEqual(window.handleInvoiceEmail, legacyEmail);
  assert.equal(await window.handleInvoiceRenderPdf(), null);

  window.__invoiceAsyncCapability = {
    enabled_for_user: false,
    document_read_ready: true,
    document_generation_ready: false
  };
  assert.equal(window.installInvoiceAsyncOverrides(), true);
  assert.equal(window.__invoiceAsyncOverridesInstalled, true);
  assert.equal(window.__invoiceAsyncGenerationInstalled, false);

  window.__invoiceAsyncCapability = {
    enabled_for_user: true,
    document_read_ready: true,
    document_generation_ready: true
  };
  assert.equal(window.installInvoiceAsyncOverrides(), true);
  assert.equal(window.__invoiceAsyncGenerationInstalled, true);
  assert.notEqual(window.handleInvoiceRenderPdf, legacyRender);
  assert.notEqual(window.handleInvoiceEmail, legacyEmail);
  const installsAfterEnable = batchInstalls;
  assert.equal(window.installInvoiceAsyncOverrides(), true);
  assert.equal(batchInstalls, installsAfterEnable);
});

test('Batch Generate and Issue entry points remain stable across async startup and unavailable capability installs', () => {
  const { window, context } = loadScript(batchRuntimeSource);
  const generate = window.openInvoiceBatchGenerateModal;
  const issue = window.openInvoiceBatchIssueModal;
  assert.equal(generate.__invoiceBatchModalV8, true);
  assert.equal(issue.__invoiceBatchModalV8, true);

  vm.runInNewContext(asyncSource, context, { filename: 'invoice-async-ui.js' });
  assert.equal(window.openInvoiceBatchGenerateModal, generate);
  assert.equal(window.openInvoiceBatchIssueModal, issue);
  window.installInvoiceAsyncUnavailableActions();
  assert.equal(window.openInvoiceBatchGenerateModal, generate);
  assert.equal(window.openInvoiceBatchIssueModal, issue);
});

test('document action states expose visible labels, disabled state and ARIA busy semantics', () => {
  const { window } = loadScript(asyncSource);
  const preparing = window.deriveInvoiceAsyncActionState({
    operation_type: 'VIEW_INVOICE_DOCUMENT',
    status: 'RUNNING',
    phase: 'SOURCE_RENDER'
  });
  assert.equal(preparing.tone, 'amber');
  assert.equal(preparing.button_label, 'Generate invoice PDF now');
  assert.equal(preparing.disabled, false);
  assert.equal(preparing.aria_busy, true);

  const ready = window.deriveInvoiceAsyncActionState({
    operation_type: 'VIEW_INVOICE_DOCUMENT',
    status: 'COMPLETE',
    document_version_id: UUID_A
  });
  assert.equal(ready.tone, 'ready');
  assert.equal(ready.button_label, 'View invoice PDF');
  assert.equal(ready.view_available, true);
  assert.equal(window.renderInvoiceProgressText({
    operation_type: 'VIEW_INVOICE_DOCUMENT',
    status: 'RUNNING',
    progress: { completed_units: 4, total_units: 5 }
  }), 'Preparing invoice PDF…');
  assert.doesNotMatch(window.renderInvoiceAsyncState({
    document_operation: {
      operation_type: 'VIEW_INVOICE_DOCUMENT',
      status: 'RUNNING',
      progress: { completed_units: 4, total_units: 5 }
    }
  }), /4\/5|Preparing invoice PDF….*Preparing invoice PDF…/s);

  const readyAlias = window.deriveInvoiceAsyncActionState({
    operation_type: 'VIEW_INVOICE_DOCUMENT',
    status: 'READY',
    document_version_id: UUID_A
  });
  assert.equal(readyAlias.tone, 'ready');
  assert.equal(readyAlias.button_label, 'View invoice PDF');

  const terminalWithoutVersion = window.deriveInvoiceAsyncActionState({
    operation_type: 'VIEW_INVOICE_DOCUMENT',
    status: 'COMPLETE'
  });
  assert.equal(terminalWithoutVersion.tone, 'error');
  assert.equal(terminalWithoutVersion.view_available, false);
  assert.equal(terminalWithoutVersion.button_label, 'Document unavailable');
  assert.equal(terminalWithoutVersion.disabled, true);

  const activeWithStaleVersion = window.deriveInvoiceAsyncActionState({
    operation_type: 'VIEW_INVOICE_DOCUMENT',
    status: 'RUNNING',
    document_version_id: UUID_A
  });
  assert.equal(activeWithStaleVersion.view_available, false);
  assert.equal(activeWithStaleVersion.button_label, 'Generate invoice PDF now');
  assert.equal(activeWithStaleVersion.disabled, false);
});

test('individual PREPARING starts one immediate non-overlapping watcher and exact READY stops it', async () => {
  const scheduled = [];
  let pingCalls = 0;
  let releasePing;
  const pendingPing = new Promise(resolve => { releasePing = resolve; });
  const { window } = loadScript(asyncSource, {
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, cleared: false, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimeout: timer => { if (timer) timer.cleared = true; },
    window: {
      __USER_ID: UUID_C,
      authFetch: async () => ({
        ok: true,
        status: 202,
        json: async () => ({
          contract_version: 'INVOICE_VIEWER_V2',
          viewer_state: 'PREPARING',
          purpose: 'DRAFT_PREVIEW',
          operation: {
            operation_id: UUID_B,
            operation_type: 'VIEW_INVOICE_DOCUMENT',
            entity_type: 'INVOICE',
            entity_id: UUID_A,
            status: 'QUEUED',
            purpose: 'DRAFT_PREVIEW'
          }
        })
      }),
      __changesHeartbeat: {
        pingOnce: async () => {
          pingCalls += 1;
          await pendingPing;
        }
      }
    }
  });
  const modalCtx = {
    invoiceId: UUID_A,
    invoiceDetail: { invoice: { id: UUID_A, status: 'DRAFT' } },
    invoiceAsync: {}
  };
  window.modalCtx = modalCtx;
  await window.handleInvoiceRenderPdfAsync(modalCtx);
  await Promise.resolve();
  assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 1);
  assert.equal(pingCalls, 1);
  assert.equal(scheduled.filter(timer => timer.ms === 5 * 60 * 1000).length, 1);
  const requestSerial = modalCtx.invoiceAsync.viewer_request.request_serial;
  assert.equal(await window.runInvoiceDocumentForegroundWatch(requestSerial), false);
  assert.equal(pingCalls, 1);
  releasePing();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduled.filter(timer => timer.ms === 2000).length, 1);

  window.applyInvoiceOperationUpdates({
    watched_invoice_operations: [{
      operation_id: UUID_B,
      operation_type: 'VIEW_INVOICE_DOCUMENT',
      entity_type: 'INVOICE',
      entity_id: UUID_A,
      status: 'COMPLETE',
      purpose: 'DRAFT_PREVIEW',
      document_version_id: UUID_C,
      change_seq: 1
    }]
  });
  assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 0);
  assert.equal(modalCtx.invoiceAsync.document_version_id, UUID_C);
  assert.equal(window.deriveInvoiceAsyncActionState(modalCtx.invoiceAsync.document_operation).button_label, 'View invoice PDF');
});

test('foreground watcher stops for every terminal viewer signal without inventing document readiness', async () => {
  for (const status of ['READY', 'BLOCKED', 'FAILED', 'CANCELLED', 'SUPERSEDED']) {
    const { window } = loadScript(asyncSource, {
      window: {
        authFetch: async () => ({
          ok: true,
          status: 202,
          json: async () => ({
            contract_version: 'INVOICE_VIEWER_V2',
            viewer_state: 'PREPARING',
            purpose: 'DRAFT_PREVIEW',
            operation: {
              operation_id: UUID_B,
              operation_type: 'VIEW_INVOICE_DOCUMENT',
              entity_type: 'INVOICE',
              entity_id: UUID_A,
              status: 'QUEUED',
              purpose: 'DRAFT_PREVIEW'
            }
          })
        }),
        __changesHeartbeat: { pingOnce: async () => {} }
      }
    });
    const modalCtx = {
      invoiceId: UUID_A,
      invoiceDetail: { invoice: { id: UUID_A, status: 'DRAFT' } },
      invoiceAsync: {}
    };
    window.modalCtx = modalCtx;
    await window.handleInvoiceRenderPdfAsync(modalCtx);
    await Promise.resolve();
    assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 1, status);
    window.applyInvoiceOperationUpdates({
      watched_invoice_operations: [{
        operation_id: UUID_B,
        operation_type: 'VIEW_INVOICE_DOCUMENT',
        entity_type: 'INVOICE',
        entity_id: UUID_A,
        status,
        purpose: 'DRAFT_PREVIEW',
        change_seq: 1
      }]
    });
    assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 0, status);
    assert.equal(window.deriveInvoiceAsyncActionState(modalCtx.invoiceAsync.document_operation).view_available, false, status);
  }
});

test('foreground watcher exits on modal replacement, logout and its bounded maximum duration', async () => {
  const scheduled = [];
  let nowMs = Date.UTC(2026, 6, 29, 12, 0, 0);
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  }
  const { window } = loadScript(asyncSource, {
    Date: FakeDate,
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, cleared: false, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimeout: timer => { if (timer) timer.cleared = true; },
    window: {
      __USER_ID: UUID_C,
      authFetch: async () => ({
        ok: true,
        status: 202,
        json: async () => ({
          contract_version: 'INVOICE_VIEWER_V2',
          viewer_state: 'PREPARING',
          purpose: 'DRAFT_PREVIEW',
          operation: {
            operation_id: UUID_B,
            operation_type: 'VIEW_INVOICE_DOCUMENT',
            entity_type: 'INVOICE',
            entity_id: UUID_A,
            status: 'QUEUED',
            purpose: 'DRAFT_PREVIEW'
          }
        })
      }),
      __changesHeartbeat: { pingOnce: async () => {} }
    }
  });
  const modalCtx = {
    invoiceId: UUID_A,
    invoiceDetail: { invoice: { id: UUID_A, status: 'DRAFT' } },
    invoiceAsync: {}
  };
  window.modalCtx = modalCtx;
  await window.handleInvoiceRenderPdfAsync(modalCtx);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 1);
  window.modalCtx = {};
  const closeTimer = scheduled.find(timer => timer.ms === 2000 && timer.cleared !== true);
  assert.ok(closeTimer);
  closeTimer.cleared = true;
  await closeTimer.fn();
  assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 0);

  window.modalCtx = modalCtx;
  await window.handleInvoiceRenderPdfAsync(modalCtx);
  await Promise.resolve();
  const firstSerial = modalCtx.invoiceAsync.viewer_request.request_serial;
  assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 1);
  await window.handleInvoiceRenderPdfAsync(modalCtx);
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(modalCtx.invoiceAsync.viewer_request.request_serial, firstSerial);
  assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 1);

  nowMs += 5 * 60 * 1000 + 1;
  const foregroundTimer = [...scheduled].reverse().find(timer => timer.ms === 2000 && timer.cleared !== true);
  assert.ok(foregroundTimer);
  foregroundTimer.cleared = true;
  await foregroundTimer.fn();
  await Promise.resolve();
  assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 0);
  assert.equal(window.loadInvoiceOperationWatches().some(row => row.operation_id === UUID_B), true);

  await window.handleInvoiceRenderPdfAsync(modalCtx);
  await Promise.resolve();
  assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 1);
  window.uninstallInvoiceAsyncOverrides({ reason: 'logout' });
  assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 0);
});

test('issued invoice viewer adopts FINAL_ISSUE and opens only the exact returned version', async () => {
  const calls = [];
  let viewerOpenCount = 0;
  const { window } = loadScript(asyncSource, {
    window: {
      showModal: () => { viewerOpenCount += 1; },
      authFetch: async (url, init) => {
        calls.push({ url, init });
        if (calls.length === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              contract_version: 'INVOICE_VIEWER_V2',
              viewer_state: 'READY',
              purpose: 'FINAL_ISSUE',
              document_version_id: UUID_B
            })
          };
        }
        if (calls.length === 2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              document_version_id: UUID_B,
              purpose: 'FINAL_ISSUE',
              url: `https://test-cloudtms-backend.example/api/invoice-document-versions/${UUID_B}/download?token=opaque`
            })
          };
        }
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob(['%PDF-final'], { type: 'application/pdf' })
        };
      }
    }
  });
  const modalCtx = {
    invoiceId: UUID_A,
    invoiceDetail: { invoice: { id: UUID_A, status: 'ISSUED' } },
    invoiceAsync: {}
  };
  await window.handleInvoiceRenderPdfAsync(modalCtx);
  assert.equal(modalCtx.invoiceAsync.viewer_request.purpose, 'FINAL_ISSUE');
  assert.equal(modalCtx.invoiceAsync.viewer_request.viewer_state, 'READY');
  assert.equal(modalCtx.invoiceAsync.viewer_request.document_version_id, UUID_B);
  assert.equal(calls.length, 1);
  assert.equal(viewerOpenCount, 0);
  await window.handleInvoiceRenderPdfAsync(modalCtx);
  assert.equal(viewerOpenCount, 1);
  assert.match(calls[1].url, new RegExp(`/api/invoice-document-versions/${UUID_B}/presign$`));
  window.revokeInvoiceAsyncViewerBlob(modalCtx);
});

test('a completed document signal opens its exact version without starting another render', async () => {
  const calls = [];
  const { window } = loadScript(asyncSource, {
    window: {
      authFetch: async (url) => {
        calls.push(url);
        if (calls.length === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              document_version_id: UUID_B,
              purpose: 'DRAFT_PREVIEW',
              url: `https://test-cloudtms-backend.example/api/invoice-document-versions/${UUID_B}/download?token=opaque`
            })
          };
        }
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob(['%PDF-ready'], { type: 'application/pdf' })
        };
      }
    }
  });
  const modalCtx = {
    invoiceId: UUID_A,
    invoiceDetail: { invoice: { id: UUID_A, status: 'DRAFT', document_state: 'PREPARING' } },
    invoiceAsync: { document_version_id: UUID_B }
  };
  await window.handleInvoiceRenderPdfAsync(modalCtx);
  assert.equal(calls.length, 2);
  assert.equal(window.activeInvoiceDocumentForegroundWatchCount(), 0);
  assert.match(calls[0], new RegExp(`/api/invoice-document-versions/${UUID_B}/presign$`));
  assert.doesNotMatch(calls[0], /\/api\/invoices\/.+\/render/);
  window.revokeInvoiceAsyncViewerBlob(modalCtx);
});

test('viewer adopts PREPARING purpose only for its current request and ignores a late replacement', async () => {
  let viewerOpenCount = 0;
  const { window } = loadScript(asyncSource, {
    window: {
      showModal: () => { viewerOpenCount += 1; },
      authFetch: async () => ({
        ok: true,
        status: 202,
        json: async () => ({
          contract_version: 'INVOICE_VIEWER_V2',
          viewer_state: 'PREPARING',
          purpose: 'FINAL_ISSUE',
          operation: {
            operation_id: UUID_B,
            operation_type: 'VIEW_INVOICE_DOCUMENT',
            entity_type: 'INVOICE',
            entity_id: UUID_A,
            status: 'QUEUED',
            purpose: 'FINAL_ISSUE'
          }
        })
      })
    }
  });
  const modalCtx = {
    invoiceId: UUID_A,
    invoiceDetail: { invoice: { id: UUID_A, status: 'ISSUED' } },
    invoiceAsync: {}
  };
  await window.handleInvoiceRenderPdfAsync(modalCtx);
  assert.equal(modalCtx.invoiceAsync.viewer_request.purpose, 'FINAL_ISSUE');
  assert.equal(modalCtx.invoiceAsync.viewer_request.operation_id, UUID_B);
  assert.equal(viewerOpenCount, 0);

  let resolveRender;
  window.authFetch = () => new Promise(resolve => { resolveRender = resolve; });
  const lateCtx = {
    invoiceId: UUID_A,
    invoiceDetail: { invoice: { id: UUID_A, status: 'ISSUED' } },
    invoiceAsync: {}
  };
  const pending = window.handleInvoiceRenderPdfAsync(lateCtx);
  await Promise.resolve();
  const originalSerial = lateCtx.invoiceAsync.viewer_request.request_serial;
  lateCtx.invoiceAsync.viewer_request = {
    ...lateCtx.invoiceAsync.viewer_request,
    request_serial: UUID_C,
    purpose: 'DRAFT_PREVIEW'
  };
  resolveRender({
    ok: true,
    status: 200,
    json: async () => ({
      contract_version: 'INVOICE_VIEWER_V2',
      viewer_state: 'READY',
      purpose: 'FINAL_ISSUE',
      document_version_id: UUID_B
    })
  });
  await pending;
  assert.notEqual(lateCtx.invoiceAsync.viewer_request.request_serial, originalSerial);
  assert.equal(lateCtx.invoiceAsync.viewer_request.purpose, 'DRAFT_PREVIEW');
  assert.equal(lateCtx.invoiceAsync.viewer_request.document_version_id, null);
});

test('operation watches are scoped by environment and user and omit internal ready metadata', async () => {
  const enabledCapabilities = {
    contract_version: 'INVOICE_ASYNC_BACKEND_V8',
    backend_contract_version: 'INVOICE_ASYNC_BACKEND_V8',
    database_contract_ready: true,
    deployment_contract_ready: true,
    pipeline_enabled: true,
    processor_enabled: true,
    enabled_for_user: true,
    controlled_cohort: true,
    scheduled_enabled: false,
    supported_media_types: ['application/pdf', 'image/jpeg', 'image/png'],
    document_view_contract_version: 'INVOICE_DOCUMENT_VERSION_ACCESS_V1',
    heartbeat_supported: true,
    feature_flags: {
      batch_candidate_paging_v2: true,
      batch_selection_rules_v2: true,
      batch_selection_summary_v2: true,
      batch_facets_v2: true,
      batch_result_paging_v2: true,
      generate_and_view_v2: true,
      exact_document_version_access_v1: true,
      separate_issue_delivery_state_v2: true,
      bounded_viewer_contract_v2: true
    }
  };
  const { window, session } = loadScript(asyncSource, {
    window: {
      authFetch: async () => ({
        ok: true,
        status: 200,
        json: async () => enabledCapabilities
      }),
      InvoiceBatchModalV8: { install() {}, close() {} }
    }
  });
  session.setItem('cloudtms.invoiceOperationWatches.v8', JSON.stringify([{ operation_id: UUID_C }]));
  window.__USER_ID = UUID_A;
  const watch = window.normaliseInvoiceOperationWatch({
    operation_id: UUID_B,
    operation_type: 'VIEW_INVOICE_DOCUMENT',
    status: 'COMPLETE',
    document_version_id: UUID_C,
    ready_key: 'must-not-persist'
  });
  assert.equal(Object.hasOwn(watch, 'ready_key'), false);
  window.saveInvoiceOperationWatches([watch]);
  const keyA = `cloudtms.invoiceOperationWatches.v8:testmode.arthur-rai.co.uk:${UUID_A}`;
  const keyB = `cloudtms.invoiceOperationWatches.v8:testmode.arthur-rai.co.uk:${UUID_B}`;
  assert.equal(session.getItem('cloudtms.invoiceOperationWatches.v8'), null);
  assert.doesNotMatch(session.getItem(keyA), /ready_key|must-not-persist/);

  window.__USER_ID = UUID_B;
  assert.deepEqual(JSON.parse(JSON.stringify(window.loadInvoiceOperationWatches())), []);
  await window.initialiseInvoiceAsyncUi({ force: true });
  assert.equal(session.getItem(keyA), null);
  window.saveInvoiceOperationWatches([{
    ...watch,
    operation_id: UUID_C,
    root_operation_id: UUID_C
  }]);
  assert.ok(session.getItem(keyB));

  window.authFetch = async () => { throw new Error('temporary capability failure'); };
  await window.initialiseInvoiceAsyncUi({ force: true });
  assert.ok(session.getItem(keyB));
});

test('evidence retry submits only the operation identity through the control route', async () => {
  const calls = [];
  const { window } = loadScript(asyncSource, {
    window: {
      authFetch: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [{
              operation_id: UUID_A,
              operation_type: 'PREPARE_INVOICE_ASSET',
              accepted: true,
              status: 'QUEUED',
              change_seq: 9
            }]
          })
        };
      }
    }
  });
  await window.retryInvoiceEvidenceOperation(UUID_A);
  assert.match(calls[0].url, /\/api\/invoice-operations\/control$/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.contract_version, 'INVOICE_OPERATION_CONTROL_V2');
  assert.equal(body.command_token, body.request_token);
  assert.deepEqual(body.actions, [{ operation_id: UUID_A, action: 'RETRY' }]);
  assert.equal(calls[0].init.headers['idempotency-key'], body.request_token);
  assert.doesNotMatch(calls[0].init.body, /work_key|fence|plan_generation|replacement_payload/);
});

test('definitive evidence retry rejection clears its token and a deliberate retry uses a fresh token', async () => {
  const calls = [];
  const toasts = [];
  let requestCount = 0;
  const { window } = loadScript(asyncSource, {
    window: {
      __toast: message => toasts.push(message),
      authFetch: async (url, init) => {
        calls.push({ url, init });
        requestCount += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [{
              operation_id: UUID_A,
              action: 'RETRY',
              accepted: requestCount > 1,
              status: requestCount > 1 ? 'QUEUED' : 'WAITING',
              error: requestCount > 1 ? null : { code: 'OPERATION_NOT_RETRYABLE' }
            }]
          })
        };
      }
    }
  });
  const button = {
    dataset: {},
    disabled: false,
    isConnected: true,
    setAttribute() {}
  };
  await assert.rejects(
    window.retryInvoiceEvidenceOperation(UUID_A, button),
    /OPERATION_NOT_RETRYABLE/
  );
  const rejectedToken = JSON.parse(calls[0].init.body).request_token;
  assert.equal(Object.hasOwn(button.dataset, 'operationControlToken'), false);
  assert.deepEqual(toasts, []);

  await window.retryInvoiceEvidenceOperation(UUID_A, button);
  const acceptedToken = JSON.parse(calls[1].init.body).request_token;
  assert.notEqual(acceptedToken, rejectedToken);
  assert.equal(Object.hasOwn(button.dataset, 'operationControlToken'), false);
  assert.deepEqual(toasts, ['Evidence retry queued.']);
});

test('uncertain evidence retry response retains its token for an idempotent replay', async () => {
  const calls = [];
  let requestCount = 0;
  const { window } = loadScript(asyncSource, {
    window: {
      authFetch: async (url, init) => {
        calls.push({ url, init });
        requestCount += 1;
        if (requestCount === 1) throw new Error('network response unavailable');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [{
              operation_id: UUID_A,
              action: 'RETRY',
              accepted: true,
              status: 'QUEUED'
            }]
          })
        };
      }
    }
  });
  const button = {
    dataset: {},
    disabled: false,
    isConnected: true,
    setAttribute() {}
  };
  await assert.rejects(
    window.retryInvoiceEvidenceOperation(UUID_A, button),
    /network response unavailable/
  );
  const uncertainToken = JSON.parse(calls[0].init.body).request_token;
  assert.equal(button.dataset.operationControlToken, uncertainToken);

  await window.retryInvoiceEvidenceOperation(UUID_A, button);
  const replayToken = JSON.parse(calls[1].init.body).request_token;
  assert.equal(replayToken, uncertainToken);
  assert.equal(Object.hasOwn(button.dataset, 'operationControlToken'), false);
});

test('capability failure installs unavailable actions rather than legacy processing', async () => {
  const legacyRender = () => 'legacy-render';
  const legacyEmail = () => 'legacy-email';
  const { window } = loadScript(asyncSource, {
    window: {
      handleInvoiceRenderPdf: legacyRender,
      handleInvoiceEmail: legacyEmail,
      authFetch: async () => { throw new Error('offline'); }
    }
  });
  const capability = await window.initialiseInvoiceAsyncUi({ force: true });
  assert.equal(capability.enabled_for_user, false);
  assert.notEqual(window.handleInvoiceRenderPdf, legacyRender);
  assert.notEqual(window.handleInvoiceEmail, legacyEmail);
  assert.equal(window.__invoiceAsyncOverridesInstalled, false);
});

test('operation extraction follows documented paths and ignores arbitrary result objects', () => {
  const { window } = loadScript(asyncSource);
  const rows = window.extractInvoiceOperationRows({
    operation: { operation_id: UUID_A, operation_type: 'BATCH_GENERATE', status: 'RUNNING' },
    children: [{ operation_id: UUID_B, operation_type: 'VIEW_INVOICE_DOCUMENT', status: 'QUEUED' }],
    results: [{ id: '4ed82adf-da4d-4de6-866b-492d06ba1a77', status: 'READY' }],
    invoice: { id: 'a754cb59-c347-4ee1-8f47-43c075e18f3a' }
  });
  assert.equal(
    JSON.stringify([...rows].map(row => row.operation_id).sort()),
    JSON.stringify([UUID_B, UUID_A].sort())
  );
});

test('newer document and issue signals remain in independent modal slots', () => {
  const { window } = loadScript(asyncSource);
  window.modalCtx = {
    invoiceId: UUID_A,
    invoiceDetail: { invoice: { id: UUID_A } },
    invoiceAsync: {}
  };
  window.applyInvoiceOperationUpdates({
    watched_invoice_operations: [{
      operation_id: UUID_B,
      operation_type: 'VIEW_INVOICE_DOCUMENT',
      entity_type: 'INVOICE',
      entity_id: UUID_A,
      status: 'RUNNING',
      phase: 'SOURCE_RENDER',
      change_seq: 2
    }, {
      operation_id: '4ed82adf-da4d-4de6-866b-492d06ba1a77',
      operation_type: 'ISSUE_INVOICES',
      entity_type: 'INVOICE',
      entity_id: UUID_A,
      status: 'RUNNING',
      phase: 'FREEZE',
      change_seq: 3
    }]
  });
  assert.equal(window.modalCtx.invoiceAsync.document_operation.operation_id, UUID_B);
  assert.equal(window.modalCtx.invoiceAsync.issue_operation.operation_type, 'ISSUE_INVOICES');
  assert.equal(window.modalCtx.invoiceAsync.delivery_operation, undefined);

  window.applyInvoiceOperationUpdates({
    watched_invoice_operations: [{
      operation_id: UUID_B,
      operation_type: 'VIEW_INVOICE_DOCUMENT',
      entity_type: 'INVOICE',
      entity_id: UUID_A,
      status: 'QUEUED',
      phase: 'QUEUED',
      change_seq: 1
    }]
  });
  assert.equal(window.modalCtx.invoiceAsync.document_operation.effective_change_seq, 2);
  assert.equal(window.modalCtx.invoiceAsync.document_operation.phase, 'SOURCE_RENDER');
});

test('exact document access sends only the document-version id', async () => {
  const calls = [];
  const { window } = loadScript(asyncSource, {
    window: {
      authFetch: async (url, init) => {
        calls.push({ url, init });
        if (calls.length === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              document_version_id: UUID_A,
              purpose: 'DRAFT_PREVIEW',
              url: `https://test-cloudtms-backend.example/api/invoice-document-versions/${UUID_A}/download?token=opaque`
            })
          };
        }
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob(['%PDF-test'], { type: 'application/pdf' })
        };
      }
    }
  });
  const result = await window.openExactReadyDocument(UUID_A, { returnBlobUrl: true });
  assert.match(calls[0].url, new RegExp(`/api/invoice-document-versions/${UUID_A}/presign$`));
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, undefined);
  assert.doesNotMatch(JSON.stringify(calls), /r2_key|ready_key|presign-download/);
  assert.equal(result.document_version_id, UUID_A);
  result.revoke();
});

test('all semantic V2 selectors are accepted and GROUP_KEY is rejected', () => {
  const { window } = loadScript(batchRuntimeSource);
  const selection = window.InvoiceBatchModalV8.createInvoiceBatchSelectionState();
  const selectors = [
    { type: 'ROW', selection_key: 'generate:one' },
    { type: 'WEEK', week_ending_date: '2026-07-26' },
    { type: 'CLIENT', client_id: UUID_A },
    { type: 'CANDIDATE', candidate_id: UUID_B },
    { type: 'STATUS', status_code: 'READY' },
    { type: 'WEEK_CLIENT', week_ending_date: '2026-07-26', client_id: UUID_A },
    { type: 'WEEK_CLIENT_CANDIDATE', week_ending_date: '2026-07-26', client_id: UUID_A, candidate_id: UUID_B },
    { type: 'STATUS_WEEK', status_code: 'READY', week_ending_date: '2026-07-26' },
    { type: 'STATUS_WEEK_CLIENT', status_code: 'READY', week_ending_date: '2026-07-26', client_id: UUID_A },
    {
      type: 'DIMENSION_GROUP',
      status_code: 'READY',
      week_ending_date: '2026-07-26',
      client_id: UUID_A,
      candidate_id: UUID_B
    }
  ];
  for (const selector of selectors) {
    window.InvoiceBatchModalV8.applyInvoiceBatchSelectionRule(selection, 'EXCLUDE', selector);
  }
  assert.equal(selection.rules.length, 10);
  assert.throws(
    () => window.InvoiceBatchModalV8.applyInvoiceBatchSelectionRule(
      selection,
      'EXCLUDE',
      { type: 'GROUP_KEY', group_key: 'opaque' }
    ),
    /BATCH_SELECTION_SELECTOR_INVALID/
  );
});

test('V2 candidate requests keep signed cursors opaque and browser explicit hydration is exactly one key', () => {
  const { window } = loadScript(batchRuntimeSource);
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('GENERATE');
  state.snapshot = {
    contract_version: 'INVOICE_BATCH_SNAPSHOT_V2',
    action: 'GENERATE',
    at_utc: '2026-07-26T12:00:00.000Z',
    revision: 9,
    expires_at_utc: '2026-07-26T12:30:00.000Z',
    key_id: 'key-1',
    token: 'signed-snapshot'
  };
  const opaque = 'opaque.signed.cursor';
  const page = window.buildInvoiceBatchCandidateRequest(state, 'PAGE', { cursor: opaque });
  assert.equal(page.cursor, opaque);
  assert.equal(page.mode, 'PAGE');
  assert.equal(page.contract_version, 'INVOICE_BATCH_QUERY_V2');
  const explicit = window.buildInvoiceBatchCandidateRequest(state, 'EXPLICIT_KEYS', {
    selection_keys: ['generate:one'],
    expected_source_revisions: { 'generate:one': 'revision-1' }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(explicit.selection_keys)), ['generate:one']);
  assert.throws(
    () => window.buildInvoiceBatchCandidateRequest(state, 'EXPLICIT_KEYS', {
      selection_keys: ['generate:one', 'generate:two'],
      expected_source_revisions: { 'generate:one': 'revision-1', 'generate:two': 'revision-2' }
    }),
    /BATCH_EXPLICIT_KEYS_INVALID/
  );
});

test('Batch Issue defaults to Issue and email with distinct durable identities', async () => {
  const calls = [];
  const { window } = loadScript(batchRuntimeSource, {
    window: {
      authFetch: async (url, init) => {
        calls.push({ url, init });
        return {
          status: 202,
          ok: true,
          json: async () => ({ root_operation_id: UUID_A, status: 'QUEUED' })
        };
      },
      registerInvoiceOperationsFromResponse: () => [{
        operation_id: UUID_A,
        status: 'QUEUED',
        phase: 'BUILD_MANIFEST'
      }],
      registerInvoiceOperationWatch() {}
    }
  });
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('ISSUE');
  state.snapshot = {
    contract_version: 'INVOICE_BATCH_SNAPSHOT_V2',
    action: 'ISSUE',
    at_utc: '2026-07-26T12:00:00.000Z',
    revision: 3,
    expires_at_utc: '2026-07-26T12:30:00.000Z',
    key_id: 'key-1',
    token: 'signed-snapshot'
  };
  await window.submitInvoiceBatchOperation(state);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(state.issue_mode, 'ISSUE_AND_SEND');
  assert.equal(body.deliver, true);
  assert.equal(body.delivery_intent.route_mode, 'SERVER_RESOLVED');
  assert.equal(body.delivery_intent.template_version, 'INVOICE_EMAIL_V2');
  assert.notEqual(body.command_token, body.delivery_request_token);
  assert.equal(calls[0].init.headers['idempotency-key'], body.command_token);
});

test('Batch Issue confirmation uses plain-English singular wording and omits zero-value noise', () => {
  const { window } = loadScript(batchRuntimeSource);
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('ISSUE');
  state.selection_summary_pending = false;
  state.selection_summary = {
    exact: true,
    selected_total: 1,
    blocked_total: 31
  };
  state.totals = { delivery_blocked_total: 0 };
  const html = window.renderInvoiceBatchConfirmation(state);
  assert.match(html, /<h3>Issue 1 invoice\?<\/h3>/);
  assert.match(html, /Issue and email/);
  assert.match(html, /Recommended\. Email each invoice to its saved recipient/);
  assert.match(html, /<strong>1 invoice<\/strong> will be issued and emailed\./);
  assert.match(html, /<strong>31 invoices<\/strong> are not ready and will be left unchanged\./);
  assert.match(html, /Issuing creates the official invoice\./);
  assert.match(html, />Issue 1 invoice<\/button>/);
  assert.doesNotMatch(html, /Delivery is resolved separately|legally issued|delivery will be suppressed|will be skipped|Batch early is not included|0 invoices/);
});

test('Batch Issue confirmation uses plural issue-only wording and mentions early batching only when enabled', () => {
  const { window } = loadScript(batchRuntimeSource);
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('ISSUE');
  state.issue_mode = 'ISSUE_ONLY';
  state.filter.allow_early = true;
  state.selection_summary_pending = false;
  state.selection_summary = {
    exact: true,
    selected_total: 2,
    blocked_total: 0
  };
  state.totals = { delivery_blocked_total: 5 };
  const html = window.renderInvoiceBatchConfirmation(state);
  assert.match(html, /<h3>Issue 2 invoices\?<\/h3>/);
  assert.match(html, /Issue without emailing/);
  assert.match(html, /<strong>2 invoices<\/strong> will be issued without emailing\./);
  assert.match(html, /Eligible invoices before the normal batch date are included\./);
  assert.match(html, />Issue 2 invoices<\/button>/);
  assert.doesNotMatch(html, /5 invoices|cannot be emailed|0 invoices/);
});

test('Batch Issue confirmation explains non-zero email blockers without jargon', () => {
  const { window } = loadScript(batchRuntimeSource);
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('ISSUE');
  state.selection_summary_pending = false;
  state.selection_summary = {
    exact: true,
    selected_total: 3,
    blocked_total: 0
  };
  state.totals = { delivery_blocked_total: 1 };
  const html = window.renderInvoiceBatchConfirmation(state);
  assert.match(html, /<strong>3 invoices<\/strong> will be issued\. CloudTMS will email each one that has a valid recipient\./);
  assert.match(html, /<strong>1 invoice<\/strong> cannot be emailed and will be issued without email\./);
  assert.doesNotMatch(html, /delivery will be suppressed|eligible deliveries|legally issue/);
});

test('stale result cursors recover to page one once and retain the root/category', async () => {
  const calls = [];
  const revision = '12';
  const { window } = loadScript(batchRuntimeSource, {
    window: {
      authFetch: async (url, init) => {
        calls.push(JSON.parse(init.body));
        if (calls.length === 1) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: 'OPERATION_RESULT_CURSOR_STALE', result_page_revision: revision })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            operations: [{ operation_id: UUID_A, result_page_revision: revision }],
            result_page: {
              contract_version: 'INVOICE_BATCH_RESULT_PAGE_V2',
              root_operation_id: UUID_A,
              category: 'FAILED',
              result_page_revision: revision,
              rows: [],
              has_more: false,
              total_count: 0,
              next_cursor: null
            }
          })
        };
      }
    }
  });
  const state = window.InvoiceBatchModalV8.createInvoiceBatchModalState('GENERATE');
  state.root_operation_id = UUID_A;
  state.result_page_revision = revision;
  await window.loadInvoiceBatchResultPage(state, {
    category: 'FAILED',
    cursor: 'opaque.stale.cursor'
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].result_cursor, 'opaque.stale.cursor');
  assert.equal(calls[1].result_cursor, undefined);
  assert.equal(calls[1].operation_ids[0], UUID_A);
  assert.equal(calls[1].result_category, 'FAILED');
});

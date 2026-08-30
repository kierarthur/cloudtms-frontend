const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../js/main.js'), 'utf8');

function sliceBetween(start, end) {
  const from = mainSource.indexOf(start);
  const to = mainSource.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return mainSource.slice(from, to);
}

const scheduledAlert = {
  alert_kind: 'BATCH_SCHEDULED_SUCCESS',
  severity: 'info',
  entity_kind: 'pay_batch',
  entity_id: '11111111-1111-4111-8111-111111111111',
  pay_batch_id: '11111111-1111-4111-8111-111111111111',
  alert_fingerprint: 'banking-alert-scheduled',
  label: 'Future payment batch scheduled',
  description: 'Payment batch scheduled successfully. £1,234.56 will be paid across 3 individual payments on 1 September 2026 at 23:00 (UK Time).',
  acknowledged_for_current_user: false,
  payload_json: {
    alert_kind: 'BATCH_SCHEDULED_SUCCESS',
    is_success_only: true,
    individual_payment_count: 3,
    amount_gbp: 1234.56,
    user_label: 'Future payment batch scheduled',
    user_description: 'Payment batch scheduled successfully. £1,234.56 will be paid across 3 individual payments on 1 September 2026 at 23:00 (UK Time).'
  }
};

const settledAlert = {
  ...scheduledAlert,
  alert_kind: 'BATCH_SETTLED_SUCCESS',
  alert_fingerprint: 'banking-alert-settled',
  label: 'Payment batch settled',
  description: 'Payment batch settled successfully. £1,234.56 across 3 individual payments completed on 1 September 2026 at 23:05 (UK Time).',
  payload_json: {
    ...scheduledAlert.payload_json,
    alert_kind: 'BATCH_SETTLED_SUCCESS',
    user_label: 'Payment batch settled',
    user_description: 'Payment batch settled successfully. £1,234.56 across 3 individual payments completed on 1 September 2026 at 23:05 (UK Time).'
  }
};

const failedAlert = {
  ...scheduledAlert,
  alert_kind: 'PAYMENT_PROVIDER_SUBMIT_REVIEW',
  alert_fingerprint: 'banking-alert-failed',
  entity_id: '22222222-2222-4222-8222-222222222222',
  pay_batch_id: '22222222-2222-4222-8222-222222222222',
  label: 'Payment needs checking',
  description: 'A payment needs checking before it can continue.',
  payload_json: {
    ...scheduledAlert.payload_json,
    alert_kind: 'PAYMENT_PROVIDER_SUBMIT_REVIEW',
    user_label: 'Payment needs checking',
    user_description: 'A payment needs checking before it can continue.'
  }
};

test('popover renders successful schedule and settlement messages with clear controls', () => {
  const source = sliceBetween('function renderBankingNavAlertPopover(attentionState)', 'function applyAlertSummaryToState(responsePayload)');
  const context = {
    window: {},
    Intl,
    Date,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    encodeURIComponent
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-popover.js' });
  const markup = context.renderBankingNavAlertPopover({
    count: 2,
    alerts: [scheduledAlert, settledAlert],
    banking_alert_summary: { unacknowledged_count: 2, alerts: [scheduledAlert, settledAlert] }
  });

  assert.match(markup, /Future payment batch scheduled/);
  assert.match(markup, /£1,234\.56 will be paid across 3 individual payments on 1 September 2026 at 23:00 \(UK Time\)/);
  assert.match(markup, /Payment batch settled/);
  assert.match(markup, /completed on 1 September 2026 at 23:05 \(UK Time\)/);
  assert.match(markup, /color:var\(--text,#f8fafc\)/);
  assert.doesNotMatch(markup, /color:#111827/);
  assert.equal((markup.match(/data-action="banking:nav:alerts:clear"/g) || []).length, 2);
  assert.match(markup, /data-action="banking:nav:alerts:clearAll"/);
  assert.match(markup, /2 unread Banking alerts/);
});

test('popover shows expanded Banking alerts newest first by date and time', () => {
  const source = sliceBetween('function renderBankingNavAlertPopover(attentionState)', 'function applyAlertSummaryToState(responsePayload)');
  const context = {
    window: {},
    Intl,
    Date,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    encodeURIComponent
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-popover-order.js' });
  const older = {
    ...failedAlert,
    alert_fingerprint: 'older-alert',
    label: 'Older alert',
    description: 'Older alert description',
    created_at_utc: '2026-08-09T09:15:00Z'
  };
  const newer = {
    ...failedAlert,
    alert_fingerprint: 'newer-alert',
    label: 'Newer alert',
    description: 'Newer alert description',
    created_at_utc: '2026-08-09T19:45:00Z'
  };
  const undated = {
    ...failedAlert,
    alert_fingerprint: 'undated-alert',
    label: 'Undated alert',
    description: 'Undated alert description'
  };
  const markup = context.renderBankingNavAlertPopover({
    count: 3,
    alerts: [undated, older, newer],
    banking_alert_summary: { unacknowledged_count: 3, alerts: [undated, older, newer] }
  });

  assert.ok(markup.indexOf('Newer alert') < markup.indexOf('Older alert'));
  assert.ok(markup.indexOf('Older alert') < markup.indexOf('Undated alert'));
});

test('popover treats deferred alert detail as loading and never as permanently unavailable', () => {
  const source = sliceBetween('function renderBankingNavAlertPopover(attentionState)', 'function applyAlertSummaryToState(responsePayload)');
  const context = {
    window: {},
    Intl,
    Date,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    encodeURIComponent
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-popover.js' });
  const markup = context.renderBankingNavAlertPopover({
    count: 3,
    alerts: [],
    detailsDeferred: true,
    detailsSettledDeferred: true,
    banking_alert_summary: {
      unacknowledged_count: 3,
      alerts: [],
      detailsDeferred: true,
      detailsSettledDeferred: true
    }
  });

  assert.match(markup, /Loading Banking alert messages/);
  assert.doesNotMatch(markup, /details are not available yet/i);
  assert.match(markup, /data-banking-alert-details-loading="1"/);
  assert.match(markup, /Retry loading alert messages/);
});

test('count-only refresh cannot replace already-loaded messages for the same alert state', () => {
  const source = sliceBetween('function renderBankingNavAlertPopover(attentionState)', 'function applyAlertSummaryToState(responsePayload)');
  const context = {
    window: {
      __bankingNavAttentionState: {
        count: 2,
        alerts: [scheduledAlert, settledAlert],
        banking_alert_hash: 'same-alert-hash',
        banking_alert_summary: {
          alerts: [scheduledAlert, settledAlert],
          unacknowledged_count: 2,
          banking_alert_hash: 'same-alert-hash'
        }
      }
    },
    Intl,
    Date,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    encodeURIComponent
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-popover-preserve.js' });
  const markup = context.renderBankingNavAlertPopover({
    count: 2,
    alerts: [],
    detailsDeferred: true,
    banking_alert_hash: 'same-alert-hash'
  });

  assert.match(markup, /Future payment batch scheduled/);
  assert.match(markup, /Payment batch settled/);
  assert.doesNotMatch(markup, /Loading Banking alert messages/);
});

test('opening a popover with missing rows starts the dedicated full-detail alert fetch', () => {
  const handlers = sliceBetween('function attachBankingNavAlertPopoverHandlers()', 'function renderBankingNavAlertPopover(attentionState)');
  assert.match(handlers, /startDirectAlertDetailFetch/);
  assert.match(handlers, /bankingAlertsFetchActive\(\{ silent: true, limit: 100, forceRefresh \}\)/);
  assert.match(handlers, /forceRefresh: true/);
  assert.match(handlers, /Date\.now\(\) - lastForcedAtMs >= 60000/);
  assert.match(handlers, /missingRowsForPositiveCount === true[\s\S]*startDirectAlertDetailFetch\(hash\)/);
  assert.match(handlers, /if \(attempt >= 3\) return/);
  assert.match(handlers, /startDirectAlertDetailFetch\(h, \{[\s\S]*attempt: attempt \+ 1,[\s\S]*forceRefresh: forceRefreshRequested,[\s\S]*retryForceRefresh: forceRefresh/);
  assert.match(handlers, /\.catch\(\(\) => \{[\s\S]*scheduleRetry\(\)/);
});

test('alert preferences opens a dedicated top-layer dialog before removing its originating popover', () => {
  const handlers = sliceBetween('function attachBankingNavAlertPopoverHandlers()', 'function renderBankingNavAlertPopover(attentionState)');
  const preferencesBranch = handlers.slice(
    handlers.indexOf("if (action === 'banking:nav:alerts:preferences')"),
    handlers.indexOf("if (action === 'banking:nav:alerts:clear')")
  );
  assert.match(handlers, /const removePreferencesDialog = \(\) =>/);
  assert.match(handlers, /const openPreferencesDialog = \(\) =>/);
  assert.match(handlers, /data-banking-alert-preferences-dialog/);
  assert.match(handlers, /setTimeout\(\(\) => \{[\s\S]*removePopover\(\)/);
  assert.match(preferencesBranch, /openPreferencesDialog\(\)/);
  assert.doesNotMatch(preferencesBranch, /openUiConfirmModal/);
  assert.doesNotMatch(preferencesBranch, /openUiHtmlModal/);
  assert.doesNotMatch(preferencesBranch, /refreshOpenPopover/);
  assert.doesNotMatch(preferencesBranch, /refreshBankingNavAttentionFromCachedRows/);
});

test('single-clear handler removes the row optimistically and does not reapply cached batch alerts', () => {
  const handlers = sliceBetween('function attachBankingNavAlertPopoverHandlers()', 'function renderBankingNavAlertPopover(attentionState)');
  const clearBranch = handlers.slice(
    handlers.indexOf("if (action === 'banking:nav:alerts:clear')"),
    handlers.indexOf("if (action === 'banking:nav:alerts:clearAll')")
  );
  assert.match(clearBranch, /optimisticallyRemoveAlertRows\(\{ alertFingerprint \}\)/);
  assert.match(clearBranch, /alert_kind: alertKind/);
  assert.match(clearBranch, /entity_id: entityId/);
  assert.match(clearBranch, /alert_payload_json: payloadJson/);
  assert.match(clearBranch, /beginClearOperation\(alertFingerprint, false\)/);
  assert.match(clearBranch, /client_mutation_generation: operation\.generation/);
  assert.match(clearBranch, /restoreOptimisticallyRemovedAlert\(\{ alertFingerprint, alertSnapshot, stateBeforeClear \}\)/);
  assert.match(clearBranch, /refreshOpenPopover\(restoredState\)/);
  assert.match(clearBranch, /finally \{[\s\S]*finishClearOperation\(operation\)/);
  assert.doesNotMatch(clearBranch, /activePopover\?\.getAttribute\('data-clearing'\)/);
  assert.doesNotMatch(clearBranch, /refreshBankingNavAttentionFromCachedRows/);
  assert.match(handlers, /const remainingAlerts = clearAll[\s\S]*currentAlerts\.filter/);
  assert.match(handlers, /updateBankingNavAttentionState\(nextState\)/);
  assert.match(handlers, /querySelectorAll\('\[data-action="banking:nav:alerts:clearAll"\]'\)/);
});

test('summary application no longer filters success-only alerts', () => {
  const source = sliceBetween('function applyAlertSummaryToState(responsePayload)', 'async function bankingAcknowledgeAlerts(input = {})');
  let attentionState = null;
  const context = {
    window: {
      modalCtx: { banking: { pay: { list: {} } } },
      __bankingLocallyAcknowledgedFingerprints: {},
      __changesHeartbeat: {}
    },
    document: { querySelector() { return null; } },
    updateBankingNavAttentionState(value) { attentionState = value; context.window.__bankingNavAttentionState = value; },
    console,
    setTimeout,
    clearTimeout,
    Date,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    Set
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-state.js' });
  const result = context.applyAlertSummaryToState({
    banking_alert_summary_included: true,
    banking_alert_summary: {
      alerts: [scheduledAlert, settledAlert],
      unacknowledged_count: 2,
      banking_unacknowledged_alert_count: 2,
      banking_alert_hash: 'hash-success-alerts',
      banking_alert_summary_signature: 'hash-success-alerts'
    }
  });

  assert.equal(result.count, 2);
  assert.equal(result.alerts.length, 2);
  assert.equal(attentionState.count, 2);
  assert.deepEqual(Array.from(attentionState.alerts, (alert) => alert.alert_kind), ['BATCH_SCHEDULED_SUCCESS', 'BATCH_SETTLED_SUCCESS']);
});

test('a changed-hash count-only response after one clear preserves exactly the unsuppressed message and corrected badge count', () => {
  const source = sliceBetween('function applyAlertSummaryToState(responsePayload)', 'async function bankingAcknowledgeAlerts(input = {})');
  let attentionState = null;
  const now = Date.now();
  const loadedSummary = {
    alerts: [scheduledAlert, settledAlert],
    banking_alerts: [scheduledAlert, settledAlert],
    unacknowledged_count: 2,
    banking_unacknowledged_alert_count: 2,
    banking_alert_hash: 'old-alert-hash',
    banking_alert_summary_signature: 'old-alert-hash'
  };
  const context = {
    window: {
      modalCtx: { banking: { pay: { list: { banking_alert_summary: loadedSummary } } } },
      __bankingNavAttentionState: {
        count: 2,
        alerts: [scheduledAlert, settledAlert],
        banking_alerts: [scheduledAlert, settledAlert],
        banking_alert_summary: loadedSummary,
        banking_alert_hash: 'old-alert-hash'
      },
      __bankingAlertSummary: loadedSummary,
      __bankingLocallyAcknowledgedFingerprints: {
        [scheduledAlert.alert_fingerprint]: now
      },
      __bankingLastAlertAckMutationAtMs: now,
      __changesHeartbeat: { _lastBankingAckMutationAtMs: now }
    },
    document: { querySelector() { return null; }, createElement() { return { innerHTML: '', firstElementChild: null }; } },
    updateBankingNavAttentionState(value) { attentionState = value; context.window.__bankingNavAttentionState = value; },
    console,
    setTimeout,
    clearTimeout,
    Date,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    Set
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-changed-hash-reconcile.js' });
  const result = context.applyAlertSummaryToState({
    banking_alert_hash: 'new-alert-hash',
    banking_alert_summary_signature: 'new-alert-hash',
    banking_unacknowledged_alert_count: 1,
    alert_summary: {
      alerts: [],
      banking_alerts: [],
      unacknowledged_count: 1,
      banking_unacknowledged_alert_count: 1,
      banking_alert_hash: 'new-alert-hash',
      banking_alert_summary_signature: 'new-alert-hash',
      banking_alert_summary_deferred: true
    }
  });

  assert.equal(result.count, 1);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].alert_fingerprint, settledAlert.alert_fingerprint);
  assert.equal(attentionState.count, 1);
  assert.equal(attentionState.alerts[0].description, settledAlert.description);
  assert.equal(attentionState.banking_alert_hash, 'new-alert-hash');
});

test('a stale higher count-only refresh during two rapid clears keeps the remaining message and monotonic badge', () => {
  const source = sliceBetween('function applyAlertSummaryToState(responsePayload)', 'async function bankingAcknowledgeAlerts(input = {})');
  let attentionState = null;
  const now = Date.now();
  const optimisticSummary = {
    alerts: [failedAlert],
    banking_alerts: [failedAlert],
    unacknowledged_count: 1,
    banking_unacknowledged_alert_count: 1,
    banking_alert_hash: 'optimistic-alert-hash',
    banking_alert_summary_signature: 'optimistic-alert-hash'
  };
  const context = {
    window: {
      modalCtx: { banking: { pay: { list: { banking_alert_summary: optimisticSummary } } } },
      __bankingNavAttentionState: {
        count: 1,
        alerts: [failedAlert],
        banking_alerts: [failedAlert],
        banking_alert_summary: optimisticSummary,
        banking_alert_hash: 'optimistic-alert-hash'
      },
      __bankingAlertSummary: optimisticSummary,
      __bankingLocallyAcknowledgedFingerprints: {
        [scheduledAlert.alert_fingerprint]: now,
        [settledAlert.alert_fingerprint]: now
      },
      __bankingLastAlertAckMutationAtMs: now,
      __bankingAlertClearOperations: {
        generation: 2,
        pending: {
          [scheduledAlert.alert_fingerprint]: { generation: 1 },
          [settledAlert.alert_fingerprint]: { generation: 2 }
        },
        clearAllPending: false
      },
      __changesHeartbeat: { _lastBankingAckMutationAtMs: now }
    },
    document: { querySelector() { return null; }, createElement() { return { innerHTML: '', firstElementChild: null }; } },
    updateBankingNavAttentionState(value) { attentionState = value; context.window.__bankingNavAttentionState = value; },
    console,
    setTimeout,
    clearTimeout,
    Date,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    Set
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-rapid-clear-count-only.js' });
  const result = context.applyAlertSummaryToState({
    banking_alert_hash: 'stale-higher-hash',
    banking_alert_summary_signature: 'stale-higher-hash',
    banking_unacknowledged_alert_count: 3,
    alert_summary: {
      alerts: [],
      banking_alerts: [],
      unacknowledged_count: 3,
      banking_unacknowledged_alert_count: 3,
      banking_alert_hash: 'stale-higher-hash',
      banking_alert_summary_signature: 'stale-higher-hash',
      banking_alert_summary_deferred: true
    }
  });

  assert.equal(result.count, 1);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].alert_fingerprint, failedAlert.alert_fingerprint);
  assert.equal(attentionState.count, 1);
  assert.equal(attentionState.alerts[0].description, failedAlert.description);
});

test('two distinct rapid clears remain monotonic in both acknowledgement response orders', async () => {
  const source = sliceBetween('function applyAlertSummaryToState(responsePayload)', 'async function bankingPayBatchRetryBlockedFunds');

  const runOrder = async (order) => {
    const releases = Object.create(null);
    const requests = [];
    const initialSummary = {
      alerts: [scheduledAlert, settledAlert],
      banking_alerts: [scheduledAlert, settledAlert],
      unacknowledged_count: 2,
      banking_unacknowledged_alert_count: 2,
      banking_alert_hash: 'initial-hash',
      banking_alert_summary_signature: 'initial-hash'
    };
    const context = {
      window: {
        modalCtx: { banking: { pay: { list: { banking_alert_summary: initialSummary } } } },
        __bankingNavAttentionState: {
          count: 2,
          alerts: [scheduledAlert, settledAlert],
          banking_alerts: [scheduledAlert, settledAlert],
          alertSummary: initialSummary,
          banking_alert_summary: initialSummary
        },
        __bankingAlertSummary: initialSummary,
        __bankingAlertClearOperations: {
          generation: 2,
          pending: {
            [scheduledAlert.alert_fingerprint]: { generation: 1 },
            [settledAlert.alert_fingerprint]: { generation: 2 }
          },
          clearAllPending: false
        },
        __bankingAlertAckMutationGeneration: 2,
        __changesHeartbeat: {}
      },
      document: {
        querySelector() { return null; },
        createElement() { return { innerHTML: '', firstElementChild: null }; }
      },
      API(value) { return value; },
      async authFetch(url, fetchOptions) {
        const body = JSON.parse(fetchOptions.body);
        requests.push({ url, body });
        return await new Promise((resolve) => { releases[body.alert_fingerprint] = resolve; });
      },
      bankingHandleApiError(error) { return error && error.json ? error.json : {}; },
      async openUiConfirmModal() {},
      updateBankingNavAttentionState(value) { context.window.__bankingNavAttentionState = value; },
      renderBankingNavAlertPopover() { return '<div></div>'; },
      attachBankingNavAlertPopoverHandlers() {},
      console,
      setTimeout,
      clearTimeout,
      Date,
      Number,
      String,
      Math,
      Array,
      Object,
      JSON,
      Set,
      Error
    };
    vm.runInNewContext(source, context, { filename: `banking-alert-rapid-clear-${order.join('-')}.js` });

    const first = context.bankingAcknowledgeAlerts({ ...scheduledAlert, client_mutation_generation: 1 });
    const second = context.bankingAcknowledgeAlerts({ ...settledAlert, client_mutation_generation: 2 });
    await new Promise((resolve) => setImmediate(resolve));
    context.window.__bankingNavAttentionState = {
      count: 0,
      alerts: [],
      banking_alerts: [],
      alertSummary: { alerts: [], banking_alerts: [], unacknowledged_count: 0, banking_unacknowledged_alert_count: 0 },
      banking_alert_summary: { alerts: [], banking_alerts: [], unacknowledged_count: 0, banking_unacknowledged_alert_count: 0 }
    };

    const release = (fingerprint) => {
      const remainingAlert = fingerprint === scheduledAlert.alert_fingerprint ? settledAlert : scheduledAlert;
      releases[fingerprint]({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            acknowledged: true,
            remaining_alert_summary: {
              alerts: [remainingAlert],
              banking_alerts: [remainingAlert],
              unacknowledged_count: 1,
              banking_unacknowledged_alert_count: 1
            }
          });
        }
      });
    };

    release(order[0]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(context.window.__bankingNavAttentionState.count, 0);
    assert.equal(context.window.__bankingNavAttentionState.alerts.length, 0);
    release(order[1]);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(context.window.__bankingNavAttentionState.count, 0);
    assert.equal(context.window.__bankingNavAttentionState.alerts.length, 0);
    assert.equal(requests.length, 2);
    assert.equal(firstResult.banking_alert_response_ignored_as_stale, true);
    assert.notEqual(secondResult.banking_alert_response_ignored_as_stale, true);
  };

  await runOrder([scheduledAlert.alert_fingerprint, settledAlert.alert_fingerprint]);
  await runOrder([settledAlert.alert_fingerprint, scheduledAlert.alert_fingerprint]);
});

test('dedicated alert fetch loads full details and applies them', async () => {
  const source = sliceBetween('async function bankingAlertsFetchActive(options = {})', 'async function bankingAlertPreferencesFetch()');
  let requestedUrl = '';
  let applied = null;
  const responsePayload = {
    ok: true,
    alerts: [scheduledAlert],
    unacknowledged_count: 1,
    banking_unacknowledged_alert_count: 1,
    banking_alert_hash: 'hash-one'
  };
  const context = {
    window: {},
    API(value) { return value; },
    async authFetch(url, options) {
      requestedUrl = url;
      assert.equal(options.method, 'GET');
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify(responsePayload); }
      };
    },
    applyAlertSummaryToState(value) { applied = value; },
    encodeURIComponent,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    Error
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-fetch.js' });
  const result = await context.bankingAlertsFetchActive({ limit: 25 });

  assert.equal(requestedUrl, '/api/banking/alerts?limit=25');
  assert.equal(result.banking_alert_summary_included, true);
  assert.equal(applied.banking_alert_summary.alerts.length, 1);
});

test('explicit alert refresh bypasses the routine server-side summary cache', async () => {
  const source = sliceBetween('async function bankingAlertsFetchActive(options = {})', 'async function bankingAlertPreferencesFetch()');
  let requestedUrl = '';
  const context = {
    window: {},
    API(value) { return value; },
    async authFetch(url) {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ok: true, alerts: [], unacknowledged_count: 0 }); }
      };
    },
    applyAlertSummaryToState() {},
    encodeURIComponent,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    Error
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-force-refresh.js' });

  await context.bankingAlertsFetchActive({ limit: 100, forceRefresh: true });
  assert.equal(requestedUrl, '/api/banking/alerts?limit=100&refresh=1');
});

test('heartbeat uses a ten-minute recovery backstop for routine alert detail reads', () => {
  assert.match(mainSource, /periodicAlertRefreshDue = Date\.now\(\) - lastDirectAlertFetchAtMs >= \(10 \* 60 \* 1000\)/);
  assert.match(mainSource, /forceRefresh: explicitAlertRefresh/);
  assert.doesNotMatch(mainSource, /directAlertFetchDue = Date\.now\(\) - lastDirectAlertFetchAtMs >= 10000/);
});

test('dedicated alert fetch coalesces concurrent requests for the same limit', async () => {
  const source = sliceBetween('async function bankingAlertsFetchActive(options = {})', 'async function bankingAlertPreferencesFetch()');
  let requestCount = 0;
  let releaseFetch;
  const fetchGate = new Promise((resolve) => { releaseFetch = resolve; });
  const responsePayload = {
    ok: true,
    alerts: [],
    unacknowledged_count: 0,
    banking_unacknowledged_alert_count: 0,
    banking_alert_hash: 'hash-empty'
  };
  const context = {
    window: {},
    API(value) { return value; },
    async authFetch(url, options) {
      requestCount += 1;
      assert.equal(url, '/api/banking/alerts?limit=100');
      assert.equal(options.method, 'GET');
      await fetchGate;
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify(responsePayload); }
      };
    },
    applyAlertSummaryToState() {},
    encodeURIComponent,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    Error
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-fetch.js' });

  const first = context.bankingAlertsFetchActive({ silent: true, limit: 100 });
  const second = context.bankingAlertsFetchActive({ limit: 100 });
  await Promise.resolve();
  assert.equal(requestCount, 1);
  releaseFetch();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.equal(requestCount, 1);
});

function createAcknowledgeContext(responseSummary, options = {}) {
  const requests = [];
  let friendlyModal = null;
  const configuredResponse = options.response || null;
  const source = sliceBetween('async function bankingAcknowledgeAlerts(input = {})', 'async function bankingPayBatchRetryBlockedFunds');
  const context = {
    window: {
      __bankingNavAttentionState: {
        alerts: [scheduledAlert, settledAlert],
        banking_alerts: [scheduledAlert, settledAlert]
      },
      __bankingAlertSummary: {
        alerts: [scheduledAlert, settledAlert],
        unacknowledged_count: 2
      },
      __changesHeartbeat: {}
    },
    document: {
      querySelector() { return null; },
      createElement() { return { innerHTML: '', firstElementChild: null }; }
    },
    API(value) { return value; },
    async authFetch(url, fetchOptions) {
      requests.push({ url, method: fetchOptions.method, body: JSON.parse(fetchOptions.body) });
      if (typeof options.authFetch === 'function') return await options.authFetch(url, fetchOptions);
      if (configuredResponse) return configuredResponse;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            acknowledged: true,
            acknowledged_alerts: responseSummary.acknowledged_alerts || [],
            remaining_alert_summary: responseSummary
          });
        }
      };
    },
    bankingHandleApiError(error) { return error && error.json ? error.json : {}; },
    async openUiConfirmModal(config) { friendlyModal = config; },
    applyAlertSummaryToState(payload) {
      const summary = payload.remaining_alert_summary || payload.alert_summary;
      return {
        count: summary.unacknowledged_count,
        alerts: summary.alerts,
        banking_alerts: summary.alerts,
        alertSummary: summary,
        banking_alert_summary: summary
      };
    },
    updateBankingNavAttentionState() {},
    renderBankingNavAlertPopover() { return '<div></div>'; },
    attachBankingNavAlertPopoverHandlers() {},
    console,
    Date,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    Set,
    Error
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-acknowledge.js' });
  return { context, requests, getFriendlyModal: () => friendlyModal };
}

test('clearing one alert sends its full identity and keeps the remaining message visible', async () => {
  const remainingSummary = {
    alerts: [settledAlert],
    unacknowledged_count: 1,
    banking_unacknowledged_alert_count: 1,
    acknowledged_alerts: [scheduledAlert]
  };
  const { context, requests } = createAcknowledgeContext(remainingSummary);

  const result = await context.bankingAcknowledgeAlerts(scheduledAlert);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/banking/alerts/acknowledge');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].body.alert_fingerprint, scheduledAlert.alert_fingerprint);
  assert.equal(requests[0].body.alert_kind, 'BATCH_SCHEDULED_SUCCESS');
  assert.equal(requests[0].body.entity_id, scheduledAlert.entity_id);
  assert.equal(result.banking_unacknowledged_alert_count, 1);
  assert.equal(result.banking_alerts[0].description, settledAlert.description);
  assert.ok(context.window.__bankingLocallyAcknowledgedFingerprints[scheduledAlert.alert_fingerprint]);
});

test('single clear suppresses the selected row while the server response is still in flight', async () => {
  let releaseResponse;
  const responsePromise = new Promise((resolve) => { releaseResponse = resolve; });
  const remainingSummary = {
    alerts: [settledAlert],
    unacknowledged_count: 1,
    banking_unacknowledged_alert_count: 1
  };
  const { context } = createAcknowledgeContext(remainingSummary, {
    async authFetch() { return await responsePromise; }
  });

  const pending = context.bankingAcknowledgeAlerts(scheduledAlert);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(context.window.__bankingLocallyAcknowledgedFingerprints[scheduledAlert.alert_fingerprint]);

  releaseResponse({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ ok: true, remaining_alert_summary: remainingSummary }); }
  });
  await pending;
});

test('clear all sends an explicit clear_all request and empties the alert state', async () => {
  const emptySummary = {
    alerts: [],
    unacknowledged_count: 0,
    banking_unacknowledged_alert_count: 0,
    acknowledged_alerts: [scheduledAlert, settledAlert]
  };
  const { context, requests } = createAcknowledgeContext(emptySummary);

  const result = await context.bankingAcknowledgeAlerts({ clear_all: true });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, { clear_all: true });
  assert.equal(result.banking_unacknowledged_alert_count, 0);
  assert.equal(result.banking_alerts.length, 0);
  assert.ok(context.window.__bankingLocallyAcknowledgedFingerprints[scheduledAlert.alert_fingerprint]);
  assert.ok(context.window.__bankingLocallyAcknowledgedFingerprints[settledAlert.alert_fingerprint]);
});

test('expired session gives a specific reason when an alert cannot be cleared', async () => {
  const { context, getFriendlyModal } = createAcknowledgeContext({ alerts: [], unacknowledged_count: 0 }, {
    response: {
      ok: false,
      status: 401,
      async text() { return JSON.stringify({ ok: false, error: 'Unauthorized' }); }
    }
  });

  await assert.rejects(
    context.bankingAcknowledgeAlerts(scheduledAlert),
    /Your session has expired\. Please sign in again, then reopen Banking alerts\./
  );

  const modal = getFriendlyModal();
  assert.equal(modal.title, 'Session expired');
  assert.match(modal.message, /sign in again/i);
  assert.equal(context.window.__bankingLocallyAcknowledgedFingerprints[scheduledAlert.alert_fingerprint], undefined);
});

test('preferences expose successful lifecycle alerts as enabled by default', () => {
  assert.match(mainSource, /include_success_alerts: mode !== 'NO_BANKING_PAY_ALERTS' && boolOr\(rawPrefs\.include_success_alerts, true\)/);
  assert.match(mainSource, /data-alert-preference-success-alerts="1"/);
  assert.match(mainSource, /Immediate payments alert on settlement only/);
  assert.match(mainSource, /CSV payments have one settlement alert/);
  assert.match(mainSource, /await bankingAlertsFetchActive\(\{ silent: true, limit: 100 \}\)/);
  assert.doesNotMatch(mainSource, /function renderBankingNavAlertPopover[\s\S]*?isSuccessOnlyAlert/);
});

test('preferences use professional user-facing wording and a clear layout', () => {
  const panel = sliceBetween('function renderBankingAlertPreferencesPanel()', 'function attachBankingModalDelegatedHandlers()');
  const dialog = sliceBetween('function attachBankingNavAlertPopoverHandlers()', 'function renderBankingNavAlertPopover(attentionState)');

  assert.match(dialog, /Banking alert settings/);
  assert.match(panel, /Which alerts would you like to see\?/);
  assert.match(panel, /Payment problems/);
  assert.match(panel, /Other payment updates/);
  assert.match(panel, /Successful payment updates/);
  assert.match(panel, /Temporarily pause alerts/);
  assert.match(panel, /Advanced exclusions/);
  assert.match(panel, /Save changes/);
  assert.match(panel, /Payment processing is not affected/);
  assert.doesNotMatch(panel, />Muted scopes</);
  assert.doesNotMatch(panel, />auto-unwind progress</);
  assert.doesNotMatch(panel, />unmatched bank webhook</);
  assert.doesNotMatch(panel, /webhook ingestion/);
});

function createPreferencesSaveContext() {
  const requests = [];
  const source = sliceBetween('async function bankingAlertPreferencesSave(preferences)', 'function startBankingPayBatchLiveWatch');
  const context = {
    window: { __changesHeartbeat: {} },
    API(value) { return value; },
    async authFetch(url, fetchOptions) {
      requests.push({ url, method: fetchOptions.method, body: JSON.parse(fetchOptions.body) });
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ok: true, preferences: requests.at(-1).body }); }
      };
    },
    async bankingAlertPreferencesFetch() { return { ok: true, preferences: requests.at(-1).body }; },
    async bankingAlertsFetchActive() { return { ok: true, alerts: [] }; },
    applyAlertSummaryToState() {},
    updateBankingNavAttentionState() {},
    console,
    Date,
    Number,
    String,
    Math,
    Array,
    Object,
    JSON,
    Set,
    Error
  };
  vm.runInNewContext(source, context, { filename: 'banking-alert-preferences-save.js' });
  return { context, requests };
}

test('explicit All action-required mode is not silently converted to selected reasons', async () => {
  const { context, requests } = createPreferencesSaveContext();
  await context.bankingAlertPreferencesSave({
    mode: 'ALL_ACTION_REQUIRED',
    failure_reason_groups: ['INSUFFICIENT_FUNDS', 'BANK_REJECTED'],
    informational_alert_kinds: [],
    include_success_alerts: true
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.mode, 'ALL_ACTION_REQUIRED');
  assert.equal(requests[0].body.failure_reason_allowlist, null);
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body, 'failure_reason_groups'), false);
});

test('Selected failure reasons mode sends only the chosen allow-list', async () => {
  const { context, requests } = createPreferencesSaveContext();
  await context.bankingAlertPreferencesSave({
    mode: 'SELECTED_FAILURE_REASONS',
    failure_reason_groups: ['INSUFFICIENT_FUNDS'],
    informational_alert_kinds: [],
    include_success_alerts: false
  });

  assert.equal(requests[0].body.mode, 'SELECTED_FAILURE_REASONS');
  assert.deepEqual(Array.from(requests[0].body.failure_reason_allowlist), ['INSUFFICIENT_FUNDS']);
  assert.deepEqual(Array.from(requests[0].body.failure_reason_groups), ['INSUFFICIENT_FUNDS']);
});

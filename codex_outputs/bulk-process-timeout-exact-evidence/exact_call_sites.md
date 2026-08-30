# Exact call sites for Bulk Process timeout / DB-health fix planning

This file is line-level evidence only. No code was changed and the incident was not reproduced.

## Backend call sites

### `POST /api/contract-weeks/:id/manual-upsert` route handler

- **File:** `/workspace/cloudtms-backend/broker/src/index.js`
- **Function:** `handleContractWeekManualUpsert(env, req, weekId)`
- **Line range:** 39992-40015 for handler start; route registration at 161701-161705.

```js
39992 async function handleContractWeekManualUpsert(env, req, weekId) {
39995   const user = await requireUser(env, req, ['admin']);
39998   let body;
40000     body = await parseJSONBody(req);
40005   const requestContext = String(body?.context || body?.mode || '').trim().toLowerCase();
```

**Interpretation:** this is the backend handler used by the browser's long `manual-upsert` route.

### Exact weekly manual-upsert RPC selection and missing timeout

- **File:** `/workspace/cloudtms-backend/broker/src/index.js`
- **Function:** `handleContractWeekManualUpsert`
- **Line range:** 43521-43570

```js
43521 const rpcFunctionName = bulkPatchResponseRequested
43522   ? 'contract_week_manual_upsert_bulk_process_atomic'
43523   : 'contract_week_manual_upsert_atomic';
...
43562 let rpcRes;
43563 try {
43564   wlog('sql_rpc_started', {
43565     rpc_function_name: rpcFunctionName,
...
43570   rpcRes = await sbRpc(env, rpcFunctionName, rpcArgs);
```

**Interpretation:** line 43570 is the primary weekly manual-upsert RPC call and it passes no fourth `opts` argument, so no `timeoutMs` is supplied at this call site.

### `sbRpc` helper timeout inference logic

- **File:** `/workspace/cloudtms-backend/broker/src/index.js`
- **Function:** `sbRpc(env, fn, args, opts)`
- **Line range:** 132365-132535

```js
132365 async function sbRpc(env, fn, args, opts) {
132366   const options = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
132370   const bankingPayFunctionRouteClasses = new Map([
132374     ['rpc_changes_ping', 'CHANGES_PING'],
132375     ['banking_pay_batch_watch_signal', 'WATCH_SIGNAL'],
...
132457 const requestedTimeoutMs =
132458   (Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0)
132459     ? Math.trunc(Number(options.timeoutMs))
132460     : null;
132463 let timeoutMs = requestedTimeoutMs ?? defaultTimeoutMs;
132469 const controller = timeoutMs ? new AbortController() : null;
132470 const t = timeoutMs ? setTimeout(() => {
132471   try { controller.abort(new Error(`RPC ${fnText} timed out after ${timeoutMs}ms`)); } catch {}
132472 }, timeoutMs) : null;
...
132522 const err = new Error(`RPC ${fnText} failed 408: ${timeoutMs ? `timeout after ${timeoutMs}ms` : 'timeout'}`);
```

**Interpretation:** generic RPCs only get a timeout if `opts.timeoutMs` is provided or a recognized route class supplies `defaultTimeoutMs`; `contract_week_manual_upsert_*` is not in the route-class map, so the line-43570 call is unbounded from this helper's perspective.

### `POST /api/changes/ping` route handler and RPC calls

- **File:** `/workspace/cloudtms-backend/broker/src/index.js`
- **Function:** `handleChangesPing(env, req, user)`
- **Line range:** 119894-119965; route registration at 161140-161142.

```js
119894 async function handleChangesPing(env, req, user) {
...
119923 const payload = unwrapRpc(await sbRpc(env, 'rpc_changes_ping', {
119924   p_last_seen: { ...lastSeen, __banking_actor_user_id: currentUser.id, __banking_alert_hash: previousBankingAlertHash || '', __watched_pay_batch_ids: watchedBatchIds }
119925 }), 'rpc_changes_ping');
...
119935 const alerts = unwrapRpc(await sbRpc(env, 'banking_alerts_active_for_user', { p_actor_user_id: currentUser.id, p_entity_kind: null, p_entity_id: null, p_include_acknowledged: false, p_limit: 25 }), 'banking_alerts_active_for_user');
...
119947 const signal = unwrapRpc(await sbRpc(env, 'banking_pay_batch_watch_signal', {
119948   p_pay_batch_id: payBatchId,
...
119958 }), 'banking_pay_batch_watch_signal');
119964 console.error('[CHANGES_PING] rpc_changes_ping failed', { err: e?.message || String(e), status: e?.status, body: e?.body });
```

**Interpretation:** `changes/ping` has a primary `rpc_changes_ping` RPC and optional banking alert/watch-signal RPCs; the primary call does not pass explicit `{ timeoutMs: ... }` at the call site, relying on helper inference.

### `GET /api/files/download` route handler and awaited audit calls

- **File:** `/workspace/cloudtms-backend/broker/src/index.js`
- **Function:** `handleFilesDownload(env, req)`
- **Line range:** 120359-120484; route registration at 161599-161600.

```js
120359 async function handleFilesDownload(env, req) {
...
120436 await writeAudit(
120437   env,
120438   null,
120439   'FILE_DOWNLOAD_DENIED',
...
120450 await writeAudit(env, null, 'FILE_DOWNLOAD_DENIED', { key, reason: 'expired', exp }, { entity: 'r2', subject_id: key, req });
...
120460 const obj = await bucket.get(key);
120463 await writeAudit(env, null, 'FILE_DOWNLOAD_NOT_FOUND', { key }, { entity: 'r2', subject_id: key, req });
...
120483 await writeAudit(env, null, 'FILE_DOWNLOAD_OK', { key, size: obj.size || null }, { entity: 'r2', subject_id: key, req });
120484 return withCORS(env, req, new Response(obj.body, { status: 200, headers }));
```

**Interpretation:** the successful R2 download path awaits `writeAudit` before returning the R2 body, so file preview/download can be coupled to DB/audit latency.

### `POST /api/files/presign-download` route handler

- **File:** `/workspace/cloudtms-backend/broker/src/index.js`
- **Function:** `handleFilePresignDownload(env, req)`
- **Line range:** 131950-132009; route registration at 161599.

```js
131950 async function handleFilePresignDownload(env, req) {
131951   const user = await requireUser(env, req, ['admin']);
...
131977 const m = key.match(/^docs-pdf\/timesheets\/ts_([0-9a-fA-F-]{36})\.pdf$/);
131982 await ensureTimesheetPdf(env, m[1]);
...
131988 const head = await r2Head(env, key);
131994 const token = await createToken(env.UPLOAD_TOKEN_SECRET, { typ: "file_dl", key, exp });
132004 return withCORS(env, req, ok({
132005   url: signed,
132006   signed_url: signed,
132007   download_url: signed,
```

**Interpretation:** normal presign does auth + R2 head + token, but canonical generated timesheet PDF keys call `ensureTimesheetPdf`, which can be heavier than simple R2 signing.

### `GET /api/timesheets/bulk-process-row-context` route handler and RPC timeout

- **File:** `/workspace/cloudtms-backend/broker/src/index.js`
- **Function:** `handleBulkProcessRowContext(env, req, rowIdentity = null)`
- **Line range:** 65150-65190 for handler start; 65970-65985 for RPC call; route registration at 161855-161857.

```js
65150 async function handleBulkProcessRowContext(env, req, rowIdentity = null) {
...
65979 const rpcRes = await sbRpc(env, 'bulk_process_row_context_v1', { p_filters: compactFilters }, { timeoutMs: 45000 });
65980 const payload = normaliseReturnedContext(unwrapRpcPayload(rpcRes, 'bulk_process_row_context_v1'), { profile, includeEvidence, baseOnly: profile === 'status_header' });
65981 return withCORS(env, req, ok(payload));
```

**Interpretation:** row-context is DB/RPC-backed and has a 45s Worker-side timeout; for UI read traffic during a mutation storm this is still a long budget.

## Frontend call sites

### `handleBulkProcessProcess` busy guard and busy-state set

- **File:** `/workspace/TEST-Frontend/js/main.js`
- **Function:** `handleBulkProcessProcess(state)`
- **Line ranges:** 199024-199040 and 203371-203380

```js
199024 async function handleBulkProcessProcess(state) {
...
199036 if (st.loading || st.saving || st.processing || st.unprocessing) {
199038   return { ok: false, busy: true };
199039 }
...
203371 st.__suppress_dirty_marking = true;
203372 st.processing = true;
203373 st.process_in_flight = true;
203374 st.__bulk_process_process_in_flight = true;
203380 await rerenderBulkProcessWorkbench(st, '[TS][BULK-PROCESS][PROCESS][START]');
```

**Interpretation:** there is a local state busy guard and UI rerender, but no durable per-row/action single-flight registry keyed by row/action.

### Weekly manual-upsert frontend submit helper

- **File:** `/workspace/TEST-Frontend/js/main.js`
- **Function:** weekly manual save/upsert helper containing `urlPath`
- **Line range:** 316706-316722

```js
316706 const encId   = encodeURIComponent(weekId);
316707 const urlPath = `/api/contract-weeks/${encId}/manual-upsert`;
...
316721 // ✅ Use apiPostJson so 409 errors preserve err.status + err.json for TIMESHEET_MOVED handling upstream
316722 const json = await apiPostJson(urlPath, safePayload);
```

**Interpretation:** the frontend weekly path posts to the backend route identified above; this path has no Bulk Process-specific request key passed to `authFetch`.

### `handleBulkProcessUnprocess` busy guard and submit call

- **File:** `/workspace/TEST-Frontend/js/main.js`
- **Function:** `handleBulkProcessUnprocess(state)`
- **Line ranges:** 205105-205120 and 204743-204750 (inner submit helper in the same unprocess flow)

```js
205105 async function handleBulkProcessUnprocess(state) {
...
205117 if (st.loading || st.saving || st.processing || st.unprocessing) {
205119   return { ok: false, busy: true };
205120 }
...
204743 const route = `/api/timesheets/${encodeURIComponent(id)}/daily-manual-unprocess`;
204746 const res = await authFetch(API(route), {
204747   method: 'POST',
204748   headers: { 'Content-Type': 'application/json' },
204749   body: JSON.stringify(body)
204750 });
```

**Interpretation:** unprocess has a local busy guard, but again no shared per-row/action single-flight/backpressure registry.

### Bulk Process row-context fetch function and missing AbortController signal

- **File:** `/workspace/TEST-Frontend/js/main.js`
- **Function:** `fetchSlimRowContext(rowObj, loadOptions = {})`
- **Line range:** 224256-224338

```js
224256 const fetchSlimRowContext = async (rowObj, loadOptions = {}) => {
...
224300 const profile = trimStr(loadOpts.profile || loadOpts.context_profile || 'status_header').toLowerCase() || 'status_header';
...
224336 const url = API(`/api/timesheets/bulk-process-row-context?${qs.toString()}`);
224338 const res = await authFetch(url);
```

**Interpretation:** the row-context fetch uses `authFetch(url)` without passing a `signal`, so stale row-context requests are not cancelled at the network/backend level.

### Row-context in-flight key generation

- **File:** `/workspace/TEST-Frontend/js/main.js`
- **Function:** `loadRowContext(rowObj, loadOptions = {})`
- **Line range:** 224550-224620

```js
224594 const cacheStore = getCacheStore();
224596 const inflightStore = getInflightStore();
224598 const cacheKey = getRowContextCacheKey(row, { includeEvidence, profile });
224600 const inflightKey = `${cacheKey}|${trimStr(requestTokenObj?.id || requestIdentity || '')}`;
```

**Interpretation:** in-flight reuse is keyed by cache key plus request token/identity; new request tokens for the same URL/profile can bypass dedupe.

### Stale-response guard after row-context await

- **File:** `/workspace/TEST-Frontend/js/main.js`
- **Function:** `loadRowContext(rowObj, loadOptions = {})`
- **Line range:** 224728-224750

```js
224734 if (!isModalOwnerCurrent(modalToken, requestIdentity) || (isCurrent && !isCurrent()) || (requestTokenObj && requestTokenObj.cancelled === true)) {
224736   stateAudit('loadRowContext:return:stale-loaded-context', {
...
224748   return { payload: makeRowContextFailurePayload('stale-loaded-context', row, loaded, { stale: true, degraded: true }), fromCache: false, failed: true };
224749 }
```

**Interpretation:** stale responses are ignored/degraded after completion, but this does not stop the underlying backend/DB work because the fetch was not aborted.

### `authFetch` single-flight route classification

- **File:** `/workspace/TEST-Frontend/js/main.js`
- **Function:** `authFetch(input, init = {})`
- **Line ranges:** 4785-5068 and 5170-5191

```js
4785 async function authFetch(input, init = {}) {
...
4828 const getBankingPayRequestClass = (() => {
...
5030 if (/\/api\/banking\/pay\//i.test(pathname)) {
5031   return {
5032     routeClass: 'BANKING_PAY_OTHER',
5034     idempotent: requestMethodText === 'GET',
5035     singleFlight: requestMethodText === 'GET',
5036     reuseExisting: requestMethodText === 'GET',
...
5042 return null;
...
5059 const requestKey = bankingPayRequestClass && bankingPayRequestClass.singleFlight && bankingPayRequestClass.key
5060   ? bankingPayRequestClass.key
5061   : null;
5063 if (requestRegistry && requestKey) {
5064   const existing = requestRegistry.get(requestKey);
5065   if (existing && existing.promise && bankingPayRequestClass.reuseExisting !== false) {
5067     return existing.promise.then((res) => {
5068       try { return res.clone(); } catch { return res; }
...
5172 if (requestRegistry && requestKey) {
5173   requestRegistry.set(requestKey, {
5175     promise: requestPromise,
...
5190 cleanupRequestRegistry();
```

**Interpretation:** `authFetch` single-flight is route-class driven and effectively scoped to Banking Pay classified requests; Bulk Process routes return `null` and get no shared request key.

### Bulk Process preview presign cache/in-flight logic

- **File:** `/workspace/TEST-Frontend/js/main.js`
- **Function:** preview binder presign path inside `bindBulkProcessPreviewPane(state)`
- **Line ranges:** 173050-173112 and 176640-176682

```js
173050 const presignDownload = async (key, signal, presignOptions = {}) => {
...
173098 const res = await authFetch(API('/api/files/presign-download'), {
173099   method: 'POST',
173100   headers: { 'Content-Type': 'application/json' },
173101   body: JSON.stringify({
...
173111   signal
173112 });
...
176646 const inflightKey = getPreviewOwnerCacheKey(previewFileCacheKey, capturePreviewCommitSnapshot(previewState, { reason: 'presign-inflight-key' })) || previewFileCacheKey;
176659 const existingRecord = (pane.__preview_presign_inflight[inflightKey] && typeof pane.__preview_presign_inflight[inflightKey] === 'object')
176662 const presignRecord = existingRecord || (() => {
176663   const abortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
176665   const url = await presignDownload(previewFileCacheKey, abortController ? abortController.signal : undefined, {
```

**Interpretation:** presign has an in-flight map and can pass an abort signal, but that protection is for presign only, not for the browser `<img>`/`<iframe>` download after `src` assignment.

### Preview `<img src>` / `<iframe src>` assignment

- **File:** `/workspace/TEST-Frontend/js/main.js`
- **Function:** preview render branch
- **Line range:** 162520-162532

```js
162526 hasCurrentSignedUrl
162527   ? (
162528       isPdf
162529         ? `<iframe id="bulkProcessPdfPreviewFrame" src="${enc(previewUrl)}" title="Bulk Process PDF preview" ...></iframe>`
162530         : (isImage
162531             ? `<img id="bulkProcessImagePreviewEl" alt="Evidence preview" src="${enc(signedUrl)}" ... />`
```

**Interpretation:** once a signed URL is committed to the DOM, the browser starts a file download outside the presign in-flight registry; repeated DOM replacement/source changes can create repeated downloads.

### Changes ping scheduler and `_pingInFlight` guard

- **File:** `/workspace/TEST-Frontend/js/main.js`
- **Function:** global changes heartbeat `pingOnce`
- **Line range:** 320721-320795

```js
320721 const pingOnce = async (reason = '') => {
320722   if (hb._disabled) return;
...
320731   if (hb._pingInFlight === true) {
320732     hb._pendingPingReason = String(reason || 'coalesced');
320733     return;
320734   }
...
320760   hb._pingInFlight = true;
...
320791   res = await doFetch(API('/api/changes/ping'), {
320792     method: 'POST',
320793     headers: { 'Content-Type': 'application/json' },
320794     body: JSON.stringify(payload)
320795   });
```

**Interpretation:** heartbeat coalesces while one ping is in-flight, but this snippet contains no Bulk Process mutation/modal-pressure pause condition before sending `/api/changes/ping`.

### Evidence that changes ping is not paused for Bulk Process mutation/high modal pressure

- **File:** `/workspace/TEST-Frontend/js/main.js`
- **Function:** same heartbeat `pingOnce`
- **Line range:** 320721-320795

**Interpretation:** the only gates shown are auth state, `_pingInFlight`, and a 1s throttle; there is no check for `window.modalCtx.bulkProcessState.processing`, `unprocessing`, `saving`, or a Bulk Process in-flight counter before line 320791 sends the ping.

# Backend fix targets

No backend code was changed in this task. This file identifies exact future change targets.

## 1. Weekly manual-upsert primary `sbRpc` timeout

- **Route/helper:** `handleContractWeekManualUpsert`
- **File/lines:** `/workspace/cloudtms-backend/broker/src/index.js` lines 43521-43570.
- **Current defect proven by code:** `rpcRes = await sbRpc(env, rpcFunctionName, rpcArgs);` has no `{ timeoutMs }` option and the chosen RPC name is generic, so `sbRpc` will not infer a timeout.
- **Exact safe change needed:** pass explicit `{ timeoutMs: 45000, routeClass: 'BULK_PROCESS_MUTATION', purpose: 'CONTRACT_WEEK_MANUAL_UPSERT' }` or a stricter agreed budget; map timeout to a controlled JSON response.
- **Containment or root-cause reduction:** immediate fail-fast containment.
- **Recommended timeout budget:** 30s-45s initially; lower only after DB-level timeout behavior is verified.
- **Expected HTTP status:** `408` for timeout or `503` for backend busy/DB degraded; `409` for lock/row conflict if DB returns a controlled conflict.
- **Frontend handling needed:** yes; show backend busy/retry-safe message and do not auto-retry.
- **Risk level:** low-medium; risk is surfacing existing slow operations as errors instead of hanging.

## 2. Per-row/action backend backpressure for Bulk Process mutations

- **Routes:** `POST /api/contract-weeks/:id/manual-upsert`, `POST /api/timesheets/:id/daily-manual-process`, `POST /api/timesheets/:id/daily-manual-unprocess`, `POST /api/timesheets/:id/daily-manual-upsert`.
- **Files/lines:** `/workspace/cloudtms-backend/broker/src/index.js` 39992-40015, 55009-55278, 55278-55377, 55377-55490.
- **Current defect proven by code:** no route-level row/action in-flight guard was found around these handlers.
- **Exact safe change needed:** add a short-lived per-user/session/row/action lock in Worker instance memory or durable test-safe KV if needed; return quickly if duplicate mutation is already active.
- **Containment or root-cause reduction:** both; prevents duplicate expensive mutation and limits blast radius.
- **Recommended timeout budget:** lock TTL slightly above mutation timeout, e.g. 60s if mutation budget is 45s.
- **Expected HTTP status:** `429` or `409` with `error_code: BULK_PROCESS_MUTATION_IN_FLIGHT`.
- **Frontend handling needed:** yes; show “operation already in progress” and suppress retry.
- **Risk level:** medium; Worker-instance memory is not globally complete, KV introduces latency/cleanup concerns.

## 3. `changes/ping` fast-fail/degraded response

- **Route/helper:** `handleChangesPing`
- **File/lines:** `/workspace/cloudtms-backend/broker/src/index.js` lines 119894-119965.
- **Current defect proven by code:** primary `rpc_changes_ping` call has no explicit timeout options at the call site; optional alert/watch-signal RPCs can add work.
- **Exact safe change needed:** pass explicit short timeout to `rpc_changes_ping` and optional calls, or wrap the whole route in a route budget; on timeout return existing degraded no-change payload.
- **Containment or root-cause reduction:** fail-fast containment.
- **Recommended timeout budget:** 2s-3s total for changes ping; optional alert/watch detail should be skipped/deferred if budget is low.
- **Expected HTTP status:** prefer `200` with `{ degraded: true, changes_ping_degraded: true }` to avoid client retry storm; use `503` only for systemic auth/config failures.
- **Frontend handling needed:** minimal if `200 degraded`; log/silently continue.
- **Risk level:** low.

## 4. Row-context shorter budget/degraded response

- **Route/helper:** `handleBulkProcessRowContext`
- **File/lines:** `/workspace/cloudtms-backend/broker/src/index.js` lines 65150-65190 and 65970-65985.
- **Current defect proven by code:** `bulk_process_row_context_v1` uses `{ timeoutMs: 45000 }`, which is long for repeated UI read traffic during a mutation storm.
- **Exact safe change needed:** reduce UI read budget and return degraded/minimal row context on timeout. Optionally use profile-based budgets: `status_header` shorter than `evidence`/`editor`.
- **Containment or root-cause reduction:** containment and request-pressure reduction.
- **Recommended timeout budget:** `status_header` 3s-5s; `evidence`/`editor` 8s-12s initially.
- **Expected HTTP status:** `200` degraded payload for UI continuity, or `503` with structured error if caller already handles degraded contexts.
- **Frontend handling needed:** yes if non-200; minimal if existing degraded payload shape is preserved.
- **Risk level:** medium; too short a timeout may cause degraded editor panes on normal slow days.

## 5. File download `writeAudit` decoupling or bounded audit

- **Route/helper:** `handleFilesDownload`
- **File/lines:** `/workspace/cloudtms-backend/broker/src/index.js` lines 120359-120484.
- **Current defect proven by code:** success path awaits `writeAudit` before returning R2 response at lines 120483-120484; failure paths also await audit.
- **Exact safe change needed:** make audit best-effort with `ctx.waitUntil` where available, or wrap audit in a very short timeout and never block valid R2 response on audit latency.
- **Containment or root-cause reduction:** containment for R2/download amplification.
- **Recommended timeout budget:** 250ms-500ms if kept inline; preferably async waitUntil.
- **Expected HTTP status:** valid download should remain `200`; audit failure should not alter response. Denied/not-found can still return current status without waiting on audit.
- **Frontend handling needed:** no, if response shape/status unchanged.
- **Risk level:** medium; audit reliability semantics change and may need product/security acceptance.

## 6. `presign-download` timeout/backpressure

- **Route/helper:** `handleFilePresignDownload`
- **File/lines:** `/workspace/cloudtms-backend/broker/src/index.js` lines 131950-132009.
- **Current defect proven by code:** canonical generated timesheet PDF keys can call `ensureTimesheetPdf`; route has no explicit route budget/backpressure in the shown handler.
- **Exact safe change needed:** add route budget and per-file/user in-flight guard; for normal evidence keys, keep fast R2-head/token path; for generated PDFs, fail/defer if preparation exceeds budget.
- **Containment or root-cause reduction:** containment.
- **Recommended timeout budget:** normal evidence presign 2s-5s; generated PDF preparation 10s-15s or separate async generation path.
- **Expected HTTP status:** `503` or `202`/structured deferred for generated PDF not ready; `429` for duplicate same-file presign pressure.
- **Frontend handling needed:** yes for non-200 presign: show retry/degraded preview rather than loop.
- **Risk level:** medium.

## 7. Correlation/request IDs

- **Routes/helpers:** all above plus `sbRpc`.
- **Files/lines:** route handlers listed above and `sbRpc` at `/workspace/cloudtms-backend/broker/src/index.js` lines 132365-132535.
- **Current defect proven by code:** inspected call sites log route-specific data but do not consistently attach a request correlation ID through frontend -> Worker -> RPC log.
- **Exact safe change needed:** generate/read `x-request-id`, include route/action/row identity in structured logs, pass safe context to RPC where appropriate without exposing secrets.
- **Containment or root-cause reduction:** diagnostic/root-cause reduction.
- **Recommended timeout budget:** not applicable.
- **Expected HTTP status:** no behavior change.
- **Frontend handling needed:** optional display/copy support for error reports.
- **Risk level:** low.

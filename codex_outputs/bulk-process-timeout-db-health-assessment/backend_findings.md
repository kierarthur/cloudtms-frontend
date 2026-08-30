# Backend findings

Inspected repository: `/workspace/cloudtms-backend`.

Primary file inspected: `/workspace/cloudtms-backend/broker/src/index.js`.

SQL source inspected selectively under `/workspace/cloudtms-backend/supabase/repeatable/` and `/workspace/cloudtms-backend/supabase/migrations/`.

## Routes inspected

- `POST /api/contract-weeks/:id/manual-upsert`
- `POST /api/timesheets/:id/daily-manual-process`
- `POST /api/timesheets/:id/daily-manual-unprocess`
- `POST /api/timesheets/:id/daily-manual-upsert`
- `GET /api/timesheets/bulk-process-row-context`
- `GET /api/timesheets/summary`
- `POST /api/changes/ping`
- `POST /api/files/presign-download`
- `GET /api/files/download`
- shared `sbRpc` helper

## Shared RPC/timeout behavior

`sbRpc(env, fn, args, opts)` only installs an `AbortController` when a timeout is explicitly supplied or inferred from a recognized route class. For generic RPCs, default timeout is `null`. Therefore calls such as `sbRpc(env, rpcFunctionName, rpcArgs)` can wait indefinitely from the Worker perspective.

Important limitation: Worker-side fetch abort does not guarantee the PostgreSQL statement is cancelled immediately. Even where Worker `timeoutMs` exists, corresponding DB-level `lock_timeout` / `statement_timeout` is still needed inside the RPC/session to prevent DB resource exhaustion.

## `POST /api/contract-weeks/:id/manual-upsert`

### Supabase/RPC calls observed

The route performs many preparatory reads and then chooses:

- `contract_week_manual_upsert_bulk_process_atomic` when a bulk patch response is requested.
- `contract_week_manual_upsert_atomic` otherwise.

It also calls helper/patch RPCs in adjacent paths, including:

- `bulk_timesheet_row_patch_v1` with `{ timeoutMs: 45000 }` for patch rows.
- `settings_finance_pick` via `sbRpc(...).catch(() => [])`.

### Critical finding

The primary atomic upsert call is:

```js
rpcRes = await sbRpc(env, rpcFunctionName, rpcArgs);
```

No `timeoutMs` is supplied. This is the clearest backend match for the browser's ~499s `manual-upsert` timing.

### Lock/transaction risk

The called RPC is atomic and can touch contract-week, timesheet, staged evidence/materialisation, TSFIN snapshot/payload, rotation, and bulk patch response state. If this function waits on a row lock or performs heavy work, it can hold/request DB resources for too long.

### Backpressure risk

No per-user/session/contract-week in-flight mutation guard was found in the Worker route. Multiple requests for the same contract week can reach the same atomic RPC path if the frontend sends them.

## `POST /api/timesheets/:id/daily-manual-process`

### Supabase/RPC calls observed

- `timesheet_daily_manual_process_atomic` with `{ timeoutMs: 45000 }`.

### Findings

- Better than weekly manual-upsert because Worker-side timeout is explicit.
- SQL source for the function contains row-locking (`FOR UPDATE`) in the atomic path.
- Needs DB-level lock/statement timeout verification before relying on Worker abort alone.

## `POST /api/timesheets/:id/daily-manual-unprocess`

### Supabase/RPC calls observed

- `timesheet_daily_manual_unprocess_atomic` with `{ timeoutMs: 45000 }`.

### Findings

- Better than weekly manual-upsert because Worker-side timeout is explicit.
- SQL source for the function contains row-locking (`FOR UPDATE`) in the atomic path.
- Should also have DB-level lock/statement timeout and controlled retryable errors.

## `POST /api/timesheets/:id/daily-manual-upsert`

### Supabase/RPC calls observed

- Uses `guardCurrentTimesheetWrite` before applying updates.
- Bulk-mode patch refresh uses `bulk_timesheet_row_patch_v1` with `{ timeoutMs: 45000 }` in inspected sections.

### Findings

- Not the route shown with 499s in the snapshot, but it participates in Bulk Process save/process flows.
- Should be covered by the same route budget and same per-row mutation guard.

## `GET /api/timesheets/bulk-process-row-context`

### Supabase/RPC calls observed

- `bulk_process_row_context_v1` with `{ timeoutMs: 45000 }`.

### Findings

- Has a Worker-side 45s timeout, but 45s is too long when repeated row-context requests are allowed during a mutation/degraded DB period.
- This route should have a shorter UI-read budget or should return a degraded/minimal context quickly when a related mutation is in flight.
- No route-level circuit breaker/backpressure was found.

## `GET /api/timesheets/summary`

### Supabase/RPC calls observed

Depending on filters/mode, the route can call:

- `pay_batch_timesheet_summary_lightweight_v1`
- `timesheet_list_ids`
- `timesheet_summary_lightweight_rows_v1`
- `timesheet_list_totals`

### Findings

- This is not the primary route in the supplied timing list, but summary refresh after mutation can add DB load.
- Some inspected calls did not show explicit timeout in the immediate call site, though helper behavior may vary by route class.
- Summary refresh should be avoided synchronously during critical Bulk Process mutation if not needed for immediate UI correctness.

## `POST /api/changes/ping`

### Supabase/RPC calls observed

- `rpc_changes_ping` with no explicit `timeoutMs` at call site.
- Optional `banking_alerts_active_for_user` if alert summary is needed.
- Optional `banking_pay_batch_watch_signal` for watched batch IDs.

### Findings

- `sbRpc` can infer a short Banking Pay route class for `rpc_changes_ping`, but the browser snapshot still shows a ~496s `changes/ping` request. This means the route did not fail fast in the incident, whether due to runtime version, pre/post-RPC delay, Worker/PostgREST saturation, fetch cancellation not propagating, or some optional path.
- `changes/ping` should be explicitly capped at a very short route budget and return a degraded empty payload if any dependency is slow.
- It should be safe to skip during Bulk Process mutation pressure.

## `POST /api/files/presign-download`

### Supabase/RPC/R2 calls observed

- Requires authenticated user.
- Parses key.
- For canonical `docs-pdf/timesheets/ts_<uuid>.pdf`, calls `ensureTimesheetPdf`, which can be DB/R2/PDF-generation heavy.
- Calls `r2Head(env, key)`.
- Creates a signed `/api/files/download` URL.

### Findings

- Normal evidence image keys should be mostly auth + R2 head + token signing.
- Generated timesheet PDF keys can be much heavier because `ensureTimesheetPdf` may prepare a PDF.
- No per-file/session presign backpressure was found at the route level.

## `GET /api/files/download`

### Supabase/RPC/R2 calls observed

- Verifies token.
- Reads object from R2 via `bucket.get(key)`.
- Calls `writeAudit` for denied/not-found/OK outcomes.
- Returns `new Response(obj.body, ...)` with `Cache-Control: no-store`.

### Findings

- The route is not purely R2: audit writes can couple the download path to DB health.
- The OK path awaits `writeAudit` before returning the object response. If DB is unhealthy, even a valid R2 file download can be delayed.
- During preview storms, repeated image/iframe loads can multiply these audit writes.

## Which route likely took 499s?

Most likely `POST /api/contract-weeks/:id/manual-upsert` waiting on the unbounded `contract_week_manual_upsert_bulk_process_atomic` or `contract_week_manual_upsert_atomic` call. Static inspection cannot prove whether the time was spent in PostgreSQL execution, lock wait, PostgREST queueing, Worker connection wait, or network, but the route-level unbounded RPC is a concrete defect that allows the 499s symptom.

## Can long DB calls continue after frontend abort?

Yes, likely.

- Frontend fetch abort was not used for many Bulk Process row-context calls.
- Even when Worker `AbortController` is used, aborting the HTTP fetch to PostgREST is not a complete substitute for PostgreSQL `statement_timeout`/`lock_timeout` inside the DB session/function.
- Therefore stale or timed-out frontend requests can still leave expensive DB work running unless DB-level timeouts are added.

## Proposed backend safeguards

1. Add explicit `timeoutMs` to weekly manual-upsert primary `sbRpc`; start with 45s maximum, preferably lower once DB-level lock timeouts exist.
2. Add DB-level `lock_timeout` and `statement_timeout` in `contract_week_manual_upsert_bulk_process_atomic`, `contract_week_manual_upsert_atomic`, `timesheet_daily_manual_process_atomic`, and `timesheet_daily_manual_unprocess_atomic` where safe.
3. Convert lock timeout/statement timeout into controlled `409/503` JSON responses with retry guidance.
4. Add Worker route budgets and correlation IDs for mutation/context/presign/download/ping.
5. Add per-user/session/row/action backpressure for Bulk Process mutations; reject duplicate same-row mutation quickly with `409` or `429`.
6. Make `changes/ping` explicitly fast-fail with a short timeout and degraded no-change response.
7. Make file download audit best-effort/non-blocking or bounded to a very short timeout so R2 preview does not become DB-blocked.
8. Consider short-lived edge/client caching of safe presign metadata and suppress repeated `r2Head` for the same file key within a short window.
9. Do not perform expensive summary refresh synchronously in the mutation response unless required for immediate correctness.

## Backend files changed locally

None. Backend was inspected only; no backend file was modified.

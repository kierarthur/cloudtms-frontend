# CloudTMS Bulk Process timeout / DB unhealthy assessment

## Safety boundary used

- No Bulk Process mutation was executed.
- No process/unprocess/manual-upsert reproduction was attempted.
- No stress loop was run.
- No TEST or production deploy was performed.
- No destructive SQL, migrations, DDL, DML, background drains, payment, settlement, remittance, webhook, or email actions were run.
- Database diagnostics were limited to bounded `SELECT` statements through the approved TEST-only `public.codex_debug_select_sql` RPC.
- Secrets were not printed. Environment variables were checked only by name/presence.

## Evidence summary

The browser snapshot supplied by the user shows a Bulk Process modal that survived a severe backend/database degradation event. The visible modal reported `Failed to fetch`; the active row was `timesheet:d488286f-34e1-43bc-9020-2164a6098f45`; the visible evidence tab was `ATTACHED`; and the attached preview had recovered enough to render an attached image. Therefore the dump is evidence of a broader request/backend/DB timeout condition, not simply evidence of one broken preview render.

Important browser resource timings from the supplied snapshot:

- `POST /api/contract-weeks/dfd64693-236c-46eb-b1e8-6ac64936ba7b/manual-upsert` appeared three times at approximately 5.1s, 16.8s, and 499s.
- `POST /api/changes/ping` had overlapping/hung entries around 10.6s, 496s, and 6.3s.
- `GET /api/files/download?...` had one image request around 463s, another around 4.2s, and repeated image/iframe downloads.
- `/auth/refresh` took around 71s.
- Repeated `GET /api/timesheets/bulk-process-row-context` calls appeared for `profile=editor`, `profile=evidence`, and `profile=status_header`.
- Repeated `POST /api/files/presign-download`, `GET /api/files/download`, and `POST /api/changes/ping` calls were interleaved with the mutation calls.

## Reconstructed timeline from browser dump

1. Bulk Process dataset/manual queue opened successfully; initial dataset and queue calls were fast.
2. The contract-week row context opened initially in under 1s.
3. First weekly manual `manual-upsert` against contract week `dfd64693-236c-46eb-b1e8-6ac64936ba7b` completed in about 5.1s.
4. User continued process/unprocess and evidence tab/thumbnail switching. Additional row-context/profile, presign, download, and heartbeat calls were created while the modal was active.
5. A later `manual-upsert` on the same contract week took about 16.8s.
6. A later `manual-upsert` on the same contract week remained open for about 499s.
7. During the same degradation window, `changes/ping` remained open about 496s, an R2-backed file download remained open about 463s, and `/auth/refresh` took about 71s.
8. Once the backend/DB path was saturated or stalled, unrelated endpoints such as changes ping, row-context, auth refresh, and file download also stalled or reported `Failed to fetch`.

## Most likely root causes

### 1. Backend weekly manual-upsert has an unbounded primary RPC call

**Confidence: high.**

The backend route for `POST /api/contract-weeks/:id/manual-upsert` eventually calls either `contract_week_manual_upsert_bulk_process_atomic` or `contract_week_manual_upsert_atomic`. Unlike many nearby Bulk Process helper calls that pass `{ timeoutMs: 45000 }`, this primary `sbRpc` invocation passes no timeout options. `sbRpc` only installs an `AbortController` when a timeout is provided or inferred by a recognized route class; this manual-upsert RPC has neither. Therefore a slow/blocked PostgREST/RPC call can sit for hundreds of seconds from the Worker/client perspective instead of failing fast.

This directly matches the 499s `manual-upsert` browser timing. It also explains why the UI saw a request that did not fail fast and why subsequent work accumulated around it.

**Proven:** primary manual-upsert RPC has no explicit timeout; `sbRpc` does not default-timeout generic functions.

**Inferred:** the 499s browser entry was waiting on that unbounded RPC or on PostgREST/DB work triggered by it.

### 2. Frontend permits multiple weekly manual-upsert/process attempts over time and does not use per-row/action single-flight idempotency

**Confidence: high.**

The frontend sets busy flags before the submit request and rerenders the modal, which should block simple double-clicks while the same state object is busy. However, there is no durable per-row/action single-flight registry keyed by `contract_week_id`/`timesheet_id` + action. The supplied snapshot shows three `manual-upsert` calls against the same contract week in one session. That could be legitimate repeated user action after each previous request returned, but the dangerous point is that no frontend-level per-row/action backpressure prevents a later action from starting while stale row-context/presign/download work from the same row is still in flight or while the backend is already degraded.

**Proven:** general `authFetch` single-flight is Banking Pay-specific only, while Bulk Process mutation calls use `apiPostJson`/`authFetch` without a Bulk Process request registry.

**Inferred:** the repeated same-contract-week calls contributed to DB lock/capacity pressure during the incident.

### 3. Bulk Process row-context deduplication is too narrow and stale fetches are not aborted at fetch level

**Confidence: high.**

The row-context loader has useful cache and stale-response guards, but its in-flight key is `cacheKey|requestToken.id-or-identity`, not the exact request URL/profile/row. New row-change/request tokens for the same row/profile can therefore create independent `GET /api/timesheets/bulk-process-row-context` calls instead of reusing the existing one. The loader ignores stale responses after await, but the underlying `authFetch(url)` has no `AbortController` signal, so stale DB/RPC work is allowed to continue on the backend.

This matches the snapshot's repeated `profile=editor`, `profile=evidence`, and `profile=status_header` row-context calls.

**Proven:** in-flight key includes request token; fetch call has no abort signal; stale results are ignored after completion rather than cancelled.

**Inferred:** row-context calls amplified DB/PostgREST pressure while manual-upsert was slow.

### 4. Evidence preview has partial presign dedupe/abort, but rendered image/iframe downloads are not globally bounded

**Confidence: medium-high.**

The preview binder maintains signed URL caches and an in-flight presign registry keyed by owner/file key, and it supports aborting presign requests. That is good. However, each committed preview writes either an `<iframe>` for PDFs or an `<img>` for images using `/api/files/download?...`. Browser downloads cannot be cancelled by the existing presign registry after the DOM `src` is assigned, and repeated tab/thumbnail switching can create multiple browser-level downloads. The snapshot's repeated file download entries, including a 463s one, are consistent with browser connection saturation and backend/R2/audit work piling up.

The preview code appears to choose either `<iframe>` or `<img>` for the current file type, not both in the same render branch, so the core issue is repeated selection/render/download, not a guaranteed duplicate `<img>`+`<iframe>` for the same file in one render.

**Proven:** preview renders signed URLs into `<iframe>` or `<img>` and presign is separate from actual download.

**Inferred:** repeated thumbnail switching and rerenders caused repeated downloads and browser/Worker connection pressure.

### 5. `changes/ping` continues during modal/backend degradation and can hang for a long time

**Confidence: high.**

The frontend heartbeat has an `_pingInFlight` guard, so it should not stack identical pings from the same heartbeat instance while one is in flight. However, it does not pause/defer during Bulk Process critical mutations or high in-flight modal activity. Backend `handleChangesPing` calls `rpc_changes_ping` without a short explicit timeout; it relies on `sbRpc` route-class inference, but then can optionally call alert/watch-signal RPCs. In the supplied snapshot, `changes/ping` hung about 496s, proving the route did not fail fast in the incident.

**Proven:** frontend heartbeat is not Bulk Process-aware; snapshot shows a 496s ping.

**Inferred:** either route-class timeout inference was not reached/effective for this path at runtime, or the request was delayed before/around the RPC due to Worker/PostgREST/DB saturation.

### 6. `/api/files/download` is mostly R2/token work but still performs DB audit writes

**Confidence: medium-high.**

`POST /api/files/presign-download` authenticates, optionally calls `ensureTimesheetPdf` for canonical generated timesheet PDF keys, runs an R2 head, and returns a `/api/files/download` URL. Normal evidence image keys should not require DB-heavy metadata lookups beyond auth/session. `GET /api/files/download` verifies the signed token, reads R2, and streams the object, but it also calls `writeAudit` for denied/not-found/OK outcomes. Those audit calls can introduce DB dependence into an otherwise R2-oriented route. During DB/PostgREST degradation, file downloads can therefore become coupled to DB health, especially at the final audit-before-response point.

**Proven:** download route calls `writeAudit` before returning OK and on denial/not-found paths.

**Inferred:** the 463s file download may have been blocked by audit DB work, R2/Worker connection saturation, browser connection slots, or a combination. Static inspection cannot prove which without logs.

### 7. RPCs use row locks and include patch/finance/evidence work; no per-function lock/statement timeout was verified for these specific functions

**Confidence: medium.**

The local SQL source for daily manual process/unprocess uses `FOR UPDATE` in the atomic functions. The weekly manual-upsert bulk-process atomic function is present in source and is a large atomic mutation path involving timesheet/contract-week/evidence/TSFIN payloads. Static source inspection found explicit `lock_timeout`/`statement_timeout` settings elsewhere in the repository, but not verified at the start of the specific Bulk Process manual process/unprocess functions inspected. If one of these functions waits on a lock or performs a heavy recompute inside one transaction, PostgREST/DB resources can be held for too long.

**Proven:** relevant atomic functions exist and use row-level locks in daily process/unprocess source; weekly route calls an atomic RPC.

**Inferred:** lock waits or heavy RPC work caused the DB health issue. The live DB was healthy at diagnostic time, so no active blocking chain was captured.

## Layer involvement

- **Frontend:** implicated. It creates repeated mutation/context/presign/download/heartbeat traffic; stale row-context requests are ignored after completion but not cancelled; Bulk Process has no broad per-row/action single-flight/backpressure registry.
- **Backend Worker:** implicated. The most important finding is the unbounded weekly manual-upsert primary RPC call. Several routes have no general request budget/circuit breaker.
- **RPC/DB:** implicated. Atomic mutation functions can lock rows and perform multi-domain work. The incident required a Supabase restart, strongly suggesting DB/PostgREST saturation or lock/capacity exhaustion rather than only browser rendering trouble.
- **R2/file route:** implicated as an amplifier. Presign/download traffic is repeated during thumbnail switching, and download includes DB audit writes.
- **Auth refresh:** likely a victim/amplifier. The 71s refresh timing indicates global backend/session/DB or browser connection degradation, not an auth-specific root cause.

## Why the DB became unhealthy

The most likely chain is:

1. Weekly manual process/unprocess led to one or more `manual-upsert` calls.
2. The primary weekly manual-upsert RPC ran without a Worker-side timeout. If it encountered a lock wait or a heavy transaction, it could remain active/waiting for hundreds of seconds.
3. During that time, the modal continued generating row-context, evidence, presign, download, and heartbeat requests.
4. Row-context and heartbeat routes hit DB/RPC paths; file download may also hit DB through audit writes. These requests accumulated while the DB/PostgREST path was already slow.
5. Instead of failing fast with bounded 429/503/408 responses, requests remained pending. This consumed browser connection slots, Worker subrequest/connection capacity, PostgREST connections, and DB resources.
6. The DB/Supabase project became unhealthy/unresponsive until restarted.

## What must change so this cannot happen again

### Must-fix backend safeguards

1. Add explicit short/medium timeouts to the primary weekly manual-upsert `sbRpc` call, matching or tightening the 45s used by adjacent Bulk Process RPC calls.
2. Add route-level budgets/correlation IDs for `manual-upsert`, daily process/unprocess, row-context, changes ping, presign, and download.
3. Make `changes/ping` a strict fast-fail route with a short budget and degraded empty response if DB does not answer quickly.
4. Avoid DB audit writes on the synchronous `/api/files/download` critical path during preview, or make them best-effort/non-blocking with a very short timeout.
5. Add per-user/session/row/action backpressure in the Worker: concurrent mutation for the same row/action should return `409/429` quickly rather than running another atomic RPC.
6. Ensure the relevant PL/pgSQL functions set safe local `lock_timeout` and `statement_timeout` values and return controlled retryable errors on lock timeout.

### Must-fix frontend safeguards

1. Add a Bulk Process request coordinator with per-row/action single-flight for process/unprocess/manual-upsert.
2. Disable action buttons immediately and keep them disabled until the request and required post-mutation refresh reach a terminal state.
3. Abort stale row-context/evidence fetches when the active row/profile changes; dedupe in-flight row-context by exact row/profile/include-evidence URL, not by request token.
4. Add max in-flight Bulk Process request caps and a visible backend-busy state.
5. Pause/defer `changes/ping` while critical Bulk Process mutations are in flight or while modal backend in-flight count exceeds a low threshold.
6. Avoid resetting `<img>`/`<iframe>` `src` when the preview selection and signed URL are unchanged; cap active preview downloads by ignoring or deferring stale selections.
7. Cache presigned URLs briefly by file key/selection key and reuse while valid.

## Optional code patches

No code patches were produced in this assessment. The primary backend timeout fix is clear, but the requested task emphasized assessment first and avoiding speculative broad changes. A follow-up patch should be narrowly scoped to backend timeout/backpressure plus frontend single-flight/cancellation once the desired timeout budgets are agreed.

## Policy X

No Banking Pay/payment/settlement/remittance/provider logic was changed. No Policy X drift was introduced.

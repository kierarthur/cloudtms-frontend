# Frontend findings

Inspected file: `/workspace/TEST-Frontend/js/main.js`.

## Functions/areas inspected

- `authFetch`
- `apiPostJson`
- `handleBulkProcessProcess`
- `handleBulkProcessUnprocess`
- `handleBulkProcessRowChange`
- `openBulkProcessWorkbench`
- Bulk Process row context cache/in-flight logic in the row-change loader
- `renderBulkProcessEvidencePane`
- `bindBulkProcessPreviewPane`
- `reconcileBulkProcessEvidenceStateAfterContextRefresh`
- Bulk Process preview presign/download logic
- Changes heartbeat scheduler and `POST /api/changes/ping` usage

## Findings by question

### Are Process and Unprocess buttons disabled immediately and kept disabled while a request is in flight?

Partially yes.

- `handleBulkProcessProcess` checks `st.loading || st.saving || st.processing || st.unprocessing` on entry.
- It later sets `st.processing = true`, `st.process_in_flight = true`, and `st.__bulk_process_process_in_flight = true`, then rerenders the workbench before submitting.
- `handleBulkProcessUnprocess` similarly checks busy state and sets/clears unprocessing state.

Limitation:

- This is state-object/UI based. It is not a durable per-row/action single-flight registry. If state is reset, row changes, rerenders, a prior request hangs, or a second action is initiated after a previous slow request returns, the frontend does not have a global Bulk Process lock keyed by row/action.

### Is there a single-flight guard per row/action so the same manual-upsert/unprocess cannot be triggered twice?

No robust per-row/action single-flight guard was found.

- General `authFetch` single-flight only applies to Banking Pay route classifications.
- Bulk Process `apiPostJson` calls inherit `authFetch` but do not receive a Bulk Process route class or request key.
- The supplied snapshot proves repeated `manual-upsert` calls for the same contract week occurred in the session.

### Are stale row-context requests aborted when the active row changes?

No, not at fetch level.

- Row-change code creates request tokens and stale checks.
- After a row-context promise resolves, the result is ignored if it is stale or identity-mismatched.
- However, `fetchSlimRowContext` calls `authFetch(url)` without passing an `AbortController` signal. The DB/RPC-backed request is allowed to continue even if the active row changes.

### Are stale row-context responses ignored if they return after row identity changes?

Yes, mostly.

- The row-change path checks modal owner/current row state before fetch, after await, and before applying final context.
- Identity mismatch returns a degraded/stale payload or refuses to apply the result.

Limitation:

- Ignoring stale responses protects UI correctness but does not protect DB/Worker capacity. The backend work has already happened.

### Are evidence/profile row-context requests deduped when the same URL is already in flight?

Not sufficiently.

- The loader has an in-flight store, but the in-flight key is `cacheKey|requestToken.id-or-identity`.
- New request tokens for the same row/profile can bypass reuse and create duplicate row-context fetches.
- The desired key should be the exact row/profile/include-evidence/cache URL or normalized row-context cache key independent of row-change token.

### Does switching QUEUE/ATTACHED repeatedly trigger redundant presign/download requests?

Likely yes.

- Preview presign has a cache and in-flight registry keyed by owner/file key, which helps.
- However, switching tabs/thumbnails can change owner/selection keys and start new presign requests.
- The actual browser download begins after `<img src>` or `<iframe src>` is assigned. Those browser-level downloads are not controlled by the presign in-flight registry.

### Does a render/reconcile loop create repeated image reloads?

Potentially.

- The preview renderer writes `<iframe src=...>` for PDFs or `<img src=...>` for images when a signed URL is present.
- There is extensive commit/stale checking, but repeated rerenders that reassign an equivalent signed URL can still prompt browser fetch behavior depending on DOM replacement and cache headers.
- Backend download responses set `Cache-Control: no-store`, so the browser should not rely on HTTP cache to absorb repeated preview loads.

### Does `changes/ping` keep running while a long process/unprocess mutation is in flight?

Yes.

- The heartbeat has an `_pingInFlight` guard, so a single heartbeat instance should not stack pings while one is in flight.
- It is not Bulk Process-aware and does not pause/defer during a critical Bulk Process mutation or while the modal has many in-flight backend calls.
- The browser snapshot showed a `changes/ping` request around 496s during the degraded window.

### Does the preview use both `img` and `iframe` for the same file and cause duplicate downloads?

Not as a normal single-render branch.

- The inspected branch renders an `<iframe>` for PDF, an `<img>` for image, or an `Open file` link for other types.
- Repeated row/tab/thumbnail transitions can still create multiple downloads over time.

### Does “Open larger” or preview fallback create additional download loops?

Potentially, but not proven from static inspection.

- “Open larger”/open-file paths use presign/download independently.
- No unbounded retry loop was proven for “Open larger”.
- The larger risk is repeated user selection/rerender while old downloads remain pending.

### Are there retry loops with no cap/backoff?

No obvious unbounded retry loop was found in the inspected Bulk Process preview path. The risk is not classic automatic retry storm; it is overlapping user-driven and rerender-driven request creation with insufficient cancellation/backpressure.

## Frontend implicated mechanisms

1. No Bulk Process per-row/action single-flight registry for manual-upsert/process/unprocess.
2. Row-context stale responses are guarded, but stale network/DB work is not aborted.
3. Row-context in-flight dedupe key is too narrow because it includes a request token.
4. Preview presign has partial dedupe, but actual `<img>`/`<iframe>` downloads are not bounded once started.
5. Heartbeat continues during critical Bulk Process mutation/degradation.
6. No central Bulk Process max-in-flight request budget or backend-busy circuit breaker was found.

## Proposed frontend safeguards

1. Add `bulkProcessRequestCoordinator` on modal state/global state:
   - keyed by `row_key || contract_week_id || timesheet_id`, action (`process`, `unprocess`, `row-context`, `presign`, `download`), and profile.
   - returns existing promise for exact duplicate safe reads.
   - rejects duplicate mutations with a local busy message.
2. Add `AbortController` to row-context fetches and abort all stale row-context/evidence fetches on row change, modal close, or mutation start.
3. Change row-context in-flight dedupe key to normalized URL/profile/include-evidence, not request token.
4. Pause/defer `changes/ping` while `st.processing`, `st.unprocessing`, `st.saving`, or Bulk Process in-flight count is above a threshold.
5. Add a modal-level max-in-flight cap, e.g. no more than 2 DB-backed Bulk Process reads plus 1 mutation.
6. Do not rewrite preview stage `src` if selection key and signed URL are unchanged.
7. Use short-lived signed URL cache by file key/selection key and suppress presign requests for stale selections.
8. Show “Backend busy, waiting for current operation” instead of firing more row-context/presign/download requests after a request exceeds a safe threshold.

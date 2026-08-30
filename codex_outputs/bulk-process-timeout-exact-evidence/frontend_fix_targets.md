# Frontend fix targets

No frontend code was changed in this task. This file identifies exact future change targets.

## 1. Per-row/action single-flight for Process/Unprocess

- **Functions:** `handleBulkProcessProcess`, `handleBulkProcessUnprocess`, weekly manual-upsert helper using `urlPath = /api/contract-weeks/:id/manual-upsert`.
- **Files/lines:** `/workspace/TEST-Frontend/js/main.js` lines 199024-199040, 203371-203380, 205105-205120, 204743-204750, 316706-316722.
- **Current defect proven by code:** existing guard is state-local (`st.processing`, `st.unprocessing`, etc.) and request submit calls do not register a durable row/action key.
- **Safe change needed:** add a Bulk Process request coordinator keyed by `action + row_key/contract_week_id/timesheet_id`; reject or reuse duplicate same-row mutation promises and keep the key until terminal success/error/timeout cleanup.
- **Required or optional:** required.
- **Scope:** Bulk Process only if implemented as `st.__bulk_process_request_coordinator` or similarly namespaced helper.
- **Risk level:** medium; must avoid leaving stale locks on exceptions/modal close.

## 2. Abort stale row-context/evidence requests

- **Functions:** `fetchSlimRowContext`, `loadRowContext`, row-change flow creating request tokens.
- **Files/lines:** `/workspace/TEST-Frontend/js/main.js` lines 224256-224338, 224550-224620, 224728-224750.
- **Current defect proven by code:** `fetchSlimRowContext` calls `authFetch(url)` with no `signal`; stale response guard runs after the request completes, so backend work is not cancelled.
- **Safe change needed:** create an `AbortController` per active row/profile request; pass `signal` to `authFetch`; abort previous controllers on row change, modal close, mutation start, and superseded profile request.
- **Required or optional:** required.
- **Scope:** Bulk Process only.
- **Risk level:** medium; UI must treat `AbortError` as benign stale cancellation.

## 3. Row-context in-flight dedupe key change

- **Functions:** `loadRowContext`.
- **Files/lines:** `/workspace/TEST-Frontend/js/main.js` lines 224594-224600.
- **Current defect proven by code:** `inflightKey = cacheKey|requestToken.id-or-identity`, so equivalent row/profile requests with different request tokens do not dedupe.
- **Safe change needed:** use a stable normalized key such as `cacheKey` plus profile/include-evidence/force flags only; keep request token for stale-apply checks but not for exact duplicate fetch dedupe.
- **Required or optional:** required.
- **Scope:** Bulk Process only.
- **Risk level:** low-medium; ensure forced refresh can intentionally bypass cache/dedupe when needed after mutations.

## 4. Preview download/src reassignment guard

- **Functions:** `bindBulkProcessPreviewPane` preview render/commit branch.
- **Files/lines:** `/workspace/TEST-Frontend/js/main.js` lines 162520-162532.
- **Current defect proven by code:** preview writes `<iframe src=...>` or `<img src=...>` for the signed URL; once assigned, browser download is outside presign cancellation. No line-level guard is visible here that skips DOM rewrite when the same selection and URL are already rendered.
- **Safe change needed:** before replacing preview stage, compare current rendered `data-preview-selection-key` and `data-signed-url`/`src`; if unchanged, do not rewrite `innerHTML` or reset `src`.
- **Required or optional:** required for request-storm prevention.
- **Scope:** Bulk Process preview only; shared renderer caution if used by Bulk Authorise.
- **Risk level:** medium; must not suppress legitimate rotation/page/file changes.

## 5. Presign cache/dedupe improvement

- **Functions:** `presignDownload` and preview presign in-flight path inside `bindBulkProcessPreviewPane`.
- **Files/lines:** `/workspace/TEST-Frontend/js/main.js` lines 173050-173112 and 176640-176682.
- **Current defect proven by code:** presign has an in-flight map and passes an abort signal, which is good; however, the key includes owner cache semantics and does not cap modal-wide presign concurrency.
- **Safe change needed:** retain existing in-flight reuse but add a modal-level maximum presign count and short signed-URL TTL reuse keyed by normalized file key + selection key; abort stale presign when selection changes.
- **Required or optional:** required if preview switching is part of the failure workflow; optional only after src-reassignment guard and row-context cap if metrics prove presign is not storming.
- **Scope:** Bulk Process preview; review Bulk Authorise coupling before changing shared code.
- **Risk level:** medium.

## 6. Changes ping pause/defer during Bulk Process mutation or high modal request pressure

- **Functions:** global changes heartbeat `pingOnce`.
- **Files/lines:** `/workspace/TEST-Frontend/js/main.js` lines 320721-320795.
- **Current defect proven by code:** gates are auth, `_pingInFlight`, and 1s throttle; no Bulk Process state or request-pressure gate appears before sending `/api/changes/ping`.
- **Safe change needed:** before line 320791, check for an active Bulk Process modal with `processing`, `unprocessing`, `saving`, or high `__bulk_process_inflight_count`; if true, defer ping with bounded backoff and preserve one pending reason.
- **Required or optional:** required.
- **Scope:** shared app heartbeat, but condition should be narrowly Bulk Process-specific.
- **Risk level:** low-medium; heartbeat freshness can be delayed but should resume after terminal state.

## 7. Modal-level max in-flight cap / backend-busy state

- **Functions:** Bulk Process row-change/context loader, preview presign/download coordinator, process/unprocess handlers.
- **Files/lines:** `/workspace/TEST-Frontend/js/main.js` around 199024-199040, 203371-203380, 224256-224750, 173050-176682.
- **Current defect proven by code:** there are isolated busy flags and caches, but no central modal request budget covering row-context + presign + mutation + heartbeat pressure.
- **Safe change needed:** add a Bulk Process-only request budget helper with counters by type (`mutation`, `dbRead`, `presign`, `downloadIntent`) and a visible `backend busy`/`waiting` state when caps are reached.
- **Required or optional:** required for permanent prevention.
- **Scope:** Bulk Process only.
- **Risk level:** medium; must avoid blocking essential recovery/error-state refreshes.

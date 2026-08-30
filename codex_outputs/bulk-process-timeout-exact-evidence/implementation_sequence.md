# Safest implementation sequence

Goal 1: prevent TEST DB from becoming unhealthy. Goal 2: stop the bad Bulk Process request pattern. Do not reproduce the incident until Phase E.

## Phase A — immediate DB protection / fail-fast containment

### Files/functions to change

- `/workspace/cloudtms-backend/broker/src/index.js`
  - `handleContractWeekManualUpsert` lines 43521-43570.
  - `handleChangesPing` lines 119894-119965.
  - `handleBulkProcessRowContext` lines 65150-65190 and 65970-65985.
  - `sbRpc` lines 132365-132535 if shared timeout/correlation behavior is centralized.

### Why needed

The 499s manual-upsert and 496s changes-ping indicate requests did not fail fast. This phase caps backend request duration before fixing every frontend request source.

### Risk reduced

Reduces DB/PostgREST/Worker connection exhaustion and converts hangs into controlled retryable/degraded responses.

### Root cause or containment

Mostly containment, but weekly manual-upsert timeout removes the clearest backend defect.

### Safe tests

- Static lint/syntax checks.
- Unit-level helper tests if available.
- Harmless GET health/version route checks.
- One read-only DB diagnostic summary through approved RPC.

### Tests not allowed yet

- No process/unprocess/manual-upsert mutation.
- No repeated row switching or preview stress.
- No Playwright reproduction.

## Phase B — frontend request prevention

### Files/functions to change

- `/workspace/TEST-Frontend/js/main.js`
  - `handleBulkProcessProcess` lines 199024-199040 and 203371-203380.
  - `handleBulkProcessUnprocess` lines 205105-205120 and unprocess submit path lines 204743-204750.
  - weekly manual-upsert submit helper lines 316706-316722.
  - row-context functions lines 224256-224750.
  - preview presign/render lines 173050-173112, 176640-176682, 162520-162532.
  - changes heartbeat lines 320721-320795.

### Why needed

Backend fail-fast protects the DB, but the UI can still create duplicate/stale row-context, preview, and heartbeat work unless requests are coordinated and cancelled.

### Risk reduced

Reduces request storm creation at source: duplicate mutation, stale row-context fetches, repeated preview downloads, and heartbeat pressure.

### Root cause or containment

Root-cause reduction for the request storm pattern.

### Safe tests

- Static JS syntax check if available.
- Unit/helper tests if available.
- Manual code review of state cleanup paths.
- Optional non-mutating browser observation only after user approval, without clicking process/unprocess.

### Tests not allowed yet

- No process/unprocess/manual-upsert.
- No thumbnail stress loop.
- No DB mutation.

## Phase C — backend/RPC root-cause reduction

### Files/functions to change

- `/workspace/cloudtms-backend/broker/src/index.js`
  - per-row/action backend backpressure around Bulk Process mutation handlers.
- SQL migration/repeatable source for:
  - `contract_week_manual_upsert_bulk_process_atomic`.
  - `contract_week_manual_upsert_atomic`.
  - `timesheet_daily_manual_process_atomic`.
  - `timesheet_daily_manual_unprocess_atomic`.
  - optionally `bulk_process_row_context_v1` and `rpc_changes_ping` for statement timeouts.

### Why needed

Worker timeouts do not guarantee DB statement cancellation; DB-level lock/statement timeouts prevent lock waits and long transactions from degrading the database.

### Risk reduced

Reduces long DB transactions/lock waits and duplicate same-row mutation impact.

### Root cause or containment

Root-cause reduction for lock/transaction duration and duplicate mutation.

### Safe tests

- SQL static review.
- Read-only schema/function metadata checks.
- If backend-primary and approved, deploy only to isolated Codex Worker/TEST-safe path as instructed.

### Tests not allowed yet

- No normal TEST backend deploy unless explicitly instructed.
- No migration execution unless explicitly approved.
- No mutation reproduction.

## Phase D — R2/download decoupling

### Files/functions to change

- `/workspace/cloudtms-backend/broker/src/index.js`
  - `handleFilesDownload` lines 120359-120484.
  - `handleFilePresignDownload` lines 131950-132009.
- `/workspace/TEST-Frontend/js/main.js`
  - preview render/source guard lines 162520-162532.
  - preview presign path lines 173050-176682.

### Why needed

Repeated preview switching can create many R2 downloads; current download route awaits audit before returning a valid file.

### Risk reduced

Prevents R2 preview traffic from amplifying DB/audit pressure and reduces browser/Worker connection slot saturation.

### Root cause or containment

Both: reduces preview request creation and decouples download from DB health.

### Safe tests

- Static syntax checks.
- Single non-mutating presign/download of a known safe non-sensitive test file only if user approves and no payload/body is printed.

### Tests not allowed yet

- No repeated thumbnail switching stress.
- No generated PDF mass preparation.

## Phase E — controlled verification

### Files/functions involved

All changed areas above.

### Why needed

Only after containment and prevention are in place should the workflow be verified end-to-end.

### Risk reduced

Confirms DB health is protected under realistic but bounded interaction.

### Root cause or containment

Verification of both containment and root-cause reduction.

### Safe tests

Only with explicit user approval:

1. Exact TEST row IDs.
2. Max one mutation action.
3. Max one QUEUE -> ATTACHED switch.
4. Max two thumbnail clicks.
5. Stop if any request exceeds 15s or DB active query exceeds 15s.
6. Read-only DB health summaries only.
7. No automatic retry.

### Tests not allowed without explicit approval

- Stress loops.
- Multiple process/unprocess cycles.
- Broad data mutation.
- Production anything.
- Normal TEST backend deploy unless explicitly instructed.

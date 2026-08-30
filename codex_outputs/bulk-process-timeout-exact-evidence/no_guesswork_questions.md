# No-guesswork questions / real blockers

These are the remaining facts or decisions that would affect a safe implementation. This list avoids vague/non-blocking questions.

## 1. Exact product timeout budgets

The evidence proves missing/overlong timeouts, but final budgets are a product/operations decision. Suggested starting values are:

- Weekly manual-upsert Worker timeout: 30s-45s.
- DB `lock_timeout`: 1s-3s.
- DB mutation `statement_timeout`: 25s-40s for weekly; 15s-25s for daily.
- Row-context route timeout: 3s-5s for `status_header`, 8s-12s for `editor`/`evidence`.
- Changes ping total route budget: 2s-3s.

A final implementation should confirm these budgets or choose safe defaults explicitly.

## 2. Whether local SQL source exactly matches deployed TEST function bodies

Safe DB metadata proved the functions exist, but detailed deployed function definitions were blocked by the diagnostic RPC guard. If exact deployed SQL matching is required, a backend-primary or admin-approved read-only mechanism is needed.

## 3. Audit semantics for `/api/files/download`

The safe technical fix is to avoid blocking valid R2 responses on `writeAudit`. Product/security must confirm whether best-effort/asynchronous audit is acceptable, or whether a very short bounded inline audit is required.

## 4. Backend backpressure storage choice

A Worker in-memory per-row/action guard is simple but per-isolate only. A KV-backed guard is more global but adds latency and cleanup complexity. The implementation owner must choose the acceptable consistency level.

## 5. Frontend shared preview coupling with Bulk Authorise

Some preview code appears shared/named across Bulk Process and Bulk Authorise. Before editing preview presign/render helpers, confirm whether the change should be strictly Bulk Process-gated or intentionally shared.

## 6. `pg_stat_statements` safe access path

The extension exists, but querying `pg_stat_statements` failed in the diagnostic RPC context. If slow-query history is needed before SQL changes, an approved safe access path/schema qualification needs to be identified.

## Not blockers

- Missing index is not proven, so no index SQL is needed for the first implementation.
- Reproduction is not needed before Phase A/Phase B fixes.
- Production access is not needed and must not be used.

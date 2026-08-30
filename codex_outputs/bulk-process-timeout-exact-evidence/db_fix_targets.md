# DB/RPC fix targets

This file is based only on read-only metadata and local SQL source inspection. No migration or destructive SQL was run.

## General DB-level recommendation

Worker-side `AbortController` timeouts are not enough to guarantee that PostgreSQL stops a running or lock-waiting function immediately. The Bulk Process mutation RPCs should set safe local `lock_timeout` and `statement_timeout` and convert timeout/lock errors into controlled retryable JSON or SQLSTATE responses.

## `contract_week_manual_upsert_bulk_process_atomic`

- **Local source:** `/workspace/cloudtms-backend/supabase/repeatable/19012026_extras.sql` lines 9765-10582.
- **DB-level `lock_timeout` recommended:** yes, because it delegates to row-locking `contract_week_manual_upsert_atomic` and performs pre/post patch reads.
- **DB-level `statement_timeout` recommended:** yes.
- **Proposed safe budget:** `lock_timeout` 1s-3s; `statement_timeout` 25s-40s, aligned below Worker timeout.
- **Controlled error to return:** JSON with `ok:false`, `error_code:'BULK_PROCESS_DB_BUSY'` or `LOCK_TIMEOUT`, `retryable:true`, `contract_week_id`, and no sensitive payload.
- **Requires SQL migration:** yes.
- **Missing index proven:** no.
- **Evidence:** local function calls `bulk_timesheet_row_patch_v1` and delegates to `contract_week_manual_upsert_atomic`; no local `lock_timeout` or `statement_timeout` found.

## `contract_week_manual_upsert_atomic`

- **Local source:** `/workspace/cloudtms-backend/supabase/repeatable/19012026_extras.sql` lines 7662-9287.
- **DB-level `lock_timeout` recommended:** yes.
- **DB-level `statement_timeout` recommended:** yes.
- **Proposed safe budget:** `lock_timeout` 1s-3s; `statement_timeout` 25s-40s initially.
- **Controlled error to return:** SQL/JSON domain error such as `LOCK_TIMEOUT` or `MANUAL_UPSERT_DB_BUSY`, retryable true, mapped by backend to `409` or `503`.
- **Requires SQL migration:** yes.
- **Missing index proven:** no. Existing inspected indexes cover primary timesheet/contract-week/evidence/queue lookup paths; no bounded diagnostic proved an absent index.
- **Evidence:** local source locks `contract_weeks`, `contracts`, `timesheets_financials`, and staged `manual_timesheet_queue` rows with `FOR UPDATE`, and mutates `timesheet_evidence`/`manual_timesheet_queue`.

## `timesheet_daily_manual_process_atomic`

- **Local source:** `/workspace/cloudtms-backend/supabase/repeatable/26052026_2100HRS_NEW_FUNCTIONS.sql` lines 141931-142414.
- **DB-level `lock_timeout` recommended:** yes.
- **DB-level `statement_timeout` recommended:** yes.
- **Proposed safe budget:** `lock_timeout` 1s-2s; `statement_timeout` 15s-25s because this route already has Worker `{ timeoutMs: 45000 }` but should fail earlier at DB level.
- **Controlled error to return:** JSON with `ok:false`, `operation:'daily_manual_process'`, `error_code:'LOCK_TIMEOUT'` or `DAILY_PROCESS_DB_BUSY`, `retryable:true`.
- **Requires SQL migration:** yes.
- **Missing index proven:** no.
- **Evidence:** local source locks current `timesheets` and `timesheets_financials` rows with `FOR UPDATE`, calls `bulk_timesheet_row_patch_v1`, and has no visible timeout-specific handling.

## `timesheet_daily_manual_unprocess_atomic`

- **Local source:** `/workspace/cloudtms-backend/supabase/repeatable/26052026_2100HRS_NEW_FUNCTIONS.sql` lines 142415-142693.
- **DB-level `lock_timeout` recommended:** yes.
- **DB-level `statement_timeout` recommended:** yes.
- **Proposed safe budget:** `lock_timeout` 1s-2s; `statement_timeout` 15s-25s.
- **Controlled error to return:** JSON with `ok:false`, `operation:'daily_manual_unprocess'`, `error_code:'LOCK_TIMEOUT'` or `DAILY_UNPROCESS_DB_BUSY`, `retryable:true`.
- **Requires SQL migration:** yes.
- **Missing index proven:** no.
- **Evidence:** local source locks current `timesheets` and `timesheets_financials` rows with `FOR UPDATE`, calls `bulk_timesheet_row_patch_v1`, and has no local lock/statement timeout settings.

## `bulk_process_row_context_v1`

- **Local source:** `/workspace/cloudtms-backend/supabase/repeatable/02052026_1528_fast_timesheet_reading.sql` lines 3440-7228.
- **DB-level `lock_timeout` recommended:** optional/low priority, because local source is read-heavy and contains no direct `FOR UPDATE`.
- **DB-level `statement_timeout` recommended:** yes, to prevent repeated UI reads from consuming DB resources during degraded periods.
- **Proposed safe budget:** 5s-10s DB statement timeout, with backend route budget by profile (`status_header` shortest).
- **Controlled error to return:** backend can convert DB timeout into degraded row-context payload; SQL function does not necessarily need domain JSON if PostgREST error is mapped safely.
- **Requires SQL migration:** likely yes if implemented inside function; alternatively route-level timeout only can be a first containment step.
- **Missing index proven:** no.
- **Evidence:** local source reads `timesheets`, `contract_weeks`, `timesheets_financials`, `timesheet_evidence`, `manual_timesheet_queue`, and calls `bulk_timesheet_row_patch_v1`; no timeout settings found.

## `rpc_changes_ping`

- **Local source:** `/workspace/cloudtms-backend/supabase/repeatable/26052026_2100HRS_NEW_FUNCTIONS.sql` lines 64297-64625.
- **DB-level `lock_timeout` recommended:** optional/low priority; local source has no row locks.
- **DB-level `statement_timeout` recommended:** yes, short.
- **Proposed safe budget:** 1s-2s DB statement timeout; backend total route budget 2s-3s.
- **Controlled error to return:** backend should return `200` degraded no-change payload on timeout; SQL-specific controlled error is optional.
- **Requires SQL migration:** optional if route-level timeout is enough; yes if DB-level timeout is set inside function.
- **Missing index proven:** no.
- **Evidence:** local source reads `app_change_counters`; no `FOR UPDATE`, `lock_timeout`, or `statement_timeout` found.

## Index evidence conclusion

No missing index is proven. The previous bounded DB diagnostics found relevant indexes on `contract_weeks(timesheet_id)`, `timesheets(timesheet_id)` primary key, `timesheet_evidence(timesheet_id, kind)`, `timesheet_evidence(timesheet_id)`, `manual_timesheet_queue(timesheet_id)`, `manual_timesheet_queue(status, uploaded_at_utc)`, and a staged contract-week expression/partial index. Do not propose index SQL until a specific slow plan or missing predicate is proven.

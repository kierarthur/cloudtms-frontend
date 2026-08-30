# RPC function evidence

This file uses local backend SQL source plus safe current-DB metadata. No SQL mutation was run.

## Safe current-DB metadata check

Read-only metadata query confirmed these functions exist in the TEST DB as `plpgsql` security-definer functions:

| function | language | volatility | security definer | arg count seen |
|---|---|---|---:|---:|
| `bulk_process_row_context_v1` | plpgsql | stable | true | 1 |
| `contract_week_manual_upsert_atomic` | plpgsql | volatile | true | 11 |
| `contract_week_manual_upsert_bulk_process_atomic` | plpgsql | volatile | true | 14 |
| `rpc_changes_ping` | plpgsql | volatile | true | 1 |
| `timesheet_daily_manual_process_atomic` | plpgsql | volatile | true | 7 |
| `timesheet_daily_manual_unprocess_atomic` | plpgsql | volatile | true | 4 and 5 overloads |

Attempting a current-DB `pg_get_functiondef` pattern query was blocked by the diagnostic RPC guard (`blocked keyword in diagnostic SQL`), so detailed function-body evidence below comes from local SQL source. This means exact deployed body equivalence is not proven by this task.

## Summary table from local SQL source

| RPC | Local source file | Function range | `FOR UPDATE` in local source | `lock_timeout` | `statement_timeout` | Atomic/transaction-heavy? | Controlled timeout/lock retry errors visible? |
|---|---|---:|---:|---:|---:|---|---|
| `contract_week_manual_upsert_bulk_process_atomic` | `/workspace/cloudtms-backend/supabase/repeatable/19012026_extras.sql` | 9765-10582 | No direct `FOR UPDATE`; calls atomic upsert | No | No | Yes, wrapper around pre/post row patch and atomic upsert | Generic exception JSON, but no visible lock/statement timeout-specific handling |
| `contract_week_manual_upsert_atomic` | `/workspace/cloudtms-backend/supabase/repeatable/19012026_extras.sql` | 7662-9287 | Yes | No | No | Yes, locks contract week, contract, timesheet/TSFIN, staged queue/evidence | Uses exceptions for domain errors, but no visible timeout/lock retry branch |
| `timesheet_daily_manual_process_atomic` | `/workspace/cloudtms-backend/supabase/repeatable/26052026_2100HRS_NEW_FUNCTIONS.sql` | 141931-142414 | Yes | No | No | Yes, locks timesheet and TSFIN then updates TSFIN/timesheet and emits row patches | Domain JSON errors visible; no lock/statement timeout-specific handling visible |
| `timesheet_daily_manual_unprocess_atomic` | `/workspace/cloudtms-backend/supabase/repeatable/26052026_2100HRS_NEW_FUNCTIONS.sql` | 142415-142693 | Yes | No | No | Yes, locks timesheet and TSFIN then updates TSFIN/timesheet and emits row patches | Domain JSON errors visible; no lock/statement timeout-specific handling visible |
| `bulk_process_row_context_v1` | `/workspace/cloudtms-backend/supabase/repeatable/02052026_1528_fast_timesheet_reading.sql` | 3440-7228 | No | No | No | Read-heavy, not mutating; calls row patch function and evidence/queue reads | No timeout/lock handling visible; stable function |
| `rpc_changes_ping` | `/workspace/cloudtms-backend/supabase/repeatable/26052026_2100HRS_NEW_FUNCTIONS.sql` | 64297-64625 | No | No | No | Read-heavy heartbeat over change counters and alert hashes | Generic exception guards for parsing only; no timeout/lock handling visible |

## `contract_week_manual_upsert_bulk_process_atomic`

- **Source file:** `/workspace/cloudtms-backend/supabase/repeatable/19012026_extras.sql`
- **Line range:** 9765-10582
- **Main tables/functions touched from local source:** `bulk_timesheet_row_patch_v1`, `contract_week_manual_upsert_atomic`; TSFIN snapshots are passed through payloads.

Focused snippets:

```sql
9765 CREATE OR REPLACE FUNCTION public.contract_week_manual_upsert_bulk_process_atomic(
9771   p_tsfin_snapshot_json jsonb DEFAULT NULL,
9777   p_expected_current_tsfin_snapshot_json jsonb DEFAULT NULL,
9778   p_next_tsfin_snapshot_json jsonb DEFAULT NULL,
...
9895 SELECT decision_result.row_json
9897 FROM public.bulk_timesheet_row_patch_v1(v_pre_patch_filters) AS decision_result(row_json)
...
10010 FROM public.contract_week_manual_upsert_atomic(
10011   p_week_id => p_week_id,
...
10016   p_tsfin_snapshot_json => v_next_tsfin_snapshot_json,
...
10489 EXCEPTION WHEN OTHERS THEN
10525 RETURN JSONB_BUILD_OBJECT(
10529   'error_code', v_error_code,
10530   'sqlstate', v_error_sqlstate,
10531   'message', v_error_message,
```

**Interpretation:** this is a volatile security-definer wrapper that performs pre/post row patch reads and delegates the actual write to `contract_week_manual_upsert_atomic`. It has generic exception JSON but no visible local `lock_timeout`, `statement_timeout`, `lock_not_available`, or `query_canceled` handling.

## `contract_week_manual_upsert_atomic`

- **Source file:** `/workspace/cloudtms-backend/supabase/repeatable/19012026_extras.sql`
- **Line range:** 7662-9287
- **Main tables touched from local source:** `contract_weeks`, `contracts`, `timesheets`, `timesheets_financials`, `manual_timesheet_queue`, `timesheet_evidence`.

Focused snippets:

```sql
7662 CREATE OR REPLACE FUNCTION public.contract_week_manual_upsert_atomic(...)
7663  RETURNS TABLE(... timesheet_json jsonb, timesheet_financials_json jsonb)
7671  v_week public.contract_weeks%ROWTYPE;
7673  v_pointer_ts public.timesheets%ROWTYPE;
7674  v_current_ts public.timesheets%ROWTYPE;
7675  v_current_tsfin public.timesheets_financials%ROWTYPE;
...
7805 SELECT *
7807 FROM public.contract_weeks AS cw
7808 WHERE cw.id = p_week_id
7809 FOR UPDATE;
...
8307 SELECT *
8309 FROM public.timesheets_financials AS tsfin_lock
8313 LIMIT 1
8314 FOR UPDATE;
...
8960 SELECT *
8961 FROM public.manual_timesheet_queue AS mq
8965 FOR UPDATE
...
9007 INSERT INTO public.timesheet_evidence (
...
9024 UPDATE public.manual_timesheet_queue AS mq
```

**Interpretation:** this is the core weekly manual mutation RPC and is transaction-heavy: it locks contract/week/TSFIN/queue rows and mutates timesheet evidence/queue state. Local source contains no `lock_timeout` or `statement_timeout`.

## `timesheet_daily_manual_process_atomic`

- **Source file:** `/workspace/cloudtms-backend/supabase/repeatable/26052026_2100HRS_NEW_FUNCTIONS.sql`
- **Line range:** 141931-142414
- **Main tables touched from local source:** `timesheets`, `timesheets_financials`; calls `bulk_timesheet_row_patch_v1`.

Focused snippets:

```sql
141931 CREATE OR REPLACE FUNCTION public.timesheet_daily_manual_process_atomic(...)
141947 v_tsfin_id uuid := NULL;
...
142109 FROM public.timesheets AS current_ts
142112 LIMIT 1
142113 FOR UPDATE;
...
142155 FROM public.timesheets_financials AS tsfin_current
142159 LIMIT 1
142160 FOR UPDATE;
...
142199 FROM public.bulk_timesheet_row_patch_v1(JSONB_BUILD_OBJECT('dataset_mode', 'process', 'timesheet_id', v_current_timesheet_id::text)) AS decision_result(row_json)
...
142251 EXCEPTION WHEN OTHERS THEN
142252   RETURN JSONB_BUILD_OBJECT(
142255     'error_code', 'TSFIN_PATCH_NUMERIC_INVALID',
```

**Interpretation:** daily process is atomic and row-locking. It has domain-level JSON errors but no visible lock/statement timeout settings or timeout-specific retryable error mapping.

## `timesheet_daily_manual_unprocess_atomic`

- **Source file:** `/workspace/cloudtms-backend/supabase/repeatable/26052026_2100HRS_NEW_FUNCTIONS.sql`
- **Line range:** 142415-142693
- **Main tables touched from local source:** `timesheets`, `timesheets_financials`; calls `bulk_timesheet_row_patch_v1`.

Focused snippets:

```sql
142415 CREATE OR REPLACE FUNCTION public.timesheet_daily_manual_unprocess_atomic(...)
...
142503 FROM public.timesheets AS current_ts
142507 FOR UPDATE;
...
142535 FROM public.timesheets_financials AS tsfin_current
142540 FOR UPDATE;
...
142583 FROM public.bulk_timesheet_row_patch_v1(JSONB_BUILD_OBJECT('dataset_mode', 'process', 'timesheet_id', v_current_timesheet_id::text)) AS decision_result(row_json)
```

**Interpretation:** daily unprocess is atomic and row-locking. No local `lock_timeout`, `statement_timeout`, `lock_not_available`, or `query_canceled` handling was found in the function source.

## `bulk_process_row_context_v1`

- **Source file:** `/workspace/cloudtms-backend/supabase/repeatable/02052026_1528_fast_timesheet_reading.sql`
- **Line range:** 3440-7228
- **Main tables/functions touched from local source:** `timesheets`, `contract_weeks`, `timesheets_financials`, `timesheet_evidence`, `manual_timesheet_queue`, `bulk_timesheet_row_patch_v1`.

Focused snippets:

```sql
3440 CREATE OR REPLACE FUNCTION public.bulk_process_row_context_v1(p_filters jsonb DEFAULT '{}'::jsonb)
3441  RETURNS jsonb
3442  LANGUAGE plpgsql
3443  STABLE SECURITY DEFINER
...
3641 FROM public.timesheets AS identity_ts
3648 FROM public.contract_weeks AS identity_cw
...
3880 FROM public.bulk_timesheet_row_patch_v1(
...
5062 FROM public.timesheet_evidence AS te0
...
5111 FROM public.manual_timesheet_queue AS mq0
```

**Interpretation:** row-context is read-heavy and not directly row-locking in local source, but it can read many Bulk Process/evidence/queue/TSFIN structures and call the row-patch function. No local timeout settings exist inside the function.

## `rpc_changes_ping`

- **Source file:** `/workspace/cloudtms-backend/supabase/repeatable/26052026_2100HRS_NEW_FUNCTIONS.sql`
- **Line range:** 64297-64625
- **Main tables touched from local source:** `app_change_counters` and banking alert signal/summary supporting data based on local function body; no timesheet/contract/evidence tables found in the function source scan.

Focused snippets:

```sql
64297 CREATE OR REPLACE FUNCTION public.rpc_changes_ping(
64298   p_last_seen jsonb DEFAULT '{}'::jsonb
64299 )
64300 RETURNS jsonb
64301 LANGUAGE plpgsql
64302 VOLATILE
64303 SECURITY DEFINER
...
64351 BEGIN
64352   v_actor_user_id := NULLIF(BTRIM(COALESCE(v_last_seen ->> '__banking_actor_user_id', '')), '')::uuid;
64353 EXCEPTION WHEN OTHERS THEN
64354   v_actor_user_id := NULL::uuid;
...
64461 LEFT JOIN public.app_change_counters AS change_counter
...
64486 SELECT change_counter.entity_key, change_counter.seq
64488 FROM public.app_change_counters AS change_counter
```

**Interpretation:** changes ping is read-heavy and has parsing exception guards, but no local DB-level timeout settings. It should be safe to fail fast/degrade rather than wait behind DB pressure.

## Source freshness caveat

Local SQL source may not exactly match the deployed TEST DB function bodies. The safe metadata query proved the functions exist and basic volatility/security metadata, but detailed deployed source inspection was blocked by the diagnostic RPC guard. A future backend-primary task could verify deployed definitions through an approved, safe, non-secret mechanism if needed.

# DB diagnostics

All diagnostics were run against the TEST Supabase project only through the approved read-only RPC:

```text
public.codex_debug_select_sql(p_sql text, p_limit integer default 100)
```

No destructive SQL, DDL, DML, locks, migrations, background jobs, payment actions, webhook replay, settlement, remittance, email drain, or comms drain were run.

Secrets were not printed.

## Query 1: slow-query extension availability

```sql
select extname
from pg_extension
where extname in ('pg_stat_statements','pg_stat_monitor')
order by extname
limit 10;
```

Result:

```json
[
  { "extname": "pg_stat_statements" }
]
```

Finding: extension is installed, but querying `pg_stat_statements` directly through the diagnostic RPC was rejected by the database as relation not found in the available search path/access context (see rejected query below).

## Query 2: active/wait state summary

```sql
select state, wait_event_type, wait_event, count(*)::int as n
from pg_stat_activity
where datname = current_database()
group by state, wait_event_type, wait_event
order by n desc
limit 30;
```

Result at diagnostic time:

```json
[
  { "state": "idle", "wait_event_type": "Client", "wait_event": "ClientRead", "n": 5 },
  { "state": null, "wait_event_type": "Extension", "wait_event": "Extension", "n": 2 },
  { "state": "active", "wait_event_type": null, "wait_event": null, "n": 1 }
]
```

Finding: TEST DB was not unhealthy at diagnostic time. No blocking chain was captured. The only active query was the diagnostic RPC itself.

## Query 3: long-running active queries with truncated SQL

```sql
select
  pid,
  state,
  wait_event_type,
  wait_event,
  round(extract(epoch from (now() - query_start))::numeric, 1) as age_s,
  left(regexp_replace(query, '\s+', ' ', 'g'), 300) as query_prefix
from pg_stat_activity
where datname = current_database()
  and state <> 'idle'
order by query_start nulls last
limit 20;
```

Result at diagnostic time:

```json
[
  {
    "state": "active",
    "wait_event_type": null,
    "wait_event": null,
    "age_s": 0.0,
    "query_prefix": "WITH pgrst_source AS (... codex_debug_select_sql ... )"
  }
]
```

Finding: no long-running app query was active when diagnostics ran.

## Query 4: pg_stat_statements slow statements

```sql
select
  calls,
  round(total_exec_time::numeric, 1) as total_ms,
  round(mean_exec_time::numeric, 1) as mean_ms,
  rows,
  left(regexp_replace(query, '\s+', ' ', 'g'), 500) as query_prefix
from pg_stat_statements
where query ilike '%timesheet%'
   or query ilike '%contract_week%'
   or query ilike '%evidence%'
   or query ilike '%manual%'
   or query ilike '%tsfin%'
order by total_exec_time desc
limit 30;
```

Result:

```json
{ "ok": false, "message": "relation \"pg_stat_statements\" does not exist", "sqlstate": "42P01" }
```

Finding: rejected/unavailable in this RPC context. Slow statement history could not be obtained.

## Query 5: relevant function names

```sql
select n.nspname as schema_name, p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname ilike '%timesheet%'
    or p.proname ilike '%contract_week%'
    or p.proname ilike '%bulk%'
    or p.proname ilike '%tsfin%'
    or p.proname ilike '%manual%'
    or p.proname ilike '%evidence%'
  )
order by p.proname
limit 200;
```

Selected relevant results:

- `bulk_authorise_dataset_v1`
- `bulk_authorise_import_evidence_page_v1`
- `bulk_authorise_row_context_v1`
- `bulk_process_dataset_v1`
- `bulk_process_row_context_v1`
- `bulk_timesheet_row_decision_v1`
- `bulk_timesheet_row_patch_v1`
- `bulk_timesheet_workbench_row_source_v1`
- `contract_week_manual_upsert_atomic`
- `contract_week_manual_upsert_bulk_process_atomic`
- `enqueue_tsfin_for_authorised_range`
- `enqueue_tsfin_for_hospital_norm`
- `enqueue_tsfin_for_occ_key`
- `timesheet_daily_manual_process_atomic`
- `timesheet_daily_manual_unprocess_atomic`

Finding: the expected Bulk Process/manual/TSFIN functions exist in TEST.

## Query 6: table stats

```sql
select
  relname,
  n_live_tup,
  n_dead_tup,
  seq_scan,
  idx_scan,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
from pg_stat_user_tables
where relname in (
  'timesheets',
  'contract_weeks',
  'timesheet_evidence',
  'manual_timesheet_queue',
  'timesheet_finance',
  'timesheet_financials'
)
order by relname
limit 50;
```

Result:

| relname | n_live_tup | n_dead_tup | seq_scan | idx_scan | vacuum/analyze info |
|---|---:|---:|---:|---:|---|
| `contract_weeks` | 0 | 0 | 12 | 23 | null in stats snapshot |
| `manual_timesheet_queue` | 0 | 0 | 0 | 0 | null in stats snapshot |
| `timesheet_evidence` | 0 | 0 | 114 | 6 | null in stats snapshot |
| `timesheets` | 0 | 0 | 58 | 30 | null in stats snapshot |

Finding: stats in this TEST project appear reset or not representative (`n_live_tup=0` for active tables). `timesheet_evidence` had more seq scans than index scans in the snapshot, but because stats appear reset, this is only a weak signal.

## Query 7: indexes on likely tables

```sql
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('timesheets','contract_weeks','timesheet_evidence','manual_timesheet_queue')
order by tablename, indexname
limit 200;
```

Selected relevant indexes found:

- `contract_weeks_pkey` on `contract_weeks(id)`.
- `idx_cw_timesheet` on `contract_weeks(timesheet_id)`.
- `idx_cw_status` on `contract_weeks(status)`.
- `manual_timesheet_queue_pkey` on `manual_timesheet_queue(id)`.
- `manual_timesheet_queue_status_uploaded_idx` on `manual_timesheet_queue(status, uploaded_at_utc desc)`.
- `manual_timesheet_queue_timesheet_idx` on `manual_timesheet_queue(timesheet_id)`.
- `idx_manual_timesheet_queue_staged_contract_week` expression/partial index on `meta_json ->> 'contract_week_id'` for staged rows.
- `idx_timesheet_evidence_ts` on `timesheet_evidence(timesheet_id)`.
- `idx_timesheet_evidence_timesheet_kind` on `timesheet_evidence(timesheet_id, kind)`.
- `idx_timesheet_evidence_ts_kind_created` on `timesheet_evidence(timesheet_id, kind, created_at, id)`.
- `timesheets_pkey` on `timesheets(timesheet_id)`.
- `idx_timesheets_status`, `idx_timesheets_sub_mode`, `idx_timesheets_weekending`, and current/booking-related indexes on `timesheets`.

Finding: obvious timesheet/evidence/contract-week lookup indexes exist. Missing-index root cause is not proven from these bounded diagnostics.

## Query 8: schema verification for minimal status query

```sql
select table_name, column_name
from information_schema.columns
where table_schema='public'
  and table_name in ('timesheets','contract_weeks','timesheet_evidence','manual_timesheet_queue','timesheet_financials')
  and (
    column_name in ('id','timesheet_id','contract_week_id','status','processing_status','updated_at','created_at','is_current','manual_pdf_r2_key','r2_key','storage_key','download_storage_key')
    or column_name ilike '%timesheet%'
    or column_name ilike '%contract_week%'
    or column_name ilike '%status%'
  )
order by table_name, ordinal_position
limit 200;
```

Selected verification results:

- `contract_weeks`: `id`, `status`, `timesheet_id`, `created_at`, `updated_at`.
- `manual_timesheet_queue`: `id`, `r2_key`, `status`, `timesheet_id`.
- `timesheet_evidence`: `id`, `timesheet_id`, `storage_key`, `created_at`.
- `timesheets`: `timesheet_id`, `status`, `created_at`, `updated_at`, `is_current`, `manual_pdf_r2_key`, `qr_status`, `parent_timesheet_id`.

Finding: `timesheets` uses `timesheet_id` as primary identifier; a first minimal status query using `t.id` was rejected. This was corrected.

## Query 9: specific known TEST IDs, minimal status/counts only

Known IDs inspected:

- `contract_week_id = dfd64693-236c-46eb-b1e8-6ac64936ba7b`
- `timesheet_id = c63e997b-e4eb-47b3-925a-b0f1b379ed8d`
- `timesheet_id = d488286f-34e1-43bc-9020-2164a6098f45`
- `timesheet_id = 9f05fb68-53dc-4688-89bd-5ae01bb37f46`
- `timesheet_id = fc11c665-a15e-47e4-807b-c01ce6830891`

Corrected bounded query returned:

| kind | id | status | is_current | updated_at | evidence_count | queue_count |
|---|---|---|---|---|---:|---:|
| contract_week | `dfd64693-236c-46eb-b1e8-6ac64936ba7b` | `OPEN` | null | `2026-06-12 16:57:51.582906+00` | null | null |
| timesheet | `9f05fb68-53dc-4688-89bd-5ae01bb37f46` | `RECEIVED` | true | `2026-06-11 08:52:52.849+00` | 1 | null |
| timesheet | `fc11c665-a15e-47e4-807b-c01ce6830891` | `RECEIVED` | true | `2026-05-23 13:35:35.929604+00` | 2 | null |
| timesheet | `d488286f-34e1-43bc-9020-2164a6098f45` | `RECEIVED` | true | `2026-06-10 12:21:58.655571+00` | 2 | null |
| manual_queue | `d488286f-34e1-43bc-9020-2164a6098f45` | `ATTACHED` | null | null | null | 2 |
| manual_queue | `9f05fb68-53dc-4688-89bd-5ae01bb37f46` | `ATTACHED` | null | null | null | 1 |
| manual_queue | `fc11c665-a15e-47e4-807b-c01ce6830891` | `ATTACHED` | null | null | null | 2 |

Finding: known rows were not currently locked/hung at diagnostic time. The active row from the browser dump (`d488286f-...`) currently has attached evidence/queue counts, consistent with the snapshot's ATTACHED preview.

## Rejected/failed diagnostics

1. `pg_stat_statements` query failed with `42P01 relation "pg_stat_statements" does not exist` in the diagnostic context.
2. First specific-ID query used `timesheets.id` and failed with `42703 column t.id does not exist`; schema verification showed `timesheets.timesheet_id` is the correct key.
3. Second specific-ID query included `timesheets.contract_week_id` and failed with `42703 column t.contract_week_id does not exist`; corrected query removed that column.

## DB diagnostic conclusion

The database was healthy when diagnostics ran, so the live lock/wait state from the incident was not captured. Diagnostics support these conclusions:

- Relevant functions/tables/indexes exist.
- No active blocking query was present after recovery.
- Slow-statement history was not available through this RPC context.
- Known TEST IDs are present in safe minimal form; the active dump row has attached evidence/queue artifacts.
- The DB-unhealthy incident must be prevented by fast-fail timeouts/backpressure because post-incident diagnostics cannot reliably reconstruct the transient lock/capacity event.

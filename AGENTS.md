# CloudTMS Codex Operating Instructions

## Purpose

These instructions apply to Codex work on CloudTMS. They are mandatory unless the user explicitly overrides a specific instruction in the current task.

## Banking Pay Bible

Before investigating, planning, editing, testing, publishing, installing, or deploying any Banking Pay, Workbench, Draft, payment, recovery, pay-channel resolution, settlement, cancellation, or remittance change, read `BANKING_PAY_BIBLE.md` in full.

Treat that document as the mandatory cross-system behavioural rulebook. A Banking Pay change must preserve every applicable rule in it, add or update an executable regression test for any rule it affects, and update the Bible's change record when verified behaviour or an explicitly approved policy decision changes. Never silently weaken an existing rule to make a new test pass.

CloudTMS currently uses a frontend-primary Codex environment:

* Primary writable repository: `/workspace/TEST-Frontend`
* Backend local clone: `/workspace/cloudtms-backend`
* Backend GitHub repository is read-only from the frontend-primary Codex environment.
* Backend files may be edited locally for patch-worker testing only.
* Backend GitHub changes must be returned as patch/replacement files unless the backend repository is the primary writable repository for the current Codex task.

## CloudTMS TEST-only rule

This environment is TEST-only.

Never use production endpoints, production Supabase, production Cloudflare, production payment providers, production credentials, production Workers, production R2 buckets, production KV namespaces, production webhooks, or production databases.

Never deploy to production.

Never deploy to the normal TEST backend unless the user explicitly instructs that exact action in the current task.

The isolated Codex backend patch Worker is:

```text
https://codex-cloudtms-backend.kier-88a.workers.dev
```

The normal TEST frontend is:

```text
https://testmode.arthur-rai.co.uk
```

The normal TEST backend is:

```text
https://test-cloudtms-backend.kier-88a.workers.dev
```

The isolated Codex Worker must use:

```text
Worker: codex-cloudtms-backend
R2 bucket: test-cloudtms-preview
KV namespace: cloudtms-codex-sessions
KV namespace id: 6f3888a777f844959e35f4b2fb0dce9b
Database: Miget TEST through `codex-cloudtms-miget-gateway` only
Crons: disabled
```

Normal TEST and the isolated patch Worker must not route database traffic to the legacy Supabase TEST project. The logical environment names `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` may remain for compatibility, but their TEST values must target the Miget gateway and matching PostgREST JWT.

For every Miget CloudTMS/MyTMS PostgREST app, append `options=-c%20pg_show_plans.is_enabled%3Doff` to `PGRST_DB_URI`, preserving all other URI components and credentials. Miget currently preloads `pg_show_plans`; leaving it enabled caused repeated `not enough memory to append new query plans` warnings and multi-second complex-RPC latency. Redeploy and prove a new PostgREST session has the collector disabled, the warning flood is absent, and an exact real RPC passes a timing benchmark. After any resource resize, independently verify the live limits plus PostgreSQL memory settings instead of trusting the control-plane allocation alone.

## Permanent Miget auditor connector

The current database authorities listed below are Miget, not the former Supabase projects. They share pooled resource `migetuq4` / `01a02ef7-1977-79bd-ad56-7e86927d5f81` in project `01a02ef7-18d1-7a96-9ea2-63df1bf06adc`, while remaining separate PostgreSQL services with separate credentials:

* Agency TEST PostgreSQL: `cloudtms-codex-poc-pg17` / `01a02f5a-2bee-7db2-910d-a7e71f11ba0a`; PostgREST: `cloudtms-codex-poc-postgrest-kwtyn` / `01a02ff2-4d37-77f8-b440-a20655129ee1`.
* MyTMS control PostgreSQL: `mytms-control-plane-pg17` / `01a03045-5d5a-7892-b555-704ba6edc733`; PostgREST: `mytms-control-plane-postgrest-mwzkq` / `01a0306a-90cd-7bbf-80bc-8fa77c5486f1`.
* Agency LIVE PostgreSQL: `cloudtms-live-pg17` / `01a03205-8273-7159-952e-47029c786995`; PostgREST: `cloudtms-live-postgrest-hurqd` / `01a032ef-3726-771b-85d2-1c6f836745e4`. This identity is for a user-authorised read-only LIVE audit only, never routine TEST work or mutation.

For a new ChatGPT web audit, select the connected **CloudTMS Miget Operations** custom connector. It is a permanent remote Cloudflare Worker/MCP service named `codex-cloudtms-miget-gateway`; it does not require Wrangler or any process on this PC to remain running. Never ask the user to paste its credential into a chat.

Choose exactly one database target for each call:

* `agency_test` for the CloudTMS agency TEST database.
* `mytms_test` for the MyTMS control database.
* `agency_live` only when the user explicitly authorises a LIVE read-only audit.

Use only the connector's fixed read-only tools: `miget_verify_codex_parity_route`, `miget_list_infrastructure`, `miget_inspect_postgres`, `miget_db_catalog_summary`, `miget_db_release_ledger`, `miget_db_security_audit`, `miget_db_performance_summary`, `miget_db_list_rpcs`, and `miget_db_get_rpc_definition`. Do not supply free-form SQL. The release-ledger tool branches safely: `agency_test` reads the private CloudTMS migration/repeatable ledgers, while `mytms_test` reads `public.schema_migrations` and `public.schema_repeatables`.

An independent ChatGPT audit must first read the applicable `AGENTS.md` files from all three named repositories; ordinary ChatGPT web must not assume GitHub access loads them automatically. Before substantive audit work, the same task that will issue the verdict must then see all nine named tools, pass `miget_verify_codex_parity_route`, and inspect every database target placed in scope. If discovery or a just-discovered call fails, retry discovery/parity at most three times in that task, reselecting/reconnecting when available. After three failures, stop early with the exact tool/error evidence and ask the user for a fresh audit chat; do not continue the audit, score an application/database defect, or replace the missing fresh calls with sealed historical evidence.

An auditor must prove the selected PostgreSQL target, catalogue/RLS/grants/function security, installed migration and repeatable ledgers, runtime performance and the exact `pg_get_functiondef` result for relevant RPCs. Do not direct a current audit to either former Supabase project.

## Secrets and sensitive data

Do not print, log, echo, expose, commit, or include in reports:

* Cloudflare tokens
* Supabase keys
* Supabase service-role keys
* DB URLs
* Passwords
* Cookies
* Access tokens
* Refresh tokens
* Auth headers
* `.dev.vars`
* Temporary secret files
* Full sensitive API payloads
* Full user records
* Full payment/banking/provider payloads
* Any credential-like value

When confirming environment variables, report names only and whether they are present. Do not print values.

## Supabase and database safety

Codex must not run destructive Supabase, SQL, RPC, or API actions unless the user explicitly instructs that exact action in the current task.

Destructive actions include, but are not limited to:

* `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `REINDEX`, schema migrations, or any other DDL
* Running migration files
* `DELETE` from application tables
* `UPDATE` or `PATCH` of broad or unbounded row sets
* `INSERT` or `UPSERT` of non-test data
* Any mutation without a specific test identifier
* Payment execution
* Provider submission
* Settlement
* Unwind
* Webhook replay
* Remittance send
* Email drain
* Comms drain
* Background worker/drain RPCs
* Any RPC that schedules payments, sends emails, touches bank/provider state, creates/voids payment batches, settles transfers, or mutates finance artifacts

For diagnostics, prefer read-only actions:

* `SELECT`-only Supabase REST requests
* `GET` requests
* Health/readiness checks
* Playwright observation
* Worker logs
* Reading source code
* Harmless RPCs only where confirmed read-only

If a test requires a write, Codex must stop and state:

1. What it wants to mutate.
2. Why the mutation is necessary.
3. Which exact TEST identifiers/rows are affected.
4. How it will verify the outcome.
5. How it will avoid broad impact.

Do not proceed with the write until the user explicitly approves it in the current task.

## TEST-only diagnostic RPC

The Miget TEST clone has a provider-neutral diagnostic RPC:

```text
public.codex_debug_select_sql(p_sql text, p_limit integer default 100)
```

Codex may use this RPC only for TEST-only read-only diagnostics through the Miget compatibility gateway/PostgREST:

```text
/rest/v1/rpc/codex_debug_select_sql
```

Allowed use:

* Bounded `SELECT` or `WITH` diagnostic queries
* Joins
* Grouping
* JSON inspections
* Consistency checks
* Status summaries
* Verification of specific TEST IDs

Forbidden use:

* Destructive SQL
* DDL
* Migrations
* DML
* Locks
* Transactions
* Payment execution
* Settlement
* Provider submission
* Remittance
* Webhook replay
* Email/comms drains
* Background worker/drain operations
* Returning or printing sensitive row data unless safe and necessary

Do not print service-role keys or full sensitive query results.

## CloudTMS Policy X

For Banking Pay and payment logic, Policy X is mandatory.

* Pre-draft may use live truth.
* Post-draft must use frozen batch artifacts only.
* `TS_DAY` remains date-bucketed as `YYYY-MM-DD`.
* Do not alter finance/payment/economic logic unless explicitly instructed.
* Do not introduce live finance-component identity fallback post-draft.
* Do not invent a new economic-key derivation ladder.
* Do not bypass central freshness/staleness validation.
* Do not change settlement/remittance/provider behaviour unless explicitly instructed.

Any implementation plan, SQL, backend code, frontend code, or test involving Banking Pay must explicitly avoid Policy X drift.

## Repository model

### Frontend-primary Codex environment

In the current full-stack environment:

```text
Primary writable repo: /workspace/TEST-Frontend
Backend local clone: /workspace/cloudtms-backend
```

Codex may:

* Modify frontend files in `/workspace/TEST-Frontend`.
* Read backend files in `/workspace/cloudtms-backend`.
* Locally patch backend files for isolated testing.
* Deploy the locally patched backend clone to the isolated Codex Worker.
* Route Playwright requests from the TEST frontend to the isolated Codex Worker.
* Return backend patches/replacement files in the frontend repo under `codex_outputs/`.

Codex must not:

* Push backend changes from the frontend-primary environment.
* Commit backend changes from the frontend-primary environment.
* Modify backend `wrangler.toml`.
* Deploy the normal TEST backend.
* Deploy production.

### Backend-primary Codex environment

If a future Codex task uses the backend repository as the primary writable repo, backend commits/PRs may be produced only if the user asks for them. All safety rules in this file still apply.

## Backend patch-worker workflow

When testing backend changes from the frontend-primary environment, use the isolated patch-worker workflow.

Do not modify:

```text
/workspace/cloudtms-backend/wrangler.toml
```

Instead, generate a temporary Wrangler config outside the repository:

```text
/tmp/cloudtms-codex-wrangler.toml
```

The temporary config must deploy only:

```text
codex-cloudtms-backend
```

It must point to:

```text
/workspace/cloudtms-backend/broker/src/index.js
```

Use:

```text
R2 bucket: test-cloudtms-preview
KV binding: SESSIONS
KV namespace id: 6f3888a777f844959e35f4b2fb0dce9b
Logical Supabase URL: Miget TEST gateway only
Crons: disabled
```

Use temporary secrets outside the repo:

```text
/tmp/cloudtms-codex-worker-secrets.env
```

The current Wrangler version in Codex rejected `deploy --secrets-file`, so use this proven pattern:

```bash
cd /workspace/cloudtms-backend
npx wrangler deploy --config /tmp/cloudtms-codex-wrangler.toml
npx wrangler secret bulk /tmp/cloudtms-codex-worker-secrets.env --config /tmp/cloudtms-codex-wrangler.toml
```

Delete temporary config and secret files before finishing:

```bash
rm -f /tmp/cloudtms-codex-wrangler.toml
rm -f /tmp/cloudtms-codex-worker-secrets.env
```

After testing, restore backend tracked files unless the user explicitly asks to keep local backend changes:

```bash
cd /workspace/cloudtms-backend
git checkout -- <changed tracked backend files>
```

Confirm:

* Backend `wrangler.toml` was not modified.
* Backend tracked files were restored or intentionally output as patches.
* No deploy was made to normal TEST.
* No deploy was made to production.

## Playwright routing workflow

When testing backend patches against the TEST frontend:

1. Open the normal TEST frontend:

```text
https://testmode.arthur-rai.co.uk
```

2. Install Playwright routing before navigation.

3. Rewrite requests beginning with:

```text
https://test-cloudtms-backend.kier-88a.workers.dev
```

to:

```text
https://codex-cloudtms-backend.kier-88a.workers.dev
```

4. Preserve path, query string, method, headers, and body.

5. Verify:

* Backend requests were intercepted.
* Requests hit the Codex backend Worker.
* No backend requests escaped to the normal TEST backend.
* Login works through the routed Codex backend.
* `/api/me` or equivalent authenticated current-user check works through the routed Codex backend.

Do not print response bodies, cookies, tokens, user records, or sensitive payloads.

## Standard output requirements for backend changes

Because backend GitHub is read-only in the frontend-primary environment, backend changes must be returned under:

```text
codex_outputs/
```

Use this structure where relevant:

```text
codex_outputs/implementation_plan.md
codex_outputs/backend_patch.diff
codex_outputs/backend_replacement_files/
codex_outputs/test_report.md
```

For backend replacement files/functions:

* Include only files/functions that actually changed.
* Do not include unchanged functions.
* Provide full replacement function code for changed functions.
* Do not use placeholders.
* Do not omit code for brevity.
* Provide a diff.
* Provide a detailed implementation plan.
* Explain tests run and results.
* Confirm Policy X compliance where Banking Pay/payment logic is involved.

## Frontend code changes

When modifying the frontend:

* Keep changes narrowly scoped to the user’s request.
* Preserve existing UI date/time format: `DD/MM/YYYY hh:mm:ss`, 24-hour clock.
* Do not alter unrelated modal framework, auth/session handling, Banking Pay, payment, settlement, remittance, webhook, or finance logic unless explicitly asked.
* If a change affects backend interaction, verify via Playwright against the Codex backend route where appropriate.

## Database/schema verification before SQL or code

Before providing SQL, RPC code, or backend code that references database objects, verify all referenced tables, columns, enums, and functions against the current schema/source available in the workspace or user-provided files.

Do not assume schema objects exist.

If schema verification is incomplete, state exactly what could not be verified.

## Forbidden shortcuts

Do not:

* Say a task is complete unless it was actually tested or clearly marked as untested.
* Invent function names, table names, or column names.
* Use old code versions when the user has posted a newer version in the current task.
* Return placeholder code.
* Return partial functions when the user asks for full functions.
* Broaden a highly targeted fix.
* Modify unrelated systems.
* Run `npm audit fix` or dependency upgrades unless explicitly asked.
* Run migrations unless explicitly asked.
* Run payment/remittance/settlement/webhook/email/background drains unless explicitly asked and safe.

## Final report expectations

Every Codex task should return a concise but complete report containing:

* Files changed.
* Backend files changed locally, if any.
* Whether backend changes were restored.
* Whether backend replacement files/diffs were created.
* Tests run.
* Test results.
* Whether the Codex backend Worker was deployed.
* Whether Playwright routed requests to the Codex backend.
* Whether any requests escaped to normal TEST backend.
* Confirmation no TEST/PROD deploy occurred unless explicitly requested.
* Confirmation no destructive SQL or prohibited RPCs were run.
* Confirmation secrets were not printed.

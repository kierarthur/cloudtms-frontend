# CloudTMS Codex Desktop Operating Instructions

## Purpose and scope

These instructions are the durable desktop rules for Codex work in this GitHub workspace. They apply to CloudTMS frontend, backend, database diagnostics, SQL output, Cloudflare Workers, Wrangler Tail, Playwright, and full-stack work.

The user’s explicit instruction in the current task may narrow or approve a normally restricted TEST action. It never implicitly authorises production use, destructive database work, payment execution, or unrelated changes.

## Desktop workspace model

The repositories are local Windows clones:

```text
Workspace root:
C:\Users\KierArthur\OneDrive - Arthur Rai\Documents\GitHub

Frontend repository:
C:\Users\KierArthur\OneDrive - Arthur Rai\Documents\GitHub\TEST-Frontend

Backend repository:
C:\Users\KierArthur\OneDrive - Arthur Rai\Documents\GitHub\cloudtms-backend
```

Desktop Codex works directly on these saved local files. Both repositories are writable when the user asks for changes.

## First-choice GitHub and Cloudflare deployment authentication (normal PC)

Use this section first on the normal `C:\Users\KierArthur\...` desktop. It was proven on 24 August 2026 and replaces repeated GitHub device-code authentication and local Wrangler OAuth for ordinary repository-backed deployments.

### GitHub: SSH is the first choice

- The GitHub account `kierarthur` has the authentication key labelled `CloudTMS Codex – all repositories`.
- The private key is machine-local at `C:\Users\KierArthur\.ssh\cloudtms_codex_ed25519`; never read, print, copy, expose, or commit it.
- `C:\Users\KierArthur\.ssh\config` selects that key for `github.com`, and the user's Git configuration rewrites `https://github.com/` remotes to SSH. Existing and future GitHub repositories therefore use SSH even when an origin was originally recorded as HTTPS.
- Account authentication and non-mutating dry-run pushes were proved for `TEST-Frontend`, `cloudtms-backend`, `mytms-app`, and `availability`. Use ordinary `git fetch`, `git pull`, and `git push`; do not use `gh auth login`, a GitHub device code, or HTTPS credential recovery as the first attempt.
- SSH capability does not grant standing permission to commit, push, merge, deploy, or change LIVE. Continue to require the exact authority stated elsewhere in this file and in the current user request.

### Cloudflare: Git-connected Workers Builds is the first choice for repository-backed deployment

- The Cloudflare Workers and Pages GitHub App is installed for all current and future repositories owned by `kierarthur`.
- When a Worker is connected to a GitHub repository, push the explicitly authorised commit to that Worker's configured deployment branch using GitHub SSH. Let Cloudflare Workers Builds run the configured Wrangler deploy command with Cloudflare's dedicated build token. Do not start with local `wrangler login` for this workflow.
- The normal TEST backend route was proved on 24 August 2026: Worker `test-cloudtms-backend`, repository `kierarthur/cloudtms-backend`, branch `test`, deploy command `npx wrangler deploy --env test`, and Cloudflare-managed build token `test-cloudtms-backend build token`. Cloudflare's deployment history also showed successful Git-triggered builds from branch `test`, proving that the GitHub App and Cloudflare-hosted Wrangler path work together.
- Before relying on this route for another Worker or repository, verify its current Git repository, deployment branch, deploy command, build token selection, and most recent successful deployment. GitHub App access alone does not connect or deploy every repository.
- The Candidate Worker family has an ordered compatibility boundary: deploy the real and synthetic private Workers first and the public Candidate broker last. `test-cloudtms-candidate-broker` was originally left manual to enforce that rollout order; leaving only the broker Git-connected would be unsafe because an ordinary branch push could deploy the public edge before compatible private authority. Its intended connection is repository `kierarthur/cloudtms-backend`, branch `test`, root `/`, no build command, deploy command `npx wrangler deploy --config candidate-broker/wrangler.jsonc`, but enable it only with an equivalent private-Worker connection or one ordered release orchestration. A bounded manual broker deployment remains permitted when the exact private version is already proved compatible and unchanged.
- Use local Wrangler only for operations that Workers Builds cannot perform or when the Git integration is unavailable. The existing task-scoped Wrangler authentication workaround remains the fallback. Never claim local Wrangler is authenticated unless `wrangler whoami` succeeds in the current task.
- The GitHub App's broad repository access is an authentication capability only. It does not authorise a TEST or LIVE deployment, database change, secret change, payment action, or any production operation.

### Cloudflare API connector: first choice for Worker script secrets and direct Cloudflare API work

- The connected ChatGPT/Codex plugin is named `Cloudflare API`. Its ChatGPT app permission is `Allow all actions`; its Cloudflare OAuth grant retains the normal read scopes and additionally includes `Workers Scripts — Write`. This is separate from GitHub SSH and from the Cloudflare Workers and Pages GitHub App.
- The write grant was proved on 25 August 2026 without changing a secret: a deliberately invalid `PUT /accounts/{account_id}/workers/scripts/codex-cloudtms-backend/secrets` reached Cloudflare's authenticated Worker-secret endpoint and returned validation code `10052` (`Binding must have a name`) instead of authentication code `10000`; a subsequent read listed secret names only. No secret value was created, changed, rotated, printed, or deleted during that proof.
- Use the `Cloudflare API` connector as the first choice to list Worker secret names and, only when the current user request explicitly authorises the exact Worker and variable, to create, update or delete a Worker script secret. Never return, log or print a secret value. Use a generated value only when the user has authorised generation; otherwise obtain the value through an approved non-disclosing route.
- A GitHub push or Workers Builds deployment cannot create or update Worker secrets. GitHub repository authentication, Git-triggered deployment, and Cloudflare Worker-secret management are three separate capabilities: GitHub uses the durable SSH key, deployment uses the connected Cloudflare Git build, and secrets use the `Cloudflare API` connector or the authenticated Wrangler fallback.
- OAuth is expected to refresh automatically while the connection remains authorised. If a future write unexpectedly returns Cloudflare authentication code `10000`, inspect the connector before asking the user for a phone/device code: confirm it remains connected, confirm its ChatGPT permission is `Allow all actions`, and reconnect it with the existing read-only selection plus only `Workers Scripts — Write`. Do not select unrestricted Cloudflare `Full access` merely to repair Worker-secret writes.
- Connector capability is not standing mutation authority. It does not permit an unrequested secret change, deployment, TEST mutation, LIVE action, credential rotation, or disclosure of a secret value.

## Temporary holiday-PC profile

The user is temporarily using a different Windows PC from their normal machine. Apply this profile only when the active workspace is under:

```text
C:\Users\felin\OneDrive - Arthur Rai\Documents\GitHub
```

On this temporary PC:

- Keep all machine-specific paths, runtime locations, authenticated-session assumptions, diagnostics, and workarounds isolated to this PC. Do not copy or generalise them to the normal `C:\Users\KierArthur\...` machine.
- Do not change machine-wide configuration, OneDrive or Files On-Demand settings, Windows profiles, environment variables, `PATH`, Git global/system configuration, Codex configuration, credential stores, browser profiles, installed services, or application settings unless the user explicitly requests the exact change for this temporary PC.
- Prefer task-scoped or repository-local configuration when a temporary workaround is explicitly needed, and remove it after the task unless the user asks to retain it.
- Some OneDrive-backed tracked files may appear as unavailable/offline placeholders and return `Access is denied`. Treat that as a temporary-PC availability condition; do not hydrate files or alter OneDrive configuration without explicit approval. For read-only review, committed Git objects may be used as a clearly labelled fallback, but they do not supersede accessible saved disk contents.
- GitHub CLI authentication is stored in this PC's Windows credential keyring for `kierarthur`. On 15 August 2026, `repo` and `workflow` scopes and push access to both CloudTMS repositories were verified; an empty proof commit `c1e74612c7c2285e0753ae3772b15db4ab7e7961` was pushed to `cloudtms-backend/test`. If `gh` is absent from a stale process `PATH`, use `C:\Program Files\GitHub CLI\gh.exe`. This authentication does not provide standing publish permission.
- The repository's saved Wrangler package can be an unavailable OneDrive placeholder. A verified temporary-PC fallback is Wrangler `4.43.0` through the bundled pnpm, with the bundled Node directory prepended to `PATH` for that process only: `C:\Users\felin\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd dlx wrangler@4.43.0 ...`. Existing Cloudflare OAuth and read access to the TEST Worker deployments, Queues, R2, and KV were verified on 15 August 2026. Do not install Wrangler globally or persist a `PATH` change merely to use this fallback.
- Temporary TEST Playwright credentials are stored only in the ignored local file `TEST-Frontend\tests\e2e\.auth\playwright-test.env`; the reusable ignored browser storage state is `TEST-Frontend\tests\e2e\.auth\user.json`. The real normal-TEST login passed on 15 August 2026. Never print, inspect, commit, copy to another PC, or expose either file; load the environment file only into the Playwright child process that needs it.
- Supabase plugin access to the TEST-only `test-cloudtms` project was verified on 15 August 2026. Continue to confirm the exact TEST project before every project-specific call.
- Never treat authentication or configuration proven on this PC as proof about the normal PC, and never document a temporary-PC workaround as a normal-machine requirement.

This profile is a machine boundary only. It does not broaden permission to edit, mutate TEST data, deploy, commit, push, or access production.

Rules:

- Re-read relevant files immediately before editing because the user may edit them concurrently.
- Treat the current saved disk contents as authoritative.
- Preserve all pre-existing user changes and unrelated dirty files.
- Never discard, reset, restore, commit, or overwrite user changes without explicit instruction.
- Do not assume GitHub contains newer changes than the local clone. Pull only when the user asks or when an explicitly requested workflow requires it.
- Local edits are visible to GitHub Desktop immediately after saving.
- Do not commit, push, open a pull request, merge, or deploy unless the user explicitly requests that action.
- Backend changes no longer need to be returned as replacement files merely because the backend was read-only in Codex Cloud. On desktop, edit the backend clone directly when backend changes are requested.
- Do not restore backend tracked files after testing unless the edits were explicitly temporary or the user requests restoration.

## TEST-only hard rule

This workspace is TEST-only by default.

Never use production endpoints, production Supabase, production Cloudflare resources, production Workers, production R2 buckets, production KV namespaces, production credentials, production payment providers, production webhooks, or production databases.

Never deploy production.

Never deploy the normal TEST backend unless the user explicitly instructs that exact deployment in the current task.

Never mutate TEST data merely because a diagnostic or browser test would benefit from it. Mutation requires explicit approval in the current task and must be narrowly scoped.

Known TEST endpoints:

```text
TEST frontend:
https://testmode.arthur-rai.co.uk

Normal TEST backend:
https://test-cloudtms-backend.kier-88a.workers.dev

Isolated Codex patch Worker:
https://codex-cloudtms-backend.kier-88a.workers.dev
```

Known Worker names:

```text
Normal TEST Worker: test-cloudtms-backend
Isolated patch Worker: codex-cloudtms-backend
```

## Current Miget TEST database authority

As of 24 August 2026, normal CloudTMS TEST database traffic is routed to Miget. The old Supabase `test-cloudtms` project is a legacy read-only comparison source only; do not route a Worker, frontend, workflow, or new test to it, and never mutate it unless the user explicitly changes this authority.

Current TEST path:

```text
TEST frontend
  -> test-cloudtms-backend
  -> codex-cloudtms-miget-gateway
  -> cloudtms-codex-poc-postgrest-kwtyn
  -> cloudtms-codex-poc-pg17 / cloudtms_test_clone
```

Current MyTMS control-plane path:

```text
CloudTMS/MyTMS Workers
  -> cloudtms-mytms-miget-gateway
  -> mytms-control-plane-postgrest
  -> mytms-control-plane-pg17
```

Google transport configuration and MyTMS Google-control activation are separate authorities. A working signed Rota/Daily Google-to-broker route proves transport only. Candidate provisioning and target switching also require two distinct service-registered project identities (Master and Availability), one exact disabled target pair, a current signed heartbeat from each installed Apps Script project, the exact agency's `provisioning_enabled` setting and an explicit service-only pair transition to READY/ACTIVE. Before diagnosing `CONTROL_PLANE_AUTH_FAILED` as a key failure, inspect those Miget control rows and gates; never rotate or duplicate an already-proved transport secret by guesswork. The complete property-name inventory, registration/target/heartbeat sequence, TEST-to-LIVE differences, security negatives and rollback are controlled by `mytms-app/docs/MYTMS_NEW_AGENCY_ONBOARDING_MANUAL.md` and `mytms-app/google-apps-script/INSTALLATION_RUNBOOK.md`. A parity audit or LIVE-upgrade plan must read and reconcile that section without printing any secret values.

The existing logical configuration names `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` may remain in code to avoid a business-logic rewrite, but for TEST their values must be the Miget compatibility gateway and the matching Miget/PostgREST JWT. A variable name is not evidence of Supabase routing; verify the effective hostname without printing the secret value.

Miget/PostgREST performance rules discovered during the TEST migration:

- Miget currently preloads `pg_show_plans` and the cloned TEST database had `pg_show_plans.is_enabled=on`. With complex CloudTMS RPCs, the extension emitted repeated `not enough memory to append new query plans` warnings and added seconds of latency even though CPU and RAM utilisation were low.
- Every CloudTMS PostgREST app on this Miget resource must disable that collector for its database sessions by adding the libpq URI option `options=-c%20pg_show_plans.is_enabled%3Doff` to `PGRST_DB_URI`. Preserve every other URI component and secret exactly; this is not permission to rotate credentials.
- After applying the option, redeploy the PostgREST app, prove the app/deployment is healthy, verify a new PostgREST session has the collector disabled, confirm the warning flood is absent, and benchmark an exact real RPC. Do this for MyTMS and every future agency PostgREST app.
- After any Miget resource/database resize, verify both live service limits and PostgreSQL's regenerated profile. For the current 4 GiB agency database profile the expected values are `shared_buffers=1GB`, `effective_cache_size=3GB`, `maintenance_work_mem=256MB`, and `max_connections=97`; do not trust the control-plane allocation alone.
- A restored Supabase dump can retain `postgres` as the repository/logical owner even though Miget provisions a generated service owner. Release tooling must map only that audited logical owner to `CURRENT_USER`; it must never assume it can `SET ROLE postgres`. Reapply and verify the repository's audited owner default privileges after restore because `pg_dump`/`pg_restore` do not reliably recreate provider-owner defaults for the new Miget owner. The release must fail closed for every unexpected owner or grantee, and PostgREST browser-role exposure must be rechecked after the final repeatable definitions are installed.
- The compatibility gateway is not the cause of the original regression: measured overhead was approximately 0-20 ms. Keep the gateway for `/rest/v1` and JWT compatibility unless a new measurement proves it material.
- A real browser modal, exact Worker route, and exact PostgREST RPC must be timed separately. Do not infer whole-application performance from a database-only benchmark.
- Independent read-only PostgREST requests may be run concurrently only after proving there is no data dependency and preserving all existing error semantics. Never apply broad concurrency changes to payment, settlement, provider, or other mutation paths.

Store Miget API and database credentials only in approved machine-local environment variables or ignored secret files. Never commit or print them. Separate agency databases, PostgREST JWTs, and Worker secrets must remain isolated even though the services share the purchased Miget compute pool.

### Permanent Miget read-only auditor route

Current nonsecret TEST identities (verify them again before relying on them):

- Miget project `My Project`: `01a02ef7-18d1-7a96-9ea2-63df1bf06adc`.
- Shared Miget Hobby Tier 6 resource `migetuq4`: `01a02ef7-1977-79bd-ad56-7e86927d5f81` (4 pooled CPU, 8 GiB RAM, 160 GiB storage).
- Agency TEST PostgreSQL `cloudtms-codex-poc-pg17` / `postgres-service-p0qoe`: `01a02f5a-2bee-7db2-910d-a7e71f11ba0a`; database `cloudtms_test_clone`.
- Agency PostgREST `cloudtms-codex-poc-postgrest-kwtyn`: `01a02ff2-4d37-77f8-b440-a20655129ee1`, image `postgrest/postgrest:v14.17`, public origin `https://cloudtms-codex-poc-postgrest-kwtyn.eu-east-1.migetapp.com`.
- MyTMS PostgreSQL `mytms-control-plane-pg17` / `postgres-service-kpqwi`: `01a03045-5d5a-7892-b555-704ba6edc733`; database `uofvkfi5`.
- MyTMS PostgREST `mytms-control-plane-postgrest-mwzkq`: `01a0306a-90cd-7bbf-80bc-8fa77c5486f1`, public origin `https://mytms-control-plane-postgrest-mwzkq.eu-east-1.migetapp.com`.
- Permanent Cloudflare read-only MCP plus agency `/rest/v1` gateway: `codex-cloudtms-miget-gateway` at `https://codex-cloudtms-miget-gateway.kier-88a.workers.dev`; Hyperdrive IDs `11c78f14afea494c9d5e8d8ad57d41a2` (agency) and `7e979a8127c84c319dfc2ecf488aa903` (MyTMS). The MyTMS application compatibility gateway remains `cloudtms-mytms-miget-gateway`.

A brand-new ChatGPT web auditor needs no local token file. Select the connected custom connector **CloudTMS Miget Operations**, then call these fixed read-only tools:

1. `miget_verify_codex_parity_route` and `miget_list_infrastructure`.
2. `miget_inspect_postgres` for `agency_test` and `mytms_test`.
3. `miget_db_catalog_summary`, `miget_db_release_ledger`, `miget_db_security_audit`, and `miget_db_performance_summary` for both database targets.
4. `miget_db_list_rpcs` to search/list functions and `miget_db_get_rpc_definition` to retrieve exact `pg_get_functiondef` source. Use `agency_test` for CloudTMS TEST and `mytms_test` for the MyTMS control plane.

Anonymous MCP access must return `401`. The connector must return `authenticated=true`, `read_only=true`, and no credentials. It accepts no caller-supplied SQL. For repository-to-database drift, compare its returned RPC definitions and ledger hashes with the exact GitHub commit under audit. Do not query either former Supabase project for current runtime truth.

An independent ChatGPT audit prompt must tell the auditor to read the applicable root and repository `AGENTS.md` files before any evidence or tool work. Codex loads applicable instructions automatically in this workspace, but an ordinary ChatGPT web task must not assume that merely having GitHub access causes those files to be read.

Before substantive audit work, perform a connector-session preflight in the same fresh ChatGPT task that will issue the verdict: confirm that all nine tool names above are visible, call `miget_verify_codex_parity_route`, and prove both `agency_test` and `mytms_test` with `miget_inspect_postgres`. If fewer than nine tools are visible, the namespace disappears, or a discovered tool returns `RESOURCE_NOT_FOUND`, do not give up after one call. Perform at most three bounded attempts in the same task, re-running connector discovery and the parity call each time and reselecting/reconnecting the connector between attempts when the interface permits. If all three attempts fail, stop the audit early, return the exact discovered-tool list and error for each attempt, classify it as a connector-session capability failure rather than a database/application verdict, and ask the user to start a fresh audit chat. Do not continue a long audit that cannot inspect the current databases, and do not substitute sealed historical evidence for the missing fresh calls.

Codex database releases use the repository-controlled routes, never an ordinary push-time mutation. Agency TEST uses `cloudtms-backend/.github/workflows/database-release.yml`, `scripts/cloudtms-db-release.mjs`, `npm run db:check`, `npm run db:plan`, `npm run db:apply`, `npm run db:contract:export`, and `npm run db:contract:verify`. MyTMS uses the Miget-only contents of `mytms-app/.github/workflows/supabase-migrate.yml` (legacy filename), its `public.schema_migrations` and `public.schema_repeatables` ledgers, and every SQL file in `supabase/verification`. The protected GitHub secrets are `MIGET_DATABASE_URL_TEST` (environment `database-test`) and `MYTMS_MIGET_DATABASE_URL`; never print or download them.

### Permanent Miget browser database administration

The credential-protected browser database tool is pgAdmin 4 at `https://cloudtms-database-browser-gimgy.eu-east-1.migetapp.com/browser/`, Miget app `cloudtms-database-browser` / `01a0339e-8a1b-76db-9d69-142c2a15e0ad`. It is intentionally limited to 512 MiB RAM and 0.1 pooled CPU; those are admission limits, not dedicated reservations, and no PostgreSQL resource may be resized merely to fund the viewer. The pgAdmin username is `pgadmin@arthur-rai.co.uk`. Its generated password is stored only in the ignored local file `cloudtms-backend/.codex-tmp/pgadmin-login.secret`; never print, commit, copy into documentation or save it in a browser without the user's immediate confirmation.

The viewer pre-registers `CloudTMS TEST (Miget)`, `MyTMS control plane (Miget)` and `CloudTMS LIVE (Miget)` from declarative server JSON. Database passwords are provided inside the protected viewer container through `PasswordExecCommand`, not embedded in the JSON. Future Codex work must preserve `PGADMIN_CONFIG_ENABLE_SERVER_PASS_EXEC_CMD=True`, `PGADMIN_SERVER_JSON_FILE=/opt/cloudbeaver/workspace/pgadmin-bootstrap/servers.json`, and `PGADMIN_REPLACE_SERVERS_ON_STARTUP=True`. After any viewer restart or configuration change, prove all three server entries exist and run a harmless read-only query such as `select current_database(), current_user;` before declaring it working.

### Repository-controlled secondary Worker deployments

Normal TEST remains connected to `cloudtms-backend:test`, LIVE remains connected to `cloudtms-backend:main`, and `arthur-rai-broker` remains connected to `timesheets:main`. Secondary Workers use dedicated `deploy/cloudflare/<worker>` branches so a routine source push cannot redeploy every Worker simultaneously. The prepared branches are `test-candidate-private-api`, `test-candidate-synthetic-private-api`, `test-candidate-broker`, `test-invoice-document-processor`, `test-invoice-queue-dispatcher`, `cloudtms-live-miget-gateway`, `cloudtms-mytms-miget-gateway`, `codex-cloudtms-miget-gateway`, `cloudtms-local`, `codex-cloudtms-backend`, and, in `mytms-app`, `mytms-manager-review-test`.

For `test-cloudtms-candidate-synthetic-private-api`, the repository configuration is `candidate-synthetic-private-api/wrangler.jsonc`. The Git build must use `npx wrangler deploy --dry-run --config candidate-synthetic-private-api/wrangler.jsonc` and deploy with `npx wrangler deploy --config candidate-synthetic-private-api/wrangler.jsonc --keep-vars`. The historical path `candidate-private-api/wrangler.synthetic.jsonc` does not exist and must never be restored to a Cloudflare build trigger. Before moving the public broker branch, verify that the latest synthetic build used the correct path and succeeded; if its saved Cloudflare build command is stale, stop before the broker, correct the build configuration or use the authenticated local Wrangler fallback for the exact synthetic Worker, then prove the active deployment/version at 100%.

Operational TEST feature flags and browser database isolation are different controls. A verifier may require invitation, Candidate app, Rota or other explicitly authorised TEST features to be boolean-typed and internally consistent; it must not re-impose an obsolete bootstrap-only requirement that all flags or all tables are empty/disabled. Browser isolation remains mandatory: `anon` and `authenticated` browser roles receive no direct Miget table access and no execution of service-only functions, while the app and website continue to use the public broker/private Worker route.

A Git branch is not proof that Cloudflare Workers Builds is connected. Before relying on a secondary route, verify the Worker's build trigger reports the exact repository, dedicated branch, root directory, deploy command and managed build-token identity. Preserve deployment ordering for the Candidate path: normal backend, private Worker, synthetic private Worker, then public broker last. A GitHub App installation or successful Git push does not by itself authorise or perform a Worker deployment.

### Safe UPGRADE and NEW-database requests

Treat `CLOUDTMS PLAN UPGRADE <exact target>` and `CLOUDTMS PLAN NEW DATABASE <agency>` as the canonical requests for the Miget installation/release system. Both are read-only planning requests: inspect the exact target, report the precise pending migrations and new/changed repeatables plus required PostgREST, gateway, Worker and configuration work, and stop before mutation. A vague request containing “upgrade”, “new database”, “prepare”, or “what is missing” never authorises APPLY, provisioning, deployment, paid-resource creation, secret changes, feature activation or resource reallocation.

Current LIVE's first deliberate schema promotion uses `LEGACY_UPGRADE`; moving its hosting to Miget did not perform that upgrade. A managed database uses `UPGRADE`, and a proved-blank database uses `NEW`. The owner has granted standing authority for managed Miget TEST `UPGRADE` releases: do not stop to request another APPLY phrase. Dispatch the protected workflow against the exact current `test` branch head; it must source-gate that commit, run its read-only plan before mutation, generate the exact commit-bound engine approval internally, apply only pending migrations and new/changed repeatable closures, and complete every security/contract verifier. This standing authority never covers LIVE, NEW, ADOPT, LEGACY_UPGRADE, destructive SQL, payment/provider actions, secret changes, or unrelated application-data mutations; those retain their separate exact authority. Never extend an APPLY to another database or operational stage by inference.

## Secrets and sensitive data

Never print, echo, log, commit, paste into reports, or include in tool output:

- passwords;
- Cloudflare API tokens;
- Supabase service-role or anonymous keys;
- database URLs or passwords;
- cookies, access tokens, refresh tokens, session data, or auth headers;
- `.env`, `.env.*.local`, `.dev.vars`, temporary secret files, or Playwright storage-state contents;
- complete user, payment, banking, provider, or other sensitive payloads.

When checking configuration, report variable names and presence only. Do not report values. Avoid reporting secret lengths unless genuinely necessary for diagnosis.

Use existing authenticated tools where available. Local Wrangler is authenticated with Cloudflare OAuth; do not require or expose a Cloudflare API token when OAuth is sufficient.

Machine-local environment variables and ignored local secret files may be used by commands without displaying their values.

## Database and Supabase safety

Do not run destructive or mutating SQL, migrations, DDL, DML, or state-changing RPCs unless the user explicitly approves the exact action in the current task.

Forbidden by default:

- `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `REINDEX`, locks, transactions, or migrations;
- `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, or broad/unbounded mutations;
- payment execution, provider submission, settlement, unwind, remittance, webhook replay, email/comms drains, or background worker/drain operations;
- any RPC that schedules payments, sends communications, touches banking/provider state, settles transfers, or creates/voids financial artifacts.

Preferred diagnostics:

- source inspection;
- bounded GET requests;
- health/readiness/version checks;
- Playwright observation without mutation;
- Worker logs;
- bounded TEST-only SELECT/WITH database diagnostics.

PostgreSQL UUID aggregate rule:

- PostgreSQL does not provide built-in `min(uuid)` or `max(uuid)` aggregates. Never call `min()` or `max()` directly on a UUID expression.
- Where a deterministic UUID representative is genuinely required after an exact single-value/cardinality proof, aggregate the text form and cast back explicitly, for example `min(uuid_column::text)::uuid`.
- Add or retain an executable regression check for any payment, trigger, or runtime route that depends on this pattern; successful `CREATE FUNCTION` compilation alone is not runtime proof for PL/pgSQL statements.

PostgreSQL conditional-expression qualification rule:

- `COALESCE`, `NULLIF`, `LEAST`, and `GREATEST` are PostgreSQL syntax constructs, not schema-qualified `pg_catalog` functions. Never write `pg_catalog.coalesce(...)`, `pg_catalog.nullif(...)`, `pg_catalog.least(...)`, or `pg_catalog.greatest(...)` in SQL or PL/pgSQL. PostgreSQL can accept the routine definition and then fail with SQLSTATE `42883` only when the statement first executes.
- Every changed routine using these constructs must have a source guard that rejects all four illegal prefixes and a rollback-contained real first-use call against the complete pending installed-state sequence. Successful `CREATE FUNCTION`, static tests, ledger hashes, or a green release without the first-use call are not sufficient runtime proof.

## SQL file naming and placement

Every new SQL file must use the filename format `DDMMYYYY_HHMM_name.sql`; the filename must always begin with the date and 24-hour time in that exact order. Use the current UK date and time, and use a short descriptive `snake_case` name.

- Save one-time database migrations in `cloudtms-backend\supabase\migrations`.
- Save new or replacement SQL function definitions in `cloudtms-backend\supabase\repeatable`.
- Do not save SQL functions as one-time migrations unless a separately required schema/data migration calls or installs them as part of an explicitly approved change.
- Never rename an already-applied migration merely to adopt this convention unless the user explicitly requests it and the migration history has been checked safe.

## Legacy Supabase plugin

The Supabase plugin remains installed and can access the legacy `test-cloudtms` project. Use it only for explicitly authorised read-only historical comparison or migration verification; it is not the current TEST runtime authority.

Rules:

- Prefer direct Miget PostgreSQL/PostgREST for current TEST inspection. Use the Supabase plugin only when the legacy source itself must be compared.
- Treat plugin access as a diagnostic capability, not permission to mutate data or configuration.
- All existing TEST-only, secrets, database safety, mutation approval, and production prohibitions still apply to plugin calls.
- Confirm the target project is `test-cloudtms` before every project-specific plugin operation. Never use another visible Supabase project unless the user explicitly puts that project in scope.
- Do not expose project credentials, keys, tokens, connection strings, user records, or sensitive query results returned by plugin tools.
- Keep `public.codex_debug_select_sql` as a fallback for bounded read-only diagnostics when the plugin is unavailable or does not cover the required access path.
- Installing or connecting the plugin does not itself configure application Auth, protected routes, RLS, grants, or policies.

If a write appears necessary, stop and report:

1. The exact mutation proposed.
2. Why it is necessary.
3. The exact TEST identifiers or rows affected.
4. How the outcome will be verified.
5. How broad impact will be prevented and how rollback will work.

Do not proceed until the user explicitly approves that mutation in the current task.

## TEST diagnostic RPC

The current Miget TEST clone provides this provider-neutral diagnostic RPC (the legacy Supabase source may also retain a copy):

```text
public.codex_debug_select_sql(p_sql text, p_limit integer default 100)
```

REST endpoint:

```text
/rest/v1/rpc/codex_debug_select_sql
```

Use only for bounded read-only `SELECT` or `WITH` diagnostics. Schema-check all referenced tables, columns, enums, and functions before relying on them.

DB diagnostic preflight:

1. Confirm required environment-variable names are present without printing values.
2. Run a harmless bounded smoke query such as `select now() as now_utc`.
3. Confirm the RPC succeeded.
4. Inspect `information_schema` or `pg_catalog` for every target object.
5. Run the bounded target baseline query.
6. If DB truth is required before an approved mutation and any preflight step fails, stop before mutation.

Prefer `curl.exe -4` for this RPC when direct Node networking is unreliable. Temporary request and response files must stay under `C:\tmp` and must not be committed. Never print keys or authorization headers.

## CloudTMS Policy X

Policy X is mandatory for Banking Pay and payment logic:

- Pre-draft may use live truth.
- Post-draft must use frozen batch artifacts only.
- `TS_DAY` remains date-bucketed as `YYYY-MM-DD`.
- Do not introduce live finance-component identity fallback post-draft.
- Do not invent a new economic-key derivation ladder.
- Do not bypass central freshness or staleness validation.
- Do not change payment, settlement, remittance, provider, or economic behaviour unless explicitly requested.

Every plan, implementation, SQL proposal, and test touching Banking Pay must explicitly prevent Policy X drift.

## Frontend work

- Make the smallest change that satisfies the request.
- Preserve existing UI date/time format: `DD/MM/YYYY hh:mm:ss`, 24-hour clock.
- Do not alter unrelated modal infrastructure, authentication/session handling, Banking Pay, payment, settlement, remittance, webhook, or finance logic.
- Inspect backend route contracts when frontend behaviour depends on them. Do not invent response fields.
- If a user declares a component or workflow frozen, do not edit its functions, shared dependencies, selectors, or tests. Establish an explicit isolation boundary before changing adjacent code.

### Patched-asset verification

A frontend patch is not browser-verified merely because:

- `node --check` passes;
- Playwright reproduces the old behaviour on the deployed TEST site;
- Playwright opens TEST while TEST still serves the old deployed frontend asset.

Post-change browser verification must prove that the browser loaded the patched frontend code by one of:

1. Playwright route interception serving the local patched asset.
2. A local frontend server serving the local repository.
3. An explicitly approved preview or TEST deployment containing the patch.

For route interception:

- register routing before navigation;
- block or bypass service workers/cache where appropriate;
- serve the actual saved local asset from the frontend repository;
- record the intercepted URL or another harmless proof that the patched asset loaded;
- do not print cookies, tokens, user records, or sensitive response bodies.

### Proven Windows Chromium route-interception method

On this desktop, prefer Playwright request interception for local frontend patch verification before trying a local URL or Quick Tunnel. This method was proven successful on 18 July 2026 and is a high-quality browser verification path, not a reduced substitute: Chromium runs the real application on the normal TEST origin and normal TEST backend while only the explicitly patched frontend assets are replaced with the saved local files.

Use this sequence:

1. Run Playwright from `TEST-Frontend` using its installed Chromium and machine-local `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`; check only that the variable names are present and never print their values.
2. Create a fresh browser context with service workers blocked and the required desktop or narrow viewport.
3. Register the route for `https://testmode.arthur-rai.co.uk/**` before navigation.
4. Fulfil only `/` or `/index.html` from the saved local `TEST-Frontend\index.html`, and `/js/main.js` from the saved local `TEST-Frontend\js\main.js`. Continue every other request normally.
5. The intercepted HTML may receive a harmless runtime-only marker plus `BROKER_BASE_URL` fixed to `https://test-cloudtms-backend.kier-88a.workers.dev`; do not alter the saved repository file merely to add this proof marker.
6. Navigate to the normal TEST frontend, log in through the visible TEST login form, and verify all of: TEST origin, TEST backend value, runtime marker, one-or-more interceptions for both saved assets, and SHA-256 hashes matching the current saved files.
7. Run the functional and visual assertions, save only explicitly requested screenshots, and close the temporary browser context. Do not save or print storage state, cookies, tokens, credentials, sensitive response bodies, or user records.

Known desktop symptoms and routing decision:

- Controlled in-app Browser and Chrome may reject `localhost`, `127.0.0.1`, private LAN addresses, and anonymous `*.trycloudflare.com` previews with `ERR_BLOCKED_BY_CLIENT` before application code runs.
- Standalone Chromium may route a loopback URL through a machine security proxy and receive HTTP 403 without the preview proof header, even when the local server is healthy.
- These symptoms are browser/address restrictions, not evidence of a CloudTMS frontend, backend, database, or login failure. Use the proven normal-TEST-origin route-interception method instead of repeatedly retrying blocked addresses.

If patched-asset verification cannot be completed, say clearly that the patch was not verified in the browser.

### Standing authority for short-lived frontend preview tunnels

The user has granted standing permission for Codex to use a short-lived Cloudflare Quick Tunnel when browser security prevents direct access to a local patched frontend preview. Codex does not need to ask again for this narrow TEST verification action.

Rules:

- The tunnel may expose only a local frontend preview serving the saved local repository for browser verification.
- Application traffic must route only to the normal TEST backend, or to a freshly proven isolated patch Worker when that separate workflow has been explicitly authorised. It must never route to production.
- Prefer the installed Wrangler `tunnel quick-start` capability. If unavailable, a temporary `cloudflared` binary may be downloaded and run only from `C:\tmp`; do not install a service or create a named/persistent tunnel.
- Use the anonymous random Quick Tunnel hostname only for the current automated browser test. Do not publish, share, retain, or commit the hostname.
- Do not place credentials, tokens, cookies, session state, or secrets in tunnel commands, configuration, output, screenshots, or reports.
- Stop the tunnel and local preview immediately after testing, and remove temporary binaries, configs, logs, and helper files when no longer needed.
- Record harmless proof that the browser loaded the saved patched asset and that requests stayed within TEST.
- This standing authority does not permit a Worker or Pages deployment, DNS changes, production access, database mutation, payment actions, a persistent tunnel, or any other external-state change.

## Playwright on desktop

Run Playwright from:

```text
C:\Users\KierArthur\OneDrive - Arthur Rai\Documents\GitHub\TEST-Frontend
```

The desktop installation and Chromium browser cache persist across Codex sessions. Playwright credentials come from machine-local environment variables or ignored local files. Never read or print their values.

Use normal TEST backend directly when investigating behaviour already deployed to TEST. Do not route to the isolated Codex Worker unless testing a local backend patch that has been freshly deployed and proven current in the same task.

Before any mutation-capable browser test:

- identify the precise action;
- obtain explicit approval if the action writes state;
- start required diagnostics/tail before the action;
- scope the action to explicit TEST identifiers;
- verify the final state without exposing sensitive data.

## Backend work

- Work directly in the local backend clone when backend changes are requested.
- Read `cloudtms-backend\AGENTS.md` before backend work; the nearest applicable instructions take precedence where they are stricter.
- Do not modify `wrangler.toml` unless the user explicitly requests that configuration change.
- Verify current functions and database objects before editing.
- Preserve unrelated user changes.
- Run focused checks proportional to the risk.
- Do not commit or push unless explicitly requested.

Large backend functions do not need to be pasted into chat. Prefer direct local edits plus a concise diff/report. Create replacement-function artifacts only when the user explicitly needs handoff files.

## Cloudflare Worker deployment

Deployment is an external state change and always requires explicit instruction in the current task.

### Proven normal-PC Wrangler authentication and OneDrive build workaround

On the normal `C:\Users\KierArthur\...` desktop, a restricted Codex process may be unable to use the Windows user's Wrangler keyring login even though the user is signed in. The following task-scoped method was proven through an authenticated `whoami`, three successful dry builds, three TEST Worker deployments, 100% traffic verification, and live health/readiness checks on 18 August 2026:

1. Create an ignored task directory inside the exact backend worktree and set it as Wrangler's XDG configuration root for every related command.
2. Run `npx wrangler login --no-use-keyring` once with that same `XDG_CONFIG_HOME`. Never print or inspect the resulting credential file.
3. Set `WRANGLER_LOG_PATH` to a writable ignored file inside the worktree so Wrangler does not try to write under the restricted user-profile log directory.
4. If Wrangler/esbuild reports `Cannot read directory` or cannot resolve the entry file from the OneDrive path, validate an unused temporary drive letter, map it to the exact worktree with `subst`, run Wrangler from the mapped root, and remove the mapping in a `finally` block. This is a short-lived process workaround only; do not persist the mapping or change OneDrive settings.

Example shape (replace the task slug and verify the target/config before use):

```powershell
$worktree = 'C:\Users\KierArthur\OneDrive - Arthur Rai\Documents\GitHub\cloudtms-backend'
$env:XDG_CONFIG_HOME = Join-Path $worktree '.codex-tmp\wrangler-config-<task-slug>'
$env:WRANGLER_LOG_PATH = Join-Path $worktree '.codex-tmp\wrangler-<task-slug>.log'

npx wrangler login --no-use-keyring
npx wrangler whoami

if (Get-PSDrive -Name Z -ErrorAction SilentlyContinue) {
  throw 'Temporary drive Z is already in use'
}
subst Z: $worktree
try {
  Set-Location 'Z:\'
  npx wrangler deploy --env test --dry-run
  if ($LASTEXITCODE -ne 0) { throw 'Wrangler dry build failed' }
} finally {
  Set-Location $worktree
  subst Z: /d
}
```

This proven workaround does not provide standing deployment authority. Remove only the exact task-scoped Wrangler configuration/log files after all authorised deployment and evidence work is complete, after validating their resolved paths remain inside the intended worktree.

Rules:

- Never deploy production.
- Never deploy the normal TEST Worker unless explicitly instructed to deploy that exact Worker/environment.
- Do not infer deploy permission from permission to edit or test code.
- When a task includes an authorised Worker deployment, run the repository's installed Wrangler `whoami` preflight near the start of the task, using a writable task-scoped log/config location where the desktop profile is restricted. Confirm the intended Cloudflare account and required Worker/queue access before implementation reaches the deployment gate. Do not rely on an earlier chat's login or wait until after committing to discover that Wrangler OAuth has expired.
- For local backend patches requiring deployed verification, use only the isolated `codex-cloudtms-backend` Worker unless the user explicitly directs otherwise.
- Treat the isolated Worker as stale until the intended local backend source is deployed and proven current in the current task.
- Local source inspection is not runtime proof.
- Record the local backend Git HEAD or equivalent source identity, deploy result, and harmless runtime marker/smoke proof.
- Use Miget TEST only, isolated TEST R2/KV resources, and disabled crons for the patch Worker.
- Keep temporary Wrangler configs and secret files outside the repositories under `C:\tmp`.
- Delete temporary secret/config files after use.
- Never print their contents.

Isolated patch resources:

```text
Worker: codex-cloudtms-backend
R2 bucket: test-cloudtms-preview
KV namespace: cloudtms-codex-sessions
KV namespace id: 6f3888a777f844959e35f4b2fb0dce9b
Database: Miget TEST only
Crons: disabled
```

Mandatory stop conditions:

- If a task intends to test normal TEST but traffic is routed to the isolated Worker, stop before mutation.
- If a task intends to test the isolated Worker but it was not freshly deployed/proven current in the task, stop before mutation.
- If runtime response markers expected from the patch are missing, stop and report stale/wrong-runtime risk.

## Wrangler Tail on Windows desktop

Wrangler Tail is live-only. It does not retrieve historical events.

Run from:

```text
C:\Users\KierArthur\OneDrive - Arthur Rai\Documents\GitHub\cloudtms-backend
```

Use the backend repository’s installed Wrangler:

```powershell
npx wrangler tail <worker-name> --format json
```

Rules:

- Start tail before triggering the UI/API action.
- For normal TEST, tail `test-cloudtms-backend` only when the user has put normal TEST in scope.
- For the isolated patch Worker, tail `codex-cloudtms-backend` only after runtime freshness is established when relevant.
- Do not use `--search` until baseline events are proven.
- Capture only what is needed and redact identifiers/payloads.
- Invocation events with no application console entries still prove tail connectivity.
- Do not commit raw tail logs.
- Temporary captures belong under `C:\tmp`.
- Stop the tail when the required evidence has been captured.
- Tailing does not authorise deployment or mutation.

If tail fails, check Wrangler version, `wrangler whoami`, target Worker, command directory, OAuth/token permission, syntax, network access, timing, filters, and whether traffic occurred while the stream was open. Do not guess.

## Runtime selection

Use this decision rule:

1. Investigating code already deployed to normal TEST:
   - use normal TEST backend directly;
   - do not route to the isolated Worker;
   - tail `test-cloudtms-backend` if live logs are required.

2. Testing a local backend patch not installed on normal TEST:
   - explicitly deploy to `codex-cloudtms-backend` only after permission;
   - prove runtime freshness;
   - then route TEST frontend calls to the isolated Worker;
   - verify no requests escaped to normal TEST.

3. Testing local frontend plus local backend patches:
   - prove the patched frontend asset loaded;
   - deploy/prove the isolated backend only when explicitly approved;
   - route backend traffic only after runtime proof;
   - verify both frontend and backend sources actually exercised.

## Git and GitHub Desktop

- Local saved edits are immediately visible in GitHub Desktop.
- GitHub CLI is installed on this Windows machine and authenticated to GitHub as `kierarthur` through the Windows credential keyring. Codex can therefore perform explicitly requested repository publishing without the user operating GitHub Desktop or being physically present at the PC.
- Prefer `gh` for GitHub authentication, repository inspection, pull requests, checks, and merges. If an already-running Codex process has a stale `PATH` and does not recognise `gh`, invoke `C:\Program Files\GitHub CLI\gh.exe` directly; a Codex Desktop restart should refresh the normal command path.
- Before a publish operation, verify `gh auth status` and the target repository identity. Never display the authentication token, use `--show-token`, or ask the user to paste a token into chat. If keyring authentication has expired, ask the user to run `gh auth login --hostname github.com --git-protocol https --web` again.
- Treat required OAuth scopes as part of the GitHub publish preflight. In particular, if the intended commit adds or changes anything under `.github/workflows/`, require `gh auth status` to show the `workflow` scope before creating the final publish commit or attempting a push; obtain that scope once with `gh auth refresh --hostname github.com --scopes workflow` when missing. A token with `repo` access alone will be rejected after all other work is ready.
- In a restricted desktop session, the normal GitHub CLI profile directory or user-level `.gitconfig` may be readable but not writable. If `gh auth status` is invalid or login reports access denied while saving configuration, set `GH_CONFIG_DIR` to a task-scoped ignored directory inside the repository (for example `.codex-tmp/gh-config`) **before** starting `gh auth login`. Keep the login process alive until the device/browser flow reports completion, verify `gh auth status` with the same `GH_CONFIG_DIR`, and remove the temporary configuration after the authorised publish. Never print its `hosts.yml` or token.
- On the normal `C:\Users\KierArthur\...` desktop, the task-scoped fallback was proven on 18 August 2026 when the Windows Credential Manager token was unavailable to the restricted process: set a unique `GH_CONFIG_DIR`, run `gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow --insecure-storage`, then verify the exact `kierarthur` identity, `repo`/`workflow` scopes, and repository push permission with the same environment value. `--insecure-storage` is permitted only for that short-lived task directory; never inspect or print the credential file, never commit it, and delete only the validated exact directory after all authorised publication/workflow evidence is complete.
- Do not repeatedly use `gh auth setup-git` after a user-level Git configuration permission failure. Prefer a repository-local credential-helper configuration or another authenticated GitHub operation that uses the verified task-scoped `GH_CONFIG_DIR`; prove it works before documenting it as the reusable command. Never embed a token in a remote URL, command output, report, or committed file.
- If Windows Git HTTPS fails with `SEC_E_NO_CREDENTIALS` even though the task-scoped `gh auth status` and `gh api` calls succeed, do not keep retrying the same Schannel push. An explicitly authorised publish may use GitHub's Git database API through the authenticated `gh api` client, but only after proving that the remote branch still equals the local commit's parent and that the API-created tree SHA exactly equals the local commit tree SHA; update the branch ref non-forcibly and verify the resulting workflow SHA. Keep any helper/configuration under an ignored task directory, never expose its token, and remove it after verification.
- Repository publishing defaults are direct commits to each repository's default working branch: `TEST-Frontend` uses `main`, and `cloudtms-backend` uses `test`. When the user explicitly asks Codex to commit or publish, commit and push directly to that branch; do not create an agent/feature branch or pull request unless the user explicitly requests one.
- These branch defaults do not provide standing permission to commit or push. Every publish operation still requires an explicit user request in the current task.
- Review `git diff` and `git status` before reporting completion.
- Never include secrets, `.dev.vars`, local environment files, Playwright auth state, raw logs, or diagnostic dumps in a commit.
- Do not alter existing commits or branches without explicit instruction.
- If asked to publish, confirm scope, commit intentionally, push a branch, and optionally open a draft pull request.
- GitHub Desktop may be used by the user instead; do not duplicate its commit/push actions unless asked.

## Output and artifact discipline

For substantive investigations or implementations, default to one consolidated report:

```text
TEST-Frontend\codex_outputs\<task-slug>\report.md
```

Do not create a report for a simple question or tiny change unless useful or requested.

When a report is warranted, keep implementation plan, reproduction evidence, root cause, verification, limitations, safety confirmation, DB summary, and Wrangler summary in that single file.

Additional artifacts only when relevant or requested:

```text
frontend_patch.diff
backend_patch.diff
sql_patch.sql
sql_verification_queries.sql
backend_replacement_files\
```

Do not create or commit by default:

- screenshots;
- Playwright scripts created only for one diagnostic;
- raw console/network/JSON dumps;
- raw database RPC outputs;
- raw Wrangler output;
- duplicate reports, manifests, investigation notes, or verification files.

Temporary diagnostics belong under `C:\tmp` and must be deleted when no longer needed.

## SQL output

If asked to propose SQL but not execute it:

- verify every referenced object against current schema/source;
- write complete SQL without placeholders;
- include bounded SELECT-only verification queries;
- do not run the SQL;
- explain Policy X compliance when relevant;
- clearly state that execution was not performed.

## Verification and final reporting

Do not claim completion unless the requested behaviour was actually verified or clearly marked unverified.

Every substantive final report should state, as applicable:

- files changed and files deliberately untouched;
- pre-existing local changes preserved;
- frontend patched-asset verification method and proof;
- backend runtime used;
- whether any Worker was deployed and runtime freshness proof;
- Playwright tests run and results;
- DB diagnostic method, smoke/schema/target results;
- Wrangler Worker, timing, action observed, and safe findings;
- requests routed to the intended backend and whether any escaped;
- TEST identifiers affected by an approved mutation;
- what was not tested and limitations;
- whether secrets were printed;
- whether destructive SQL/RPC/actions ran;
- TEST and production deployment status;
- Policy X drift status;
- commit/push/PR status.

Expected safety defaults:

```text
Secrets printed: no
Destructive SQL/RPC/actions run: no
Normal TEST deploy: no
Production deploy: no
Raw diagnostic artifacts committed: no
```

If any answer differs, explain exactly why and cite the user’s explicit approval.

## Priority rules

1. System and platform safety instructions always win.
2. The user’s current explicit request defines task scope and may approve a narrowly described TEST action.
3. This workspace `AGENTS.md` supplies durable CloudTMS desktop defaults.
4. A nearer repository/subdirectory `AGENTS.md` may add stricter or more specific rules.
5. Code pasted by the user in the current task supersedes older repository versions only for the exact files/functions identified, until the saved local file is re-read or the user says otherwise.

When instructions conflict or a requested action would materially broaden scope, stop and ask for direction.

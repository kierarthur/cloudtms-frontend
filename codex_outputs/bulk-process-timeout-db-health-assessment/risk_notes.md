# Risk notes and safe follow-up plan

## What must not be tested without explicit user approval

Do not run any of the following without a new explicit approval that names exact TEST rows/actions and safety limits:

- Bulk Process stress testing.
- Repeated process/unprocess loops.
- Repeated manual-upsert calls on the same contract week.
- Any mutation of TEST data without exact identifiers.
- Any destructive SQL, DDL, migrations, or broad DML.
- Any payment, Banking Pay, settlement, remittance, provider, webhook, email, comms, or background drain route.
- Any production endpoint, production Supabase, production Cloudflare Worker, production storage, production KV, production payment provider, or production credential.
- Normal TEST backend deploy.
- Production deploy.

## Safe reproduction plan if later approved

A later controlled reproduction should be staged only after implementing at least route timeouts and request instrumentation. If the user approves, use a plan like:

1. Confirm target TEST row(s) and ensure they are safe to mutate.
2. Confirm max one mutation attempt; no loop.
3. Use the isolated Codex backend Worker only if backend changes need testing.
4. Route the TEST frontend to the isolated Codex Worker via Playwright routing.
5. Install request logging/correlation IDs before action.
6. Open the Bulk Process modal and perform exactly one approved action.
7. Allow no more than a small fixed number of evidence tab/thumbnail switches, for example:
   - Max 1 QUEUE -> ATTACHED switch.
   - Max 2 thumbnail clicks total.
   - Max 1 process or unprocess click.
8. Monitor DB health through read-only `pg_stat_activity` summaries only.
9. Stop immediately if any single request exceeds 15s, any DB active query exceeds 15s, or more than a small cap of backend requests are in flight.
10. Do not retry after a timeout; capture logs and stop.

## Recommended pacing/concurrency caps for future testing

Before fixes:

- Mutation attempts: 0 unless explicitly approved.
- Row-context requests: observation only; no repeated clicking.
- Thumbnail switches: avoid repeated back/forward switching.
- DB diagnostics: bounded read-only queries only.

After targeted timeout/backpressure fixes:

- Max concurrent Bulk Process mutation per user/session: 1.
- Max concurrent mutation per row/action: 1.
- Max concurrent Bulk Process DB-backed reads per modal: 2.
- Max concurrent presign requests per modal: 2.
- Max active preview download target per modal: 1 current selection; stale selections ignored/deferred.
- `changes/ping` should pause during mutation and resume after terminal state or after backoff.
- Mutation request budget should fail fast rather than exceed the chosen safe timeout.
- Row-context UI-read budget should be significantly shorter than mutation budget and should return degraded state rather than hanging.

## How to avoid making DB unhealthy again

1. Never reproduce the user's storm manually before fast-fail protections exist.
2. Implement backend timeouts and DB-level lock/statement timeouts first.
3. Add frontend single-flight/cancellation before doing UI click testing.
4. Keep heartbeat and preview/download traffic paused or capped while mutation is in flight.
5. Prefer single controlled action tests over exploratory clicking.
6. Use read-only activity summaries to verify no long-running active/waiting queries.
7. Stop at the first slow/hung signal; do not retry repeatedly.

## Manual follow-up required

A safe fix should be implemented in stages:

1. Backend: add timeout/backpressure/correlation ID for weekly manual-upsert and fast-fail `changes/ping`.
2. DB/RPC: add safe local lock/statement timeout in relevant atomic functions and verify retryable error handling.
3. Frontend: add Bulk Process request coordinator, stale request aborts, and heartbeat pause/defer.
4. R2/files: make download audit non-blocking/bounded and suppress repeated stale preview downloads.
5. Only then run a controlled single-row reproduction if still needed.

## Confirmation of safety during this assessment

- Mutations run: no.
- DB stress/reproduction run: no.
- Secrets printed: no.
- Destructive SQL/RPC/actions run: no.
- TEST deploy: no.
- PROD deploy: no.
- Backend `wrangler.toml` modified: no.
- Backend tracked files modified: no.
- Backend replacement files/diffs created: no, because no code patch was produced.

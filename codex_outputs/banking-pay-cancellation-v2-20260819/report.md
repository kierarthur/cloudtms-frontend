# CloudTMS Banking Pay cancellation V2 implementation and independent-verification handover

## 1. Purpose of this pack

This is the complete handover for the targeted Banking Pay cancellation changes implemented on 19 August 2026. The receiving chat should assume no prior conversational context. It has GitHub and TEST Supabase access and must independently verify every material claim below.

The receiving chat must:

1. inspect the current heads of `kierarthur/cloudtms-backend:test` and `kierarthur/TEST-Frontend:main`;
2. compare the committed definitions and frontend asset with the installed/deployed TEST authorities;
3. run the acceptance work described in section 12 with the user;
4. decide whether any further change is actually required;
5. if a further change is required, provide a new, highly targeted implementation plan before changing anything;
6. preserve all safety boundaries and the Banking Pay Bible.

Do not use or request any local files from the implementation chat. Everything required for verification is in GitHub, TEST Supabase, the deployed TEST site, and this pack.

## 2. Precise completion status

The work divides into four incident areas:

| Area | Implementation status | What remains |
| --- | --- | --- |
| Volatile remittance-email state invalidated the financial cancellation hash | Implemented in TEST DB and backend GitHub | A controlled end-to-end cancellation must prove the `QUEUED -> SENT` race no longer produces `SOURCE_SCOPE_CHANGED`. |
| Failed cancellation produced a deterministic Workbench source-build error and seven pointless retries | Implemented in TEST DB and backend GitHub | A controlled cancellation must prove the normal Workbench rebuild completes and protects the exact frozen scope. |
| Parent Batches page unexpectedly displayed one row because parent `limit` became `1` | Instrumentation implemented; no speculative behaviour change | The next reproduction must identify the first writer. Only then may a narrowly scoped parent-limit correction be planned. |
| Cancellation/reauthentication modal ownership appeared damaged | Existing owner-bound close behaviour was preserved and additional instrumentation/tests were added | Run full success and failure modal chains in the deployed TEST browser and inspect the trace. Do not replace `closeTop()` without new evidence. |
| Supabase migration jobs repeatedly finished red after safe database work had already completed | Fixed and verified green | Catalog-owned pending repeatables are now rehearsed in a rollback-only transaction, the two stale catalog hashes are current, and mutable James live-build state no longer gates unrelated migrations. |

This distinction is important: the two proven database causes were corrected. The two frontend observations were instrumented because the original writer and exact failing frame transition were not proved. Claiming that all four are already behaviourally fixed would be unsupported.

## 3. Source and deployment identities

### Backend

- Repository: `kierarthur/cloudtms-backend`
- Branch: `test`
- Cancellation implementation commit: `c8628eb830a95b6658fc86689dfe07659810db35`
- Catalog/pre-apply hardening commit: `20b496cbd46cdde0f46989dd9e2d08ded9d6677a`
- Final backend/workflow head: `19effa7a3913d875981587cc85f3e91f1ae0bf4c`
- Parent/base inspected before implementation: `dda6e87420dfa943276ded4d07213b25f008b5df`
- The base includes the sealed active-batch/£25 exclusion correction and that authority was preserved.
- GitHub publication was non-forced and the remote `test` ref was verified byte-for-byte at the implementation commit.

### Frontend

- Repository: `kierarthur/TEST-Frontend`
- Branch: `main`
- Base inspected before implementation: `59cf52e2409ff0054cac97907105caacbc1605e2`
- An intervening user-owned branding commit `cc68cc84716e75f9e9a768dc41376788e1051387` reached `main` before publication. The Banking Pay change was rebased onto it without conflict, and both branding asset references were re-tested and preserved.
- Frontend instrumentation commit: `0e318aff8b26c826c4e29b2091756d5f44aa733f`
- The handover pack is added by the later report-only commit containing this file; resolve current `main` to identify that final documentation head.
- Expected main asset marker: `20260819-banking-cancel-lifecycle-trace-r1`
- Expected cache key suffix: `banking-cancel-lifecycle-trace=20260819-r1`
- GitHub Pages deployment run for the implementation asset: `32255271907` (passed).

### Database

- Project: `test-cloudtms`
- Project ref: `yakevhtttcsljosbdpov`
- Region: `eu-west-2`
- PostgreSQL observed after installation: `17.6.1.147`
- Installation name used through the Supabase migration tool: `banking_pay_cancellation_scope_v2_and_workbench_projection`
- The six function definitions were installed atomically in consumer-first order.
- No table, column, trigger, policy or grant was added or changed.
- No payment, correction request, Workbench session, provider, transfer, reservation, batch or mail row was manually edited.

### Worker

- No Worker source change was made.
- No Worker deployment was required or performed for this implementation.
- Existing API signatures and provider/fallback orchestration were deliberately preserved.

## 4. Proven original causes

### 4.1 Financial cancellation scope race

The old selection contract counted matching `mail_outbox` rows only while their status was `QUEUED`. The incident planned with 74 financial rows plus one queued mail row, stored a source-row count of 75, then applied after that mail became `SENT`. Apply reconstructed 74, the hash changed, and the candidate was blocked as `SOURCE_SCOPE_CHANGED` before fast/fallback route selection.

The affected incident references were:

- batch `be464686-0897-4616-a996-5f9e03b038e8`;
- correction request `188d8f59-17a1-40e2-b250-36916ac80ef8`;
- operation `e41e153c-4697-479e-ad32-f2df42fc115c`;
- work item `da692b40-e4e7-4ea6-bf3f-7de0ba1ffe41`;
- source Workbench session `01245cf8-6819-41de-a9a7-f6641a34ad26`.

These are diagnostic anchors only. Re-read current state before relying on them. Do not rerun, reinterpret, repair or mutate the old blocked request without separate explicit approval.

### 4.2 Workbench projection and retry failure

The Workbench source builder passed an incompatible request-level envelope without `scope_type` to `_pay_payment_correction_selected_items`, even though exact server-owned authority existed in request-candidate membership and the work item. The deterministic `PAYMENT_CORRECTION_SCOPE_TYPE_REQUIRED` error was then treated as retryable seven times before being wrapped as an exhausted delivery.

The correct fix is not to default a missing `scope_type`, weaken the central helper or exclude all blocked requests. Blocked correction ownership must continue protecting its exact frozen items and reservations.

### 4.3 One-row batch list

Database evidence showed the batch list still contained the expected rows and total. Browser evidence showed `limit=1` reached parent state, but it did not prove which writer first changed the value. Therefore the implementation records every known parent list request/response and writer, while retaining existing list behaviour until a trace proves the first bad transition.

### 4.4 Modal ownership

The current source already contained owner-bound reauthentication close/restoration logic. There was insufficient evidence to justify another modal-framework rewrite. The implementation retained `closeTop()`, parent-context restoration and existing child ownership, and added bounded trace events around the exact cancellation, verification, child-close and parent-refresh transitions.

## 5. Backend implementation

The following committed repeatable definitions were changed:

1. `supabase/repeatable/04082026_1147_pay_payment_correction_selection_prepare_chunk_v1.sql`
2. `supabase/repeatable/04082026_1208_pay_payment_correction_expand_work.sql`
3. `supabase/repeatable/04082026_1158_pay_pre_bank_cancel_apply_work_item.sql`
4. `supabase/repeatable/04082026_1158_pay_no_money_unwind_apply_work_item.sql`
5. `supabase/repeatable/07082026_1013_pay_workbench_candidate_source_build_chunk.sql`
6. `supabase/repeatable/04082026_1219_pay_workbench_fail_job.sql`

The relevant catalogue manifests were updated only for these six function definitions:

- `supabase/verification/banking_pay_revision5_catalog_manifest.json`
- `supabase/verification/banking_pay_targeted_fast_route_certified_reuse_catalog_manifest.json`

The focused regression is:

- `tests/banking-pay-cancellation-frozen-scope-v2.test.js`

### 5.1 Versioned scope contract

New, unmaterialised cancellation selections now use:

```text
candidate_scope_contract_version = 2
candidate_scope_hash_version = 2
source_row_count_semantics = FINANCIAL_ONLY
communication_cleanup_contract_version = 1
```

An existing request without a marker remains V1. V1 retains its exact historical `FINANCIAL_AND_QUEUED_COMMUNICATIONS` count/hash semantics. Existing evidence is never silently upgraded or reinterpreted.

V2 candidate identity contains only the immutable financial/frozen selection. Matching communication state is observed and recorded separately.

### 5.2 Expansion and apply validation

`pay_payment_correction_expand_work` validates the stored version markers and carries them into the work item. Both apply functions validate request/work-item coherence before using V2 semantics.

For V2 apply:

- exact financial item IDs, counts, hashes, amounts and existing provider/settlement/reservation fences remain controlling;
- current exact communication rows are resolved separately;
- exact `QUEUED` rows are locked and rechecked;
- a row already `SENT` or otherwise terminal is left untouched and recorded as such;
- unsafe current queued communication state returns `COMMUNICATION_CLEANUP_UNSAFE` before financial mutation;
- genuine financial drift still returns the existing financial blocker;
- no timeout, retry or fallback is used as a concurrency correctness mechanism.

The same separation was made for `PRE_BANK_CANCEL` and `NO_MONEY_UNWIND` so the parallel route cannot retain the same race.

### 5.3 Workbench frozen-scope projection

The private source builder now creates one temporary frozen-scope projection, `_bpay_wb_open_correction_scope_v1`, and both correction consumers use that same projection.

For correction requests with durable request-candidate membership, it:

- keeps `BLOCKED` ownership in scope;
- reads exact `pay_batch_item_ids` from server-owned request-candidate membership;
- validates the corresponding work-item selection where it exists;
- validates supported V1/V2 markers;
- fails closed on missing, mismatched or unsupported authority;
- never invents a client or request-level scope type.

Only an actual legacy request without durable membership may use the existing helper/envelope fallback.

New deterministic error codes are:

```text
PAYMENT_CORRECTION_WORKBENCH_FROZEN_SCOPE_MISSING
PAYMENT_CORRECTION_WORKBENCH_FROZEN_SCOPE_MISMATCH
PAYMENT_CORRECTION_WORKBENCH_FROZEN_SCOPE_VERSION_UNSUPPORTED
```

### 5.4 Retry classification

`pay_workbench_fail_job` now treats `PAYMENT_CORRECTION_SCOPE_TYPE_REQUIRED` and the three frozen-scope errors above as deterministic. They terminalise with their semantic root code instead of consuming transient retry capacity. Existing transient retry and obsolete-generation behaviour was not changed.

### 5.5 Migration workflow hardening

The recurring red migration runs had two separate, proved causes.

First, commit `5a9f5c49747ffdf790d9f171c3e97e3e59d2d24c` had already changed the authoritative signed-recovery definitions for:

- `private.pay_sync_overpayments_from_workbench_workspace_v1`;
- `private.pay_workbench_sealed_rate_component_projection_v1`.

The TEST repeatable ledger proved the exact current GitHub SQL files were installed, and the installed function bodies contained the new signed-recovery authority, but the targeted catalog still held the previous definition fingerprints. The catalog now records the current installed definitions.

Second, the migration ran a James-specific live-data diagnostic on every deployment. That diagnostic selected the newest matching build without requiring it to be complete. It therefore selected the known failed cancellation rebuild (`FAILED`, `WORKSPACE_FACT`, zero facts) instead of the immediately preceding complete sealed build (78 facts), producing `PAY_WORKBENCH_UNIT_PROJECTION_INCOMPLETE` after every catalog had already passed.

The correction is intentionally narrow:

- `.github/workflows/supabase-migrate.yml` collects only content-pending repeatables;
- `supabase/verification/generate_banking_pay_catalog_preapply_check.mjs` applies any catalog-owned pending repeatables inside one `BEGIN`/`ROLLBACK` rehearsal and verifies their exact `pg_get_functiondef` SHA-256 fingerprints before the real apply loop;
- the rehearsal refuses paths outside `supabase/repeatable`, transaction-owning source files and conflicting manifest ownership;
- `tests/13082026_1942_banking_pay_james_rate_authority_runtime_verification.sql` remains the automatic deterministic definition/rollback-fixture gate but no longer includes mutable live James build state;
- `supabase/verification/13082026_1943_banking_pay_james_rate_authority_readonly.sql` remains available as a manual read-only diagnostic and now selects only a completed sealed build;
- `tests/banking-pay-catalog-preapply-gate.test.cjs` and `tests/banking-pay-migration-runtime-gate-stability.test.cjs` lock these boundaries.

No payment logic, function body, table, row, provider state or financial authority was changed by the workflow correction.

## 6. Installed TEST database proof

After both the direct atomic installation and the later GitHub repeatable run, TEST returned these exact definitions:

| Function | SHA-256 | MD5 |
| --- | --- | --- |
| `public.pay_payment_correction_selection_prepare_chunk_v1(uuid,uuid,jsonb,integer,text,uuid)` | `8bb8703c4e8f7abcfb62cf68fd76a7e6e57bac4668648de61788b0202bde910b` | `cd01057a4e89daa5a18ec2e2239fbf6d` |
| `public.pay_pre_bank_cancel_apply_work_item(uuid,uuid)` | `3dfad8de619564e9c5dc6915f609e7b1da6ced86f25ed691a1765769772637b8` | `ed34251aac0a4ca901c4a59b590207be` |
| `public.pay_no_money_unwind_apply_work_item(uuid,uuid)` | `3e77192523fce251e65117bbfcd64cc906850d7aa508a0242535681dd5295185` | `ea4ffb39add14e633401dd215061a51f` |
| `public.pay_payment_correction_expand_work(uuid,uuid)` | `3bcf21c8b46a64ce8dee0e9752606056149bc590669ea6065e674c50bdc705a7` | `344e8d2a4449c24b123df7967b08300c` |
| `public.pay_workbench_fail_job(uuid,jsonb,integer)` | `2750d5b1e12c23bd08ab0b6691b02bdae59c655d51413f3b60ae3f2792a785ad` | `6aa03c1e87f88314d7b2ad5dda58875c` |
| `private.pay_workbench_candidate_source_build_chunk_legacy_v1(uuid,uuid,jsonb,jsonb,integer)` | `3dea503e2c8a326ecfe04ba32630cf0b8ceb7e3f2c63df58052c5de9aabb082b` | `fb2d556d9a628f7d321ca93a481c27f3` |

Metadata was preserved:

- all six owners remain `postgres`;
- all six remain `SECURITY DEFINER`;
- the four public operational functions retain `service_role` execution only in addition to `postgres`;
- `pay_workbench_fail_job` retains an empty `search_path` and `service_role` execution;
- the private builder retains an empty `search_path`, `plpgsql_check.mode=disabled`, and `postgres`-only execution;
- existing statement and lock timeouts remain on the four cancellation functions.

The project-wide Supabase advisor output contains many pre-existing informational/warning findings across the wider schema. Do not misreport those as introduced by these function replacements. The exact ACL/config checks above are the relevant no-drift evidence for this change.

The two formerly mismatched authorities have this final source/install parity:

| Authority | GitHub SQL file SHA-256 = TEST repeatable-ledger SHA-256 | Installed definition SHA-256 |
| --- | --- | --- |
| `private.pay_sync_overpayments_from_workbench_workspace_v1` | `c61d38bece93d97853fb6592dc12cdbbfd0219edb5075ac38b7443cee05dbe33` | `6545152d1cb26ddfb71453803d5c5d3f5682a02176c1b3eacc424917ca16478f` |
| `private.pay_workbench_sealed_rate_component_projection_v1` | `78837bef7ad9ed2f52a53cae6630a89617af39cd210d8f7bacd35af2e20eccf6` | `a3e3a35101070382fb2e9957bc007ef31f9801afca165b2391ae0179adf6da0e` |

Final metadata remained exact: the synchronizer is `postgres`-owned, invoker-security, volatile and parallel-unsafe with its existing empty search path/plpgsql-check configuration; the sealed projection is `postgres`-owned, security-definer, stable and parallel-unsafe with its existing empty search path.

## 7. Frontend instrumentation implementation

Changed frontend files:

- `js/main.js`
- `index.html`
- `tests/e2e/banking-pay-reauth-parent-close.spec.ts`
- `tests/unit/main-asset-cache-version.test.cjs`
- `tests/unit/banking-pay-cancellation-lifecycle-trace.test.cjs`

The trace contract is:

```text
BANKING_PAY_LIFECYCLE_TRACE_R1
maximum events = 200
enabled host = testmode.arthur-rai.co.uk only
```

TEST exposes:

```javascript
window.clearBankingPayLifecycleTrace()
window.readBankingPayLifecycleTrace()
```

The trace is in-memory only. It does not send new network requests or persist data. It uses an explicit allowlist and does not record IDs, payloads, passwords, authentication tokens, cookies, headers, email addresses or financial row data.

Recorded categories include:

- parent list request, stale response, adopted response and error;
- every known parent page-size writer and its source;
- child Current Payment Status requested limit and effective limit separately;
- cancellation financial refresh and parent-list refresh;
- cancellation signal/progress reuse, completion and failure;
- reauthentication modal open, verification, dismissal and cancellation;
- password confirmation modal open, submit and dismissal;
- batch child open/reuse/close/dismiss transitions;
- owner/parent refresh primary and fallback paths;
- modal stack depth, top frame kind, parent/owner kind and modal context entity.

The implementation deliberately does not clamp parent `1` to `5` yet. The next reproduction must identify the earliest trace event where the parent limit changes from the expected value.

GitHub Pages built and deployed commit `0e318aff8b26c826c4e29b2091756d5f44aa733f`. A fresh cache-busted request to the TEST custom domain then proved all of:

- the deployed `index.html` contains `banking-cancel-lifecycle-trace=20260819-r1`;
- the intervening `cloudtms-office-logo-black.png` branding reference remains present;
- the deployed `main.js` contains asset marker `20260819-banking-cancel-lifecycle-trace-r1`;
- the deployed `main.js` contains trace contract `BANKING_PAY_LIFECYCLE_TRACE_R1`.

## 8. Tests run

### Backend

- Exact staged SQL definitions compiled successfully against TEST inside `BEGIN/ROLLBACK` before installation.
- Focused new frozen-scope suite: 7/7 passed.
- Complete repository JavaScript suite: 696/696 passed after the final committed source and manifest changes.
- Focused migration/Banking authority suite after workflow hardening: 190/190 passed.
- The corrected manual completed-build James diagnostic passed against TEST.
- The deterministic James definition/rollback-fixture check passed directly against TEST.
- `git diff --check` passed.
- PostgreSQL 17.6 and 18.1 GitHub pre-migration gates both passed.
- Final safe migration workflow run `32254731258` passed end to end at backend head `19effa7a3913d875981587cc85f3e91f1ae0bf4c`.

### Frontend

- `node --check js/main.js` passed.
- Focused Banking Pay/modal/trace suite: 41/41 passed.
- Full static/unit run: 662/663 passed.
- The sole failure, `financial completion is not obscured by internal Workbench refresh detail`, is pre-existing at base `59cf52e…`: the base `renderBankingPayCancellationProgressModal` already contains the strings that this stale static assertion forbids. The implementation did not edit that render function. Do not hide this fact, and do not attribute it to the lifecycle instrumentation.
- Patched-asset Playwright owner-close test: 1/1 passed on the normal TEST origin with local `index.html` and `main.js` interception, service workers blocked, exact asset hashes proved, reauthentication endpoint mocked, zero Banking Pay mutations, zero production requests, correct parent restoration and successful final Close.
- After rebasing onto the intervening branding commit, the combined affected frontend suite passed 41/41.
- GitHub Pages build/deployment run `32255271907` passed and the deployed TEST cache marker, trace contract and preserved branding reference were verified through fresh requests.

### Live financial acceptance

No new payment was created, executed or cancelled autonomously. The user explicitly asked to run those behavioural tests together after deployment. Therefore the financial cancellation fix is structurally and database-verified, but the direct incident race and full rebuild still require the joint acceptance sequence in section 12.

## 9. GitHub workflow investigation and final result

The workflow history is important because it separates the cancellation change from the older publication defects:

1. Run `32171875370` on prior backend head `dda6e874…` already failed on the same two stale catalog fingerprints. This predates the cancellation implementation.
2. Run `32252637762` on cancellation commit `c8628eb8…` passed both PostgreSQL gates and installed the six cancellation definitions, then failed on those same two catalog fingerprints.
3. Exact GitHub-file SHA/TEST-ledger parity, installed function fingerprints and unique signed-recovery markers proved the function SQL and TEST definitions were current; only their catalog fingerprints were stale.
4. Commit `20b496cb…` updated the two proved fingerprints and added the rollback-only catalog pre-apply rehearsal. Run `32254147815` then passed both PostgreSQL gates and all four catalogs, with both source files skipped as unchanged. It failed later only because the mutable James live diagnostic selected the known failed zero-fact build.
5. Commit `19effa7a…` separated that manual live diagnostic from the deterministic migration gate and required completed sealed authority when the manual diagnostic is run.
6. Final run `32254731258` passed both PostgreSQL engines, all source-authority tests, all four catalogs, all deterministic runtime SQL checks and the complete TEST migration job.

The workflow is therefore green for the correct reasons. No function was reinstalled merely to clear a catalog failure, no manifest was guessed, and no live James row was repaired or altered.

## 10. Policy X and preservation assessment

This implementation does not introduce Policy X drift:

- post-Draft selection still uses frozen batch/request/work-item artifacts;
- no live finance-component identity fallback was added;
- no new economic-key derivation was introduced;
- `TS_DAY` remains date-bucketed as `YYYY-MM-DD`;
- central freshness and financial mismatch checks remain;
- V1 evidence remains V1 and is not reinterpreted;
- provider, settlement, transfer, reservation, payment execution, fast-route admission and safe fallback behaviour were not changed;
- `BLOCKED` correction ownership remains protected;
- the sealed active-batch/£25 linked-timesheet exclusion remains protected;
- the owner-bound modal-close fix remains in place.

No changes were made to VAT, PAYE, Umbrella economics, rates, timesheets, draft creation, CSV, provider submission, settlement, remittance generation, queue fanout, Workbench parallelism, candidate dirtying, publication architecture or production.

## 11. Bible status

`BANKING_PAY_BIBLE.md` was checked before implementation and no conflict was found. It was intentionally not changed in this commit because the standing rule is to add behavioural authority only after the installed TEST behaviour has been verified end to end.

After the joint tests pass, add a dated, concise Bible entry covering:

1. V2 financial scope is immutable and excludes volatile communication delivery state;
2. exact queued communication is cancelled under lock, sent/terminal communication is untouched, and unsafe queued state fails before finance mutation;
3. Workbench rebuild uses durable request-candidate/work-item frozen ownership and retains blocked ownership;
4. deterministic frozen-scope errors do not retry-loop;
5. the identified parent-limit writer and the exact final correction, if one is required;
6. verified modal-stack success/failure postconditions;
7. explicit Policy X, £25 exclusion, reservation and provider reconciliation evidence.

Do not add the parent-limit behaviour as settled until the trace identifies the writer and any correction is verified.

## 12. Required joint acceptance plan

### 12.1 Before the user acts

1. Confirm frontend `main` and backend `test` heads.
2. Fetch deployed TEST `index.html` and `main.js`; prove the expected cache suffix and asset marker.
3. Re-query all six DB hashes/owners/ACLs/configuration.
4. Confirm normal TEST Worker health, readiness and version without redeploying it.
5. Start Wrangler Tail on `test-cloudtms-backend` before the action.
6. Start bounded DB monitoring for the exact new test batch/request only.
7. In the browser, call `clearBankingPayLifecycleTrace()` before beginning.
8. Record the parent Batches page-size state and visible/total row counts.
9. Capture a read-only financial baseline: exact frozen item IDs and amounts, reservations, transfer state, provider attempts/events, execution state and matching communication state.

### 12.2 Direct cancellation race test

Use a new controlled TEST batch, not the old blocked request. Execute it future-dated as agreed with the user, wait until execution has reached its safe cancellable state, then cancel while monitoring browser, DB and tail.

Required assertions:

- a normal `QUEUED -> SENT` mail transition does not change the V2 financial count/hash;
- apply does not return `SOURCE_SCOPE_CHANGED` merely because mail was sent;
- sent communication remains sent and is not rewritten;
- exact still-queued communication is safely locked/cancelled;
- unsafe current queued communication blocks before financial mutation;
- genuine financial/item/provider/settlement drift still blocks;
- route selection is reached after financial apply;
- fast route is used when its existing admission is satisfied;
- existing safe fallback is used only when fast admission genuinely fails and fallback is already permitted;
- no invented fallback or provider bypass occurs.

### 12.3 Workbench assertions

- exactly one current rebuild owner is created for the affected candidate;
- request-candidate membership and work-item item IDs agree;
- no `PAYMENT_CORRECTION_SCOPE_TYPE_REQUIRED` occurs;
- no deterministic frozen-scope error is retried;
- candidate returns to READY/current through normal processing;
- frozen items/reservations are neither duplicated nor released incorrectly;
- blocked correction ownership remains protected where applicable;
- the £25 sealed linked-timesheet exclusion remains active;
- unrelated candidates and sessions remain unchanged.

### 12.4 Modal and pagination assertions

Capture `readBankingPayLifecycleTrace()` after both success and controlled failure chains.

For each chain, verify:

- exactly one Banking parent remains after child/verification/progress closure;
- the parent owns `modalCtx`;
- no orphan verification, password, progress or batch-child overlay remains;
- parent Close works;
- the first `parent-limit-writer` or parent-list event that changes the expected page size is identified;
- child Current Payment Status requested/effective limits do not mutate parent list state;
- stale parent responses are rejected by the sequence fence;
- parent rows and total match backend truth after close/reopen.

If the trace proves the writer, produce a new implementation plan limited to that writer and an invariant regression. Do not patch every refresh path defensively.

### 12.5 Financial reconciliation

For the original James-shaped regression fixture, expected baseline arithmetic was:

```text
positive inc VAT     £948.76
recoveries inc VAT - £876.00
net bank amount       £72.76
reservations          £730.00 ex VAT
provider attempts     0
provider events       0
submitted/paid        0
```

For the new acceptance batch, calculate from its own frozen rows and prove before/after equality or exact cancellation movement. Do not assume the old amounts apply if the fixture differs.

## 13. Explicit stop conditions

Stop and report before mutation if:

- the target is not `test-cloudtms` / normal TEST;
- source, deployed asset or installed definition identity is stale or ambiguous;
- provider activity has appeared unexpectedly;
- the batch is not in the exact safe state expected for the test;
- item IDs, amounts, reservations or source session/version differ from the agreed baseline;
- another active correction/rebuild owner conflicts with the test;
- the trace functions or expected asset marker are absent;
- any test would require production, direct table repair or manual financial-state editing.

## 14. Prohibited shortcuts

Do not:

- retry or rewrite the old blocked cancellation request;
- recover the old failed Workbench session without separate explicit approval;
- restore old authorisation after a failed cancellation;
- exclude every `BLOCKED` correction request;
- default a missing `scope_type`;
- weaken `_pay_payment_correction_selected_items`;
- treat `SENT` mail as financial drift or cancel sent mail;
- leave ambiguous queued mail after successful cancellation;
- change child pagination solely to influence parent pagination;
- replace owner-bound `closeTop()` with generic modal closure;
- update jobs, builds, session counters or current build IDs manually;
- change either formerly mismatched signed-recovery function body without a new proved defect, catalog update and rollback-only pre-apply proof;
- touch production.

## 15. Independent reviewer deliverable

The receiving chat should return:

1. a verdict for each of the four incident areas: verified fixed, instrumented/pending, or still defective;
2. exact GitHub, deployed asset and DB identity evidence;
3. test results and financial reconciliation;
4. the first proven parent-limit writer and exact modal transition evidence, if reproduced;
5. an updated, highly targeted implementation plan for any remaining defect;
6. an explicit Bible-conflict and Policy X assessment;
7. a statement that no unrelated authority or data was changed.

If no further defect is proved, the reviewer should say that no additional implementation is required and proceed only with the verified Bible entry.

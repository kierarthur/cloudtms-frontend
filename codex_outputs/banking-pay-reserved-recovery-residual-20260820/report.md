# CloudTMS Banking Pay — Reserved-Recovery Residual Fix

## Independent verification handover — 20 August 2026

## 1. Purpose of this handover

This document gives a new chat enough repository and TEST-database evidence to independently verify a narrowly scoped Banking Pay change. It is not an instruction to mutate data, execute or cancel a payment, change a Draft, replay provider work, or deploy anything.

The verifier must:

1. treat the repository and current TEST catalogue as the authorities, not this narrative;
2. re-read `BANKING_PAY_BIBLE.md` before assessing the implementation;
3. confirm every diagnostic against the current TEST project before relying on it;
4. identify any direct or indirect regression, especially around section routing, selection, Draft reservation ownership, cancellation/release, cursor paging, performance, and same-modal adoption;
5. preserve Policy X and every existing frozen-artifact and economic-identity fence;
6. make no change unless the current user separately authorises it;
7. if a change is required, return a complete, narrowly targeted implementation plan and rollback/test plan before editing.

## 2. Exact published authority

### Backend

- Repository: `kierarthur/cloudtms-backend`
- Branch: `test`
- Commit: `28265873244bb5345440078c38a2a7921ded5334`
- Parent: `3c560d3866240c1b956ed969d4deb19be4b74457`
- Commit message: `Fix Banking Pay recovery residual visibility`

The verifier should inspect exactly:

```text
3c560d3866240c1b956ed969d4deb19be4b74457..28265873244bb5345440078c38a2a7921ded5334
```

Changed backend paths:

```text
.github/workflows/supabase-migrate.yml
supabase/repeatable/16082026_2035_pay_workbench_candidate_preview_effective_section_v1.sql
supabase/repeatable/17082026_2052_pay_finance_resolution_cancel_authority.sql
supabase/repeatable/20072026_0117_banking_pay_preview_selection_revision.sql
supabase/repeatable/20082026_1502_pay_workbench_preview_recovery_residual_current_v1.sql
supabase/verification/banking_pay_semantic_ready_cancellation_reversion_catalog_manifest.json
supabase/verification/banking_pay_targeted_fast_route_certified_reuse_catalog_manifest.json
tests/banking-pay-active-draft-preview-exclusion.test.cjs
tests/banking-pay-semantic-ready-cancellation-reversion.test.cjs
```

No Worker JavaScript, provider, settlement, remittance, cancellation, frontend JavaScript, or CSS file changed in this backend commit.

### Bible and this handover

- Repository: `kierarthur/TEST-Frontend`
- Branch: `main`
- Initial residual-rule Bible commit: `7d3721d5778bd4638c15ebc5997b3eb98d185305`
- A later documentation-only commit contains the final workflow evidence, this handover, and the explicit browser/direct-reader evidence boundary. Verify the current `main` head rather than assuming the later commit ID from this document.

No deployed frontend asset was changed for this residual-reader correction.

### TEST environment only

- Supabase project name: `test-cloudtms`
- Supabase project ref: `yakevhtttcsljosbdpov`
- Region: `eu-west-2`
- TEST frontend: `https://testmode.arthur-rai.co.uk`
- Normal TEST Worker: `test-cloudtms-backend`

Production was not accessed or deployed.

## 3. Defect being corrected

An active James Terwane Draft contained three overpayment-recovery items totalling £730.00 ex VAT. The same three recovery amounts were also being presented in Banking Pay as if they remained outstanding, even though the active Draft reservations already owned those amounts.

The required rule is:

- a recovery fully owned by active Draft reservations must not appear in the Workbench;
- if only part of a source recovery is reserved, a genuine strictly positive unreserved residual may remain visible exactly once;
- the reader must not infer that residual from a loose sibling or live finance identity;
- stale, missing, malformed, mismatched, or arithmetically inconsistent evidence must fail closed;
- a separate genuinely unreserved £25.00 recovery is a control and must not be suppressed merely because other recoveries for the same candidate are reserved.

The earlier strict sibling predicate was not sufficient as a complete solution: binary physical overlap can correctly suppress a fully reserved row but can also suppress a legitimate partial residual. The final implementation therefore adds a versioned publisher contract and current-reservation validation instead of weakening the existing frozen-sibling fence.

## 4. Implemented design

### 4.1 Private residual validator

New file:

```text
supabase/repeatable/20082026_1502_pay_workbench_preview_recovery_residual_current_v1.sql
```

Function:

```text
private.pay_workbench_preview_recovery_residual_is_current_v1(
  p_row_status text,
  p_row_candidate_id uuid,
  p_expected_candidate_id uuid,
  p_finance_case_id uuid,
  p_row_json jsonb,
  p_current_active_reserved_ex_vat numeric,
  p_current_active_reservation_count integer,
  p_exact_active_item_overlap boolean
)
```

Expected properties:

- pure and table-free;
- `SECURITY INVOKER`;
- `IMMUTABLE`;
- `PARALLEL SAFE`;
- empty search path;
- executable only by `postgres`;
- validates contract version, candidate and finance-case identity, finite numeric values, reservation count/overlap consistency, and the arithmetic `source outstanding - active reserved = positive residual`;
- fails closed for malformed, stale, negative, zero, mismatched, or incomplete evidence.

### 4.2 Canonical pre-Draft publisher

Modified function:

```text
public.pay_preview_candidate_build_canonical_lines(jsonb, uuid)
```

For `OVERPAYMENT_RECOVERY`, the canonical publisher now freezes these top-level fields into the preview row:

```text
recovery_residual_contract_version = 1
recovery_source_outstanding_ex_vat
recovery_active_reserved_ex_vat
recovery_residual_outstanding_ex_vat
```

This is pre-Draft publication authority. It does not reinterpret a frozen Draft or add a post-Draft live-finance fallback.

### 4.3 Candidate reader

Modified function:

```text
public.pay_workbench_session_get_candidate_preview(uuid, uuid, jsonb, integer)
```

Expected behaviour:

- reads active recovery reservations set-wise;
- builds the exact active-item overlap set once;
- requires every eligible recovery row to pass the residual-current validator;
- suppresses a fully reserved recovery;
- permits only a proven positive partial residual;
- retains the strict frozen recovery-sibling fence;
- preserves its existing bounded four-argument API and service-role-only ACL.

An initial TEST installation exposed a real runtime defect: the sibling subquery referenced `typed_overlay_pay_batch_id` against the physical preview table, although that alias exists only on the typed CTE. The final source corrects this by using:

```text
FROM session_preview_rows AS recovery_sibling
```

The final installed candidate-reader hash below includes that correction. A verifier must ensure the erroneous physical-table form is absent.

### 4.4 Paged section reader

Modified function:

```text
public.pay_workbench_session_get_preview_page(uuid, text, jsonb, integer)
```

Expected behaviour:

- uses one shared `v_eligible_row_ids` identity set for section counts and returned rows;
- performs one set-wise active-reservation aggregation;
- applies the same current residual contract as the candidate reader;
- retains the same strict frozen-sibling fence;
- preserves cursor ordering, count/row parity, public API shape, and service-role-only ACL.

The file retains old source blocks behind unreachable conditions. The verifier should confirm they cannot affect the runtime path and should not perform an unrelated cleanup merely for style.

## 5. Installed TEST catalogue authority

The following SHA-256 values are over `pg_get_functiondef` encoded as UTF-8 after the successful GitHub repeatable replay:

| Function | Expected installed SHA-256 |
|---|---|
| `private.pay_workbench_preview_recovery_residual_is_current_v1` | `4317bb7fbf6fd222fc26133fa08c931b2a9d23f0cc60ff71522ff930f59d344a` |
| `public.pay_preview_candidate_build_canonical_lines` | `9216d9e6c3c73514149dc20e93b75648c42ffd6850b0eaff2fbe4764e713c0b5` |
| `public.pay_workbench_session_get_candidate_preview` | `7e669a4dd7d00e332207161460444ced8d71045c1549ef837e8e8b19d25aab2b` |
| `public.pay_workbench_session_get_preview_page` | `99309bf519fa791b05249f74fc0c3de2079006f9eed64fd3dbf3e6ca25486b48` |

Read-only catalogue query shape:

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  encode(digest(convert_to(pg_get_functiondef(p.oid), 'UTF8'), 'sha256'), 'hex') as definition_sha256,
  p.prosecdef as security_definer,
  p.provolatile,
  p.proparallel,
  pg_get_userbyid(p.proowner) as owner_name,
  coalesce(array_to_string(p.proacl, ','), '') as acl,
  coalesce(array_to_string(p.proconfig, ','), '') as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
  ('private','pay_workbench_preview_recovery_residual_is_current_v1'),
  ('public','pay_workbench_session_get_candidate_preview'),
  ('public','pay_workbench_session_get_preview_page'),
  ('public','pay_preview_candidate_build_canonical_lines')
)
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
limit 20;
```

Expected security metadata:

- helper: owner `postgres`, invoker, immutable, parallel safe, owner-only execute, empty search path;
- candidate reader: owner `postgres`, definer, `search_path=public`, execute for `postgres` and `service_role` only;
- page reader: owner `postgres`, definer, `search_path=public`, execute for `postgres` and `service_role` only;
- canonical publisher: owner `postgres`, definer, explicit `search_path=public`, existing execute grants to `postgres`, `authenticated`, and `service_role`.

The Supabase security advisor reported its existing warning that authenticated users can execute the public canonical publisher because of that explicit historical grant. This change did not introduce or broaden that grant. The verifier must confirm whether it remains intentional, but must not change the ACL as part of this narrow verification without a separate impact analysis and approval. No targeted performance-advisor finding referred to the four functions.

## 6. TEST installation and rebuild sequence used

The DB-first sequence was:

1. install the private helper;
2. install the canonical publisher;
3. rebuild current pre-Draft preview authority so rows carry the new contract;
4. install the two readers;
5. run catalogue, live-reader, financial, performance, and browser proofs;
6. only then publish GitHub and allow the migration workflow to replay the repeatables.

During the controlled rebuild, direct enqueue rebuilt 12 of 13 current recovery rows. The existing owner guard correctly refused one contractless current candidate. The central bounded invalidation owner was then used for that one candidate with reason `RECOVERY_RESIDUAL_CONTRACT_V1_ROLLOUT`, after which the normal audited Workbench rebuild completed.

Observed result at rollout time:

- 13 current Ready recovery rows had a v1 residual contract;
- all 13 validated against the then-current active reservation aggregate;
- zero were malformed or invalid;
- no rollout job remained active or failed;
- no payment, provider, settlement, remittance, source financial, batch item, or reservation amount was changed by the rollout.

The verifier must re-query current state rather than assuming these counts remain static.

## 7. Executable and rollback evidence

### Local/source gate

The exact migration-workflow Banking Pay suite passed:

```text
203 tests
203 passed
0 failed
```

It included the updated active-Draft exclusion and semantic cancellation regression files.

### Rollback-only database rehearsal

The staged function definitions compiled and executed inside rollback-only TEST transactions. Covered cases included:

- zero active reservation;
- partial active reservation with positive residual;
- fully reserved recovery;
- released/non-active reservation;
- exact active item overlap;
- stale or absent contract;
- wrong contract version;
- candidate or finance-case mismatch;
- malformed numeric evidence;
- arithmetic mismatch;
- strict frozen-sibling suppression;
- candidate-reader and page-reader parity;
- cursor continuation.

No rollback fixture persisted data.

### GitHub migration workflow

- Workflow: `Supabase Migrate (safe)`
- Run ID: `32384500076`
- Head SHA: `28265873244bb5345440078c38a2a7921ded5334`
- URL: `https://github.com/kierarthur/cloudtms-backend/actions/runs/32384500076`
- Conclusion: success

Successful jobs:

- PostgreSQL 18.1 candidate runtime gate;
- PostgreSQL 17.6 candidate runtime gate;
- Banking Pay source authority verification;
- Candidate App DB/RPC authority verification;
- repeatables-first TEST migration application;
- final catalogue verification.

The only workflow annotations were GitHub's general Node 20 action deprecation notices for `actions/checkout@v4`; they were not application, SQL, or migration failures.

## 8. Live reader, cursor, and performance evidence

For the inspected DB Workbench session after the controlled rebuild:

- page reader: 60 Ready, 1 Cases / Resolutions, 2 Blocked;
- candidate reader: 5 candidates and 63 total rows;
- exact candidate/page identity differences: 0;
- page known-count versus returned-count mismatches: 0;
- `has_more` at limit 100: false;
- limit-1 cursor test: first and second rows were distinct and both correctly reported more rows;
- current recovery contracts inspected: 13;
- valid recovery contracts: 13;
- malformed or invalid recovery contracts: 0.

Combined `EXPLAIN (ANALYZE, BUFFERS)` observation for three page calls and five candidate calls:

- total execution: 876.27 ms for eight calls;
- approximate average: 109.5 ms per call;
- page-call component: 667.5 ms;
- candidate-call component: 208.5 ms;
- no shared disk reads;
- no temporary reads or writes.

The verifier should repeat bounded performance tests on current data and compare query plans. Do not infer that one observed plan guarantees every filter/cardinality case.

## 9. Financial reconciliation evidence

The inspected active James Draft contained seven frozen items:

### Positive timesheet items

- four `SEGMENT_DELTA` items;
- ex VAT: £790.63;
- VAT: £158.13;
- inc VAT: £948.76.

### Recovery items

- three `OVERPAYMENT_RECOVERY` items;
- ex VAT: £-730.00;
- VAT: £-146.00;
- inc VAT: £-876.00.

### Net

```text
£948.76 - £876.00 = £72.76
```

Additional observed invariants:

- frozen item total: £72.76;
- net bank amount: £72.76;
- batch total bank out: £72.76;
- three active reservations;
- reservation/source ex-VAT total: £730.00;
- absolute frozen recovery ex VAT matched the reserved source exactly;
- visible negative-timesheet presentation parents for those reserved recoveries: 0;
- the separate £25.00 control had source outstanding £25.00, active reserved £0.00, and residual £25.00 under resolution authority.

The verifier must establish the current batch by exact current database authority rather than relying on a truncated UI identifier or assuming the batch is still in the same status.

## 10. Browser evidence and unresolved parity question

Normal signed-in TEST browser checks were run before and after the GitHub repeatable replay.

Final post-deployment browser observation:

- origin: `https://testmode.arthur-rai.co.uk`;
- Ready: 5 candidates, 60 lines, amount £10,736.13;
- Cases / Resolutions: 0 candidates, 0 lines;
- Blocked: 0 candidates, 0 live items;
- no Workbench refresh-failure banner;
- none of James's reserved £242.50, £220.00, or £267.50 recovery rows visible;
- zero failed Banking Pay HTTP responses in the post-deployment check.

Earlier in the check, four unrelated 401 capability probes were observed (`/api/me`, invoice-async capabilities, and Candidate App office capabilities). No Banking Pay request failed.

Important evidence boundary: the signed-in browser's 60/0/0 section counts did not equal the earlier direct-reader session's 60/1/2 counts. This may be a legitimate difference in session, user, filter, selection, or adopted revision, but that explanation has not been proved. It must be investigated independently.

The browser evidence proves:

- normal TEST refresh completed;
- the fully reserved James recoveries did not leak into the displayed Workbench;
- no Banking Pay HTTP request failed during the final check.

It does not prove:

- that the direct DB session and signed-in browser session were the same authority;
- that the £25.00 control was user-visible in that final browser session;
- complete browser-to-reader parity for Cases and Blocked;
- same-modal mutation adoption;
- Draft cancellation, execution, settlement, or remittance behaviour.

Do not weaken the recovery exclusion, residual validator, section reader, or frozen-sibling fence merely to make section counts agree. First trace the exact browser session/version, backend request scope, filters, response counts, and frontend adoption state.

## 11. Required independent verification checklist

### Repository and catalogue

1. Confirm backend `test` points to `28265873244bb5345440078c38a2a7921ded5334` or a proven descendant containing the same change.
2. Review the exact parent-to-commit diff and prove only the nine listed backend files changed.
3. Confirm each affected function has one final repeatable owner and is not overwritten by a later repeatable.
4. Confirm both catalogue manifests contain the installed hashes.
5. Recompute source/catalogue hashes and compare them with the live TEST catalogue.
6. Confirm owner, `SECURITY DEFINER`/invoker state, search path, volatility, parallel safety, and ACLs.
7. Confirm the migration workflow contains the focused test and the successful run belongs to the exact backend SHA.

### Residual semantics

8. Prove the helper is table-free and cannot obtain live financial identity itself.
9. Prove the publisher is the sole source of the v1 residual contract.
10. Prove both readers validate current active reservation ownership set-wise.
11. Prove a fully reserved recovery is absent.
12. Prove a partial reservation exposes only the positive residual exactly once.
13. Prove a zero-reservation recovery is not suppressed merely because a sibling is reserved.
14. Prove missing, stale, malformed, mismatched, zero, and negative residual evidence fails closed.
15. Prove the strict frozen-sibling and exact frozen-timesheet/component fences remain intact.
16. Prove count and row selection share one eligibility identity in the page reader.

### Adjacent consequences

17. Check all supported batch states used by the active-reservation aggregate. Verify released/cancelled reservations stop owning value at the correct established boundary and no provider-submitted or settled state is reinterpreted.
18. Confirm Draft creation can reserve only the published residual and cannot draft an already reserved amount a second time.
19. Confirm Draft cancellation/release can cause a normal audited rebuild without stale residual evidence becoming current.
20. Confirm no recovery/VAT/ERNI/headroom formula changed and signs remain correct.
21. Confirm PAYE, Umbrella, ordinary timesheet, resolved-rate, finance-case, and zero-headroom presentation families are unchanged outside the narrow recovery residual predicate.
22. Confirm cursor ordering, filters, counts, and pagination at limits 1 and 100.
23. Re-run bounded performance tests and inspect for repeated correlated reservation scans, disk reads, or temporary spill.
24. Investigate the direct-reader 60/1/2 versus browser 60/0/0 discrepancy from exact session and response evidence.
25. Confirm no same-modal, batch-list, cancellation, authentication, or close-stack code changed; run read-only modal navigation checks if useful.
26. Run Supabase security and performance advisors and separate pre-existing notices from anything caused by this change.

### State safety

27. Before any mutation-capable test, record exact TEST identifiers, starting status, frozen totals, reservation totals, provider submission state, and expected postcondition.
28. Do not execute, cancel, restore, settle, submit, drain, replay, or modify a payment merely to verify this reader fix without fresh explicit authority.
29. If a defect is found, stop after diagnostics and provide a narrow implementation plan, rollback, and regression matrix. Do not opportunistically refactor the large reader functions.

## 12. Policy X assessment

The intended implementation is Policy X compliant:

- the new contract is published pre-Draft by the canonical source builder;
- active reservation ownership is used only to prevent duplicate pre-Draft presentation and to prove a current residual;
- frozen Draft items remain authoritative post-Draft;
- no live finance-component fallback was introduced post-Draft;
- no economic-key derivation ladder was added;
- no recovery, VAT, ERNI, selected-headroom, provider, settlement, remittance, or cancellation calculation was changed;
- malformed or stale evidence fails closed.

The independent verifier should reject the implementation if current source or runtime evidence contradicts any of those statements.

## 13. Expected verifier output

Return one of:

### Verified

State exactly what was checked, give current commit/catalogue identities, report the reader/browser parity explanation, and list any residual limitations. Do not merely say the tests passed.

### Further work required

Give:

1. exact defect and evidence;
2. affected owner boundary;
3. why the existing implementation is insufficient;
4. smallest safe file/function set;
5. Policy X analysis;
6. rollback strategy;
7. executable regression and live TEST verification plan;
8. explicit confirmation that unrelated payment, modal, cancellation, settlement, and remittance behaviour will remain unchanged.

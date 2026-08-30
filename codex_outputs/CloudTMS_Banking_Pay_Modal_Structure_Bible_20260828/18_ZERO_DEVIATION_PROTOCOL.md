# Zero-deviation verification protocol

## Purpose

This protocol makes the Bible executable as a control system. It applies to every implementation change, including tests, SQL, Worker routes, frontend modules, copy and release configuration.

## Before touching a file

The implementer must record:

- exact task authority;
- current frontend/backend commits;
- clean worktree locations;
- dirty-work preservation proof;
- current applicable instruction hashes;
- current Banking Pay Bible hash;
- current canonical audit hash;
- current installed RPC hashes/properties;
- affected BP, MSG, action, API/RPC, fixture and performance IDs;
- planned files and expected behaviour change.

If the affected IDs cannot be identified, stop. The change is not sufficiently understood.

## For every patch

Complete `15_STEP_VERIFICATION_RECORD_TEMPLATE.md`.

The patch must have:

1. a single bounded purpose;
2. named controlling requirements;
3. a pre-change characterization or failing contract test;
4. implementation;
5. scoped test results;
6. relevant wider regression results;
7. source-guard results;
8. performance impact where applicable;
9. updated execution/evidence ledgers;
10. a reviewer conclusion of PASS before the next dependent patch.

## Continuous comparison rules

After every patch, mechanically reject:

- any main-table fifth column;
- main-row expansion or nested payment DOM;
- new main candidate search state/control/request;
- browser amount/deduction/recovery arithmetic;
- candidate selection fan-out;
- Candidate Banking filtering after limit;
- Ready refresh without same-revision Blocked settlement;
- indefinite snooze presence in Banking Pay;
- raw technical user wording where an approved MSG replacement exists;
- removal of a guarded handler before passing replacement evidence;
- changed Draft/provider/post-Draft owner;
- unapproved LIVE or destructive reference.

## Completion standard for a requirement

A `BP-*` row is PASS only with:

- current-owner evidence;
- future-owner evidence;
- success test;
- stale/failure/no-op test where applicable;
- user-visible location proof;
- rollback/fallback proof;
- no duplicate owner;
- exact evidence IDs in the ledger.

A `MSG-*` row is PASS only with:

- exact current trigger;
- exact approved replacement;
- correct fact/code mapping;
- layout proof;
- negative test proving technical/raw fallback is not shown incorrectly.

An action row is PASS only with:

- visible entry point or documented unchanged internal entry;
- exact request payload parity;
- exact route/RPC authority;
- success, no-op, stale and failure behaviour;
- post-mutation settlement;
- no duplicate dispatch;
- fallback proof.

## Deviation levels

| Level | Meaning | Required response |
| --- | --- | --- |
| D0 | Pure implementation detail with no contract, authority, UI, copy, performance or lifecycle effect | Record in deviation ledger; technical review before merge. |
| D1 | Different technical mechanism that claims identical contract | Stop dependent work; executable equivalence evidence and reviewer approval required. |
| D2 | Product, wording, functionality, authority, economic, lifecycle or accepted performance deviation | Stop all affected work; explicit user approval and Bible update required before continuing. |
| D3 | LIVE, destructive database, provider/payment, settlement, remittance, secret or security-boundary expansion | Not authorised by this pack. Stop and request exact separate authority. |

Silence is not approval. A code comment is not a deviation approval.

## Phase closure

At the end of each phase:

- all phase ledger rows are PASS;
- no required evidence field is blank;
- no D1/D2 deviation is open;
- all failing tests are explained and resolved;
- source and installed/deployed evidence remain distinguished;
- exact rollback remains available;
- next phase entry gate is independently checked.

No partial v2 user activation is permitted.


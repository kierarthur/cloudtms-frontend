# Required test fixture catalogue

## Fixture discipline

Every fixture must record:

- fixture ID;
- exact starting session/version/progress state;
- candidate, pay channel and economic identities using safe TEST-only references;
- selected/unselected state and explicit override state;
- expected Ready/Action/Updating/Blocked/Snoozes owner;
- expected candidate amount, Deductions and headline contribution;
- expected Timesheet scope;
- expected Draft-selected identities;
- expected post-action state;
- restoration procedure and proof.

Never rely on names alone. Never leave mutated TEST fixture state behind.

## A. Amount and economic-identity fixtures

| ID | Family | Essential proof |
| --- | --- | --- |
| AMT-001 | Ordinary PAYE | Current compact Ready display amount; PAYE net contributes nothing pre-Draft. |
| AMT-002 | VAT-aware Umbrella | Existing display/VAT precedence; no ex-VAT plus VAT double counting. |
| AMT-003 | Timesheet parent with promoted children | Parent XOR children contribute, never both. |
| AMT-004 | `TS_DAY` | Exact date-bucketed day identity; synthetic total excluded. |
| AMT-005 | Expense | Exact promoted expense amount; no parent duplication. |
| AMT-006 | Additional payment | Exact signed current amount. |
| AMT-007 | Manual debt recovery | Current recoverable/scheduled display behaviour; outstanding balance not substituted. |
| AMT-008 | Full overpayment recovery | Exact negative current recoverable amount. |
| AMT-009 | Partial overpayment recovery | Negative capped Ready part; passive residual separate in Blocked. |
| AMT-010 | Loan repayment | Current negative repayment, not loan balance. |
| AMT-011 | Payment-advance repayment | Current negative repayment, not advance balance. |
| AMT-012 | Standalone finance adjustment | Canonical signed display; no component duplication. |
| AMT-013 | Resolution-derived Ready | Refreshed Ready identity/amount only; former task contributes zero. |
| AMT-014 | Manual carry-forward | Current display precedence; no VAT duplication. |
| AMT-015 | Correction carrier | Current canonical carrier only; replaced source excluded. |
| AMT-016 | Synthetic Timesheet total | Zero contribution where valid child allocation owns value. |
| AMT-017 | Duplicate negative presentation parent | Recovery sibling contributes; presentation parent zero. |
| AMT-018 | Frozen post-Draft overlap | Zero pre-Draft contribution; frozen artefact remains owner. |
| AMT-019 | Zero-current-value identity | Zero and absent from selectable candidate membership. |

Each AMT fixture must prove selected contribution, unselected zero contribution, candidate amount, full headline, Deductions classification, exact Draft identity and no negative-zero display.

## B. Candidate aggregation and selection fixtures

| ID | Scenario | Required result |
| --- | --- | --- |
| SEL-001 | One candidate, one Ready payment, selected | Checked; exact amount; candidate present. |
| SEL-002 | One candidate, one Ready payment, unselected | Unchecked; £0.00; candidate present. |
| SEL-003 | Multiple Ready, all selected | Checked; complete selected sum. |
| SEL-004 | Multiple Ready, some selected | Indeterminate; selected-only amount/Timesheets/deductions. |
| SEL-005 | Multiple Ready, none selected | Unchecked; £0.00; disabled Timesheets shortcut. |
| SEL-006 | No selectable Ready | Candidate absent; other-view counts unaffected. |
| SEL-007 | More than 100 candidate Ready payments | Candidate checkbox covers complete set, not loaded child page. |
| SEL-008 | Candidate SELECT all | One mutation/revision; every final selectable Ready selected. |
| SEL-009 | Candidate CLEAR all | One mutation/revision; every final selectable Ready unselected. |
| SEL-010 | Candidate select overrides prior individual unselection | Final ALL intent and correct recovery result. |
| SEL-011 | Candidate clear establishes explicit clear intent | Newly final Ready remains unselected. |
| SEL-012 | Individual after candidate all | Candidate becomes SOME, exact live amount. |
| SEL-013 | Candidate all after individual clear | Candidate returns ALL. |
| SEL-014 | Timesheet-group selection | Exact grouped IDs; candidate state updates. |
| SEL-015 | Global all-page selection | Complete filtered Ready section across all candidate pages. |
| SEL-016 | Global all-page clear | Complete filtered Ready section cleared. |
| SEL-017 | Cross-candidate isolation | No other candidate selection/recovery changes. |
| SEL-018 | Cross-channel isolation | PAYE/Umbrella partition preserved. |
| SEL-019 | Genuine no-op | Typed no-op, no partial write, truthful final authority. |
| SEL-020 | Duplicate submission | One accepted outcome/audit; no double mutation. |
| SEL-021 | Stale session version | Typed rejection; prior accepted UI retained/refreshed. |
| SEL-022 | Stale progress revision | Typed rejection; current authority reloaded. |
| SEL-023 | Transport uncertainty | No blind retry; read-back settles exact state. |
| SEL-024 | Rapid conflicting intents | Ordered/superseded; only newest legal outcome publishes. |

## C. Recovery promotion/demotion fixtures

| ID | Scenario | Required result |
| --- | --- | --- |
| REC-001 | Zero available funds | Deduction Blocked as `Insufficient funds to deduct`. |
| REC-002 | Exact available funds | Full Ready deduction under current order. |
| REC-003 | Partial available funds | Ready capped part and passive residual identity where current authority creates one. |
| REC-004 | Earlier deduction consumes funds | Deterministic existing allocation order preserved. |
| REC-005 | Positive payment unticked | Recovery demotes Ready→Blocked at same revision. |
| REC-006 | Positive payment ticked | Recovery promotes Blocked→Ready at same revision. |
| REC-007 | Explicit recovery unselected override | Newly eligible recovery stays unselected under current rule. |
| REC-008 | Candidate SELECT all with previously blocked override | Candidate intent yields every final selectable Ready selected. |
| REC-009 | Candidate CLEAR all | Final candidate Ready set unselected after revalidation. |
| REC-010 | Main/Candidate/Blocked open together | No duplicate identity and one atomic render. |

## D. Timesheet-scope fixtures

| ID | Scenario | Required result |
| --- | --- | --- |
| TS-001 | Selected ordinary payment with one Timesheet | Exact one ID. |
| TS-002 | Unticked-only payment | ID absent. |
| TS-003 | Selected and unselected payments share ID | ID appears once. |
| TS-004 | Selected non-Timesheet payment | Disabled icon and exact tooltip. |
| TS-005 | No selected payments | Disabled icon and exact tooltip. |
| TS-006 | Exactly 25 distinct IDs | Inline exact IDs. |
| TS-007 | 26 distinct IDs | Opaque deferred token; one exact resolution read. |
| TS-008 | Stale token | Typed rejection; never broadens to candidate search. |
| TS-009 | Reclassification changes selected Timesheet membership | Shortcut updates at accepted revision. |
| TS-010 | Main shortcut interaction | Timesheets summary updates; Banking Pay remains open; no row double-click. |
| TS-011 | Candidate payment/group shortcut | Exact payment/group IDs only. |
| TS-012 | Action task detail | Exact union of affected payment Timesheets. |
| TS-013 | Blocked detail | Exact linked Timesheet where present. |

## E. Sorting, filters and pagination fixtures

| ID | Scenario | Required result |
| --- | --- | --- |
| PAGE-001 | Candidate A–Z/Z–A | Whole result sorted before page. |
| PAGE-002 | Duplicate names | Reference and UUID stable tie-break. |
| PAGE-003 | Deductions ascending/descending | Dash/Yes order exact; stable ties. |
| PAGE-004 | Amount low/high | PostgreSQL numeric sort, not formatted text. |
| PAGE-005 | Zero/negative/large amount | Exact deterministic order. |
| PAGE-006 | Candidate 101 | Appears only on correct second page. |
| PAGE-007 | Stale cursor | Typed first-page recovery; no hidden rows. |
| PAGE-008 | Malformed/cross-scope cursor | Nonmutating typed failure. |
| PAGE-009 | Sort change | Cursor reset; first page. |
| PAGE-010 | Candidate filter | Canonical UUID scope; Draft parity. |
| PAGE-011 | Client filter | Canonical UUID scope; intersection. |
| PAGE-012 | ALL/PAYE/Umbrella | Current channel semantics and hidden selection preservation. |
| PAGE-013 | Filter adoption failure | Prior list remains; visible failure. |
| PAGE-014 | Amount-sort mutation | At most one anchored reconciliation; no visibly misordered row. |
| PAGE-015 | Membership change | Remove/backfill correctly without duplicate/skip. |
| PAGE-016 | Search absence | No main search control, state, hash or network parameter. |

## F. Candidate Banking fixtures

| ID | Scenario | Required result |
| --- | --- | --- |
| CB-001 | Candidate with mixed Ready/Case/Blocked source | Only Ready returned because filtering precedes limit. |
| CB-002 | 100 Case rows before one Ready in current order | Ready still appears in Ready-only read. |
| CB-003 | More than 100 Ready | Correct keyset pages and complete candidate selection state. |
| CB-004 | Every current line family | Exact fields/actions/breakdown retained. |
| CB-005 | Segment/expense expansion | Candidate modal only; every identity retained. |
| CB-006 | Exclude/include Timesheet | Exact expected revisions and settlement. |
| CB-007 | Ready snooze controls | Current guards and final owner. |
| CB-008 | Clear resolved rate | Exact BUCKETED owner and confirmation. |
| CB-009 | Clear pay-channel resolution | Correct finance-case family. |
| CB-010 | Clear gross-total resolution | Exact current owner/linkage. |
| CB-011 | Candidate loses final Ready | Truthful empty child; main row removed; Blocked/Action do not leak in. |
| CB-012 | Close modal | Main page/sort/filter/scroll/focus restored with updated facts. |
| CB-013 | Export candidate Ready | All candidate Ready pages, no Action/Blocked, visible cursor unchanged. |

## G. Action Required and Updating fixtures

| ID | Scenario | Required result |
| --- | --- | --- |
| AR-001 | Suggested/manual rate | One task, exact basis/actions. |
| AR-002 | Manual amount/gross total | One task, exact amounts/actions. |
| AR-003 | Bucketed resolution | Exact bucket identity and current action. |
| AR-004 | Non-bucketed resolution | Correct family/owner. |
| AR-005 | PAYE→Umbrella | Exact accepted directional wording and restructure. |
| AR-006 | Umbrella→PAYE | Exact reverse wording. |
| AR-007 | Candidate bank details missing | Correct owner and action. |
| AR-008 | Umbrella bank details missing | One shared task; all affected candidates visible. |
| AR-009 | Account-name PASS | Ready/setup transition under current authority. |
| AR-010 | Close match | Review/accept action and exact wording. |
| AR-011 | FAIL | Definite mismatch wording; mandatory audited reason where accepting. |
| AR-012 | Unavailable | Distinct wording/action from FAIL. |
| AR-013 | Payee/account setup required | Action Required→Updating. |
| AR-014 | Inactive umbrella | One shared activation task. |
| AR-015 | Retryable failure | Retry action; then Updating. |
| AR-016 | Queued/pending/running | Updating only; counts exclude Action/Blocked. |
| AR-017 | Successful job | Updating→Ready. |
| AR-018 | Failed job with action | Updating→Action Required. |
| AR-019 | Failed job without action | Updating→Blocked. |
| AR-020 | Shared task pagination | Dedupe before page; every affected payment in detail. |

## H. Blocked and Snoozes fixtures

| ID | Scenario | Required result |
| --- | --- | --- |
| BL-001 | Insufficient funds | Exact approved wording and server amount facts. |
| BL-002 | Partial residual | Scheduled/current/outstanding kept distinct. |
| BL-003 | Dated snooze/on hold | Blocked under current policy; manage/clear where permitted. |
| BL-004 | Do Not Pay | Passive unselectable Blocked. |
| BL-005 | Blocked Timesheet | Exact reason and Timesheet shortcut. |
| BL-006 | Terminal non-actionable failure | Visible system blocker and safe support reference. |
| BL-007 | Unknown external issue | `Payment issue not identified` plus fail-closed explanation. |
| BL-008 | Indefinite snooze | Absent from every Banking Pay view/count/amount/message. |
| BL-009 | Indefinite snooze cleared | Reclassified from current truth; not assumed Ready. |
| BL-010 | No blocked payments | Exact approved empty state. |

## I. UX, wording and accessibility fixtures

- Exactly four main cells and 100 one-line rows.
- No main expansion DOM, `aria-expanded`, `<details>`, child rows or card transformation.
- Candidate/reference, long values and large currency at 100/125/150/200% zoom.
- All columns remain available with bounded horizontal overflow.
- Double-click only non-interactive row area.
- Checkbox/Timesheet/link/button propagation suppression.
- Semantic headers and announced sort direction.
- Checkbox label and native mixed state.
- Busy/error relationships and focus restoration.
- Every `MSG-*` trigger with exact replacement and fallback negative test.
- No technical raw enum/field name shown where approved wording applies.

## J. Draft, Policy X and later lifecycle fixtures

- Same selected preview-row IDs and economic keys.
- Same candidate, Timesheet, finance case and component IDs.
- Same recovery reservations and Draft blockers.
- Same frozen Draft manifest/hash.
- Active frozen overlap excluded.
- `TS_DAY` date bucket unchanged.
- No post-Draft live fallback.
- No change to PAYE entry, provider submission, settlement, remittance, cancellation, alerts or audit history.

## K. Failure and concurrency fixtures

- Authentication failure is not an empty table.
- Dependency failure is not a business rejection.
- Invalid amount/selection authority is visible and fail closed.
- Ready/Blocked revision mismatch prevents adoption.
- Duplicate identity prevents adoption.
- Same identity in two sections prevents adoption.
- Module load failure falls back only before mutation.
- No fallback after dispatch or uncertain outcome.
- Modal close aborts readers/listeners without publishing late results.
- Twenty open/close cycles show no duplicate polling/listeners.


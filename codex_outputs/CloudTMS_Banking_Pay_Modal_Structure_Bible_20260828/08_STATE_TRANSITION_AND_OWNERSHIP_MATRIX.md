# State transition and economic-identity ownership matrix

## Core rule

At one accepted Workbench revision, one economic identity has exactly one effective pre-Draft owner:

```text
READY
ACTION_REQUIRED
UPDATING
BLOCKED
HIDDEN_INDEFINITE_SNOOZE
EXCLUDED_POST_DRAFT
```

The browser may never hold or render the same identity in more than one effective view.

Task details may reference related payments without becoming their effective owner. For example, a case can include a related Ready payment and a passive deduction as context while other rows require a decision. Such references carry explicit `context_only=true` in the private task-member projection. They must not be used to move that payment into Action Required, remove it from Ready/Blocked, change its selection or double-count it as an actionable payment. The original current row payload remains controlling. STEP-027 / EVIDENCE-0043.

## Legal transitions

| From | To | Typical trigger | Required settlement |
| --- | --- | --- | --- |
| Ready | Ready | Pure tick/untick with no eligibility change | Update selection, candidate amount, deductions, headline and Draft gate. |
| Ready | Blocked | Reduced available funds, snooze, exclusion or current passive blocker | Remove from Candidate Banking/main aggregate if final Ready; add/invalidate Blocked; same revision. |
| Blocked | Ready | Increased selected positive pay, dated hold cleared or authority becomes eligible | Remove from Blocked; add Ready; apply current recovery selection override rule; same revision. |
| Action Required | Updating | User starts account check/setup/retry or another asynchronous action | Remove from Action Required task count; add Updating; preserve affected scope. |
| Action Required | Ready | Synchronous accepted resolution and completed authoritative rebuild | Remove task; add current Ready identities only after refresh. |
| Action Required | Blocked | Resolution/action completes but payment has a passive blocker | Remove task; add passive Blocked identity. |
| Updating | Updating | Job progress changes | Update progress only; no Action Required/Blocked count inflation. |
| Updating | Ready | Job succeeds and Workbench publishes Ready | Remove Updating; add Ready at accepted revision. |
| Updating | Action Required | Job fails with a published safe user action | Remove Updating; create one deduplicated task. |
| Updating | Blocked | Terminal failure with no user action | Remove Updating; add passive system blocker. |
| Ready/Action/Updating/Blocked | Hidden indefinite snooze | Indefinite snooze becomes current | Remove from every Banking Pay row/count/amount/message before pagination. |
| Hidden indefinite snooze | Appropriate current owner | Indefinite snooze cleared through Snoozes authority | Reclassify from current Workbench truth; do not assume Ready. |
| Any pre-Draft owner | Excluded post-Draft | Active/frozen Draft overlap or Draft creation | Remove from live pre-Draft authority; frozen Draft becomes owner. |

## Prohibited transitions/publication

- Ready and Blocked published from different revisions.
- Action Required task left visible after it becomes Updating.
- Updating and Blocked both counting the same failed job.
- Blocked row copied into Candidate Banking.
- Candidate main row retained with no selectable Ready identity.
- Indefinite snooze retained as a hidden/count-only Banking Pay fact.
- Frozen post-Draft identity reintroduced from current live truth.
- Stale compatibility alias republishing an identity that moved.

## Selection mutation settlement

Every selection intent uses:

```text
QUEUED
→ DISPATCHED
→ SERVER_ACCEPTED
→ RECONCILING
→ VALIDATED
→ ADOPTED
```

Terminal alternatives:

```text
REJECTED_TYPED
TRANSPORT_UNCERTAIN
SUPERSEDED
FAILED_VISIBLE
CLOSED
```

### Validation before adoption

- Session UUID matches.
- Session version and progress revision match the accepted mutation.
- Scope/filter/channel hash matches.
- Every economic identity is non-empty and unique.
- Ready and Blocked are disjoint.
- Action Required task identities are deduplicated.
- Updating job/task identities are deduplicated and excluded from Action/Blocked counts.
- Candidate amount, Deductions, selected Timesheets and headline belong to the same revision.
- Draft gate belongs to the same revision.
- Any required sorted-page reconciliation is complete.

### One atomic commit

Commit together:

- main candidate row/membership;
- candidate checkbox;
- candidate Ready-to-pay amount;
- Deductions;
- selected Timesheet scope/token;
- full headline and counts;
- Draft gate;
- Candidate Banking page if open;
- Action Required/Updating/Blocked counts;
- open affected task/blocker pages;
- economic-identity ownership index;
- all render-consumed compatibility aliases.

No partial DOM render is permitted.

## Transport uncertainty

If a request may have reached the server but the response is lost:

1. Do not retry the mutation automatically.
2. Do not pretend the prior checkbox state is authoritative.
3. Keep amount/count/Draft facts non-optimistic and busy.
4. Perform one bounded current-authority read-back.
5. Settle from server truth.
6. Record the incident and terminal state.

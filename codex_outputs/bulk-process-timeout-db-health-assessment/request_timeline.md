# Request timeline from supplied browser snapshot

This file reconstructs the relevant request sequence from the user's browser performance snapshot. It is evidence-only; it was not reproduced by Codex.

## High-level timeline

| Phase | Approx duration | Route(s) | Interpretation |
|---|---:|---|---|
| Modal open / initial dataset | Fast | Bulk Process dataset, manual queue, initial row-context | Initial load was not the bottleneck. |
| Initial row context | <1s | `GET /api/timesheets/bulk-process-row-context?...contract_week...` | Contract-week target context was initially responsive. |
| First process/manual upsert | ~5.1s | `POST /api/contract-weeks/dfd64693-236c-46eb-b1e8-6ac64936ba7b/manual-upsert` | Slow but bounded first mutation. |
| Continued user activity | mixed | row-context profiles, presign/download, `changes/ping` | Modal continued to create API/R2 work while user switched evidence and thumbnails. |
| Second same-row upsert | ~16.8s | same `manual-upsert` | Latency worsened for same contract week. |
| Degraded/unhealthy window | ~463-499s | same `manual-upsert`, `changes/ping`, file download, auth refresh | Multiple unrelated routes hung simultaneously, indicating backend/DB/connection saturation rather than one bad image. |
| Recovery/partial render | after stall | Attached preview rendered | Preview itself was not permanently broken; route/backend health had degraded during the event. |

## Grouped by route

### `POST /api/contract-weeks/dfd64693-236c-46eb-b1e8-6ac64936ba7b/manual-upsert`

Observed durations:

- ~5.1s
- ~16.8s
- ~499s

Assessment:

- Same contract-week mutation route repeated in one modal session.
- Backend static inspection shows the route's primary atomic RPC call has no explicit `timeoutMs`, unlike many adjacent Bulk Process helper RPC calls.
- The ~499s entry is the strongest evidence of a non-fast-failing mutation path.

### `POST /api/changes/ping`

Observed durations:

- ~10.6s
- ~496s
- ~6.3s

Assessment:

- Heartbeat continued during Bulk Process modal activity and backend degradation.
- The ~496s entry overlaps the ~499s manual-upsert window.
- A heartbeat should never be able to hang for minutes or contribute to DB pressure; it should fail fast and return a degraded empty response.

### `GET /api/files/download?...`

Observed durations:

- ~463s for one image request
- ~4.2s for another image request
- Several repeated image/iframe download entries

Assessment:

- Repeated thumbnail/tab switching likely created repeated browser-level downloads.
- Static backend inspection shows file download is primarily token/R2 work but calls `writeAudit` before returning OK and on failure paths, which couples download completion to DB availability.
- The 463s file request overlaps the long mutation/heartbeat window, so it was probably a victim/amplifier of global backend/DB/connection saturation.

### `/auth/refresh`

Observed duration:

- ~71s

Assessment:

- Auth refresh delay indicates broad backend/session/connection degradation.
- This is likely a victim rather than the initiating route.

### `GET /api/timesheets/bulk-process-row-context`

Observed patterns:

- Repeated calls for `profile=editor`.
- Repeated calls for `profile=evidence`.
- Repeated calls for `profile=status_header`.

Assessment:

- Frontend has cache/stale guards, but in-flight dedupe includes request token identity and does not abort the underlying fetch. Repeated row changes/profile refreshes can therefore create multiple DB/RPC-backed row-context calls.
- Backend route calls `bulk_process_row_context_v1` with a 45s timeout, which is better than unbounded, but still too long to allow many concurrent modal requests during a degraded mutation.

### `POST /api/files/presign-download`

Observed patterns:

- Repeated presign calls interleaved with row-context and downloads.

Assessment:

- Preview has some presign caching and in-flight dedupe, but repeated owner/selection contexts can still start fresh presign work.
- Presign route also authenticates and may call `ensureTimesheetPdf` for canonical generated timesheet PDF keys; for normal evidence image keys it should usually be R2-head/token work.

## Concurrency overlaps

The key overlap is:

```text
manual-upsert ~499s
├─ changes/ping ~496s overlaps almost entirely
├─ files/download ~463s overlaps most of the same window
├─ auth/refresh ~71s occurs during degraded backend/session period
└─ repeated row-context + presign/download requests are interleaved
```

This concurrency shape rules out a single slow image as the only root cause. A more plausible explanation is a long-running/blocked mutation path plus continued frontend/backend request creation without strong enough cancellation, backpressure, or fast-fail limits.

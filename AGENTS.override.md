# CloudTMS LIVE Frontend — Desktop Override

This repository publishes the CloudTMS LIVE browser at
`https://cloudtms.arthur-rai.co.uk`. It is a Codex desktop workspace, not the
former `/workspace` cloud container and not the TEST frontend repository.

The authoritative shared rules are in the parent workspace file:

```text
C:\Users\KierArthur\OneDrive - Arthur Rai\Documents\GitHub\AGENTS.md
```

Apply that file in full. Ignore cloud-only assumptions in the imported legacy
`AGENTS.md` in this directory, including `/workspace` paths,
frontend-primary container ownership, backend GitHub read-only status, forced
backend restoration, mandatory patch/replacement handoff solely because of
cloud permissions, and its statement that this repository itself is TEST-only.
TEST remains a separate protected environment and must never be changed merely
because LIVE source is promoted from a proved TEST commit.

Frontend-specific desktop rules:

- Work directly in this local frontend clone when requested.
- Treat `CNAME=cloudtms.arthur-rai.co.uk` and
  `https://cloudtms.kier-88a.workers.dev` as the LIVE publication boundary.
- LIVE backend database traffic must resolve through
  `cloudtms-live-miget-gateway` to the independently credentialed LIVE Miget
  PostgreSQL/PostgREST service. Historical `SUPABASE_*` names are compatibility
  names only and must never be routed to Supabase.
- A TEST-to-LIVE code promotion must preserve LIVE-only hostnames, credentials,
  feature gates and data. It must not copy TEST credentials, TEST data, TEST
  Worker routes or TEST activation state.
- Preserve unrelated local and user changes.
- Keep UI dates/times as `DD/MM/YYYY hh:mm:ss`, 24-hour clock.
- Verify frontend patches using a proven patched asset, not merely the deployed old TEST asset.
- Never expose Playwright environment variables or authentication state.
- Do not deploy TEST or LIVE unless the user explicitly requests the exact deployment.
- Do not mutate TEST data without explicit approval for the exact action and identifiers.
- Do not modify backend code unless the task includes backend work.
- If backend work is included, edit the local backend clone directly and follow its desktop override.


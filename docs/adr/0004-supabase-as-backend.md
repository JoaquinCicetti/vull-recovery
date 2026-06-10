# ADR 0004 — Supabase as backend

- **Status:** Accepted
- **Date:** 2026-05-28

## Context
We need a database, auth, file storage, server-side logic, and stable webhook
endpoints — all at zero fixed cost (ADR 0001).

## Decision
Use **Supabase** (free tier): Postgres + Row Level Security, Auth, Storage, and
Edge Functions (Deno). Privileged logic (holds, payment confirmation) runs in
Edge Functions with the service-role key; the browser uses the anon key under
RLS.

## Consequences
- One platform covers DB/auth/storage/functions with generous free limits
  (500 MB DB, 50k auth MAU, 500k function calls, Storage).
- **Gotcha:** free projects pause after ~7 days idle → `keep-alive` function +
  external weekly cron.
- Edge Functions are Deno, so they are excluded from the Next.js TypeScript/ESLint
  scope (`tsconfig` / `eslint.config.mjs`) and validated via the Supabase CLI.
- RLS protects the browser surface; service-role bypasses RLS for server writes.

## Alternatives considered
- Firebase — weaker relational/SQL story (we rely on a Postgres `EXCLUDE`
  constraint, ADR 0007) and pricing model.
- Custom Node/Express server — adds hosting cost and ops. Rejected.

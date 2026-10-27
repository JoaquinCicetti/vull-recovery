# ADR 0015 — Latency: the Worker runs at the database's region, pages make one round trip

- **Status:** Accepted
- **Date:** 2026-10-20

## Context
The owner measured the admin agenda and settings at up to 5 s, and the
availability grid at 1.5–3 s, on a normal connection in Buenos Aires. Measured
from Buenos Aires on 2026-10-20:

| Hop | Time |
| --- | --- |
| TLS handshake to AWS sa-east-1 (São Paulo) | 0.14 s |
| TLS handshake to AWS us-west-2 (Oregon, where the Supabase project is) | 0.76 s |
| One PostgREST query (`select id from sectors limit 1`) | 0.29–0.77 s (server time 19 ms) |
| One Auth call (`getUser`) | 0.29–0.45 s |
| `availability` Edge Function, pinned to us-west-2, warm | 1.1–1.4 s |

The site's Worker ran in Buenos Aires: the `cf-placement` header on every
dynamic page said `local-EZE`. Smart Placement had been enabled in
`wrangler.jsonc` but never activated (it needs sustained traffic from several
locations to make a decision). So every page paid the Oregon round trip once
per query, and the pages queried in sequence: `requireAdmin()` did a
`getUser()` call and then a profile read, then the page's own reads, then
(agenda) the abono maintenance RPC, then the view's query, then an async
server component's query. Six to nine round trips at ~300 ms each is the 2–5 s
the owner saw. The Edge Functions were already pinned to the DB region (see
`lib/supabase/client.ts`), but `availability` ran the membership housekeeping
pass and a Google freeBusy call on every grid load.

## Decision
1. **The Worker is placed next to the database.** `wrangler.jsonc` sets
   `placement.region = "aws:us-west-2"` (explicit hint, not Smart mode). A
   visitor pays one long hop to the Worker; the Worker's own queries are a few
   milliseconds each. Static assets and prerendered pages are still served from
   the nearest edge. Verify after a deploy with
   `curl -sI https://www.vull.com.ar/login | grep cf-placement` — it must say
   `remote-…`, not `local-…`.
2. **The session is verified locally.** `lib/auth.ts` uses `getClaims()`
   (ES256 signature against the project's JWKS, cached 10 min per isolate)
   instead of `getUser()`. `getSessionUser()` costs no round trip;
   `getUserAndProfile()` costs the one profile read.
3. **One `Promise.all` per page, with the auth check inside it.** `requireAdmin()`
   / `requireUser()` run alongside the page's reads. RLS already scopes every
   row by the cookie, so a non-admin's reads return nothing useful before the
   redirect lands. Pages that only need `user.id` use `requireSession()`.
   Async server components that query (the agenda's flagged payments) are
   fed from the page's batch instead of querying after it.
4. **`availability` does its maintenance after answering.** `housekeeping()`
   goes through `defer()` (`EdgeRuntime.waitUntil`); the bookings read excludes
   lapsed holds itself; the Google freeBusy result is cached per isolate for
   60 s (the grid only — `create-booking` and `admin-booking` still read fresh).

## Consequences
- Page cost is now roughly one visitor→Oregon hop plus a few local queries.
  Expect ~0.3–0.5 s for an admin page instead of 2–5 s.
- The structural fix is still **a Supabase project in sa-east-1**: every hop
  (visitor, Worker, functions, Auth) becomes ~40 ms, and the `x-region` pin and
  the placement hint both become `sa-east-1`. Supabase cannot move a project
  between regions in place, so that is a new project and a data migration
  (runbook: `docs/runbooks/supabase-region-move.md`). Everything in this ADR
  stays valid after the move; it just gets faster.
- `profile.created_at` is read by `lib/auth` because the JWT does not carry
  it (the account page's "cliente desde").
- Edge Function cold starts (~0.5–1 s on a quiet site) are untouched; they are
  the next thing to measure if the grid still feels slow when warm calls are
  fast.

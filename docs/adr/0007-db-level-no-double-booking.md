# ADR 0007 — DB-level no-double-booking + lazy hold expiry

- **Status:** Accepted
- **Date:** 2026-05-28

## Context
Two clients could try to book the same slot simultaneously. We need correctness
without fragile application-level locking, and ideally without a cron job (free
tier).

## Decision
Enforce no overlap at the database with a Postgres **`EXCLUDE` constraint**:
`exclude using gist (during with &&) where (status in active states)` on
`bookings` (the `during` column is a generated `tstzrange`; `btree_gist` is
enabled). Pending bookings carry a `hold_expires_at`; **expired holds are freed
lazily** at the start of `availability` and `create-booking`.

## Consequences
- Overlapping bookings are impossible at the DB level; the loser gets Postgres
  error `23P01`, surfaced to the user as "that slot was just taken."
- No cron dependency: stale holds are expired on the next relevant request.
- Single-resource today; multi-room later = add `resource_id` to the constraint
  (`resource_id WITH =`), which is why `btree_gist` is already enabled.

## Alternatives considered
- Application-level check-then-insert — race-prone. Rejected.
- `pg_cron` for hold expiry — adds an extension dependency; lazy expiry is
  simpler and robust. Rejected.

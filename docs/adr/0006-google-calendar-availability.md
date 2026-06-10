# ADR 0006 — Google Calendar (service account) for availability

- **Status:** Accepted
- **Date:** 2026-05-28

## Context
Clients must see real availability, and the owner should manage the schedule in a
tool they already know — at zero cost.

## Decision
Read Google Calendar **`freeBusy`** through a **service account** (the center's
calendar is shared with the service-account email). The app computes open slots
from working hours minus busy blocks minus active bookings, and writes confirmed
bookings back as calendar events.

## Consequences
- Free (Calendar API ≈ 1M calls/day). The owner blocks/opens time in Google
  Calendar directly — no extra admin UI for availability.
- The API returns *busy*, not free slots → we compute slots app-side.
- The service-account JWT is signed in Deno via Web Crypto (RS256), no library.
- Degrades gracefully: if Google is unconfigured, availability uses DB bookings
  only.
- Single-resource assumption (one calendar / no parallel rooms) — see ADR 0007.

## Alternatives considered
- A custom in-app availability/working-hours UI — more to build and maintain.
- Per-user OAuth — unnecessary; a single shared service account is simpler.

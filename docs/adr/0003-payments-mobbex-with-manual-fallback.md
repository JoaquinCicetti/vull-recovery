# ADR 0003 — Payments via Mobbex, manual receipt as $0 fallback

- **Status:** Accepted
- **Date:** 2026-05-28

## Context
Clients pay for bookings (Argentina). We want automatic "this booking is paid"
confirmation with no fixed monthly cost. Bank transfers are common locally but
hard to reconcile automatically.

## Decision
Use **Mobbex** as the primary gateway: `create-payment` opens a checkout with
`reference` = booking id; the `mobbex-webhook` IPN confirms the booking
automatically. Keep **manual transfer-receipt upload + admin approval** as a
fallback that is truly $0.

## Consequences
- Automatic, unambiguous reconciliation tied to the booking id.
- Per-transaction fee, no Meta/MP monthly fee. However Mobbex's terms mention a
  **low-volume monthly minimum** → the manual fallback preserves the $0 path
  (ADR 0001).
- Mobbex sends no webhook signature → we authenticate the IPN with our own
  `?token=` secret on the webhook URL.
- Status mapping (`status.code` 200 = paid; 0/≥400 = rejected; else pending) must
  be confirmed against the live dashboard.

## Alternatives considered
- **Plain transfer + "concepto" reference matching** — no webhook from a bank
  account; the reference field is fragile. Rejected.
- **Per-order dynamic CVU** (Orkestra, Inswitch, dLocal, Pomelo) — exists, but
  enterprise/KYC, opaque pricing, monthly minimums; not self-serve. Rejected.
- **Open-banking readers** (Belvo, Prometeo) — sales-led, monthly minimums.
  Rejected for this scale.

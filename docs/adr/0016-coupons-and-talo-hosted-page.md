# ADR 0016 — Discount coupons, and paying on Talo's hosted page

- **Status:** Accepted
- **Date:** 2026-11-04

## Context
The owner wants simple discount codes: created by admins with a fixed percent,
entered when a payment is generated, with usage tracked and a way to disable them.

Separately, our payment screen showed a CVU and a faint "Abrir en Talo" link that
vanished on reload. Talo's hosted page has live status and returns the client to
us by itself.

## Decision

### Coupons
1. **Price lives on the payment.** `payments.amount_ars` is the discounted price
   and Talo's price matches it, so the settle check (ADR 0010) compares against the
   right number with no change. `coupon_id`, `coupon_pct` and `list_amount_ars` sit
   beside it. Not in `raw`, which settlement overwrites.
2. **Turnos and packs only.** Abono cuotas are charged in full, and
   `create-payment` refuses a code sent with one.
3. **Global, 1–99 %, unlimited uses.** 100 % can't go through Talo. Code and percent
   are fixed once created; a coupon can be disabled, not deleted.
4. **A use is derived:** an `approved` payment with `reversed_at is null`. With no
   usage cap nothing needs reserving, so abandoned CVUs, expiries and revived
   `rejected` rows need no release logic.
5. **The `coupons` table is admin-only, reads included,** so clients can't list
   codes. `create-payment` validates with the service role.
6. **On a second click:** a new code reprices a CVU that is still `PENDING`. With no
   code, a live CVU keeps its discount even if the coupon was disabled since, because
   the client may already be transferring that amount. A replacement for an expired
   CVU keeps the discount only if the coupon is still active.
7. **A cancelled discounted turno returns one full session credit,** like any other
   paid turno. The credit is a session, not an amount.

### Hosted page
8. **After generating a payment, the client goes to `payment_url`, same tab.** A
   reload or the way back shows "Continuar el pago", with the CVU/alias available by
   hand. The URL is stored in `payments.talo_payment_url`.
9. **We never send a client to an expired page.** Past expiry it still says
   "Esperando pago" and shows the alias.

Verified on sandbox on 2026-11-04: the page reflects a repriced amount, opens
`redirect_url` by itself on `SUCCESS`, and neither its URL nor its `/public` API
exposes `webhook_url`.

## Consequences
- **The webhook stays the source of truth.** Talo's page only informs the client;
  `talo-webhook` and `talo-reconcile` confirm turnos and grant credits, including
  when the client closes the tab. `SettlementPoller` stays for clients who return
  before settlement lands.
- We depend on Talo's page. Rows without a stored URL fall back to the CVU panel.
- Unused alternative: Talo's bundle has an undocumented Mercado Pago deep link
  (`mercadopago://money-out/transfers/new?data=…`, with the CVU and amount). We
  don't copy it, because it could change without notice and Talo's page already
  has the button.

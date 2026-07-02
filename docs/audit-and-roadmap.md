# Product audit & enhancement roadmap

> Audit date: 2026-06-30. Scope: move the prototype to a real product.
> Divided into **Security · Performance · Booking invariants · Admin & turns · Packs/balance · Notifications**.
> Priorities: **P0** = launch blocker / correctness-critical · **P1** = needed for a real product · **P2** = polish / later.
> Effort: S (hours) · M (1–2 days) · L (multi-day).

Each finding cites `file:line`. Nothing here has been implemented yet — this is the plan.

---

## 0. Launch blockers (fix before taking real money) 🔴

Two exploitable holes make the current build unsafe to run as a real product:

| # | Hole | Where | Exploit |
|---|------|-------|---------|
| **S1** | **Any logged-in user can make themselves admin** | `supabase/migrations/20260527090000_init.sql:164` (`profiles_update_own`) | RLS gates rows, not columns, and `authenticated` has table-level UPDATE. In the browser console: `supabase.from('profiles').update({is_admin:true}).eq('id', myUid)` → full admin (all PII, all bookings/payments, settings, `admin-payment`). |
| **S2** | **A booking can be confirmed without paying** | `supabase/functions/mobbex-webhook/index.ts:21` | The IPN trusts `payment.status.code===200` from the request body, never re-verifies with Mobbex, doesn't check amount, and the `token` check **fails open when `MOBBEX_WEBHOOK_SECRET` is unset** (`if (secret && ...)`). POST `{data:{payment:{reference:'<bookingId>',status:{code:200}}}}` → free confirmed turno. |

Fixes are S2-track P0 items below. These should land first.

**Status (2026-06-30):** ✅ **Both fixed.**
- **S1** — `supabase/migrations/20260630120000_profile_privilege_guard.sql` (column-grant lockdown + `guard_profile_privileges` trigger). Verified against a local stack: authenticated self-escalation → `permission denied`; trigger blocks it even with full column privileges; legit name edits and service-role promotion still work.
- **S2** — `mobbex-webhook` now fails closed without `MOBBEX_WEBHOOK_SECRET`, re-queries Mobbex server-side (`_shared/mobbex.ts`), checks the amount against the service price, and never inserts a payment from webhook input. Verified: forged IPNs → 401 / no-op (0 rows inserted). ⚠️ The Mobbex `/p/operations` response shape and the full paid-confirm happy path still need validation against a Mobbex **sandbox** payment (documented in ADR 0003).

---

## 1. Security

**Status:** ✅ **All done.** S1, S2 (Sprint 0); S3 (Sprint 1); S4 CORS allow-list, S5 hold-cap+throttle, S6 OTP cooldown + captcha (2026-06-30); **S7** WhatsApp `X-Hub-Signature-256` HMAC (fail-closed, live-verified), **S8** already covered by `proxy.ts` (Next 16 middleware wires `updateSession`), **S9** receipt-extension whitelist + trimmed webhook payload + lazy short-TTL signed URLs (2026-07-01).

| ID | Finding | Sev | Fix (approach) |
|----|---------|-----|----------------|
| S1 | Admin self-escalation via `profiles` UPDATE | **P0** | New migration: `REVOKE UPDATE,INSERT ON profiles FROM authenticated,anon` then `GRANT INSERT(id,full_name,whatsapp_phone), UPDATE(full_name,whatsapp_phone)`. Add a BEFORE-trigger `guard_profile_privileges()` that rejects `is_admin`/`email` self-changes unless `is_admin()`. Keep the signup SECURITY DEFINER path working. |
| S2 | Mobbex IPN spoofable | **P0** | Fail **closed** on missing secret; on every IPN re-fetch real status from Mobbex by stored `mobbex_checkout_id` (new `_shared/mobbex.ts`); confirm only if Mobbex says approved **and** amount == `services.price_ars`; never INSERT a payment from the webhook (UPDATE existing rows only). Mark secret REQUIRED in deploy docs. |
| S3 | `create-booking` trusts client `starts_at` | **P1** | Re-validate server-side: working hours/days, 60-min lead, slot-grid alignment, and Google freeBusy overlap (the DB `EXCLUDE` does **not** cover external calendar blocks). Share one validator with `availability` so they can't drift. `create-booking/index.ts:42`. |
| S4 | CORS `*` on every function | **P1** | `corsHeaders(req)` echoing an allow-list (`APP_URL` + prod domain + localhost); webhooks return no permissive ACAO. `_shared/cors.ts:2`. |
| S5 | No rate limiting / hold cap | **P1** | Cap concurrent active holds per user (e.g. 3) + short per-user `create-booking` throttle; optional Vercel Firewall rule. `create-booking/index.ts:50`. |
| S6 | OTP enumeration & spam | **P1** | Enable Turnstile captcha (`config.toml` `[auth.captcha]`), raise `max_frequency` 1s→60s. `login-form.tsx:29`. |
| S7 | WhatsApp POST unsigned | **P2** | Verify `X-Hub-Signature-256` HMAC over raw body, fail closed. `whatsapp-webhook/index.ts`. |
| S8 | No root `middleware.ts` (dead `updateSession`) | **P2** | Wire `middleware.ts` or delete the helper. `lib/supabase/middleware.ts`. |
| S9 | Input/data hygiene | **P2** | Whitelist receipt extensions, trim `payments.raw`, shorter signed-URL TTL, `docs/security.md`. |

**Sound today (keep):** RLS read-own-only is correct; `is_admin()` is SECURITY DEFINER with fixed `search_path`; service-role key never in client bundle; receipts bucket private with per-user RLS; WhatsApp GET verify fails closed.

---

## 2. Performance (landing 3D scene — the reported "very poor performance")

**Status (2026-07-02):** ✅ **Done** (browser parity check pending). Round 1: frameloop pause offscreen/hidden (biggest win), geometry detail 3→2, doubled-MSAA removed, particle canvas suppressed on `/` + paused when hidden, logo sampling deferred. Round 2 (deferred visuals): **`MeshStandardMaterial`** (clearcoat dropped), **DoF reveal-only gating** (mounts only during assembly, off on low tier), **adaptive `PerformanceMonitor` tier** (one-way step-down: DoF off + MSAA 0), Environment res 160→96, dead `lenis`/`maath` removed. tsc/lint/build clean, no new lint. ⚠️ **Needs a browser pass** for felt FPS + visual parity (material/DoF are visible changes). ⬜ Optional remainder: detail-1 (kept detail-2 for safety), lazy-GSAP (skipped — interaction-path risk).

The architecture is sound (3D is dynamically imported, SSR-off, with a real `prefers-reduced-motion` static fallback; no per-frame React re-renders or allocations). The problem is **raw GPU/main-thread load that never adapts**.

| ID | Finding | Sev | Fix |
|----|---------|-----|-----|
| P1 | **Canvas never pauses** — renders full-cost even when scrolled offscreen / tab hidden | **P0** | `<VisibilityGate>` inside `<Canvas>` using `useThree().setFrameloop`: `'never'` when offscreen (IntersectionObserver) or `document.hidden`, `'always'` when visible. `scene.tsx:19`. *Single biggest win.* |
| P2 | **~2M triangles**: `IcosahedronGeometry(1,3)` = 1280 tris × 1600 | **P0** | Drop to detail **1** (80 tris, 16× less); detail 2 only on top desktop tier. Invisible at 0.04–0.135 scale. `spheres.tsx:81`. |
| P3 | No FPS-driven adaptive tier | **P0** | `<PerformanceMonitor>` (one-way step-down): low tier drops DoF, multisampling→0, lowers DPR. Pick sphere **count** once at startup from `hardwareConcurrency`/`deviceMemory` (don't change at runtime — remounts the mesh). `scene.tsx`. |
| P4 | DepthOfField full-time + doubled MSAA (`antialias:true` **and** composer `multisampling:4`) | **P1** | `antialias:false` (composer owns AA), multisampling 4→2, gate DoF to the assembly/reveal phase only. `effects.tsx:30`. |
| P5 | `MeshPhysicalMaterial` clearcoat on sub-pixel specks | **P1** | Switch to `MeshStandardMaterial` (matte look is on-brand); the `onBeforeCompile` injections work unchanged. `sphere-material.ts:25`. |
| P6 | Second always-on rAF particle canvas with `shadowBlur` on **every** route | **P1** | Suppress `HeroParticles` on `/` (invisible behind the hero anyway); replace per-frame `shadowBlur` with a cached gradient sprite; pause on `document.hidden`. `hero-particles.tsx:84`, `layout.tsx:36`. |
| P7 | Synchronous logo SVG parse + 1600 surface samples on first scroll | **P1** | Defer `sampleLogoTargets()` to `requestIdleCallback`; `targetsReady` already gates assembly. `logo-targets.ts:38`. |
| P8 | Static `gsap` import; dead `lenis`/`maath` deps | **P2** | Dynamic-import gsap inside the effect; remove `lenis`/`maath` from `package.json`. `experience-client.tsx:5`. |
| P9 | Env probe res 160; scroll-jacking non-passive listeners | **P2** | Lower Environment to 128/64; detach wheel/touch listeners once past the hero. |

**Invariants to preserve:** code-split + SSR-off; reduced-motion never mounts Canvas; single InstancedMesh / single draw call; no per-frame allocations; matte-white + single green accent untouched.

---

## 3. Booking invariants (no overlap · max 1/day · documented)

**Status (2026-06-30):** ✅ **Done (Sprint 1).** DB per-day index + immutable `booking_local_date()` (`supabase/migrations/20260630130000_one_booking_per_day.sql`), shared `_shared/booking-rules.ts` validator used by both `availability` and `create-booking` (closes S3), client guard in the booking flow, and the docs below (`docs/booking-invariants.md`, ADR 0009). Verified on a local stack: the per-day index rejects a second active same-day booking incl. the 21:00/23:00 ART boundary; `create-booking` returns the right Spanish 409s for same-day / out-of-hours / off-grid; `availability` output unchanged.

Today **only no-overlap was truly enforced** before this. The rules you named now have DB-level guarantees + documentation.

| Invariant | Today | Plan |
|-----------|-------|------|
| **No time overlap** | ✅ DB `EXCLUDE gist (during &&)` for active statuses → 23P01→409 | Keep. |
| **Max 1 turno/day/user** | ❌ enforced **nowhere** | **P0**: partial UNIQUE index on `(user_id, booking_local_date(starts_at))` WHERE active, using an IMMUTABLE constant-offset `booking_local_date()` helper. Edge pre-check + map 23505→409 "Ya tenés un turno reservado para ese día." Client: disable already-booked days in the calendar. |
| No past slot | ✅ edge (`start<now`) | Keep, fold into shared validator. |
| Lead time (60 min), working hours/days, slot-grid, Google freeBusy | ⚠️ **only in `availability`** (advisory) | **P1**: extract shared `_shared/booking-rules.ts`; re-run in `create-booking` (= security S3). Google overlap is best-effort (external). |
| Hold lifecycle | ⚠️ `pending` expires lazily; **`awaiting_payment` never expires** (slot-squat risk) | Pin canonical hold (10 vs current 20 min default); decide an SLA for unverified `awaiting_payment`. |

**Documentation deliverables (P0, you asked for this):** `docs/booking-invariants.md` (one row per rule: DB layer / edge layer / client UX / Postgres code / Spanish message), `docs/adr/0009-booking-invariants-enforcement.md`, update `docs/architecture.md` + `docs/adr/README.md`.

**Key border case:** the per-day key must use the **salon local day** (constant UTC-3), not UTC — else 21:00 and 23:00 ART (different UTC days) both pass. Documented single-offset assumption (Argentina has no DST).

---

## 4. Admin & turns management ("clearly delete and handle turns", paginate, show info)

**Status (2026-07-01):** ✅ A1 (handle turns: confirm + no-show + **reschedule** via `admin-booking`; `no_show` status), A2 (pagination + counts), A3 (payments bounded + lazy receipts), A4 (active-vs-past split), A5 (amount + payment column), A6 (day-group headers; search/filter still open), A7 (WhatsApp links), A8 (real payment errors) **done & verified** (reschedule edge-tested: move/overlap/past/out-of-hours/403). ⬜ Remaining: A6 search/filter, A9 amber/sky chip tokens (no_show chip done), A10 client-page polish, admin balance-adjust UI.

| ID | Finding | Sev | Fix |
|----|---------|-----|-----|
| A1 | Only action is **Cancel**; no reschedule / no-show / manual-confirm / delete | **P0** | New `is_admin`-gated `supabase/functions/admin-booking` (switch: cancel-with-reason / reschedule-same-row / no_show / confirm). `delete` = cancel-with-reason (already frees the slot). Inline two-step `BookingActions` UI (extends `cancel-booking.tsx` idiom; no modals). |
| A2 | Bookings hard-`.limit(100)` + 7-day window = **silent truncation, no pagination** | **P0** | Keyset pagination (`(starts_at,id)` cursor) + counts ("mostrando X de Y") + `load-more` island. `page.tsx:58`. |
| A3 | Payments unbounded + **N+1 signed-URL per row** | **P0** | `.limit(25)`; generate signed URL lazily on "Ver comprobante" click. `page.tsx:20`. |
| A4 | Cancelled/expired future turns pollute "Próximos" | P1 | Filter operational list to active statuses; dead turns behind a disclosure. `page.tsx:89`. |
| A5 | Rows omit price / payment status / duration / ref | P1 | Join payments; per-row "Pagado / A verificar / Sin registrar" + mono ref. |
| A6 | No day grouping / search / filter | P1 | Sticky day headers (`fmtDayLabel`), status filter, name/phone search. |
| A7 | Phone is dead text | P1 | Tappable `wa.me` link (per-client `waClientLink`). |
| A8 | Approve/reject swallows real error | P1 | Reuse `readError` (extract to `lib/edge.ts`); show error next to the acted row. |
| A9 | Status chips use off-palette amber/sky | P1 | Tokenize `--color-warning`/`--color-info`; add `no_show` chip. |
| A10 | Client pages polish (`mis-turnos`, `turno/[id]`, `reservar`) | P1–P2 | Split upcoming/history, mono metadata rail, selected-slot summary in sticky bar, reduce CLS. |

**Invariant:** every state change goes through an `is_admin`-gated edge function; reschedule moves the **same** row (preserves id, payment FK, calendar event); any new terminal status (`no_show`) must stay **out** of the `EXCLUDE` active set so the slot frees.

---

## 5. Packs / appointment balance (multi-session packs → per-user credits)

**Status (2026-07-01):** ✅ **Done & verified.** Data model + race-safe RPCs (`user_credits` atomic counter + `credit_ledger` audit), edge wiring (`create-booking` use_credit, `create-payment` pack mode, webhook/admin grant, cancel refund), and client UI (admin pack creation, plans pack cards, `/comprar` purchase, credit-aware booking, "Mis créditos"). Every border case SQL/edge-tested: grant idempotency, no-negative guard, slot-race rollback (no leak), **concurrent double-spend** (parallel bookings → exactly one), refund once-only, expiry, admin clamp. ⬜ Deferred: admin balance-adjust UI (offline cash comps — `adjust_credit` RPC exists); needs a browser pass on the UI.

Nothing existed before today: `services` has no session count, there is no credit/balance entity, payment is hard-wired 1:1 to a booking. This is a **new subsystem**, built ledger-first for auditability and concurrency safety.

**Design (P0 core):**
- **Data model:** `services += sessions_included, grants_service_id, validity_days`; `payments += kind('booking'|'pack'), service_id, user_id` (booking_id nullable); new **`credit_ledger`** (append-only: `delta`, `reason`, `booking_id`/`payment_id`, `expires_at`). Balance = `sum(delta) WHERE expires_at IS NULL OR > now()` (expiry needs no cron).
- **Race-safe RPCs (SECURITY DEFINER, one transaction each):** `book_with_credit` (FOR UPDATE lock + balance check + insert confirmed booking + decrement — if the `EXCLUDE` rejects the slot, the whole tx rolls back, so **no leaked credit**), `grant_pack_credits` (idempotent via partial unique on `payment_id`), `refund_booking_credit` (once-only via partial unique on `booking_id`), `adjust_credit` (admin comp).
- **Edge wiring:** `create-booking` gains a `use_credit` branch (instant confirm, no hold/payment); `create-payment` gains pack-purchase mode; `mobbex-webhook`/`admin-payment` grant credits on approved pack payment; `cancel-booking` refunds one credit.
- **UI:** pack cards on Plans → `/comprar/[serviceId]`; "Usar 1 crédito (te quedan N)" in the booking flow; "Mis créditos"; admin balance view + `admin-credits` adjust endpoint; pack fields in services manager.

**Border cases (all resolved by the ledger+RPC design):** double-spend race (FOR UPDATE + balance>0), slot-race rollback, once-only cancel refund, hold-expiry irrelevant (credit bookings have no hold), pack expiry via WHERE clause, partial-pack money refund stays manual (ledger gives used/remaining), no-show burns the credit (P2), chargeback claws back unused credits, credits keyed to one immutable `service_id`.

**Open product decision:** confirm "pay once → N credits → book free" (vs pay-per-session), credit validity window, and whether a credit is redeemable for one service or a category. ADR `0009`/`0010`.

---

## 6. Notifications (admin push + Google Calendar triggers)

**Status (2026-07-02):** ✅ **Done** (delivery needs your keys/device). Admin **email alerts** (`notifyAdmins`) on payment-to-verify / booking-confirmed / client-cancellation (booking + pack). Native **Web Push**: `push_subscriptions` table, `app/manifest.ts` + `public/sw.js` + admin `PushManager` (enable from /admin), `_shared/webpush.ts` (VAPID ES256 + aes128gcm, no npm dep) fanned out alongside email, pruning dead subs. **Google Calendar reconciliation**: `calendar_sync` table + `calendar-poll` cron function (fail-closed `CALENDAR_POLL_TOKEN`) — incremental `events.list(syncToken)`; external cancel → cancels booking (+refund credit, emails client), external move → flags a conflict to the owner, unmatched events ignored. Verified: migration applies; edge graph compiles/boots; calendar-poll fail-closed + bootstrap. ⚠️ **Web Push encryption + calendar sync need real keys/Google config + a device to fully verify.** ⬜ Later: `events.watch` push, Realtime live `/admin`, per-event preferences.

Before this: client emails only (Resend); the owner learned of bookings/payments **only by refreshing `/admin`**; Google sync is **one-way** (no `events.watch`, external edits never flow back).

**Layered, cheapest-first plan:**
1. **P0 — Admin email alerts** (reuse `_shared/email.ts` + `loadBookingCtx`): fire on `awaiting_payment` (verify queue), `confirmed/paid`, client cancellation. `getAdminEmails()` from `profiles where is_admin`. Works on every device, zero infra. *Do not* alert on 10-min pending holds.
2. **P0 — Data model:** `push_subscriptions` (own-row RLS) + `calendar_sync` singleton (**no public read** — tokens must not live in the publicly-readable `settings`).
3. **P1 — Web Push (PWA):** `app/manifest.ts` + `public/sw.js` + `_shared/webpush.ts` (VAPID ES256 + aes128gcm via WebCrypto, no FCM billing). Register SW **only on admin routes**. iOS needs installed PWA → email is the fallback.
4. **P1 — Calendar → bookings reconciliation via cron-driven incremental `events.list(syncToken)`** (polling, because `events.watch` needs a Search-Console-verified domain, impossible on `*.functions.supabase.co`). Policy: external delete of an active booking → cancel + notify client; time moved on a paid booking → flag conflict to admin (don't silently move); event with no booking → ignore. Idempotent + loop-safe (skip self-induced changes).
5. **P2 — `events.watch` push** on the verified custom domain (Next route handler); **Realtime** `/admin` live refresh; notification preferences + dedupe.

**Invariant:** all notifications best-effort, fire after the DB commit, never block the booking write; reconciliation never creates bookings from external events and never silently mutates a paid client's turno.

---

## Suggested sequencing

1. **Sprint 0 — Launch blockers:** S1, S2 (+ document the secret requirement). Small, urgent.
2. **Sprint 1 — Correctness & trust:** booking invariants (max-1/day DB index + docs), S3 server-side revalidation, admin email alerts (N1), CORS/rate-limit (S4/S5).
3. **Sprint 2 — Admin console:** A1–A3 (handle/delete turns + pagination), then A4–A9.
4. **Sprint 3 — Performance:** P1–P3 (frameloop pause, detail-1, adaptive tier), then P4–P7.
5. **Sprint 4 — Packs/balance** subsystem.
6. **Sprint 5 — Web push + calendar reconciliation.**

## Verification (per track)
- **Security:** run the documented exploits (console `is_admin` flip; forged IPN) and confirm they fail; full happy-path regression (browse→reserve→pay sandbox→confirm; manual receipt→approve; cancel).
- **Invariants:** seed same-day bookings (expect 23505), 21:00+23:00 ART pair rejected, crafted off-grid/out-of-hours POSTs rejected, concurrent same-day race → exactly one wins.
- **Performance:** DevTools Performance + Lighthouse mobile before/after; confirm GPU work →~0 when scrolled to Plans; visual parity of the logo reveal.
- **Packs:** buy pack → balance=N (idempotent), credit-book → confirmed + balance−1, concurrent double-spend → one 409, cancel → +1 once.
- **Notifications:** admin email on verify/confirm/cancel; push subscribe→notify→click; delete calendar event → booking reconciled.

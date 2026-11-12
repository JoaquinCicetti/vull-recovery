# ADR 0017 — Post-session surveys, sent by hand over WhatsApp

- **Status:** Accepted
- **Date:** 2026-11-12

## Context
The owner wants to ask Recovery clients a short questionnaire after each session
(about them, how they arrived, how they left, their opinion) and keep the
answers as stats. The ways to reach a client automatically all fall short:
- WhatsApp Business messages cost money per conversation.
- Scheduled sends need a paid provider (ADR 0001: no fixed monthly cost).
- Push needs the PWA installed and notifications allowed, which most clients
  haven't done.

## Decision
1. **An admin sends the link by hand.** In Agenda › Turnos › Pasados, the `…`
   menu of a past confirmed turno has "Enviar encuesta por WhatsApp".
   - It is a `wa.me` deep link to the client with the message and
     `/encuesta/<booking id>` already written. That is free (ADR 0002).
   - The tap opens WhatsApp directly, since an awaited `window.open` is blocked
     on iOS. It also calls `admin_mark_survey_sent`, which counts the send.
2. **One survey per booking.** `session_surveys.booking_id` is unique.
   - The row records `sent_at`, `sent_count` and `submitted_at`.
   - Once `submitted_at` is set, the menu item goes away and the row shows the
     score. A second submit is refused.
3. **The client answers logged in.** The page goes through the normal login and
   `next`, then back to the form.
   - `submit_session_survey` re-checks that the booking is the caller's, is
     `confirmed`, has started, and is in a sector with `survey_enabled`.
   - Mis turnos also offers unanswered surveys from the last 30 days, so the
     link isn't the only way in.
4. **Answers are typed columns, not JSON,** so `admin_survey_stats` is plain SQL.
   - Ranges are CHECKs.
   - A completeness CHECK means a row with `submitted_at` has every required
     answer.
   - "Sobre vos" is stored on every response and prefilled from the previous one.
5. **"What's best" comes from the plan.** `services.stations` lists what each plan
   includes.
   - It is the survey's options and is also shown as tags on the public plan
     pages (`show_stations`).
   - The answer keeps a snapshot of the labels, so renaming a station never
     rewrites history.
6. **Admins are told** through the outbox (ADR 0013) with kind `survey_submitted`.
   The push opens Métricas › Encuestas with that response.
7. **Stats live in Métricas** as a view (`?ver=encuestas`), not a new tab, and
   are scoped to one sector.

## Consequences
- Sending costs an admin a tap per client, which is acceptable at the current
  volume. It also leaves room for a personal word in the message.
- Changing the questions means a migration (new columns) plus `lib/survey.ts`.
  That is fine: the questionnaire is meant to stay stable so stats compare over
  time.
- Bookings deleted by cascade take their survey with them.

## Alternatives rejected
- **WhatsApp Business API / scheduled messages:** cost per message.
- **Push after the session:** few clients have it.
- **An anonymous public form:** answers couldn't be tied to a booking, and
  "Sobre vos" couldn't be prefilled.
- **A JSON answers column:** the stats would need JSON parsing, and ranges
  couldn't be checked by the database.

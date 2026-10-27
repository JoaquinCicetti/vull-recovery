# Manual testing guide

How to check the main features by hand before a deploy or after a big change.
The rules behind each check are in [booking-invariants.md](../booking-invariants.md);
the notification table is in [setup.md › Notifications](../setup.md#notifications).

## Setup

- **Dev mode.** Run `pnpm deploy:dev`. Talo then uses the sandbox and the
  transfer panel shows **"Simular pago"**. Run `pnpm deploy` when you're done.
  Payments started in one mode are stranded after you switch.
- **Accounts.** You need three: one **admin** and two **clients** (A and B).
  Use real inboxes, because sign-in is an email code. Use one browser profile or
  incognito window per account, so you can act as two people at once.
- **Phone.** Run every admin check at phone width (about 375px) too, since the
  desk runs from a phone. Look for sideways page scroll, buttons that grow too
  wide, and dialogs taller than the screen.
- **What got sent.** After any step that should notify someone, run:
  ```sh
  pnpm exec supabase db query --linked "select kind, audience, actor, sent_at, error, channels from notifications order by created_at desc limit 10"
  ```
- **Test data.** Clean it up afterwards by cancelling or unblocking from the
  admin agenda. Don't delete rows by hand.

Each check below is written as: do this → expect that.

## 1. Sign-in and account

| # | Do | Expect |
|---|----|--------|
| 1.1 | Sign in with a new email at `/login` | The email has a **code** (not a link); the code signs you in |
| 1.2 | Sign in again with the same email | Code again; you land signed in |
| 1.3 | Open `/admin` as a client | You're turned away; no admin data shows |
| 1.4 | `/cuenta` as a new client | Abono and Sesiones tabs are **hidden** until the client has an abono or a pack |
| 1.5 | `/cuenta/notificaciones`: turn email off with push off | Refused, because one channel must stay on |
| 1.6 | Turn push on in an unsupported browser (iPhone outside the installed app) | Push stays off and the reason is shown |

## 2. Recovery: a single turno

| # | Do | Expect |
|---|----|--------|
| 2.1 | `/planes` → Reservar → pick a slot | `/turno/[id]` shows a hold countdown (about 10 min) |
| 2.2 | Pay with Talo → "Simular pago" | The turno becomes **confirmed**; the client gets "Turno confirmado" and admins get "Nuevo turno pagado" (one notice each) |
| 2.3 | Book and don't pay; wait past the hold | The slot is free again for client B |
| 2.4 | A and B open the same slot; both confirm | One succeeds; the other sees "Ese horario ya fue reservado. Elegí otro." |
| 2.5 | A books a second turno on the same day | "Ya tenés un turno reservado para ese día…" |
| 2.6 | Booking window on Mon–Sat | Only this week's days are offered |
| 2.7 | Booking window on Sunday before / after 14:00 | Next week is closed before 14:00 and open from 14:00 |
| 2.8 | Slot less than an hour away | Not offered |
| 2.9 | Closed weekday (Ajustes) | Not offered |

## 3. Packs and credits

| # | Do | Expect |
|---|----|--------|
| 3.1 | `/comprar/[serviceId]` → pay with Talo | `/comprar/exito`; the balance shows on `/cuenta/sesiones`; "Sesiones acreditadas" for the client, "Pack vendido" for admins |
| 3.2 | Book with a credit (twice) | Confirmed with no payment; the admin notice reads "usó 1 sesión… (quedan N)" and N goes down |
| 3.3 | Cancel a paid turno **≥24 h** ahead | One credit comes back |
| 3.4 | Cancel a paid turno **<24 h** ahead | No credit comes back |
| 3.5 | Admin cancels a paid turno (any time) | A credit always comes back; the client gets "Turno cancelado" even with email off (fallback) |
| 3.6 | Admin › Clientes › client → Ajustar saldo | The balance changes and shows in the client's Sesiones |

## 4. Pilates abonos

Pilates must be visible: Ajustes › Pilates › "Visible para clientes". When it's
off, a client must not see Pilates anywhere.

| # | Do | Expect |
|---|----|--------|
| 4.1 | `/abono/[serviceId]` → pick weekdays, times and beds → pay | The first cuota is **prorated** (e.g. $40.000, Mon+Wed, start Tue Oct 20 → $15.000); all the month's classes appear |
| 4.2 | Sign up without paying; wait past the hold | All the classes free up |
| 4.3 | Try to cancel a single class while the first cuota is unpaid | Not allowed; only the whole signup can be cancelled |
| 4.4 | `/cuenta/plan` after paying | Current cuota paid; next month materialized when locked |
| 4.5 | Move a class (≥24 h away, same week and month) | It moves; admins get "Clase movida" |
| 4.6 | Move across a week or month, or less than 24 h away | Refused |
| 4.7 | A proposes a swap to B; B accepts | The times are exchanged and each keeps their own class; both get notices |
| 4.8 | Swap where B already has a class that day | Refused; nothing changes |
| 4.9 | Next month's cuota after `due_day` | The amount includes the late fee; the first cuota never does |
| 4.10 | Admin › Agenda › Pilates › Abonos › cuotas vencidas, after `release_day` | "Liberar lugar" is enabled; releasing keeps paid months and cancels the rest |
| 4.11 | Desk sale to a new email (Agenda › new abono) | The client's account is created and gets "Tu lugar está reservado"; signing in with the code shows the abono |

## 5. Admin panel

Recovery and Pilates must never appear in the same list.

| # | Do | Expect |
|---|----|--------|
| 5.1 | Agenda: switch sector; for Pilates switch Semana / Turnos / Abonos | Lists change with the sector; the URL keeps `?sector=` |
| 5.2 | Filters dialog → apply | Chips show the active filters; removing a chip clears that filter |
| 5.3 | **Bloquear horario** with a name | The slot shows "Bloqueado" in the agenda; clients can't see or book it; no one is charged |
| 5.4 | Liberar a block | The slot is bookable again; no notice is sent |
| 5.5 | Reprogramar a client's turno | An amber warning comes first; the client gets "Turno reprogramado" with "Antes / Ahora" |
| 5.6 | Cancel / no-show / release | Red button + a confirmation question |
| 5.7 | Talo flags (when present) | Shown at the top of Agenda only |
| 5.8 | Ajustes: edit hours, slot length, booking window, plans | The client booking pages show the change right away |
| 5.9 | Ajustes: two overlapping ranges on one weekday | "Dos rangos del mismo día se superponen." |
| 5.10 | Métricas | The numbers roughly match what you just did |
| 5.11 | "Activar notificaciones en este dispositivo" (Ajustes) | The admin's device gets push for client events |

## 6. Payments: edge cases

| # | Do | Expect |
|---|----|--------|
| 6.1 | Call `talo-webhook` several times for one paid payment, and run `talo-reconcile` | Still one confirmation and one notice per (kind, subject, audience) |
| 6.2 | Pay a cuota that's already paid | Recorded as `duplicate_payment`, flagged for the admin |
| 6.3 | Pay for a turno whose hold already lapsed | Flagged in Agenda; nothing is double-booked |

## 7. Notifications: failure path

| # | Do | Expect |
|---|----|--------|
| 7.1 | A send fails (e.g. a bad `EMAIL_FROM`) | The row keeps its `error` and shows in Ajustes › "Avisos no enviados" |
| 7.2 | Fix the cause → "Reintentar" | It sends and leaves the list |

## 8. Google Calendar (recovery)

| # | Do | Expect |
|---|----|--------|
| 8.1 | Book a recovery turno | An event shows in the calendar |
| 8.2 | Create a busy event in Google over a free slot | The slot disappears from availability |
| 8.3 | Delete a turno's event in Google (`calendar-poll` runs) | The turno is cancelled; the credit is returned; the client is notified |

## 9. Quick smoke test after every deploy

1.1, 2.1 + 2.2, 3.2, 4.1 (if Pilates is live), 5.3 + 5.4, and one look at
Agenda and Métricas on a phone.

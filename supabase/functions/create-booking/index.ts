// Authenticated Edge Function: holds a slot for the signed-in user.
// Inserts a `pending` booking; the DB gives it the first free resource of the
// plan's sector (bed), the EXCLUDE constraint rejects overlaps per resource and a
// partial UNIQUE index rejects a second active booking in the sector on the same
// local day (all race-safe). A hidden (inactive) sector is bookable by admins only. Re-validates the client-supplied time against the same rules
// `availability` uses, so a crafted/stale request can't book outside the rules.
// Creates a tentative Google Calendar event (best-effort).
//
// Latency shape: the browser waits on this whole function, and from the edge
// region to the DB every round trip costs ~20–180 ms, so the checks run in two
// parallel phases and everything that is not needed to answer (calendar event,
// emails, push) runs AFTER the response via defer(). Only the insert decides.
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { createEvent, getBusy } from "../_shared/google.ts";
import { sendBookingReceived, sendBookingConfirmation, notifyAdmins } from "../_shared/email.ts";
import { defer } from "../_shared/background.ts";
import { localYMD, zonedToUtc } from "../_shared/time.ts";
import { type Busy, validateSlot } from "../_shared/booking-rules.ts";
import {
  canUseSector,
  loadServiceWithSector,
  sectorCalendarId,
  sectorSettings,
} from "../_shared/sector.ts";

const MAX_ACTIVE_HOLDS = Number(Deno.env.get("MAX_ACTIVE_HOLDS") ?? "3");
const THROTTLE_MS = Number(Deno.env.get("BOOKING_THROTTLE_SECONDS") ?? "5") * 1000;
const ACTIVE = ["pending", "awaiting_payment", "confirmed"];

const SLOT_TAKEN = "Ese horario ya fue reservado. Elegí otro.";
const SAME_DAY =
  "Ya tenés un turno reservado para ese día. Cancelalo si querés elegir otro horario.";

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { service_id, starts_at, use_credit } = await req.json();
    if (!service_id || !starts_at) {
      return json({ error: "Datos incompletos" }, 400);
    }
    const start = new Date(starts_at);
    if (isNaN(start.getTime())) return json({ error: "Fecha inválida" }, 400);
    if (start.getTime() < Date.now()) {
      return json({ error: "Ese horario ya pasó" }, 400);
    }

    const admin = adminClient();

    // ── Phase A (parallel): who is asking, free lapsed holds, load config ────
    // The sweep must land before the per-user queries in phase B so the user's
    // own expired hold doesn't count against them.
    const [
      {
        data: { user },
      },
      _swept,
      service,
    ] = await Promise.all([
      userClient(req).auth.getUser(),
      admin
        .from("bookings")
        .update({ status: "expired" })
        .eq("status", "pending")
        .lt("hold_expires_at", new Date().toISOString()),
      loadServiceWithSector(admin, service_id),
    ]);
    if (!user) return json({ error: "No autenticado" }, 401);
    if (!service || !service.active) {
      return json({ error: "Servicio no disponible" }, 404);
    }
    const sector = service.sectors;
    if (!(await canUseSector(admin, sector, user))) {
      return json({ error: "Servicio no disponible" }, 404);
    }
    const calendar = sectorCalendarId(sector);

    // A pack's price_ars is the price of the WHOLE pack. Booking one without
    // spending a credit would fall through to the ordinary paid path below and
    // bill that full price for a single session, so packs are credit-only. The
    // UI redirects to /comprar before this, but the invariant belongs here.
    if (service.sessions_included > 1 && !use_credit) {
      return json({ error: "Comprá el pack para reservar estas sesiones." }, 400);
    }

    const durationMs = service.duration_minutes * 60000;
    const end = new Date(start.getTime() + durationMs);

    const settings = sectorSettings(sector);
    const tz = settings.timezone;
    const { y, m, d } = localYMD(tz, start);
    const dayStart = zonedToUtc(y, m, d, 0, 0, tz).toISOString();
    const dayEnd = zonedToUtc(y, m, d + 1, 0, 0, tz).toISOString();

    // ── Phase B (parallel): anti-squat, one-per-day pre-check, Google busy ──
    const [{ data: activeHolds }, { data: sameDay }, googleBusy] = await Promise.all([
      // Cap concurrent unconfirmed holds + light throttle. (The per-day unique
      // index already limits a user to one active booking per day; this bounds
      // how many days a user can tie up at once.)
      admin
        .from("bookings")
        .select("created_at")
        .eq("user_id", user.id)
        .in("status", ["pending", "awaiting_payment"])
        .order("created_at", { ascending: false }),
      // Friendly pre-check (the partial UNIQUE index is the race-safe backstop).
      // One per day PER SECTOR: recovery and pilates on the same day is fine.
      admin
        .from("bookings")
        .select("id")
        .eq("user_id", user.id)
        .eq("sector_id", sector.id)
        .in("status", ACTIVE)
        .gte("starts_at", dayStart)
        .lt("starts_at", dayEnd)
        .limit(1),
      getBusy(start.toISOString(), end.toISOString(), calendar).catch(() => []),
    ]);

    if ((activeHolds?.length ?? 0) >= MAX_ACTIVE_HOLDS) {
      return json(
        {
          error:
            "Tenés varias reservas sin confirmar. Completá o cancelá alguna antes de reservar otra.",
        },
        429,
      );
    }
    const lastAt = activeHolds?.[0]?.created_at;
    if (lastAt && Date.now() - new Date(lastAt).getTime() < THROTTLE_MS) {
      return json({ error: "Esperá unos segundos antes de reservar de nuevo." }, 429);
    }
    if (sameDay && sameDay.length > 0) return json({ error: SAME_DAY }, 409);

    // ── Re-validate the slot server-side (working hours/days, lead, grid,
    //    Google freeBusy). availability uses the same validateSlot(). ─────────
    const busy: Busy[] = googleBusy.map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }));
    const check = validateSlot({
      startMs: start.getTime(),
      durationMs,
      settings,
      busy,
    });
    if (!check.ok) return json({ error: check.error }, 409);

    // Calendar event + google_event_id, after the response (best-effort; no-ops
    // when Google is unset). Nothing on /turno reads google_event_id and
    // calendar-poll only matches BY event id, so landing it a second late is fine.
    const scheduleCalendarEvent = (
      bookingId: string,
      summary: string,
      description: string,
      status: "tentative" | "confirmed",
    ) =>
      defer(async () => {
        const eventId = await createEvent({
          summary,
          description,
          start: start.toISOString(),
          end: end.toISOString(),
          status,
          calendar,
        });
        if (eventId) {
          await admin.from("bookings").update({ google_event_id: eventId }).eq("id", bookingId);
        }
      });

    // ── Credit-funded booking: spend one credit, confirm instantly (no hold,
    //    no payment). book_with_credit decrements + inserts in one tx. ─────────
    if (use_credit) {
      const { data: booking, error } = await admin.rpc("book_with_credit", {
        p_user: user.id,
        p_service: service_id,
        p_starts_at: start.toISOString(),
        p_ends_at: end.toISOString(),
      });
      if (error) {
        if (error.message?.includes("no_credit")) {
          return json({ error: "No te quedan créditos para este servicio." }, 409);
        }
        if (error.code === "23P01") return json({ error: SLOT_TAKEN }, 409);
        if (error.code === "23505") return json({ error: SAME_DAY }, 409);
        return json({ error: error.message }, 400);
      }
      scheduleCalendarEvent(
        booking.id,
        `${service.name} — turno confirmado`,
        `Turno ${booking.id} (crédito)`,
        "confirmed",
      );
      defer(() => sendBookingConfirmation(admin, booking.id));
      defer(() => notifyAdmins(admin, "booking_confirmed", booking.id));
      return json({ booking });
    }

    const holdExpires = new Date(Date.now() + sector.hold_minutes * 60000).toISOString();

    const { data: booking, error } = await admin
      .from("bookings")
      .insert({
        user_id: user.id,
        service_id,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: "pending",
        hold_expires_at: holdExpires,
      })
      .select("*")
      .single();

    if (error) {
      // 23P01 = exclusion_violation → the slot is already taken.
      if (error.code === "23P01") return json({ error: SLOT_TAKEN }, 409);
      // 23505 = unique_violation → the per-day index (race with another request).
      if (error.code === "23505") return json({ error: SAME_DAY }, 409);
      return json({ error: error.message }, 400);
    }

    scheduleCalendarEvent(
      booking.id,
      `${service.name} — reserva pendiente`,
      `Reserva ${booking.id} (pago pendiente)`,
      "tentative",
    );
    // Acknowledge the held reservation (best-effort; no-ops if email unset).
    defer(() => sendBookingReceived(admin, booking.id));

    return json({ booking });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});

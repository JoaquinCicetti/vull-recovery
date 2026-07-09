// Authenticated Edge Function: holds a slot for the signed-in user.
// Inserts a `pending` booking; the DB EXCLUDE constraint rejects overlaps and a
// partial UNIQUE index rejects a second active booking on the same local day
// (both race-safe). Re-validates the client-supplied time against the same rules
// `availability` uses, so a crafted/stale request can't book outside the rules.
// Creates a tentative Google Calendar event (best-effort).
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { createEvent } from "../_shared/google.ts";
import { getBusy } from "../_shared/google.ts";
import { sendBookingReceived, sendBookingConfirmation, notifyAdmins } from "../_shared/email.ts";
import { localYMD, zonedToUtc } from "../_shared/time.ts";
import { type Busy, type Settings, validateSlot } from "../_shared/booking-rules.ts";

const HOLD_MINUTES = Number(Deno.env.get("BOOKING_HOLD_MINUTES") ?? "20");
const MAX_ACTIVE_HOLDS = Number(Deno.env.get("MAX_ACTIVE_HOLDS") ?? "3");
const THROTTLE_MS = Number(Deno.env.get("BOOKING_THROTTLE_SECONDS") ?? "5") * 1000;
const ACTIVE = ["pending", "awaiting_payment", "confirmed"];

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { service_id, starts_at, use_credit } = await req.json();
    if (!service_id || !starts_at) {
      return json({ error: "Datos incompletos" }, 400);
    }

    const {
      data: { user },
    } = await userClient(req).auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const admin = adminClient();

    // Free expired holds first so a stale pending booking doesn't block this slot
    // (including the user's own lapsed hold, so the per-day check below is fair).
    await admin
      .from("bookings")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("hold_expires_at", new Date().toISOString());

    // ── Anti-squat: cap concurrent unconfirmed holds + light throttle ────────
    // (The per-day unique index already limits a user to one active booking per
    // day; this bounds how many days a user can tie up at once.)
    const { data: activeHolds } = await admin
      .from("bookings")
      .select("created_at")
      .eq("user_id", user.id)
      .in("status", ["pending", "awaiting_payment"])
      .order("created_at", { ascending: false });
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

    const [{ data: service }, { data: row }] = await Promise.all([
      admin.from("services").select("*").eq("id", service_id).single(),
      admin.from("settings").select("*").eq("id", true).single(),
    ]);
    if (!service || !service.active) {
      return json({ error: "Servicio no disponible" }, 404);
    }

    // A pack's price_ars is the price of the WHOLE pack. Booking one without
    // spending a credit would fall through to the ordinary paid path below and
    // bill that full price for a single session, so packs are credit-only. The
    // UI redirects to /comprar before this, but the invariant belongs here.
    if (service.sessions_included > 1 && !use_credit) {
      return json({ error: "Comprá el pack para reservar estas sesiones." }, 400);
    }

    const start = new Date(starts_at);
    if (isNaN(start.getTime())) return json({ error: "Fecha inválida" }, 400);
    if (start.getTime() < Date.now()) {
      return json({ error: "Ese horario ya pasó" }, 400);
    }
    const durationMs = service.duration_minutes * 60000;
    const end = new Date(start.getTime() + durationMs);

    const settings: Settings = {
      working_hours_start: row?.working_hours_start ?? "09:00",
      working_hours_end: row?.working_hours_end ?? "18:00",
      working_days: row?.working_days ?? [1, 2, 3, 4, 5],
      timezone: row?.timezone ?? "America/Argentina/Buenos_Aires",
    };
    const tz = settings.timezone;

    // ── Invariant: at most one active turno per user per local day ───────────
    // Friendly pre-check (the partial UNIQUE index is the race-safe backstop).
    const { y, m, d } = localYMD(tz, start);
    const dayStart = zonedToUtc(y, m, d, 0, 0, tz).toISOString();
    const dayEnd = zonedToUtc(y, m, d + 1, 0, 0, tz).toISOString();
    const { data: sameDay } = await admin
      .from("bookings")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ACTIVE)
      .gte("starts_at", dayStart)
      .lt("starts_at", dayEnd)
      .limit(1);
    if (sameDay && sameDay.length > 0) {
      return json(
        {
          error:
            "Ya tenés un turno reservado para ese día. Cancelalo si querés elegir otro horario.",
        },
        409,
      );
    }

    // ── Re-validate the slot server-side (working hours/days, lead, grid,
    //    Google freeBusy). availability uses the same validateSlot(). ─────────
    const googleBusy = await getBusy(start.toISOString(), end.toISOString()).catch(
      () => [],
    );
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
        if (error.code === "23P01") {
          return json({ error: "Ese horario ya fue reservado. Elegí otro." }, 409);
        }
        if (error.code === "23505") {
          return json(
            {
              error:
                "Ya tenés un turno reservado para ese día. Cancelalo si querés elegir otro horario.",
            },
            409,
          );
        }
        return json({ error: error.message }, 400);
      }
      // Confirmed calendar event + confirmation email (best-effort).
      try {
        const eventId = await createEvent({
          summary: `${service.name} — turno confirmado`,
          description: `Turno ${booking.id} (crédito)`,
          start: start.toISOString(),
          end: end.toISOString(),
          status: "confirmed",
        });
        if (eventId) {
          await admin
            .from("bookings")
            .update({ google_event_id: eventId })
            .eq("id", booking.id);
        }
      } catch (_) {
        /* calendar best-effort */
      }
      await sendBookingConfirmation(admin, booking.id);
      await notifyAdmins(admin, "booking_confirmed", booking.id);
      return json({ booking });
    }

    const holdExpires = new Date(Date.now() + HOLD_MINUTES * 60000).toISOString();

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
      if (error.code === "23P01") {
        return json({ error: "Ese horario ya fue reservado. Elegí otro." }, 409);
      }
      // 23505 = unique_violation → the per-day index (race with another request).
      if (error.code === "23505") {
        return json(
          {
            error:
              "Ya tenés un turno reservado para ese día. Cancelalo si querés elegir otro horario.",
          },
          409,
        );
      }
      return json({ error: error.message }, 400);
    }

    // Tentative calendar event (optional — only if Google is configured).
    try {
      const eventId = await createEvent({
        summary: `${service.name} — reserva pendiente`,
        description: `Reserva ${booking.id} (pago pendiente)`,
        start: start.toISOString(),
        end: end.toISOString(),
        status: "tentative",
      });
      if (eventId) {
        await admin
          .from("bookings")
          .update({ google_event_id: eventId })
          .eq("id", booking.id);
      }
    } catch (_) {
      // Calendar is best-effort; booking already holds the slot in the DB.
    }

    // Acknowledge the held reservation (best-effort; no-ops if email unset).
    await sendBookingReceived(admin, booking.id);

    return json({ booking });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});

// Authenticated Edge Function: holds a slot for the signed-in user.
// Inserts a `pending` booking; the DB EXCLUDE constraint rejects overlaps
// (race-safe). Creates a tentative Google Calendar event (best-effort).
import { json, handleOptions, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { createEvent } from "../_shared/google.ts";
import { sendBookingReceived } from "../_shared/email.ts";

const HOLD_MINUTES = Number(Deno.env.get("BOOKING_HOLD_MINUTES") ?? "10");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    const { service_id, starts_at } = await req.json();
    if (!service_id || !starts_at) {
      return json({ error: "Datos incompletos" }, 400);
    }

    const {
      data: { user },
    } = await userClient(req).auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const admin = adminClient();

    // Free expired holds first so a stale pending booking doesn't block this slot.
    await admin
      .from("bookings")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("hold_expires_at", new Date().toISOString());

    const { data: service } = await admin
      .from("services")
      .select("*")
      .eq("id", service_id)
      .single();
    if (!service || !service.active) {
      return json({ error: "Servicio no disponible" }, 404);
    }

    const start = new Date(starts_at);
    if (isNaN(start.getTime())) return json({ error: "Fecha inválida" }, 400);
    if (start.getTime() < Date.now()) {
      return json({ error: "Ese horario ya pasó" }, 400);
    }
    const end = new Date(start.getTime() + service.duration_minutes * 60000);
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

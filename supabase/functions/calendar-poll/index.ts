// Public Edge Function (cron-driven): reconcile external Google Calendar edits
// back to bookings. Google events.watch needs a Search-Console-verified callback
// domain (impossible on *.functions.supabase.co), so we poll incrementally with a
// stored syncToken — reusing the external-cron pattern of keep-alive.
//
// Auth: its own ?token= secret (CALENDAR_POLL_TOKEN), fail-CLOSED (like
// whatsapp-webhook, NOT the fail-open mobbex pattern). Idempotent + loop-safe:
// our own createEvent/patchEvent changes that already match the booking are no-ops.
//
// Policy:
//   • event cancelled/deleted, booking still active → cancel the booking (free the
//     slot), refund a pack credit if one was used, email the client.
//   • event time moved vs the booking → flag a conflict to the owner (never
//     silently move a possibly-paid client).
//   • event with no matching booking (owner's personal block) → ignore.
import { json, errMessage } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { listEvents } from "../_shared/google.ts";
import { sendBookingCancellation, notifyAdminsSimple } from "../_shared/email.ts";

const ACTIVE = ["pending", "awaiting_payment", "confirmed"];

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const secret = Deno.env.get("CALENDAR_POLL_TOKEN");
    if (!secret || url.searchParams.get("token") !== secret) {
      return json({ error: "unauthorized" }, 401);
    }

    const admin = adminClient();
    const { data: sync } = await admin
      .from("calendar_sync")
      .select("sync_token")
      .eq("id", true)
      .single();
    const syncToken: string | undefined = sync?.sync_token ?? undefined;

    // Bootstrap: establish a sync token over a forward window; do NOT reconcile
    // (the initial list is the whole window, not a delta).
    if (!syncToken) {
      const { nextSyncToken } = await listEvents({ timeMin: new Date().toISOString() });
      if (nextSyncToken) {
        await admin
          .from("calendar_sync")
          .update({ sync_token: nextSyncToken, last_polled_at: new Date().toISOString() })
          .eq("id", true);
      }
      return json({ ok: true, bootstrapped: true });
    }

    const { items, nextSyncToken, expired } = await listEvents({ syncToken });
    if (expired) {
      // Stale token → clear so the next run re-bootstraps.
      await admin.from("calendar_sync").update({ sync_token: null }).eq("id", true);
      return json({ ok: true, resync: true });
    }

    let cancelled = 0;
    let conflicts = 0;
    for (const ev of items) {
      const eventId = ev.id as string | undefined;
      if (!eventId) continue;
      const { data: booking } = await admin
        .from("bookings")
        .select("id, status, starts_at")
        .eq("google_event_id", eventId)
        .maybeSingle();
      if (!booking || !ACTIVE.includes(booking.status)) continue;

      if (ev.status === "cancelled") {
        await admin
          .from("bookings")
          .update({
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            cancellation_reason: "Cancelado en Google Calendar",
            hold_expires_at: null,
          })
          .eq("id", booking.id);
        await admin
          .from("payments")
          .update({ status: "rejected" })
          .eq("booking_id", booking.id)
          .eq("status", "pending");
        await admin.rpc("refund_booking_credit", { p_booking_id: booking.id });
        await sendBookingCancellation(admin, booking.id, { byAdmin: true });
        cancelled++;
      } else {
        const evStart = ev.start?.dateTime
          ? new Date(ev.start.dateTime).getTime()
          : null;
        const bkStart = new Date(booking.starts_at).getTime();
        if (evStart !== null && Math.abs(evStart - bkStart) > 60000) {
          // Moved externally — don't auto-move the client; flag it.
          await notifyAdminsSimple(
            admin,
            "Conflicto de calendario",
            "Un turno fue movido en Google Calendar pero no en la app. Revisalo en el panel y reprogramá desde ahí si corresponde.",
          );
          conflicts++;
        }
      }
    }

    await admin
      .from("calendar_sync")
      .update({
        sync_token: nextSyncToken ?? syncToken,
        last_polled_at: new Date().toISOString(),
      })
      .eq("id", true);

    return json({ ok: true, cancelled, conflicts });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});

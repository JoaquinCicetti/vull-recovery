// Authenticated Edge Function: change one class of an abono.
//
//   move    { booking_id, starts_at, resource_id? }  to a free slot, now
//   propose { from_booking_id, to_booking_id }        offer a swap to its owner
//   accept | decline { request_id }                   the receiver answers
//   cancel  { request_id }                            the proposer withdraws
//
// Rules (docs/booking-invariants.md "Moving and swapping classes"): only
// confirmed classes; both the current and the new time at least
// sectors.change_notice_hours ahead; within the same Mon–Sun week and the same
// month. A move keeps the same row (its turno page and emails follow it); the
// EXCLUDE and one-per-day index arbitrate. Swaps are SQL (swap_bookings).
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { housekeeping, mapDbError } from "../_shared/membership.ts";
import { sendSwapProposed, sendSwapResolved } from "../_shared/membership-email.ts";
import { defer } from "../_shared/background.ts";
import { validateSlot } from "../_shared/booking-rules.ts";
import { loadServiceWithSector, sectorSettings } from "../_shared/sector.ts";
import { localYMD } from "../_shared/time.ts";

// Monday-based week key + month key of an instant in `tz`.
function weekAndMonth(ms: number, tz: string): { week: number; month: string } {
  const { y, m, d } = localYMD(tz, new Date(ms));
  const day = Date.UTC(y, m - 1, d);
  const dow = (new Date(day).getUTCDay() + 6) % 7; // Mon=0
  return { week: day - dow * 86400000, month: `${y}-${m}` };
}

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { data: { user } } = await userClient(req).auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);
    const admin = adminClient();
    const body = await req.json();
    const action = body?.action;
    await housekeeping(admin);

    // ── move to a free slot ───────────────────────────────────────────────
    if (action === "move") {
      const { data: b } = await admin
        .from("bookings")
        .select("id, user_id, status, starts_at, service_id, membership_id")
        .eq("id", body?.booking_id)
        .maybeSingle();
      if (!b || b.user_id !== user.id) return json({ error: "Clase no encontrada" }, 404);
      if (!b.membership_id) {
        return json({ error: "Solo las clases de un abono se pueden mover." }, 409);
      }
      if (b.status !== "confirmed") {
        return json({ error: "Solo se pueden mover clases confirmadas." }, 409);
      }
      const service = await loadServiceWithSector(admin, b.service_id);
      if (!service) return json({ error: "Plan no disponible" }, 404);
      const sector = service.sectors;
      const notice = sector.change_notice_hours;
      const cutoff = Date.now() + notice * 3600_000;

      const from = new Date(b.starts_at).getTime();
      const to = new Date(body?.starts_at).getTime();
      if (!Number.isFinite(to)) return json({ error: "Fecha inválida" }, 400);
      if (from < cutoff || to < cutoff) {
        return json(
          { error: `Los cambios se hacen con al menos ${notice} horas de anticipación.` },
          409,
        );
      }
      const a = weekAndMonth(from, sector.timezone);
      const z = weekAndMonth(to, sector.timezone);
      if (a.week !== z.week || a.month !== z.month) {
        return json(
          { error: "Podés mover la clase a otro horario de la misma semana y del mismo mes." },
          409,
        );
      }
      const durationMs = service.duration_minutes * 60000;
      const check = validateSlot({
        startMs: to,
        durationMs,
        settings: sectorSettings(sector),
        busy: [],
      });
      if (!check.ok) return json({ error: check.error }, 409);

      const bed = typeof body?.resource_id === "string" && body.resource_id
        ? body.resource_id
        : null;
      const { data: moved, error } = await admin
        .from("bookings")
        .update({
          starts_at: new Date(to).toISOString(),
          ends_at: new Date(to + durationMs).toISOString(),
          resource_id: bed,
        })
        .eq("id", b.id)
        .eq("status", "confirmed")
        .gte("starts_at", new Date(cutoff).toISOString())
        .select("id, starts_at, resource_id");
      if (error) {
        if (error.code === "23P01") {
          return json({ error: "Ese horario ya no tiene lugar. Elegí otro." }, 409);
        }
        if (error.code === "23505") return json({ error: "Ya tenés una clase ese día." }, 409);
        return json({ error: "No se pudo mover la clase." }, 400);
      }
      if (!moved || moved.length === 0) {
        return json({ error: "Ya no se puede mover esta clase." }, 409);
      }
      // Offers that involved the old time are stale now.
      await admin
        .from("swap_requests")
        .update({ status: "expired", resolved_at: new Date().toISOString() })
        .eq("status", "pending")
        .or(`from_booking_id.eq.${b.id},to_booking_id.eq.${b.id}`);
      return json({ booking: moved[0] });
    }

    // ── propose a swap ────────────────────────────────────────────────────
    if (action === "propose") {
      const { data, error } = await admin.rpc("propose_swap", {
        p_from: body?.from_booking_id,
        p_to: body?.to_booking_id,
        p_user: user.id,
      });
      if (error) {
        const e = mapDbError(error, { noticeHours: await noticeOf(admin, body?.from_booking_id) });
        return json({ error: e.error }, e.status);
      }
      defer(() => sendSwapProposed(admin, data.id));
      return json({ request: data });
    }

    // ── answer / withdraw ─────────────────────────────────────────────────
    if (["accept", "decline", "cancel"].includes(action)) {
      const { data, error } = await admin.rpc("resolve_swap", {
        p_request: body?.request_id,
        p_user: user.id,
        p_action: action,
      });
      if (error) {
        const e = mapDbError(error);
        return json({ error: e.error }, e.status);
      }
      if (action !== "cancel") {
        defer(() => sendSwapResolved(admin, data.id, action === "accept" ? "accepted" : "declined"));
      }
      return json({ request: data });
    }

    return json({ error: "Acción inválida" }, 400);
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function noticeOf(admin: any, bookingId: unknown): Promise<number> {
  if (typeof bookingId !== "string") return 24;
  const { data } = await admin
    .from("bookings")
    .select("sectors(change_notice_hours)")
    .eq("id", bookingId)
    .maybeSingle();
  return data?.sectors?.change_notice_hours ?? 24;
}

// Authenticated, admin-only Edge Function: abonos handled at the desk.
//
//   create_for_client { email, full_name?, whatsapp_phone?, service_id, slots,
//                       locked, starts_on?, paid_cash }
//       Books a fixed schedule for a client who may not have an account yet.
//       No account → one is created with that email (confirmed; the client
//       signs in later with the usual email code) and the client is emailed.
//       paid_cash → the first cuota is recorded as a cash payment and the abono
//       is active; otherwise it waits for the client to pay, with NO hold (an
//       admin-held schedule never lapses on its own; an admin releases it).
//   mark_paid  { period_id }          cash at the desk for a cuota
//   release    { membership_id, reason? }  "Liberar lugar": classes after the
//                                     last paid month are cancelled
//   set_locked { membership_id, locked }
//   cycle      {}                     run the lazy maintenance now
//
// Notices (ADR 0013): the RPCs queue the client's (cuota paid, place
// released) with actor 'admin', so the other admins are not told; a desk sale
// queues membership_created_by_admin here. kick() sends them after the response.
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { isAdminUser, loadServiceWithSector } from "../_shared/sector.ts";
import {
  housekeeping,
  killLivePeriodPayments,
  mapDbError,
  parseDate,
  parseSlots,
} from "../_shared/membership.ts";
import { setTaloExpiration } from "../_shared/talo.ts";
import { emit, kick } from "../_shared/notify.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { data: { user } } = await userClient(req).auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);
    const admin = adminClient();
    if (!(await isAdminUser(admin, user))) return json({ error: "No autorizado" }, 403);

    const body = await req.json();
    const action = body?.action;

    if (action === "cycle") {
      const { data } = await admin.rpc("housekeeping");
      kick(admin); // a roll collision queues an alert
      return json({ ok: true, result: data });
    }

    // ── a schedule sold at the desk ───────────────────────────────────────
    if (action === "create_for_client") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email)) return json({ error: "Email inválido" }, 400);
      const fullName = String(body.full_name ?? "").trim() || null;
      const phone = String(body.whatsapp_phone ?? "").trim() || null;
      const slots = parseSlots(body.slots);
      if (!slots) return json({ error: "Elegí los días y horarios." }, 400);
      const startsOn = body.starts_on ? parseDate(body.starts_on) : null;
      if (body.starts_on && !startsOn) return json({ error: "Fecha de inicio inválida." }, 400);

      const [, service] = await Promise.all([
        housekeeping(admin),
        loadServiceWithSector(admin, body.service_id),
      ]);
      if (!service || !service.active || service.billing !== "monthly") {
        return json({ error: "Plan no disponible" }, 404);
      }

      // Find or create the client.
      let clientId: string | null = null;
      let created = false;
      const { data: existing } = await admin
        .from("profiles")
        .select("id, full_name, whatsapp_phone")
        .ilike("email", email)
        .maybeSingle();
      if (existing) {
        clientId = existing.id;
        const patch: Record<string, string> = {};
        if (fullName && !existing.full_name) patch.full_name = fullName;
        if (phone && !existing.whatsapp_phone) patch.whatsapp_phone = phone;
        if (Object.keys(patch).length) {
          await admin.from("profiles").update(patch).eq("id", clientId);
        }
      } else {
        const { data: made, error: mkErr } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: fullName ? { full_name: fullName } : {},
        });
        if (mkErr || !made?.user) {
          return json({ error: "No se pudo crear la cuenta del cliente." }, 500);
        }
        clientId = made.user.id;
        created = true;
        if (phone) await admin.from("profiles").update({ whatsapp_phone: phone }).eq("id", clientId);
      }

      const paid = Boolean(body.paid_cash);
      const { data, error } = await admin.rpc("create_membership", {
        p_user: clientId,
        p_service: service.id,
        p_slots: slots,
        p_locked: Boolean(body.locked),
        p_starts_on: startsOn,
        p_hold: null,
        p_created_by: user.id,
        p_paid_cash: paid,
      });
      if (error) {
        const m = mapDbError(error, { classesPerWeek: service.classes_per_week });
        // A brand-new account with nothing booked is harmless; keep it (the
        // admin will most likely retry with another bed).
        return json({ error: m.error }, m.status);
      }
      // The client may not even have signed in yet: this notice is how they
      // learn they have a place, so it goes by email whatever the preferences.
      await emit(admin, {
        kind: "membership_created_by_admin",
        subject: data.membership.id as string,
        audience: "user",
        actor: "admin",
        user: clientId,
        payload: { paid, new_account: created },
      });
      kick(admin);
      return json({
        membership: data.membership,
        period: data.period,
        user: { id: clientId, created },
      });
    }

    // ── cash for one cuota ────────────────────────────────────────────────
    if (action === "mark_paid") {
      const periodId = body?.period_id;
      if (typeof periodId !== "string") return json({ error: "Datos inválidos" }, 400);
      // A live CVU for the same cuota must not take the money a second time.
      await killLivePeriodPayments(admin, [periodId], setTaloExpiration);
      const { data: res, error } = await admin.rpc("pay_period_cash", {
        p_period: periodId,
        p_admin: user.id,
      });
      if (error) return json({ error: "No se pudo registrar el pago." }, 500);
      if (res === "already") return json({ error: "Esa cuota ya está paga." }, 409);
      if (res === "no_slot" || res === "not_found") {
        return json({ error: "El abono ya no está activo." }, 409);
      }
      kick(admin);
      return json({ ok: true });
    }

    const id = body?.membership_id;
    if (typeof id !== "string") return json({ error: "Datos inválidos" }, 400);

    if (action === "release") {
      const reason = typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : "Cuota impaga";
      const { data: pending } = await admin
        .from("membership_periods")
        .select("id")
        .eq("membership_id", id)
        .eq("status", "pending");
      await killLivePeriodPayments(admin, (pending ?? []).map((p) => p.id), setTaloExpiration);
      const { data: n, error } = await admin.rpc("release_membership", {
        p_membership: id,
        p_by: user.id,
        p_reason: reason,
      });
      if (error) {
        const e = mapDbError(error);
        return json({ error: e.error }, e.status);
      }
      kick(admin);
      return json({ ok: true, cancelled: n });
    }

    if (action === "set_locked") {
      const { data, error } = await admin.rpc("set_membership_locked", {
        p_membership: id,
        p_locked: Boolean(body.locked),
        p_actor: "admin",
      });
      if (error) {
        const e = mapDbError(error);
        return json({ error: e.error }, e.status);
      }
      return json({ membership: data });
    }

    return json({ error: "Acción inválida" }, 400);
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});

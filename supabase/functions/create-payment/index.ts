// Authenticated Edge Function. Pays a booking, a pack purchase or a cuota:
//   { booking_id }           → pay for a booking
//   { pack_service_id }      → buy a pack
//   { membership_period_id } → pay one month of an abono (surcharge included
//                              when late, computed by membership_periods_v)
//
// The only method is "talo": a one-time CVU/alias the client transfers to,
// settled automatically (talo-webhook / talo-reconcile). The manual receipt
// (upload a proof, an admin approves) is gone — ADR 0014: cash at the desk is
// an admin slot block, not a payment. Legacy manual rows still exist and
// rivalPayment keeps a Talo CVU from being minted on top of one.
// (The legacy Mobbex method is gone with its webhook; ADR 0010.)
//
// The amount is ALWAYS taken server-side from the services row, never from the
// client.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { MEMBERSHIP_ACTIVE_LIST, PAYABLE_LIST } from "../_shared/booking-status.ts";
import { canUseSector, type Sector } from "../_shared/sector.ts";
import {
  createTaloPayment,
  getTaloPayment,
  setTaloExpiration,
  setTaloPrice,
  taloConfigured,
} from "../_shared/talo.ts";

const PAY_COLS =
  "id, status, amount_ars, talo_payment_id, talo_cvu, talo_alias, talo_expires_at";

type PayRow = {
  id: string;
  status: string;
  amount_ars: number;
  talo_payment_id: string | null;
  talo_cvu: string | null;
  talo_alias: string | null;
  talo_expires_at: string | null;
};

// The money window and the slot hold are the SAME instant, so a transfer can
// never land on a slot we already gave away. Capped an hour before the turno
// starts (paying for a session that already began is meaningless) and floored so
// the client always gets a usable window.
function taloWindow(startsAt?: string | null): string {
  const raw = Number(Deno.env.get("TALO_PAYMENT_MINUTES") ?? "30");
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 30;
  const now = Date.now();
  let end = now + minutes * 60_000;
  if (startsAt) {
    const cutoff = new Date(startsAt).getTime() - 60 * 60_000;
    if (Number.isFinite(cutoff)) end = Math.min(end, cutoff);
  }
  return new Date(Math.max(end, now + 10 * 60_000)).toISOString();
}

type Target = { bookingId?: string; serviceId?: string; userId?: string; periodId?: string };

/** Booking, pack and cuota payments are found by different columns.
 *  Returned as a `.match()` object so it composes with any builder. */
function targetMatch(target: Target): Record<string, string> {
  if (target.periodId) return { membership_period_id: target.periodId };
  return target.bookingId
    ? { booking_id: target.bookingId }
    : { kind: "pack", service_id: target.serviceId!, user_id: target.userId! };
}

/**
 * A client must never end up with two live ways to pay the same thing: a Talo
 * CVU *and* an uploaded receipt means the webhook approves one row while an
 * admin approves the other. For a pack that double-grants credits — the
 * credit_ledger uniqueness is keyed on payment_id, so it cannot catch it.
 * Worse, the manual alias and the Talo CVU are different bank accounts.
 */
async function rivalPayment(
  admin: SupabaseClient,
  rival: "talo" | "manual",
  target: Target,
): Promise<PayRow | null> {
  const { data } = await admin
    .from("payments")
    .select(PAY_COLS)
    .eq("provider", rival)
    .match(targetMatch(target))
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PayRow | null) ?? null;
}

type TaloStart =
  | {
    ok: true;
    data: {
      payment_id: string;
      payment_url: string | null;
      cvu: string | null;
      alias: string | null;
      amount: number;
      expires_at: string | null;
    };
  }
  | { ok: false; error: string; status: number };

function shape(row: PayRow, url: string | null): TaloStart {
  return {
    ok: true,
    data: {
      payment_id: row.id,
      payment_url: url,
      cvu: row.talo_cvu,
      alias: row.talo_alias,
      amount: row.amount_ars,
      expires_at: row.talo_expires_at,
    },
  };
}

/** Kill a superseded CVU so it can never take the client's money later. */
async function retire(admin: SupabaseClient, row: PayRow) {
  if (row.talo_payment_id) {
    await setTaloExpiration(
      row.talo_payment_id,
      new Date(Date.now() + 60_000).toISOString(),
    );
  }
  // No admin_flag: superseding a CVU is routine, not something a human reviews.
  await admin
    .from("payments")
    .update({ status: "rejected" })
    .eq("id", row.id)
    .eq("status", "pending");
}

/** Can we hand this existing CVU back instead of minting a second one? */
async function tryReuse(
  admin: SupabaseClient,
  row: PayRow,
  amount: number,
): Promise<"reuse" | "retire"> {
  const v = await getTaloPayment(row.talo_payment_id!);
  // Could not check. Handing back the CVU we already have is strictly safer than
  // minting a second one the client might not be looking at.
  if (!v.ok) return "reuse";

  const st = v.data.status.toUpperCase();
  if (st === "EXPIRED") return "retire";
  // Anything other than PENDING means money already moved; the settle path owns
  // that row now and must not have its CVU pulled out from under it.
  if (st !== "PENDING") return "reuse";
  if (
    row.talo_expires_at &&
    new Date(row.talo_expires_at).getTime() <= Date.now()
  ) return "retire";

  if (row.amount_ars !== amount) {
    // Letting payments.amount_ars and Talo's price diverge would break the
    // settle-time amount check, so they move together or not at all.
    const priced = await setTaloPrice(row.talo_payment_id!, amount);
    if (!priced.ok) return "retire";
    await admin.from("payments").update({ amount_ars: amount }).eq("id", row.id);
    row.amount_ars = amount;
  }
  return "reuse";
}

/**
 * Reuse-first: a second click must return the SAME CVU, never mint another one.
 * Two concurrent callers both used to `maybeSingle()` -> both find nothing ->
 * both insert; the partial unique indexes now turn that into a 23505 that we
 * resolve by re-reading rather than by erroring at the client.
 */
async function startTalo(admin: SupabaseClient, opts: {
  userId: string;
  email?: string;
  firstName?: string;
  kind: "booking" | "pack" | "membership";
  bookingId?: string;
  serviceId?: string;
  periodId?: string;
  /** A pending abono whose hold must follow the CVU (see below). */
  membershipId?: string;
  amount: number;
  motive: string;
  startsAt?: string | null;
  redirectFor: (paymentRowId: string) => string;
}): Promise<TaloStart> {
  if (!taloConfigured()) {
    return { ok: false, error: "Pagos online no configurados", status: 503 };
  }
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) {
    return { ok: false, error: "Importe inválido", status: 409 };
  }

  const target: Target = {
    bookingId: opts.bookingId,
    serviceId: opts.serviceId,
    userId: opts.userId,
    periodId: opts.periodId,
  };

  const rival = await rivalPayment(admin, "manual", target);
  if (rival) {
    return {
      ok: false,
      status: 409,
      error: rival.status === "approved"
        ? "Ese pago ya fue registrado."
        : "Ya subiste un comprobante para este pago. Esperá a que lo verifiquemos.",
    };
  }

  const insertRow: Record<string, unknown> = opts.periodId
    ? {
      kind: "membership",
      membership_period_id: opts.periodId,
      user_id: opts.userId,
      provider: "talo",
      amount_ars: opts.amount,
      status: "pending",
    }
    : opts.bookingId
    ? {
      booking_id: opts.bookingId,
      provider: "talo",
      amount_ars: opts.amount,
      status: "pending",
    }
    : {
      kind: "pack",
      service_id: opts.serviceId,
      user_id: opts.userId,
      provider: "talo",
      amount_ars: opts.amount,
      status: "pending",
    };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const secret = Deno.env.get("TALO_WEBHOOK_SECRET") ?? "";
  const webhookUrl = `${supabaseUrl}/functions/v1/talo-webhook${
    secret ? `?token=${encodeURIComponent(secret)}` : ""
  }`;
  const expiresAt = taloWindow(opts.startsAt);

  for (let attempt = 0; attempt < 2; attempt++) {
    // ── get-or-create OUR row first, so a webhook always has something to find ─
    let row: PayRow | null = null;
    for (let i = 0; i < 3 && !row; i++) {
      const { data: live } = await admin
        .from("payments")
        .select(PAY_COLS)
        .eq("provider", "talo")
        .eq("status", "pending")
        .match(targetMatch(target))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (live) {
        row = live as PayRow;
        break;
      }
      const { data: made, error: insErr } = await admin
        .from("payments")
        .insert(insertRow)
        .select(PAY_COLS)
        .single();
      if (made) row = made as PayRow;
      // 23505 = we lost the race against a concurrent click; re-read and reuse.
      else if (insErr?.code !== "23505") {
        return { ok: false, error: "No se pudo iniciar el pago", status: 500 };
      }
    }
    if (!row) return { ok: false, error: "No se pudo iniciar el pago", status: 500 };

    if (row.talo_payment_id) {
      const verdict = await tryReuse(admin, row, opts.amount);
      // Talo's hosted URL is not stored, and guessing the host would be wrong in
      // sandbox; the CVU/alias are the primary UX anyway.
      if (verdict === "reuse") return shape(row, null);
      await retire(admin, row);
      continue; // next attempt inserts a fresh row
    }

    // ── mint the CVU ──────────────────────────────────────────────────────────
    const created = await createTaloPayment({
      amount: opts.amount,
      // external_id is OUR payment row id: a v4 uuid, so outsiders cannot guess
      // it. The paying user CAN read it (payments_select_own, and it appears in
      // /comprar/exito?ref=). That is harmless ONLY because settlement never
      // resolves from a client-supplied external_id — see _shared/talo-settle.ts.
      // Do not add a "convenience" lookup by external_id from webhook input.
      externalId: row.id,
      motive: opts.motive,
      webhookUrl,
      redirectUrl: opts.redirectFor(row.id),
      expiresAt,
      email: opts.email,
      firstName: opts.firstName,
    });
    if (!created.ok) {
      return {
        ok: false,
        status: created.reason === "unconfigured" ? 503 : 502,
        error: created.reason === "unconfigured"
          ? "Pagos online no configurados"
          : "No se pudo iniciar el pago",
      };
    }

    // Claim the row for this Talo payment, first-writer-wins.
    const { data: patched } = await admin
      .from("payments")
      .update({
        talo_payment_id: created.data.id,
        talo_cvu: created.data.cvu,
        talo_alias: created.data.alias,
        talo_expires_at: created.data.expiresAt ?? expiresAt,
        external_reference: row.id,
      })
      .eq("id", row.id)
      .is("talo_payment_id", null)
      .select(PAY_COLS)
      .maybeSingle();

    if (!patched) {
      // A concurrent call claimed the row. Kill the CVU we just minted so it can
      // never quietly accept a transfer nobody is watching.
      await setTaloExpiration(
        created.data.id,
        new Date(Date.now() + 60_000).toISOString(),
      );
      continue;
    }

    // Keep the slot hold in step with the CVU, but never longer than our own
    // window: if Talo kept its multi-day default, a late transfer is flagged at
    // settle time instead of the slot being held for days.
    const talo = created.data.expiresAt;
    const hold = talo && new Date(talo) < new Date(expiresAt) ? talo : expiresAt;
    if (opts.bookingId) {
      await admin
        .from("bookings")
        .update({ hold_expires_at: hold })
        .eq("id", opts.bookingId)
        .in("status", PAYABLE_LIST);
    }
    // An unpaid abono signup holds its whole schedule on the same clock: the
    // membership and every one of its pending classes.
    if (opts.membershipId) {
      await Promise.all([
        admin
          .from("memberships")
          .update({ hold_expires_at: hold })
          .eq("id", opts.membershipId)
          .eq("status", "pending")
          .not("hold_expires_at", "is", null),
        admin
          .from("bookings")
          .update({ hold_expires_at: hold })
          .eq("membership_id", opts.membershipId)
          .eq("status", "pending")
          .not("hold_expires_at", "is", null),
      ]);
    }

    return shape(patched as PayRow, created.data.paymentUrl);
  }

  return { ok: false, error: "No se pudo iniciar el pago", status: 500 };
}

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { booking_id, pack_service_id, membership_period_id, method = "talo" } =
      await req.json();
    if (!booking_id && !pack_service_id && !membership_period_id) {
      return json({ error: "Falta booking_id, pack_service_id o membership_period_id" }, 400);
    }
    if (method !== "talo") {
      return json({ error: "Método de pago inválido" }, 400);
    }

    const {
      data: { user },
    } = await userClient(req).auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const admin = adminClient();
    const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:3000";

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();
    const firstName = (profile?.full_name ?? "").split(" ")[0] || undefined;

    // ══ PACK PURCHASE (no booking) ═══════════════════════════════════════════
    if (pack_service_id) {
      const { data: pack } = await admin
        .from("services")
        .select("id, name, price_ars, active, sessions_included, sectors(*)")
        .eq("id", pack_service_id)
        .single();
      if (
        !pack || !pack.active || pack.sessions_included <= 1 ||
        // A hidden sector's packs are for admins only (the feature flag).
        !(await canUseSector(admin, pack.sectors as unknown as Sector, user))
      ) {
        return json({ error: "Pack no disponible" }, 404);
      }
      const amount: number = pack.price_ars ?? 0;
      const target = { serviceId: pack.id, userId: user.id };

      if (method === "talo") {
        const out = await startTalo(admin, {
          userId: user.id,
          email: user.email,
          firstName,
          kind: "pack",
          serviceId: pack.id,
          amount,
          motive: `${pack.name} · VULL`,
          redirectFor: (payId) => `${appUrl}/comprar/exito?ref=${payId}`,
        });
        if (!out.ok) return json({ error: out.error }, out.status);
        return json(out.data);
      }

      return json({ error: "Método de pago inválido" }, 400);
    }

    // ══ ABONO CUOTA ══════════════════════════════════════════════════════════
    if (membership_period_id) {
      const { data: per } = await admin
        .from("membership_periods_v")
        .select("id, membership_id, user_id, period, status, amount_due_ars, membership_status")
        .eq("id", membership_period_id)
        .maybeSingle();
      if (!per) return json({ error: "Cuota no encontrada" }, 404);
      if (per.user_id !== user.id) return json({ error: "No autorizado" }, 403);
      if (per.status === "paid") return json({ error: "Esa cuota ya está pagada." }, 409);
      if (per.status !== "pending" || !MEMBERSHIP_ACTIVE_LIST.includes(per.membership_status)) {
        return json({ error: "El abono ya no está activo." }, 409);
      }
      const { data: mem } = await admin
        .from("memberships")
        .select("id, status, hold_expires_at, services(name)")
        .eq("id", per.membership_id)
        .single();
      // A lapsed signup is about to be swept: never mint a CVU for beds that are
      // being handed to somebody else.
      if (
        mem?.status === "pending" && mem.hold_expires_at &&
        new Date(mem.hold_expires_at).getTime() <= Date.now()
      ) {
        return json({ error: "Se venció la reserva del horario. Elegí de nuevo." }, 409);
      }
      const amount: number = per.amount_due_ars;
      const target = { periodId: per.id };

      // deno-lint-ignore no-explicit-any
      const planName = (mem?.services as any)?.name ?? "Abono";
      const { data: first } = await admin
        .from("bookings")
        .select("starts_at")
        .eq("membership_id", per.membership_id)
        .in("status", PAYABLE_LIST)
        .gt("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(1)
        .maybeSingle();
      const out = await startTalo(admin, {
        userId: user.id,
        email: user.email,
        firstName,
        kind: "membership",
        periodId: per.id,
        membershipId: mem?.status === "pending" ? mem.id : undefined,
        amount,
        motive: `${planName} · ${String(per.period).slice(0, 7)} · VULL`,
        // Only a pending signup has a class clock to respect.
        startsAt: mem?.status === "pending" ? first?.starts_at ?? null : null,
        redirectFor: () => `${appUrl}/cuenta/plan/pagar/${per.id}?pago=talo`,
      });
      if (!out.ok) return json({ error: out.error }, out.status);
      return json(out.data);
    }

    // ══ BOOKING PAYMENT ══════════════════════════════════════════════════════
    const { data: booking } = await admin
      .from("bookings")
      .select("*, services(name, price_ars)")
      .eq("id", booking_id)
      .single();

    if (!booking) return json({ error: "Reserva no encontrada" }, 404);
    if (booking.user_id !== user.id) return json({ error: "No autorizado" }, 403);
    if (booking.membership_id) {
      return json(
        { error: "Esta clase es parte de tu abono. Pagá la cuota desde Mi plan." },
        409,
      );
    }
    if (!PAYABLE_LIST.includes(booking.status)) {
      return json({ error: "La reserva no admite pago" }, 409);
    }
    // A lapsed `pending` hold is about to be swept; minting a CVU for it would
    // let the client pay for a slot that is being handed to somebody else.
    if (
      booking.status === "pending" &&
      booking.hold_expires_at &&
      new Date(booking.hold_expires_at).getTime() <= Date.now()
    ) {
      return json({ error: "Se venció la reserva. Elegí otro horario." }, 409);
    }

    const amount: number = booking.services?.price_ars ?? 0;
    const target = { bookingId: booking_id };

    if (method === "talo") {
      const out = await startTalo(admin, {
        userId: user.id,
        email: user.email,
        firstName,
        kind: "booking",
        bookingId: booking_id,
        amount,
        motive: `${booking.services?.name ?? "Turno"} · VULL ${booking_id.slice(0, 8)}`,
        startsAt: booking.starts_at,
        redirectFor: () => `${appUrl}/turno/${booking_id}?pago=talo`,
      });
      if (!out.ok) return json({ error: out.error }, out.status);
      // The booking deliberately STAYS `pending`: the existing lazy hold sweep
      // then frees an abandoned CVU's slot for free. It moves to
      // `awaiting_payment` only once Talo records money on its way.
      return json(out.data);
    }

    return json({ error: "Método de pago inválido" }, 400);
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});

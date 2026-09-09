// Authenticated Edge Function. Pays either a booking or a pack purchase:
//   { booking_id }      → pay for a booking; { pack_service_id } → buy a pack.
//
// method "talo"   → mints a one-time CVU/alias the client transfers to; Talo
//                   settles it automatically (talo-webhook / talo-reconcile).
// method "manual" → records a receipt for admin review (the $0 fallback).
// method "mobbex" → legacy, switched off; removed once Talo is proven in prod.
//
// The amount is ALWAYS taken server-side from the services row, never from the
// client, and the two online/manual paths are mutually exclusive so one purchase
// can never be approved twice.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { notifyAdmins, notifyAdminsPackToVerify } from "../_shared/email.ts";
import { PAYABLE_LIST } from "../_shared/booking-status.ts";
import {
  createTaloPayment,
  getTaloPayment,
  setTaloExpiration,
  setTaloPrice,
  taloConfigured,
} from "../_shared/talo.ts";

// A receipt must live in the caller's own folder and be an image/PDF.
const RECEIPT_EXT = /\.(png|jpe?g|webp|pdf)$/i;
function validReceipt(path: unknown, userId: string): boolean {
  return (
    typeof path === "string" &&
    path.startsWith(`${userId}/`) &&
    RECEIPT_EXT.test(path)
  );
}

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

type Target = { bookingId?: string; serviceId?: string; userId?: string };

/** A booking payment and a pack payment are found by different columns.
 *  Returned as a `.match()` object so it composes with any builder. */
function targetMatch(target: Target): Record<string, string> {
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
  kind: "booking" | "pack";
  bookingId?: string;
  serviceId?: string;
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

  const insertRow: Record<string, unknown> = opts.bookingId
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

    // Talo's expiration is authoritative once set; keep the slot hold in step.
    if (opts.bookingId) {
      await admin
        .from("bookings")
        .update({ hold_expires_at: created.data.expiresAt ?? expiresAt })
        .eq("id", opts.bookingId)
        .in("status", PAYABLE_LIST);
    }

    return shape(patched as PayRow, created.data.paymentUrl);
  }

  return { ok: false, error: "No se pudo iniciar el pago", status: 500 };
}

// ── Legacy Mobbex checkout (switched off; removed once Talo is live) ──────────
async function mobbexCheckout(opts: {
  amount: number;
  reference: string;
  description: string;
  email?: string;
  name?: string;
  returnUrl: string;
}) {
  const apiKey = Deno.env.get("MOBBEX_API_KEY");
  const accessToken = Deno.env.get("MOBBEX_ACCESS_TOKEN");
  if (!apiKey || !accessToken) return { error: "unconfigured" as const };
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const secret = Deno.env.get("MOBBEX_WEBHOOK_SECRET") ?? "";
  const webhookUrl = `${supabaseUrl}/functions/v1/mobbex-webhook${
    secret ? `?token=${encodeURIComponent(secret)}` : ""
  }`;
  const res = await fetch("https://api.mobbex.com/p/checkout", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "x-access-token": accessToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      total: opts.amount,
      currency: "ARS",
      reference: opts.reference,
      description: opts.description,
      customer: { email: opts.email, name: opts.name ?? opts.email },
      return_url: opts.returnUrl,
      webhook: webhookUrl,
      test: (Deno.env.get("MOBBEX_TEST") ?? "false") === "true",
    }),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out?.data?.url) return { error: "checkout_failed" as const, detail: out };
  return { url: out.data.url as string, id: out.data.id as string };
}

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { booking_id, pack_service_id, method = "talo", receipt_path } =
      await req.json();
    if (!booking_id && !pack_service_id) {
      return json({ error: "Falta booking_id o pack_service_id" }, 400);
    }
    if (!["talo", "manual", "mobbex"].includes(method)) {
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
        .select("id, name, price_ars, active, sessions_included")
        .eq("id", pack_service_id)
        .single();
      if (!pack || !pack.active || pack.sessions_included <= 1) {
        return json({ error: "Pack no disponible" }, 404);
      }
      const amount: number = pack.price_ars ?? 0;
      const target = { serviceId: pack.id, userId: user.id };

      if (method === "manual") {
        if (!validReceipt(receipt_path, user.id)) {
          return json({ error: "Comprobante inválido" }, 400);
        }
        // Never two live ways to pay one thing (see rivalPayment).
        const live = await rivalPayment(admin, "talo", target);
        if (live) {
          if (live.status === "approved") {
            return json({ error: "Ese pack ya está pagado." }, 409);
          }
          // The client chose to switch to a receipt: kill the CVU so it cannot
          // ALSO take their money later.
          await retire(admin, live);
        }
        const { data: packPay, error: insErr } = await admin
          .from("payments")
          .insert({
            kind: "pack",
            service_id: pack.id,
            user_id: user.id,
            provider: "manual",
            amount_ars: amount,
            status: "pending",
            receipt_path,
          })
          .select("id")
          .single();
        if (insErr || !packPay) {
          return json({ error: "No se pudo registrar el comprobante" }, 500);
        }
        await notifyAdminsPackToVerify(admin, packPay.id);
        return json({ ok: true });
      }

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

      // Mobbex (legacy): create the pack payment row first so its id is the reference.
      const { data: pay, error: payErr } = await admin
        .from("payments")
        .insert({
          kind: "pack",
          service_id: pack.id,
          user_id: user.id,
          provider: "mobbex",
          amount_ars: amount,
          status: "pending",
        })
        .select("id")
        .single();
      if (payErr || !pay) return json({ error: "No se pudo iniciar el pago" }, 500);

      const co = await mobbexCheckout({
        amount,
        reference: pay.id,
        description: `${pack.name}`,
        email: user.email,
        name: profile?.full_name ?? undefined,
        returnUrl: `${appUrl}/comprar/exito?ref=${pay.id}`,
      });
      if ("error" in co) {
        return json(
          { error: co.error === "unconfigured" ? "Pagos online no configurados" : "No se pudo iniciar el pago" },
          co.error === "unconfigured" ? 503 : 502,
        );
      }
      await admin
        .from("payments")
        .update({ mobbex_checkout_id: co.id, external_reference: pay.id })
        .eq("id", pay.id);
      return json({ url: co.url, checkout_id: co.id });
    }

    // ══ BOOKING PAYMENT ══════════════════════════════════════════════════════
    const { data: booking } = await admin
      .from("bookings")
      .select("*, services(name, price_ars)")
      .eq("id", booking_id)
      .single();

    if (!booking) return json({ error: "Reserva no encontrada" }, 404);
    if (booking.user_id !== user.id) return json({ error: "No autorizado" }, 403);
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

    if (method === "manual") {
      if (!validReceipt(receipt_path, user.id)) {
        return json({ error: "Comprobante inválido" }, 400);
      }
      const live = await rivalPayment(admin, "talo", target);
      if (live) {
        if (live.status === "approved") {
          return json({ error: "Este turno ya está pagado." }, 409);
        }
        await retire(admin, live);
      }
      const { error: insErr } = await admin.from("payments").insert({
        booking_id,
        provider: "manual",
        amount_ars: amount,
        status: "pending",
        receipt_path,
        external_reference: booking_id,
      });
      if (insErr) {
        return json({ error: "No se pudo registrar el comprobante" }, 500);
      }
      await admin
        .from("bookings")
        .update({ status: "awaiting_payment" })
        .eq("id", booking_id);
      await notifyAdmins(admin, "payment_to_verify", booking_id);
      return json({ ok: true });
    }

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

    // Mobbex (legacy)
    const co = await mobbexCheckout({
      amount,
      reference: booking_id,
      description: `${booking.services?.name ?? "Turno"} — ${booking_id.slice(0, 8)}`,
      email: user.email,
      name: profile?.full_name ?? undefined,
      returnUrl: `${appUrl}/turno/${booking_id}`,
    });
    if ("error" in co) {
      return json(
        { error: co.error === "unconfigured" ? "Pagos online no configurados" : "No se pudo iniciar el pago", detail: co.detail },
        co.error === "unconfigured" ? 503 : 502,
      );
    }
    const { data: existing } = await admin
      .from("payments")
      .select("id")
      .eq("booking_id", booking_id)
      .eq("provider", "mobbex")
      .maybeSingle();
    if (existing) {
      await admin
        .from("payments")
        .update({ mobbex_checkout_id: co.id, amount_ars: amount, status: "pending" })
        .eq("id", existing.id);
    } else {
      await admin.from("payments").insert({
        booking_id,
        provider: "mobbex",
        amount_ars: amount,
        status: "pending",
        mobbex_checkout_id: co.id,
        external_reference: booking_id,
      });
    }
    await admin
      .from("bookings")
      .update({ status: "awaiting_payment" })
      .eq("id", booking_id);
    return json({ url: co.url, checkout_id: co.id });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});

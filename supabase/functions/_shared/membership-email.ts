// Emails and push for monthly plans (abonos) and class swaps. Same shell and
// fan-out as ./email.ts (preferences respected, best-effort: nothing here may
// fail the request that triggered it).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fanOutToAdmins, fanOutToUser, money, type Row, sendMail, shell } from "./email.ts";
import { loadMembership, scheduleRows, type MembershipCtx } from "./membership.ts";

const GREEN = "#61b33b";
const RED = "#e5484d";

const appUrl = () => Deno.env.get("APP_URL") ?? "";

function monthName(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

function longDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function classWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(/\./g, "");
}

async function firstName(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("full_name").eq("id", userId).single();
  return (data?.full_name ?? "").trim().split(" ")[0] || "Hola";
}

function nextDueNote(m: MembershipCtx, paidPeriod: string): string {
  if (!m.locked) {
    return m.endsOn
      ? `Tu abono termina el ${longDate(m.endsOn)}. Si querés seguir, elegí tus horarios de nuevo desde la app.`
      : "";
  }
  const [y, mo] = paidPeriod.split("-").map(Number);
  const next = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, "0")}-01`;
  return `Tu lugar queda reservado todos los meses. La cuota de ${monthName(next)} se paga hasta el ${m.sector.due_day}; después tiene un ${m.sector.late_fee_pct} % de recargo.`;
}

/** The cuota of a month was paid (Talo, receipt approved or cash at the desk). */
export async function sendMembershipConfirmation(
  admin: SupabaseClient,
  periodId: string,
): Promise<void> {
  try {
    const { data: per } = await admin
      .from("membership_periods")
      .select("membership_id, period, classes, payments!membership_periods_payment_id_fkey(amount_ars)")
      .eq("id", periodId)
      .single();
    if (!per) return;
    // deno-lint-ignore no-explicit-any
    const p = per as any;
    const m = await loadMembership(admin, p.membership_id);
    if (!m) return;
    const name = await firstName(admin, m.userId);
    const paid = p.payments?.amount_ars;
    const rows: Row[] = [
      ...scheduleRows(m.slots),
      { label: "Plan", value: `${m.plan} · ${m.classesPerWeek} por semana` },
      { label: "Mes", value: monthName(p.period) },
      ...(paid ? [{ label: "Pagado", value: money(paid), mono: true }] : []),
    ];
    const html = shell({
      heading: "Tu lugar está reservado ✓",
      accent: GREEN,
      lead: `Hola ${name}, la cuota de ${monthName(p.period)} está acreditada. Estas son tus clases de cada semana:`,
      rows,
      note: nextDueNote(m, p.period),
      cta: appUrl() ? { label: "Ver mi plan", url: `${appUrl()}/cuenta/plan` } : undefined,
    });
    await fanOutToUser(admin, m.userId, {
      subject: `Abono confirmado · ${monthName(p.period)} · VULL`,
      html,
      push: {
        title: "Abono confirmado ✓",
        body: `${m.plan} · ${monthName(p.period)}`,
        url: `${appUrl()}/cuenta/plan`,
      },
    });
  } catch (_) {
    /* best-effort */
  }
}

/** An admin booked a schedule for the client (maybe before they have an account).
 *  Sent even when the client never signed in, so it bypasses the preferences:
 *  it is the only way they learn they have a place. */
export async function sendMembershipCreatedByAdmin(
  admin: SupabaseClient,
  membershipId: string,
  opts: { paid: boolean; newAccount: boolean },
): Promise<void> {
  try {
    const m = await loadMembership(admin, membershipId);
    if (!m) return;
    const { data: prof } = await admin
      .from("profiles")
      .select("full_name, email")
      .eq("id", m.userId)
      .single();
    const email = prof?.email;
    if (!email) return;
    const name = (prof?.full_name ?? "").trim().split(" ")[0] || "Hola";
    const { data: per } = await admin
      .from("membership_periods_v")
      .select("period, amount_due_ars, status")
      .eq("membership_id", m.id)
      .order("period")
      .limit(1)
      .maybeSingle();
    const rows: Row[] = [
      ...scheduleRows(m.slots),
      { label: "Empezás", value: longDate(m.startsOn) },
      ...(per && per.status === "pending"
        ? [{ label: `Cuota de ${monthName(per.period)}`, value: money(per.amount_due_ars), mono: true }]
        : []),
      { label: "Horario fijo", value: m.locked ? "Sí, todos los meses" : "Solo este mes" },
    ];
    const html = shell({
      heading: "Tu lugar está reservado",
      accent: GREEN,
      lead: `Hola ${name}, te reservamos tu horario de ${m.plan} en VULL. Entrá con este mismo email para ver tus clases${
        opts.paid ? "" : " y pagar la cuota"
      }.`,
      rows,
      note: opts.newAccount
        ? "No hace falta contraseña: al entrar te mandamos un código a este email."
        : "Ya lo vas a ver en Mi plan, dentro de tu cuenta.",
      cta: appUrl()
        ? { label: "Entrar con mi email", url: `${appUrl()}/login?next=${encodeURIComponent("/cuenta/plan")}` }
        : undefined,
    });
    await sendMail(email, `Tu lugar en ${m.sector.name.toLowerCase()} está reservado · VULL`, html);
  } catch (_) {
    /* best-effort */
  }
}

/** An admin freed the slots (unpaid cuota) or the membership was released. */
export async function sendMembershipReleased(
  admin: SupabaseClient,
  membershipId: string,
  opts: { byAdmin: boolean },
): Promise<void> {
  try {
    const m = await loadMembership(admin, membershipId);
    if (!m) return;
    const name = await firstName(admin, m.userId);
    const html = shell({
      heading: opts.byAdmin ? "Liberamos tu lugar" : "Diste de baja tu abono",
      accent: RED,
      lead: opts.byAdmin
        ? `Hola ${name}, la cuota de tu abono de ${m.plan} no se pagó a tiempo y tu horario quedó libre para otras personas.`
        : `Hola ${name}, tu abono de ${m.plan} no se renueva más.`,
      rows: [
        ...scheduleRows(m.slots),
        ...(m.endsOn ? [{ label: "Última clase incluida", value: longDate(m.endsOn) }] : []),
      ],
      note: "Si querés volver, podés elegir horarios de nuevo desde la app o escribirnos por WhatsApp.",
      cta: appUrl() ? { label: "Ver planes", url: `${appUrl()}/planes` } : undefined,
    });
    await fanOutToUser(admin, m.userId, {
      subject: opts.byAdmin ? "Liberamos tu lugar · VULL" : "Abono dado de baja · VULL",
      html,
      push: opts.byAdmin
        ? { title: "Liberamos tu lugar", body: `${m.plan}: la cuota no se pagó a tiempo`, url: `${appUrl()}/cuenta/plan` }
        : undefined,
    });
  } catch (_) {
    /* best-effort */
  }
}

type SwapCtx = {
  id: string;
  fromUser: string;
  toUser: string;
  fromWhen: string;
  toWhen: string;
  fromBookingId: string;
  toBookingId: string;
};

async function loadSwap(admin: SupabaseClient, requestId: string): Promise<SwapCtx | null> {
  const { data } = await admin
    .from("swap_requests")
    .select(
      "id, from_user_id, to_user_id, from_booking_id, to_booking_id, from:bookings!swap_requests_from_booking_id_fkey(starts_at, resources(name), sectors(timezone)), to:bookings!swap_requests_to_booking_id_fkey(starts_at, resources(name))",
    )
    .eq("id", requestId)
    .single();
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const r = data as any;
  const tz = r.from?.sectors?.timezone ?? "America/Argentina/Buenos_Aires";
  return {
    id: r.id,
    fromUser: r.from_user_id,
    toUser: r.to_user_id,
    fromBookingId: r.from_booking_id,
    toBookingId: r.to_booking_id,
    fromWhen: `${classWhen(r.from.starts_at, tz)} · ${r.from.resources?.name ?? ""}`,
    toWhen: `${classWhen(r.to.starts_at, tz)} · ${r.to.resources?.name ?? ""}`,
  };
}

/** To the receiver of an offer. Read right after the proposal (nothing moved yet):
 *  `from` is the proposer's class, `to` is the receiver's. */
export async function sendSwapProposed(admin: SupabaseClient, requestId: string): Promise<void> {
  try {
    const s = await loadSwap(admin, requestId);
    if (!s) return;
    const [who, name] = await Promise.all([firstName(admin, s.fromUser), firstName(admin, s.toUser)]);
    const html = shell({
      heading: "Propuesta de intercambio",
      lead: `Hola ${name}, ${who} te propone cambiar su clase por la tuya. Si aceptás, las dos se intercambian al instante.`,
      rows: [
        { label: "Tu clase", value: s.toWhen, mono: true },
        { label: "Pasaría a", value: s.fromWhen, mono: true },
      ],
      note: "Podés responder hasta 24 h antes de cualquiera de las dos clases.",
      cta: appUrl() ? { label: "Responder", url: `${appUrl()}/cuenta/plan#intercambios` } : undefined,
    });
    await fanOutToUser(admin, s.toUser, {
      subject: `${who} quiere cambiar una clase con vos · VULL`,
      html,
      push: {
        title: "Propuesta de intercambio",
        body: `${who} quiere cambiar su clase del ${s.fromWhen} por la tuya`,
        url: `${appUrl()}/cuenta/plan#intercambios`,
      },
    });
  } catch (_) {
    /* best-effort */
  }
}

/** To the proposer, once the receiver answered. After an accept the two
 *  bookings already swapped times, so the proposer's row now holds the new
 *  class. */
export async function sendSwapResolved(
  admin: SupabaseClient,
  requestId: string,
  outcome: "accepted" | "declined",
): Promise<void> {
  try {
    const s = await loadSwap(admin, requestId);
    if (!s) return;
    const [who, name] = await Promise.all([firstName(admin, s.toUser), firstName(admin, s.fromUser)]);
    const accepted = outcome === "accepted";
    const html = shell({
      heading: accepted ? "Intercambio aceptado ✓" : "Intercambio rechazado",
      accent: accepted ? GREEN : undefined,
      lead: accepted
        ? `Hola ${name}, ${who} aceptó el cambio. Tu clase ahora es:`
        : `Hola ${name}, ${who} no aceptó el cambio. Tu clase sigue igual:`,
      rows: [{ label: accepted ? "Nueva clase" : "Tu clase", value: s.fromWhen, mono: true }],
      note: accepted
        ? undefined
        : "Podés moverla a un horario libre desde la clase, hasta 24 h antes.",
      cta: appUrl()
        ? { label: "Ver la clase", url: `${appUrl()}/turno/${s.fromBookingId}` }
        : undefined,
    });
    await fanOutToUser(admin, s.fromUser, {
      subject: accepted ? "Intercambio aceptado · VULL" : "Intercambio rechazado · VULL",
      html,
      push: {
        title: accepted ? "Intercambio aceptado ✓" : "Intercambio rechazado",
        body: s.fromWhen,
        url: `${appUrl()}/turno/${s.fromBookingId}`,
      },
    });
  } catch (_) {
    /* best-effort */
  }
}

/** A client uploaded a transfer receipt for a cuota. */
export async function notifyAdminsMembershipToVerify(
  admin: SupabaseClient,
  paymentId: string,
): Promise<void> {
  try {
    const { data } = await admin
      .from("payments")
      .select("amount_ars, user_id, membership_periods!payments_membership_period_id_fkey(period, memberships(services(name)))")
      .eq("id", paymentId)
      .single();
    if (!data) return;
    // deno-lint-ignore no-explicit-any
    const p = data as any;
    const who = await firstName(admin, p.user_id);
    const plan = p.membership_periods?.memberships?.services?.name ?? "Abono";
    const mes = p.membership_periods?.period ? monthName(p.membership_periods.period) : "";
    const lead = `${who} subió un comprobante para la cuota de ${mes} de "${plan}".`;
    const html = shell({
      heading: "Cuota por verificar",
      lead,
      rows: [
        { label: "Plan", value: plan },
        { label: "Importe", value: money(p.amount_ars), mono: true },
      ],
      cta: appUrl() ? { label: "Abrir panel", url: `${appUrl()}/admin` } : undefined,
    });
    await fanOutToAdmins(admin, "Cuota por verificar · VULL", html, {
      title: "Cuota por verificar",
      body: lead,
    });
  } catch (_) {
    /* best-effort */
  }
}

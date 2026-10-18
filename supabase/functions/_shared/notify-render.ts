// What every notice SAYS: one renderer per (kind, audience) of the
// notifications outbox (ADR 0013). A renderer loads what it needs from the row's
// subject and returns the message, or null when there is nothing to say any
// more (the subject is gone). It never sends: ./notify.ts does.
//
// The copy is the one the old send*/notifyAdmins* builders of email.ts and
// membership-email.ts used; new notices follow the same shell and tone.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { money, type Msg, type Row, type Section, shell } from "./email.ts";
import { loadMembership, scheduleRows } from "./membership.ts";
import { SESSION_BRIEFING } from "./session-briefing.ts";

export type NotificationRow = {
  id: string;
  kind: string;
  subject_id: string | null;
  audience: "admins" | "user";
  user_id: string | null;
  actor: "client" | "admin" | "system";
  // deno-lint-ignore no-explicit-any
  payload: Record<string, any>;
  attempts: number;
};

/** A user message may ask for the email safety net (critical) or skip the
 *  email preference (forceEmail). */
export type Rendered = Msg & { critical?: boolean; forceEmail?: boolean };
type Renderer = (admin: SupabaseClient, row: NotificationRow) => Promise<Rendered | null>;

const GREEN = "#61b33b";
const RED = "#e5484d";
const TZ_DEFAULT = "America/Argentina/Buenos_Aires";

const appUrl = () => Deno.env.get("APP_URL") ?? "";
const panel = () => (appUrl() ? { label: "Abrir panel", url: `${appUrl()}/admin` } : undefined);

// ─── small helpers ──────────────────────────────────────────────────────────
async function profileName(admin: SupabaseClient, userId: string | null): Promise<string> {
  if (!userId) return "";
  const { data } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return (data?.full_name ?? "").trim();
}
/** For greeting the client: "Hola Ana" / "Hola". */
async function firstName(admin: SupabaseClient, userId: string | null): Promise<string> {
  return (await profileName(admin, userId)).split(" ")[0] || "Hola";
}
/** For telling the admins who: "Ana Pérez" / "Un cliente". */
async function who(admin: SupabaseClient, userId: string | null): Promise<string> {
  return (await profileName(admin, userId)) || "Un cliente";
}

function longWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
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

const sessions = (n: number) => `${n} ${n === 1 ? "sesión" : "sesiones"}`;

// ─── booking context ────────────────────────────────────────────────────────
type BookingCtx = {
  userId: string;
  firstName: string;
  clientName: string;
  svc: string;
  price: number;
  when: string;
  tz: string;
  ref: string;
  bookingId: string;
  /** sectors.slug; gates sector-specific copy (the recovery briefing). */
  sectorSlug: string | null;
};

async function loadBookingCtx(admin: SupabaseClient, bookingId: string | null): Promise<BookingCtx | null> {
  if (!bookingId) return null;
  const { data: b } = await admin
    .from("bookings")
    .select("id, user_id, starts_at, services(name, price_ars), sectors(slug, timezone)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!b) return null;
  // deno-lint-ignore no-explicit-any
  const r = b as any;
  const full = await profileName(admin, r.user_id);
  const tz = r.sectors?.timezone ?? TZ_DEFAULT;
  return {
    userId: r.user_id,
    firstName: full.split(" ")[0] || "Hola",
    clientName: full || "Un cliente",
    svc: r.services?.name ?? "Sesión",
    price: r.services?.price_ars ?? 0,
    when: longWhen(r.starts_at, tz),
    tz,
    ref: r.id.slice(0, 8).toUpperCase(),
    bookingId: r.id,
    sectorSlug: r.sectors?.slug ?? null,
  };
}

const turnoUrl = (c: BookingCtx) => `${appUrl()}/turno/${c.bookingId}`;

/** SESSION_BRIEFING as two email sections: what to bring, then health caveats. */
function briefingSections(): Section[] {
  const b = SESSION_BRIEFING;
  return [
    { title: b.title, lead: b.intro, items: b.bring, tone: "ok", footer: b.facilities },
    {
      title: "Condiciones de salud",
      lead: `${b.healthIntro} ${b.healthLead}`,
      items: b.contraindications,
      tone: "warn",
      footer: b.healthNote,
    },
  ];
}

// ─── bookings: client ───────────────────────────────────────────────────────

/** Acknowledgement when a booking is first created (slot held, payment pending).
 *  Email only: it is a "we're holding your slot" ack, not an alert. */
const bookingReceived: Renderer = async (admin, row) => {
  const c = await loadBookingCtx(admin, row.subject_id);
  if (!c) return null;
  return {
    subject: `Reserva tomada · VULL (${c.ref})`,
    html: shell({
      heading: "Reserva tomada",
      lead: `Hola ${c.firstName}, te guardamos el horario. Falta el pago para confirmar el turno.`,
      rows: [
        { label: "Servicio", value: c.svc },
        { label: "Fecha y hora", value: c.when },
        { label: "Importe", value: money(c.price), mono: true },
        { label: "Reserva", value: c.ref, mono: true },
      ],
      note: "Si no completás el pago, el horario se libera y queda disponible para otra persona.",
      cta: appUrl() ? { label: "Pagar y confirmar", url: turnoUrl(c) } : undefined,
    }),
  };
};

/** The turno is confirmed: paid (Talo, receipt, at the desk) or one pack credit. */
const bookingConfirmedUser: Renderer = async (admin, row) => {
  const c = await loadBookingCtx(admin, row.subject_id);
  if (!c) return null;
  const credit = row.payload.funded === "credit";
  const left = Number(row.payload.remaining ?? 0);
  return {
    subject: `Turno confirmado · VULL (${c.ref})`,
    html: shell({
      heading: "Turno confirmado ✓",
      accent: GREEN,
      lead: credit
        ? `Hola ${c.firstName}, usaste 1 sesión de tu pack.`
        : `Hola ${c.firstName}, tu pago fue acreditado.`,
      rows: [
        { label: "Servicio", value: c.svc },
        { label: "Fecha y hora", value: c.when },
        credit
          ? { label: "Te quedan", value: sessions(left), mono: true }
          : { label: "Pagado", value: money(c.price), mono: true },
        { label: "Comprobante", value: c.ref, mono: true },
      ],
      // The pre-session briefing describes the recovery circuit; other sectors
      // don't get it.
      sections: c.sectorSlug === SESSION_BRIEFING.sectorSlug ? briefingSections() : [],
      note: "Escribinos por WhatsApp con tu nombre para coordinar los últimos detalles. Si no, mostrá este email al llegar.",
      cta: appUrl() ? { label: "Ver mi turno", url: turnoUrl(c) } : undefined,
    }),
    push: { title: "Turno confirmado ✓", body: `${c.svc} · ${c.when}`, url: turnoUrl(c) },
  };
};

/** Cancelled by the client or by the centre. The centre's cancel is critical:
 *  it goes out even when the client's channels can't deliver (email fallback). */
const bookingCancelledUser: Renderer = async (admin, row) => {
  const c = await loadBookingCtx(admin, row.subject_id);
  if (!c) return null;
  const byAdmin = Boolean(row.payload.by_admin);
  const credit = row.payload.credit as string | undefined;
  const lead = byAdmin
    ? `Hola ${c.firstName}, cancelamos tu turno. Si tenés dudas, escribinos por WhatsApp.`
    : `Hola ${c.firstName}, tu turno quedó cancelado.`;
  const note = credit === "membership"
    ? byAdmin
      ? "Es una clase de tu abono. Si querés recuperarla, escribinos por WhatsApp."
      : "Es una clase de tu abono: no se devuelve ni se acredita. La próxima vez podés moverla a otro horario libre hasta 24 h antes."
    : credit === "credited"
    ? "Te devolvimos la sesión como crédito: la próxima vez que reserves este servicio la podés usar sin pagar de nuevo."
    : credit === "late"
    ? "Como cancelaste fuera del plazo de aviso, la sesión no se devuelve. Si tuviste un imprevisto, escribinos por WhatsApp."
    : "Si fue un error o querés otro horario, podés reservar de nuevo cuando quieras.";
  return {
    subject: `Turno cancelado · VULL (${c.ref})`,
    html: shell({
      heading: "Turno cancelado",
      accent: RED,
      lead,
      rows: [
        { label: "Servicio", value: c.svc },
        { label: "Fecha y hora", value: c.when },
        { label: "Reserva", value: c.ref, mono: true },
      ],
      note,
      cta: appUrl() ? { label: "Reservar de nuevo", url: appUrl() } : undefined,
    }),
    push: { title: "Turno cancelado", body: `${c.svc} · ${c.when}`, url: turnoUrl(c) },
    critical: byAdmin,
  };
};

/** The centre moved the turno. Critical, like the centre's cancel. */
const bookingRescheduledUser: Renderer = async (admin, row) => {
  const c = await loadBookingCtx(admin, row.subject_id);
  if (!c) return null;
  const prev = row.payload.previous_starts_at as string | undefined;
  const now = (row.payload.starts_at as string | undefined) ?? null;
  const when = now ? longWhen(now, c.tz) : c.when;
  return {
    subject: `Turno reprogramado · VULL (${c.ref})`,
    html: shell({
      heading: "Turno reprogramado",
      lead: `Hola ${c.firstName}, cambiamos el horario de tu turno.`,
      rows: [
        { label: "Servicio", value: c.svc },
        ...(prev ? [{ label: "Antes", value: longWhen(prev, c.tz) }] : []),
        { label: "Ahora", value: when },
        { label: "Reserva", value: c.ref, mono: true },
      ],
      note: "Si el nuevo horario no te sirve, escribinos por WhatsApp.",
      cta: appUrl() ? { label: "Ver mi turno", url: turnoUrl(c) } : undefined,
    }),
    push: { title: "Turno reprogramado", body: `${c.svc} · ${when}`, url: turnoUrl(c) },
    critical: true,
  };
};

// ─── bookings: admins ───────────────────────────────────────────────────────

/** A client paid and booked (one notice for both), or spent a pack credit. */
const bookingConfirmedAdmins: Renderer = async (admin, row) => {
  const c = await loadBookingCtx(admin, row.subject_id);
  if (!c) return null;
  const credit = row.payload.funded === "credit";
  const left = Number(row.payload.remaining ?? 0);
  const lead = credit
    ? `${c.clientName} usó 1 sesión de su pack (quedan ${left}).`
    : `${c.clientName} reservó y pagó ${c.svc}.`;
  const heading = credit ? "Turno con sesión de pack ✓" : "Nuevo turno pagado ✓";
  return {
    subject: `Nuevo turno · VULL (${c.ref})`,
    html: shell({
      heading,
      accent: GREEN,
      lead,
      rows: [
        { label: "Servicio", value: c.svc },
        { label: "Fecha y hora", value: c.when },
        credit
          ? { label: "Quedan", value: sessions(left), mono: true }
          : { label: "Importe", value: money(c.price), mono: true },
        { label: "Reserva", value: c.ref, mono: true },
      ],
      cta: panel(),
    }),
    push: { title: heading, body: `${lead} ${c.when}` },
  };
};

const bookingCancelledAdmins: Renderer = async (admin, row) => {
  const c = await loadBookingCtx(admin, row.subject_id);
  if (!c) return null;
  const lead = `${c.clientName} canceló su turno de ${c.svc}.`;
  return {
    subject: `Cancelación · VULL (${c.ref})`,
    html: shell({
      heading: "Turno cancelado por el cliente",
      accent: RED,
      lead,
      rows: [
        { label: "Servicio", value: c.svc },
        { label: "Fecha y hora", value: c.when },
        { label: "Reserva", value: c.ref, mono: true },
      ],
      note: row.payload.credit === "credited"
        ? "Canceló con aviso: la sesión volvió como crédito."
        : undefined,
      cta: panel(),
    }),
    push: { title: "Turno cancelado por el cliente", body: `${lead} ${c.when}` },
  };
};

/** Admins only see a reschedule they didn't make, which today never happens
 *  (only admin-booking reschedules); kept so the kind is complete. */
const bookingRescheduledAdmins: Renderer = async (admin, row) => {
  const c = await loadBookingCtx(admin, row.subject_id);
  if (!c) return null;
  const lead = `${c.clientName} cambió el horario de ${c.svc}.`;
  return {
    subject: `Turno reprogramado · VULL (${c.ref})`,
    html: shell({ heading: "Turno reprogramado", lead, rows: [{ label: "Ahora", value: c.when }], cta: panel() }),
    push: { title: "Turno reprogramado", body: `${lead} ${c.when}` },
  };
};

// ─── payments ───────────────────────────────────────────────────────────────
type PaymentCtx = {
  kind: "booking" | "pack" | "membership";
  userId: string | null;
  amount: number;
  bookingId: string | null;
  serviceId: string | null;
  packName: string;
  packSessions: number;
  plan: string;
  period: string | null;
};

async function loadPayment(admin: SupabaseClient, paymentId: string | null): Promise<PaymentCtx | null> {
  if (!paymentId) return null;
  const { data } = await admin
    .from("payments")
    .select(
      "kind, user_id, amount_ars, booking_id, service_id, services(name, sessions_included), bookings(user_id), membership_periods!payments_membership_period_id_fkey(period, memberships(services(name)))",
    )
    .eq("id", paymentId)
    .maybeSingle();
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const p = data as any;
  return {
    kind: p.kind ?? "booking",
    userId: p.user_id ?? p.bookings?.user_id ?? null,
    amount: p.amount_ars ?? 0,
    bookingId: p.booking_id ?? null,
    serviceId: p.service_id ?? null,
    packName: p.services?.name ?? "Pack",
    packSessions: p.services?.sessions_included ?? 0,
    plan: p.membership_periods?.memberships?.services?.name ?? "Abono",
    period: p.membership_periods?.period ?? null,
  };
}

/** A client uploaded a transfer receipt (turno, pack or cuota). */
const paymentToVerify: Renderer = async (admin, row) => {
  const p = await loadPayment(admin, row.subject_id);
  if (!p) return null;
  if (p.kind === "booking") {
    const c = await loadBookingCtx(admin, p.bookingId);
    if (!c) return null;
    const lead = `${c.clientName} subió un comprobante de transferencia para ${c.svc}.`;
    return {
      subject: `Pago por verificar · VULL (${c.ref})`,
      html: shell({
        heading: "Pago por verificar",
        lead,
        rows: [
          { label: "Servicio", value: c.svc },
          { label: "Fecha y hora", value: c.when },
          { label: "Importe", value: money(p.amount), mono: true },
          { label: "Reserva", value: c.ref, mono: true },
        ],
        cta: panel(),
      }),
      push: { title: "Pago por verificar", body: lead },
    };
  }
  const name = await who(admin, p.userId);
  if (p.kind === "pack") {
    const lead = `${name} subió un comprobante para "${p.packName}".`;
    return {
      subject: "Pack por verificar · VULL",
      html: shell({
        heading: "Pack por verificar",
        lead,
        rows: [
          { label: "Pack", value: p.packName },
          { label: "Importe", value: money(p.amount), mono: true },
        ],
        cta: panel(),
      }),
      push: { title: "Pack por verificar", body: lead },
    };
  }
  const mes = p.period ? monthName(p.period) : "";
  const lead = `${name} subió un comprobante para la cuota de ${mes} de "${p.plan}".`;
  return {
    subject: "Cuota por verificar · VULL",
    html: shell({
      heading: "Cuota por verificar",
      lead,
      rows: [
        { label: "Plan", value: p.plan },
        { label: "Importe", value: money(p.amount), mono: true },
      ],
      cta: panel(),
    }),
    push: { title: "Cuota por verificar", body: lead },
  };
};

/** An admin rejected the client's receipt (it used to be silent). */
const paymentRejected: Renderer = async (admin, row) => {
  const p = await loadPayment(admin, row.subject_id);
  if (!p || !p.userId) return null;
  const name = await firstName(admin, p.userId);
  let what = "";
  let url = appUrl();
  if (p.kind === "booking") {
    const c = await loadBookingCtx(admin, p.bookingId);
    what = c ? `tu turno de ${c.svc} (${c.when})` : "tu turno";
    if (c) url = turnoUrl(c);
  } else if (p.kind === "pack") {
    what = `el pack ${p.packName}`;
    if (p.serviceId) url = `${appUrl()}/comprar/${p.serviceId}`;
  } else {
    what = `la cuota de ${p.period ? monthName(p.period) : "tu abono"} de ${p.plan}`;
    url = `${appUrl()}/cuenta/plan`;
  }
  return {
    subject: "Comprobante rechazado · VULL",
    html: shell({
      heading: "Comprobante rechazado",
      accent: RED,
      lead: `Hola ${name}, no pudimos verificar el comprobante que subiste para ${what}.`,
      rows: [{ label: "Importe", value: money(p.amount), mono: true }],
      note: "Podés volver a pagar desde la app. Si creés que es un error, escribinos por WhatsApp con el comprobante.",
      cta: appUrl() ? { label: "Volver a pagar", url } : undefined,
    }),
    push: { title: "Comprobante rechazado", body: `No pudimos verificar el pago de ${what}.`, url },
  };
};

// ─── packs ──────────────────────────────────────────────────────────────────

/** The pack's credits are granted (Talo settled it, or a receipt was approved). */
const packPurchasedUser: Renderer = async (admin, row) => {
  const p = await loadPayment(admin, row.subject_id);
  if (!p || !p.userId) return null;
  const name = await firstName(admin, p.userId);
  return {
    subject: "Sesiones acreditadas · VULL",
    html: shell({
      heading: "Sesiones acreditadas ✓",
      accent: GREEN,
      lead: `Hola ${name}, tu pago fue acreditado. Ya podés reservar tus sesiones.`,
      rows: [
        { label: "Pack", value: p.packName },
        { label: "Sesiones", value: sessions(p.packSessions) },
        { label: "Pagado", value: money(p.amount), mono: true },
      ],
      note: "Reservás cada turno con un crédito, cuando quieras.",
      cta: appUrl() ? { label: "Reservar una sesión", url: `${appUrl()}/mis-turnos` } : undefined,
    }),
    push: {
      title: "Sesiones acreditadas ✓",
      body: `${sessions(p.packSessions)} de ${p.packName}`,
      url: `${appUrl()}/mis-turnos`,
    },
  };
};

const packPurchasedAdmins: Renderer = async (admin, row) => {
  const p = await loadPayment(admin, row.subject_id);
  if (!p) return null;
  const lead = `${await who(admin, p.userId)} compró ${p.packName} (${sessions(p.packSessions)}).`;
  return {
    subject: "Pack vendido · VULL",
    html: shell({
      heading: "Pack vendido ✓",
      accent: GREEN,
      lead,
      rows: [
        { label: "Pack", value: p.packName },
        { label: "Importe", value: money(p.amount), mono: true },
      ],
      cta: panel(),
    }),
    push: { title: "Pack vendido ✓", body: lead },
  };
};

// ─── abonos ─────────────────────────────────────────────────────────────────
type PeriodCtx = { membershipId: string; period: string; paid: number | null };

async function loadPeriod(admin: SupabaseClient, periodId: string | null): Promise<PeriodCtx | null> {
  if (!periodId) return null;
  const { data } = await admin
    .from("membership_periods")
    .select("membership_id, period, payments!membership_periods_payment_id_fkey(amount_ars)")
    .eq("id", periodId)
    .maybeSingle();
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const p = data as any;
  return { membershipId: p.membership_id, period: p.period, paid: p.payments?.amount_ars ?? null };
}

function nextDueNote(
  m: { locked: boolean; endsOn: string | null; sector: { due_day: number; late_fee_pct: number } },
  paidPeriod: string,
): string {
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
const membershipPaidUser: Renderer = async (admin, row) => {
  const per = await loadPeriod(admin, row.subject_id);
  if (!per) return null;
  const m = await loadMembership(admin, per.membershipId);
  if (!m) return null;
  const name = await firstName(admin, m.userId);
  const rows: Row[] = [
    ...scheduleRows(m.slots),
    { label: "Plan", value: `${m.plan} · ${m.classesPerWeek} por semana` },
    { label: "Mes", value: monthName(per.period) },
    ...(per.paid ? [{ label: "Pagado", value: money(per.paid), mono: true }] : []),
  ];
  return {
    subject: `Abono confirmado · ${monthName(per.period)} · VULL`,
    html: shell({
      heading: "Tu lugar está reservado ✓",
      accent: GREEN,
      lead: `Hola ${name}, la cuota de ${monthName(per.period)} está acreditada. Estas son tus clases de cada semana:`,
      rows,
      note: nextDueNote(m, per.period),
      cta: appUrl() ? { label: "Ver mi plan", url: `${appUrl()}/cuenta/plan` } : undefined,
    }),
    push: {
      title: "Abono confirmado ✓",
      body: `${m.plan} · ${monthName(per.period)}`,
      url: `${appUrl()}/cuenta/plan`,
    },
  };
};

/** A client paid a cuota without an admin in the loop (Talo). The first one is
 *  the signup itself. */
const membershipPaidAdmins: Renderer = async (admin, row) => {
  const per = await loadPeriod(admin, row.subject_id);
  if (!per) return null;
  const m = await loadMembership(admin, per.membershipId);
  if (!m) return null;
  const name = await who(admin, m.userId);
  const mes = monthName(per.period);
  const first = Boolean(row.payload.first);
  const heading = first ? "Nuevo abono ✓" : "Cuota pagada ✓";
  const lead = first
    ? `${name} se anotó en ${m.plan} y pagó la cuota de ${mes}.`
    : `${name} pagó la cuota de ${mes} de ${m.plan}.`;
  return {
    subject: `${first ? "Nuevo abono" : "Cuota pagada"} · VULL`,
    html: shell({
      heading,
      accent: GREEN,
      lead,
      rows: [
        ...scheduleRows(m.slots),
        ...(per.paid ? [{ label: "Pagado", value: money(per.paid), mono: true }] : []),
      ],
      cta: panel(),
    }),
    push: { title: heading, body: lead },
  };
};

/** An admin booked a schedule for the client (maybe before they have an
 *  account). It is the only way they learn they have a place, so it ignores
 *  notify_email (forceEmail) like the direct send it replaced. */
const membershipCreatedByAdmin: Renderer = async (admin, row) => {
  const m = await loadMembership(admin, row.subject_id ?? "");
  if (!m) return null;
  const name = await firstName(admin, m.userId);
  const paid = Boolean(row.payload.paid);
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
  return {
    subject: `Tu lugar en ${m.sector.name.toLowerCase()} está reservado · VULL`,
    html: shell({
      heading: "Tu lugar está reservado",
      accent: GREEN,
      lead: `Hola ${name}, te reservamos tu horario de ${m.plan} en VULL. Entrá con este mismo email para ver tus clases${
        paid ? "" : " y pagar la cuota"
      }.`,
      rows,
      note: row.payload.new_account
        ? "No hace falta contraseña: al entrar te mandamos un código a este email."
        : "Ya lo vas a ver en Mi plan, dentro de tu cuenta.",
      cta: appUrl()
        ? { label: "Entrar con mi email", url: `${appUrl()}/login?next=${encodeURIComponent("/cuenta/plan")}` }
        : undefined,
    }),
    forceEmail: true,
  };
};

/** An admin freed the slots (unpaid cuota, "Liberar lugar"). */
const membershipCancelledUser: Renderer = async (admin, row) => {
  const m = await loadMembership(admin, row.subject_id ?? "");
  if (!m) return null;
  const name = await firstName(admin, m.userId);
  return {
    subject: "Liberamos tu lugar · VULL",
    html: shell({
      heading: "Liberamos tu lugar",
      accent: RED,
      lead: `Hola ${name}, la cuota de tu abono de ${m.plan} no se pagó a tiempo y tu horario quedó libre para otras personas.`,
      rows: [
        ...scheduleRows(m.slots),
        ...(m.endsOn ? [{ label: "Última clase incluida", value: longDate(m.endsOn) }] : []),
      ],
      note: "Si querés volver, podés elegir horarios de nuevo desde la app o escribirnos por WhatsApp.",
      cta: appUrl() ? { label: "Ver planes", url: `${appUrl()}/planes` } : undefined,
    }),
    push: { title: "Liberamos tu lugar", body: `${m.plan}: la cuota no se pagó a tiempo`, url: `${appUrl()}/cuenta/plan` },
  };
};

/** A client stopped renewing: their beds free up after the last paid month. */
const membershipCancelledAdmins: Renderer = async (admin, row) => {
  const m = await loadMembership(admin, row.subject_id ?? "");
  if (!m) return null;
  const endsOn = (row.payload.ends_on as string | undefined) ?? m.endsOn;
  const lead = `${await who(admin, m.userId)} no renueva su abono de ${m.plan}.${
    endsOn ? ` Su abono termina el ${longDate(endsOn)}; después su lugar queda libre.` : ""
  }`;
  return {
    subject: "Abono sin renovación · VULL",
    html: shell({ heading: "Abono sin renovación", lead, rows: scheduleRows(m.slots), cta: panel() }),
    push: { title: "Abono sin renovación", body: lead },
  };
};

// ─── moves and swaps ────────────────────────────────────────────────────────
type SwapCtx = {
  fromUser: string;
  toUser: string;
  fromWhen: string;
  toWhen: string;
  fromBookingId: string;
};

async function loadSwap(admin: SupabaseClient, requestId: string | null): Promise<SwapCtx | null> {
  if (!requestId) return null;
  const { data } = await admin
    .from("swap_requests")
    .select(
      "id, from_user_id, to_user_id, from_booking_id, to_booking_id, from:bookings!swap_requests_from_booking_id_fkey(starts_at, resources(name), sectors(timezone)), to:bookings!swap_requests_to_booking_id_fkey(starts_at, resources(name))",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const r = data as any;
  const tz = r.from?.sectors?.timezone ?? TZ_DEFAULT;
  return {
    fromUser: r.from_user_id,
    toUser: r.to_user_id,
    fromBookingId: r.from_booking_id,
    fromWhen: `${classWhen(r.from.starts_at, tz)} · ${r.from.resources?.name ?? ""}`,
    toWhen: `${classWhen(r.to.starts_at, tz)} · ${r.to.resources?.name ?? ""}`,
  };
}

/** To the receiver of an offer: `from` is the proposer's class, `to` theirs. */
const swapProposed: Renderer = async (admin, row) => {
  const s = await loadSwap(admin, row.subject_id);
  if (!s) return null;
  const [proposer, name] = await Promise.all([firstName(admin, s.fromUser), firstName(admin, s.toUser)]);
  return {
    subject: `${proposer} quiere cambiar una clase con vos · VULL`,
    html: shell({
      heading: "Propuesta de intercambio",
      lead: `Hola ${name}, ${proposer} te propone cambiar su clase por la tuya. Si aceptás, las dos se intercambian al instante.`,
      rows: [
        { label: "Tu clase", value: s.toWhen, mono: true },
        { label: "Pasaría a", value: s.fromWhen, mono: true },
      ],
      note: "Podés responder hasta 24 h antes de cualquiera de las dos clases.",
      cta: appUrl() ? { label: "Responder", url: `${appUrl()}/cuenta/plan#intercambios` } : undefined,
    }),
    push: {
      title: "Propuesta de intercambio",
      body: `${proposer} quiere cambiar su clase del ${s.fromWhen} por la tuya`,
      url: `${appUrl()}/cuenta/plan#intercambios`,
    },
  };
};

/** To the proposer, once the receiver answered. After an accept the two
 *  bookings already swapped times, so the proposer's row holds the new class. */
const swapResolved: Renderer = async (admin, row) => {
  const s = await loadSwap(admin, row.subject_id);
  if (!s) return null;
  const [receiver, name] = await Promise.all([firstName(admin, s.toUser), firstName(admin, s.fromUser)]);
  const accepted = row.payload.outcome === "accepted";
  const url = `${appUrl()}/turno/${s.fromBookingId}`;
  return {
    subject: accepted ? "Intercambio aceptado · VULL" : "Intercambio rechazado · VULL",
    html: shell({
      heading: accepted ? "Intercambio aceptado ✓" : "Intercambio rechazado",
      accent: accepted ? GREEN : undefined,
      lead: accepted
        ? `Hola ${name}, ${receiver} aceptó el cambio. Tu clase ahora es:`
        : `Hola ${name}, ${receiver} no aceptó el cambio. Tu clase sigue igual:`,
      rows: [{ label: accepted ? "Nueva clase" : "Tu clase", value: s.fromWhen, mono: true }],
      note: accepted ? undefined : "Podés moverla a un horario libre desde la clase, hasta 24 h antes.",
      cta: appUrl() ? { label: "Ver la clase", url } : undefined,
    }),
    push: {
      title: accepted ? "Intercambio aceptado ✓" : "Intercambio rechazado",
      body: s.fromWhen,
      url,
    },
  };
};

/** Low-key: a member moved a class, or two members swapped theirs. */
const classMoved: Renderer = async (admin, row) => {
  let lead: string;
  let rows: Row[];
  if (row.payload.swap) {
    const s = await loadSwap(admin, row.subject_id);
    if (!s) return null;
    const [a, b] = await Promise.all([who(admin, s.fromUser), who(admin, s.toUser)]);
    lead = `${a} y ${b} intercambiaron sus clases.`;
    rows = [
      { label: a, value: s.fromWhen, mono: true },
      { label: b, value: s.toWhen, mono: true },
    ];
  } else {
    const c = await loadBookingCtx(admin, row.subject_id);
    if (!c) return null;
    const prev = row.payload.previous_starts_at as string | undefined;
    lead = `${c.clientName} movió su clase de ${c.svc}.`;
    rows = [
      ...(prev ? [{ label: "Antes", value: classWhen(prev, c.tz), mono: true }] : []),
      { label: "Ahora", value: classWhen(row.payload.starts_at ?? new Date().toISOString(), c.tz), mono: true },
    ];
  }
  return {
    subject: "Clase movida · VULL",
    html: shell({ heading: "Clase movida", lead, rows, cta: panel() }),
    push: { title: "Clase movida", body: lead },
  };
};

// ─── free text ──────────────────────────────────────────────────────────────
/** Anomalies a human must look at (Talo, calendar, abono roll). */
const adminAlert: Renderer = (_admin, row) => {
  const heading = String(row.payload.heading ?? "Aviso");
  const body = String(row.payload.body ?? "");
  return Promise.resolve({
    subject: `${heading} · VULL`,
    html: shell({ heading, lead: body, cta: panel() }),
    push: { title: heading, body },
  });
};

// ─── the table ──────────────────────────────────────────────────────────────
export const RENDERERS: Record<string, Partial<Record<"admins" | "user", Renderer>>> = {
  booking_received: { user: bookingReceived },
  booking_confirmed: { user: bookingConfirmedUser, admins: bookingConfirmedAdmins },
  booking_cancelled: { user: bookingCancelledUser, admins: bookingCancelledAdmins },
  booking_rescheduled: { user: bookingRescheduledUser, admins: bookingRescheduledAdmins },
  payment_to_verify: { admins: paymentToVerify },
  payment_rejected: { user: paymentRejected },
  pack_purchased: { user: packPurchasedUser, admins: packPurchasedAdmins },
  membership_paid: { user: membershipPaidUser, admins: membershipPaidAdmins },
  membership_created_by_admin: { user: membershipCreatedByAdmin },
  membership_cancelled: { user: membershipCancelledUser, admins: membershipCancelledAdmins },
  class_moved: { admins: classMoved },
  swap_proposed: { user: swapProposed },
  swap_resolved: { user: swapResolved },
  admin_alert: { admins: adminAlert },
};

/** The renderer for a row, or undefined for a (kind, audience) nobody emits. */
export function rendererFor(kind: string, audience: string): Renderer | undefined {
  const byAudience = RENDERERS[kind];
  return byAudience?.[audience as "admins" | "user"];
}

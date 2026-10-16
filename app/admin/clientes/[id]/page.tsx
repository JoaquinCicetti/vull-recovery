import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { formatARS } from "@/lib/site";
import { BookingList } from "../../admin-bookings";
import { BOOKINGS_SELECT, mapBooking } from "../../bookings-select";
import { AdminRoleToggle } from "@/components/admin/admin-role-toggle";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { ClientContactForm } from "@/components/admin/client-contact-form";
import { CreditAdjustForm } from "@/components/admin/credit-adjust-form";
import { LoadErrors } from "@/components/admin/load-errors";
import { SectionTitle, Stat } from "@/components/admin/stat";
import { PageShell } from "@/components/ui/page-shell";
import { MembershipActions } from "@/components/admin/membership-actions";
import { MembershipScheduleChips } from "@/components/membership/schedule-chips";
import {
  dateLabel,
  MEMBERSHIP_STATUS_LABEL,
  MEMBERSHIP_STATUS_STYLE,
  capFirst,
  monthLabel,
  periodStatusLabel,
} from "@/lib/membership";
import { UserAvatar } from "@/components/ui/user-avatar";

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOKINGS_SHOWN = 15;

// credit_ledger.reason, in the owner's words.
const REASON_LABEL: Record<string, string> = {
  purchase: "Compra de pack",
  booking_consume: "Usó una sesión en un turno",
  booking_refund: "Turno cancelado: sesión devuelta",
  cancel_credit: "Turno pago cancelado: sesión a favor",
  admin_adjust: "Ajuste manual",
  revoke: "Revocado",
};
const PAYMENT_STATUS: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
};
const PROVIDER: Record<string, string> = {
  manual: "Transferencia",
  talo: "Talo",
  mobbex: "Mobbex",
  cash: "Efectivo",
};

function waHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

export default async function ClientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user: me } = await requireAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const nowISO = new Date().toISOString();
  const supabase = await createClient();

  // All admin-readable through RLS (is_admin()); independent, so one round trip.
  const [
    profileRes,
    creditsRes,
    ledgerRes,
    bookingsRes,
    servicesRes,
    packPayRes,
    bookingPayRes,
    membershipsRes,
  ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, whatsapp_phone, is_admin, created_at")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("user_credits")
        .select("service_id, remaining, expires_at, services(name)")
        .eq("user_id", id),
      supabase
        .from("credit_ledger")
        .select("id, delta, reason, note, created_at, services(name)")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("bookings")
        .select(BOOKINGS_SELECT, { count: "exact" })
        .eq("user_id", id)
        .order("starts_at", { ascending: false })
        .limit(BOOKINGS_SHOWN),
      supabase
        .from("services")
        .select("id, name")
        .order("sort_order", { ascending: true }),
      // A pack payment carries the buyer; a booking payment only reaches the
      // client through its booking — hence two reads.
      supabase
        .from("payments")
        .select(
          "id, kind, amount_ars, status, provider, reversed_at, created_at, services(name), membership_periods!payments_membership_period_id_fkey(period, memberships(services(name)))",
        )
        .in("kind", ["pack", "membership"])
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(15),
      supabase
        .from("payments")
        .select(
          "id, amount_ars, status, provider, reversed_at, created_at, bookings!inner(user_id, starts_at, services(name))",
        )
        .eq("bookings.user_id", id)
        .order("created_at", { ascending: false })
        .limit(15),
      supabase
        .from("memberships")
        .select(
          "id, status, locked, starts_on, ends_on, roll_error, services(name), membership_slots(weekday, start_time, resources(name))",
        )
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const profile = profileRes.data;
  if (!profile) notFound();

  const loadErrors: string[] = [];
  for (const [label, res] of [
    ["Saldo", creditsRes],
    ["Historial", ledgerRes],
    ["Turnos", bookingsRes],
    ["Planes", servicesRes],
    ["Pagos", packPayRes],
    ["Pagos de turnos", bookingPayRes],
    ["Abonos", membershipsRes],
  ] as const) {
    if (res.error) loadErrors.push(`${label}: ${res.error.message}`);
  }

  const now = new Date(nowISO).getTime();
  const credits = ((creditsRes.data ?? []) as any[]).map((c) => {
    const expired = c.expires_at != null && new Date(c.expires_at).getTime() <= now;
    return {
      serviceId: c.service_id as string,
      name: (c.services?.name as string) ?? "Plan",
      remaining: c.remaining as number,
      expiresAt: (c.expires_at as string) ?? null,
      expired,
    };
  });
  const liveBalance = credits.reduce((n, c) => n + (c.expired ? 0 : c.remaining), 0);

  const bookings = ((bookingsRes.data ?? []) as any[]).map(mapBooking);
  const bookingsTotal = bookingsRes.count ?? bookings.length;

  const payments = [
    ...((packPayRes.data ?? []) as any[]).map((p) => ({
      ...p,
      what:
        p.kind === "membership"
          ? `Cuota de ${p.membership_periods?.period ? monthLabel(p.membership_periods.period) : ""} · ${p.membership_periods?.memberships?.services?.name ?? "Abono"}`
          : `Pack · ${p.services?.name ?? ""}`.trim(),
    })),
    ...((bookingPayRes.data ?? []) as any[]).map((p) => ({
      ...p,
      what: p.bookings?.services?.name ?? "Turno",
    })),
  ]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 15);
  const paid = payments
    .filter((p) => p.status === "approved" && !p.reversed_at)
    .reduce((n, p) => n + (p.amount_ars as number), 0);

  const wa = waHref(profile.whatsapp_phone);

  const memberships = (membershipsRes.data ?? []) as any[];
  const { data: periodsData } = memberships.length
    ? await supabase
        .from("membership_periods_v")
        .select("id, membership_id, period, status, amount_due_ars, is_late, due_on")
        .in("membership_id", memberships.map((m) => m.id))
        .order("period", { ascending: false })
    : { data: [] };
  const periodsBy = new Map<string, any[]>();
  for (const p of (periodsData ?? []) as any[]) {
    periodsBy.set(p.membership_id, [...(periodsBy.get(p.membership_id) ?? []), p]);
  }

  return (
    <PageShell
      size="wide"
      nav={<AdminTabs />}
      eyebrow="Cliente"
      title={
        <span className="flex items-center gap-3">
          <UserAvatar seed={profile.id} size={44} />
          <span className="min-w-0 truncate">{profile.full_name || "Sin nombre"}</span>
        </span>
      }
      description={
        <>
          {profile.email ?? "Sin email"}
          {wa && (
            <>
              {" · "}
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-4 hover:underline"
              >
                {profile.whatsapp_phone}
              </a>
            </>
          )}
          {profile.is_admin && " · Administrador"}
        </>
      }
    >
      <Link
        href="/admin/clientes"
        className="text-sm text-fg-faint transition-colors hover:text-fg"
      >
        ← Todos los clientes
      </Link>

      <div className="mt-6">
        <LoadErrors errors={loadErrors} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Saldo" value={liveBalance} hint="sesiones a favor" />
        <Stat label="Turnos" value={bookingsTotal} hint="en total, todos los estados" />
        <Stat label="Pagado" value={formatARS(paid)} hint="en los últimos pagos" />
        <Stat label="Alta" value={<span className="text-lg">{fmtDate(profile.created_at)}</span>} />
      </div>

      <section className="mt-10">
        <SectionTitle>Saldo de sesiones</SectionTitle>
        {credits.length === 0 ? (
          <p className="mt-3 text-sm text-fg-faint">Sin sesiones a favor.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {credits.map((c) => (
              <li
                key={c.serviceId}
                className="surface-card flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <span className="text-sm text-fg">{c.name}</span>
                <span className="flex items-center gap-3 text-sm">
                  <span className="text-xs text-fg-faint">
                    {c.expired
                      ? `Venció el ${fmtDate(c.expiresAt!)}`
                      : c.expiresAt
                        ? `Vence el ${fmtDate(c.expiresAt)}`
                        : "Sin vencimiento"}
                  </span>
                  <span
                    className={`font-mono tabular-nums ${
                      c.expired || c.remaining === 0
                        ? "text-fg-faint line-through"
                        : "font-semibold text-accent"
                    }`}
                  >
                    {c.remaining}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="surface-card mt-4 p-5">
          <p className="mb-4 text-sm font-semibold text-fg">Ajustar saldo</p>
          <CreditAdjustForm
            userId={profile.id}
            services={(servicesRes.data ?? []) as { id: string; name: string }[]}
          />
        </div>
      </section>

      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-4">
          <SectionTitle>Abono</SectionTitle>
          {profile.email && (
            <Link
              href={`/admin/abonos?email=${encodeURIComponent(profile.email)}`}
              className="text-sm text-accent underline-offset-4 hover:underline"
            >
              Crear abono →
            </Link>
          )}
        </div>
        {memberships.length === 0 ? (
          <p className="mt-3 text-sm text-fg-faint">Sin abono.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {memberships.map((m) => {
              const periods = periodsBy.get(m.id) ?? [];
              const pending = [...periods].reverse().find((p) => p.status === "pending");
              const live = m.status === "pending" || m.status === "active";
              return (
                <li key={m.id} className={`surface-card p-4 ${live ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-fg">{m.services?.name ?? "Abono"}</p>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-xs ${MEMBERSHIP_STATUS_STYLE[m.status as keyof typeof MEMBERSHIP_STATUS_STYLE]}`}
                        >
                          {MEMBERSHIP_STATUS_LABEL[m.status as keyof typeof MEMBERSHIP_STATUS_LABEL]}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-fg-muted">
                        Desde {dateLabel(m.starts_on)}
                        {m.ends_on && ` · hasta ${dateLabel(m.ends_on)}`}
                      </p>
                      <MembershipScheduleChips
                        className="mt-2"
                        size="sm"
                        locked={m.locked}
                        slots={(m.membership_slots ?? []).map((s: any) => ({
                          weekday: s.weekday,
                          start_time: s.start_time,
                          resource_name: s.resources?.name,
                        }))}
                      />
                      {m.roll_error && live && (
                        <p className="mt-2 text-xs text-danger">
                          No se pudo renovar: otro turno ocupa una de sus camas el mes que viene.
                        </p>
                      )}
                    </div>
                    <MembershipActions
                      membershipId={m.id}
                      pendingPeriodId={pending?.id ?? null}
                      locked={m.locked}
                      active={live}
                    />
                  </div>
                  {periods.length > 0 && (
                    <ul className="mt-3 divide-y divide-border border-t border-border">
                      {periods.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                          <span className="text-fg-muted">{capFirst(monthLabel(p.period))}</span>
                          <span className="flex items-center gap-3">
                            <span className="font-mono tabular-nums text-fg">
                              {formatARS(p.amount_due_ars)}
                            </span>
                            <span
                              className={`text-xs ${p.status === "paid" ? "text-accent" : p.is_late ? "text-amber-300" : "text-fg-faint"}`}
                            >
                              {periodStatusLabel(p)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <SectionTitle>Movimientos de saldo</SectionTitle>
        {(ledgerRes.data ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-fg-faint">Sin movimientos.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {((ledgerRes.data ?? []) as any[]).map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-fg">
                    {REASON_LABEL[l.reason] ?? l.reason}
                    <span className="text-fg-faint"> · {l.services?.name ?? "Plan"}</span>
                  </p>
                  {l.note && <p className="mt-0.5 text-xs text-fg-muted">“{l.note}”</p>}
                  <p className="mt-0.5 font-mono text-xs text-fg-faint">
                    {fmtDateTime(l.created_at)}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-mono text-sm tabular-nums ${
                    l.delta > 0 ? "text-accent" : "text-fg-muted"
                  }`}
                >
                  {l.delta > 0 ? `+${l.delta}` : l.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-4">
          <SectionTitle>Turnos</SectionTitle>
          {bookingsTotal > bookings.length && (
            <Link
              href={`/admin/turnos?vista=todos&cliente=${profile.id}`}
              className="text-sm text-accent underline-offset-4 hover:underline"
            >
              Ver los {bookingsTotal} →
            </Link>
          )}
        </div>
        <BookingList rows={bookings} nowISO={nowISO} empty="Todavía no reservó turnos." />
      </section>

      <section className="mt-12">
        <SectionTitle>Últimos pagos</SectionTitle>
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-fg-faint">Sin pagos registrados.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {payments.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-fg">{p.what}</p>
                  <p className="mt-0.5 font-mono text-xs text-fg-faint">
                    {fmtDateTime(p.created_at)} · {PROVIDER[p.provider] ?? p.provider}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm tabular-nums text-fg">
                    {formatARS(p.amount_ars)}
                  </p>
                  <p
                    className={`text-xs ${
                      p.reversed_at
                        ? "text-danger"
                        : p.status === "approved"
                          ? "text-accent"
                          : "text-fg-faint"
                    }`}
                  >
                    {p.reversed_at ? "Devuelto" : (PAYMENT_STATUS[p.status] ?? p.status)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <SectionTitle>Datos de contacto</SectionTitle>
        <div className="surface-card mt-3 p-5">
          <ClientContactForm
            userId={profile.id}
            fullName={profile.full_name}
            phone={profile.whatsapp_phone}
          />
        </div>
      </section>

      <section className="mt-12">
        <SectionTitle>Permisos</SectionTitle>
        <div className="surface-card mt-3 p-5">
          <AdminRoleToggle
            userId={profile.id}
            isAdmin={profile.is_admin}
            isSelf={profile.id === me?.id}
          />
        </div>
      </section>
    </PageShell>
  );
}

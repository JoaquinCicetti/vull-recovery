import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/format";
import { formatARS } from "@/lib/site";
import {
  dateLabel,
  MEMBERSHIP_STATUS_LABEL,
  MEMBERSHIP_STATUS_STYLE,
  monthLabel,
  type MembershipStatus,
} from "@/lib/membership";
import type { Service } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { LoadErrors } from "@/components/admin/load-errors";
import { Pager } from "@/components/admin/pager";
import { FIELD, SectionTitle } from "@/components/admin/stat";
import { MembershipActions } from "@/components/admin/membership-actions";
import { MembershipScheduleChips } from "@/components/membership/schedule-chips";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { BedWeekGrid, type GridBooking } from "./bed-week-grid";
import { NewMembershipForm } from "./new-membership-form";

/* eslint-disable @typescript-eslint/no-explicit-any */

const PAGE = 25;
const ACTIVE = ["pending", "awaiting_payment", "confirmed"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATES = ["vigentes", "pending", "active", "cancelled", "expired"] as const;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const mondayOf = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
};

// Abonos (monthly plans): who holds which bed this week, sell one at the desk,
// and every membership with its next cuota.
export default async function AbonosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const loadErrors: string[] = [];

  await supabase.rpc("admin_membership_cycle");

  const [{ data: sectorsData }, { data: plansData }] = await Promise.all([
    supabase.from("sectors").select("id, slug, name, timezone").order("sort_order"),
    supabase.from("services").select("*").eq("billing", "monthly").order("sort_order"),
  ]);
  const plansAll = (plansData ?? []) as Service[];
  const sectors = ((sectorsData ?? []) as any[]).filter((s) =>
    plansAll.some((p) => p.sector_id === s.id),
  );
  const sector =
    sectors.find((s) => s.slug === one(sp.sector)) ?? sectors[0] ?? null;

  if (!sector) {
    return (
      <PageShell size="wide" nav={<AdminTabs />} eyebrow="Panel" title="Abonos">
        <p className="text-sm text-fg-muted">
          Todavía no hay planes mensuales. Creá uno en{" "}
          <Link href="/admin/servicios" className="text-accent hover:underline">
            Planes
          </Link>{" "}
          con cobro &quot;Mensual&quot;.
        </p>
      </PageShell>
    );
  }
  const tz = sector.timezone as string;
  const plans = plansAll.filter((p) => p.sector_id === sector.id && p.active);

  // eslint-disable-next-line react-hooks/purity -- server component: renders once
  const nowISO = new Date(Date.now()).toISOString();
  const today = localDate(nowISO, tz);
  const week = DATE_RE.test(one(sp.semana)) ? mondayOf(one(sp.semana)) : mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const weekStart = new Date(`${week}T00:00:00-03:00`).toISOString();
  const weekEnd = new Date(`${addDays(week, 7)}T00:00:00-03:00`).toISOString();

  const estado = (STATES as readonly string[]).includes(one(sp.estado)) ? one(sp.estado) : "vigentes";
  const planFilter = plans.some((p) => p.id === one(sp.plan)) ? one(sp.plan) : "";
  const fijo = one(sp.fijo) === "1";
  const q = one(sp.q).replace(/[,()%*\\"]/g, " ").trim().slice(0, 60);
  const page = Math.max(1, Number.parseInt(one(sp.pagina), 10) || 1);

  const [{ data: beds }, gridRes] = await Promise.all([
    supabase
      .from("resources")
      .select("id, name")
      .eq("sector_id", sector.id)
      .eq("active", true)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("bookings")
      .select("id, starts_at, resource_id, status, membership_id, memberships(locked), profiles!user_id(full_name)")
      .eq("sector_id", sector.id)
      .in("status", ACTIVE)
      .gte("starts_at", weekStart)
      .lt("starts_at", weekEnd)
      .order("starts_at"),
  ]);
  if (gridRes.error) loadErrors.push(`Semana: ${gridRes.error.message}`);
  const grid: GridBooking[] = ((gridRes.data ?? []) as any[]).map((b) => {
    const parts = String(b.profiles?.full_name ?? "Cliente").trim().split(/\s+/);
    return {
      id: b.id,
      startsAt: b.starts_at,
      resourceId: b.resource_id,
      status: b.status,
      client: parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0],
      membership: b.membership_id ? { locked: Boolean(b.memberships?.locked) } : null,
    };
  });

  let listQ = supabase
    .from("memberships")
    .select(
      `id, user_id, status, locked, starts_on, ends_on, roll_error, services(name), membership_slots(weekday, start_time, resources(name)), profiles!memberships_user_id_fkey${q ? "!inner" : ""}(full_name, email, whatsapp_phone)`,
      { count: "exact" },
    )
    .eq("sector_id", sector.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  listQ = estado === "vigentes" ? listQ.in("status", ["pending", "active"]) : listQ.eq("status", estado);
  if (planFilter) listQ = listQ.eq("service_id", planFilter);
  if (fijo) listQ = listQ.eq("locked", true);
  if (q) {
    listQ = listQ.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,whatsapp_phone.ilike.%${q}%`, {
      referencedTable: "profiles",
    });
  }
  const listRes = await listQ;
  if (listRes.error) loadErrors.push(`Abonos: ${listRes.error.message}`);
  const list = (listRes.data ?? []) as any[];

  const { data: duePeriods } = list.length
    ? await supabase
        .from("membership_periods_v")
        .select("id, membership_id, period, amount_due_ars, is_late, due_on")
        .in("membership_id", list.map((m) => m.id))
        .eq("status", "pending")
        .order("period")
    : { data: [] };
  const dueBy = new Map<string, any>();
  for (const p of (duePeriods ?? []) as any[]) if (!dueBy.has(p.membership_id)) dueBy.set(p.membership_id, p);

  const params = {
    sector: sector.slug,
    semana: one(sp.semana) || undefined,
    estado: estado === "vigentes" ? undefined : estado,
    plan: planFilter || undefined,
    fijo: fijo ? "1" : undefined,
    q: q || undefined,
  };
  const weekHref = (w: string) => {
    const qs = new URLSearchParams({ sector: sector.slug, semana: w });
    return `/admin/abonos?${qs}`;
  };
  const [ny, nm] = today.split("-").map(Number);
  const nextFirst = nm === 12 ? `${ny + 1}-01-01` : `${ny}-${String(nm + 1).padStart(2, "0")}-01`;

  return (
    <PageShell size="wide" nav={<AdminTabs />} eyebrow="Panel" title="Abonos">
      <LoadErrors errors={loadErrors} />

      {sectors.length > 1 && (
        <div className="mb-6 flex gap-2">
          {sectors.map((s) => (
            <Button key={s.id} asChild size="sm" variant={s.id === sector.id ? "default" : "outline"}>
              <Link href={`/admin/abonos?sector=${s.slug}`}>{s.name}</Link>
            </Button>
          ))}
        </div>
      )}

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <SectionTitle>
            Semana del {dateLabel(days[0])} al {dateLabel(days[6])}
          </SectionTitle>
          <div className="flex gap-1.5">
            <Button asChild size="sm" variant="outline">
              <Link href={weekHref(addDays(week, -7))} aria-label="Semana anterior">←</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={weekHref(mondayOf(today))}>Hoy</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={weekHref(addDays(week, 7))} aria-label="Semana siguiente">→</Link>
            </Button>
          </div>
        </div>
        <BedWeekGrid beds={(beds ?? []) as any[]} days={days} bookings={grid} today={today} tz={tz} />
        <p className="mt-2 text-xs text-fg-faint">
          Incluye turnos sueltos. El candado marca horarios fijos; en ámbar, cuotas sin pagar.
        </p>
      </section>

      <section className="mt-12 max-w-3xl">
        <SectionTitle>Nuevo abono</SectionTitle>
        <Card className="[--card-spacing:--spacing(5)]">
          <CardContent>
            <NewMembershipForm
              plans={plans}
              today={today}
              maxStart={nextFirst}
              initialEmail={one(sp.email)}
            />
          </CardContent>
        </Card>
      </section>

      <section className="mt-12">
        <SectionTitle>Abonos · {listRes.count ?? list.length}</SectionTitle>
        <form className="mb-4 flex flex-wrap items-end gap-2" action="/admin/abonos">
          <input type="hidden" name="sector" value={sector.slug} />
          <select name="estado" defaultValue={estado} className={FIELD} aria-label="Estado">
            <option value="vigentes">Vigentes</option>
            <option value="pending">Pendientes de pago</option>
            <option value="active">Activos</option>
            <option value="cancelled">Dados de baja</option>
            <option value="expired">Finalizados</option>
          </select>
          <select name="plan" defaultValue={planFilter} className={FIELD} aria-label="Plan">
            <option value="">Todos los planes</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" name="fijo" value="1" defaultChecked={fijo} />
            Solo horario fijo
          </label>
          <input
            name="q"
            defaultValue={q}
            placeholder="Nombre, email o teléfono"
            className={cn(FIELD, "min-w-48")}
          />
          <Button size="sm" type="submit">
            Filtrar
          </Button>
        </form>

        {list.length === 0 ? (
          <p className="text-sm text-fg-faint">No hay abonos con esos filtros.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((m) => {
              const due = dueBy.get(m.id);
              const status = m.status as MembershipStatus;
              const live = status === "pending" || status === "active";
              return (
                <li key={m.id} className="surface-card flex flex-wrap items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/clientes/${m.user_id}`}
                        className="font-semibold text-fg underline-offset-4 hover:underline"
                      >
                        {m.profiles?.full_name ?? m.profiles?.email ?? "Cliente"}
                      </Link>
                      <span className={cn("rounded-md px-1.5 py-0.5 text-xs", MEMBERSHIP_STATUS_STYLE[status])}>
                        {MEMBERSHIP_STATUS_LABEL[status]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-fg-muted">
                      {m.services?.name ?? "Abono"} · desde {dateLabel(m.starts_on)}
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
                    {due && (
                      <p className={cn("mt-2 text-xs", due.is_late ? "text-amber-300" : "text-fg-faint")}>
                        Cuota de {monthLabel(due.period, false)}: {formatARS(due.amount_due_ars)} ·{" "}
                        {due.is_late ? "vencida" : `vence el ${dateLabel(due.due_on)}`}
                      </p>
                    )}
                    {m.roll_error && live && (
                      <p className="mt-1 text-xs text-danger">
                        No se pudo renovar: otro turno ocupa una de sus camas el mes que viene.
                      </p>
                    )}
                  </div>
                  <MembershipActions
                    membershipId={m.id}
                    pendingPeriodId={due?.id ?? null}
                    locked={m.locked}
                    active={live}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <Pager
          basePath="/admin/abonos"
          params={params}
          page={page}
          pageSize={PAGE}
          total={listRes.count ?? 0}
        />
      </section>
    </PageShell>
  );
}

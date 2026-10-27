import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MEMBERSHIP_ACTIVE } from "@/lib/booking-status";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, localDate, STATUS_LABEL } from "@/lib/format";
import { clientWaLink, formatARS } from "@/lib/site";
import {
  dateLabel,
  MEMBERSHIP_STATUS_LABEL,
  MEMBERSHIP_STATUS_STYLE,
  monthLabel,
  type MembershipStatus,
} from "@/lib/membership";
import type { BookingStatus, Service } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BookingList } from "../admin-bookings";
import { BOOKINGS_SELECT, BOOKINGS_SELECT_BY_CLIENT, mapBooking } from "../bookings-select";
import { LoadErrors } from "@/components/admin/load-errors";
import { Pager } from "@/components/admin/pager";
import { FIELD } from "@/components/admin/stat";
import { Segmented } from "@/components/admin/segmented";
import { FilterDialog, FilterField, type ActiveFilter } from "@/components/admin/filter-dialog";
import { MembershipActions } from "@/components/admin/membership-actions";
import { MembershipScheduleChips } from "@/components/membership/schedule-chips";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { BlockSlotDialog } from "@/components/admin/block-slot-dialog";
import { BedWeekGrid, type GridBooking } from "./bed-week-grid";
import { FlaggedPayments, loadFlaggedPayments } from "./flagged-payments";
import { NewMembershipDialog } from "./new-membership-dialog";

/* eslint-disable @typescript-eslint/no-explicit-any */

const PAGE = 25;
const ACTIVE = ["pending", "awaiting_payment", "confirmed"];
const VIEWS = { proximos: "Próximos", pasados: "Pasados", todos: "Todos" } as const;
type View = keyof typeof VIEWS;
const STATUSES = Object.keys(STATUS_LABEL) as BookingStatus[];
const ABONO_STATES = ["vigentes", "vencidas", "pending", "active", "cancelled", "expired"] as const;
const ABONO_STATE_LABEL: Record<(typeof ABONO_STATES)[number], string> = {
  vigentes: "Vigentes",
  vencidas: "Con cuota vencida",
  pending: "Pendientes de pago",
  active: "Activos",
  cancelled: "Dados de baja",
  expired: "Finalizados",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Sector = { id: string; slug: string; name: string; active: boolean; timezone: string };
type Params = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
// Start of a local calendar day as an instant. Argentina has no DST, so the
// salon's offset is a constant; revisit if settings.timezone ever changes.
const dayStart = (date: string) => new Date(`${date}T00:00:00-03:00`).toISOString();
const dayEnd = (date: string) =>
  new Date(new Date(`${date}T00:00:00-03:00`).getTime() + 86400000).toISOString();
const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const mondayOf = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
};
function href(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `/admin/agenda?${s}` : "/admin/agenda";
}

// The agenda, one sector at a time. Recovery is a list of turnos in time
// order; a sector with monthly plans (pilates) adds the week by bed and the
// abonos. Sectors never share a screen: the switch at the top is the first
// thing to read.
export default async function AgendaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const supabase = await createClient();
  const loadErrors: string[] = [];

  // Round trip 1, everything that does not depend on the chosen view: the
  // admin check (a profile read), the sectors/plans/beds, the lazy abono
  // maintenance (expire lapsed signups, roll recurring members into next
  // month — admin-gated in SQL, idempotent, so it can run before the check
  // resolves) and the Talo payments that need a look. The view's own query is
  // round trip 2. This page used to make up to nine in a row.
  const [
    ,
    sp,
    { data: sectorsData, error: sectorsErr },
    { data: servicesData },
    { data: bedsData },
    ,
    flagged,
  ] = await Promise.all([
    requireAdmin(),
    searchParams,
    supabase.from("sectors").select("id, slug, name, active, timezone").order("sort_order"),
    supabase.from("services").select("*").order("sort_order"),
    supabase.from("resources").select("id, sector_id").eq("active", true),
    supabase.rpc("admin_membership_cycle"),
    loadFlaggedPayments(supabase),
  ]);
  if (sectorsErr) loadErrors.push(`Sectores: ${sectorsErr.message}`);
  const sectors = (sectorsData ?? []) as Sector[];
  const services = (servicesData ?? []) as Service[];
  const monthlyPlans = services.filter((p) => p.billing === "monthly");
  // A link straight to the abonos (from a client's page) names no sector: it
  // means the one that sells them.
  const wantsAbonos = ["abonos", "semana"].includes(one(sp.ver));
  const sector =
    sectors.find((s) => s.slug === one(sp.sector)) ??
    (wantsAbonos ? sectors.find((s) => monthlyPlans.some((p) => p.sector_id === s.id)) : undefined) ??
    sectors[0] ??
    null;
  const sectorPlans = sector ? monthlyPlans.filter((p) => p.sector_id === sector.id) : [];
  const hasAbonos = sectorPlans.length > 0;
  // "Bloquear horario" needs any plan of the sector (it names the sector and
  // the calendar; the slot length is the grid's) — a per-session one first.
  const blockService = sector
    ? (services.find((p) => p.sector_id === sector.id && p.active && p.billing === "session") ??
      services.find((p) => p.sector_id === sector.id))
    : undefined;
  const multiBed = sector
    ? ((bedsData ?? []) as { sector_id: string }[]).filter((r) => r.sector_id === sector.id).length > 1
    : false;
  const blockButton =
    sector && blockService ? (
      <BlockSlotDialog serviceId={blockService.id} sectorName={sector.name} multiBed={multiBed} />
    ) : null;

  // eslint-disable-next-line react-hooks/purity -- server component: renders once
  const nowISO = new Date(Date.now()).toISOString();
  const tz = sector?.timezone ?? "America/Argentina/Buenos_Aires";
  const today = localDate(nowISO, tz);

  const ver: "semana" | "turnos" | "abonos" = hasAbonos
    ? one(sp.ver) === "turnos"
      ? "turnos"
      : one(sp.ver) === "abonos"
        ? "abonos"
        : "semana"
    : "turnos";
  const base = { sector: sector?.slug, ver: hasAbonos ? ver : undefined };

  const sectorSwitch = (
    <Segmented
      prominent
      label="Sector"
      items={sectors.map((s) => ({
        href: href({ sector: s.slug }),
        label: s.active ? s.name : `${s.name} (oculto)`,
        active: s.id === sector?.id,
      }))}
    />
  );

  if (!sector) {
    return (
      <PageShell size="wide" top="tight" eyebrow="Panel" title="Agenda">
        <LoadErrors errors={loadErrors} />
        <p className="text-sm text-fg-muted">No hay sectores cargados.</p>
      </PageShell>
    );
  }

  let body: React.ReactNode;

  if (ver === "turnos") {
    const view: View = one(sp.vista) in VIEWS ? (one(sp.vista) as View) : "proximos";
    const status = STATUSES.includes(one(sp.estado) as BookingStatus)
      ? (one(sp.estado) as BookingStatus)
      : "";
    // PostgREST filter syntax: these characters would break out of the or() list.
    const q = one(sp.q).replace(/[,()%*\\"]/g, " ").trim().slice(0, 60);
    const from = DATE_RE.test(one(sp.desde)) ? one(sp.desde) : "";
    const to = DATE_RE.test(one(sp.hasta)) ? one(sp.hasta) : "";
    const clientId = UUID_RE.test(one(sp.cliente)) ? one(sp.cliente) : "";
    const page = Math.max(1, Number.parseInt(one(sp.pagina), 10) || 1);

    let query = supabase
      .from("bookings")
      .select(q ? BOOKINGS_SELECT_BY_CLIENT : BOOKINGS_SELECT, { count: "exact" })
      .eq("sector_id", sector.id);
    if (view === "proximos") query = query.gte("starts_at", nowISO);
    if (view === "pasados") query = query.lt("starts_at", nowISO);
    // "Próximos" is the live agenda: without an explicit status it hides the
    // cancelled / expired turnos that no longer hold a slot.
    if (status) query = query.eq("status", status);
    else if (view === "proximos") query = query.in("status", ACTIVE);
    if (from) query = query.gte("starts_at", dayStart(from));
    if (to) query = query.lt("starts_at", dayEnd(to));
    if (clientId) query = query.eq("user_id", clientId);
    if (q) {
      query = query.or(
        `full_name.ilike.%${q}%,email.ilike.%${q}%,whatsapp_phone.ilike.%${q}%`,
        { referencedTable: "profiles" },
      );
    }
    const { data, count, error } = await query
      .order("starts_at", { ascending: view !== "pasados" })
      .order("id", { ascending: true })
      .range((page - 1) * PAGE, page * PAGE - 1);
    if (error) loadErrors.push(`Turnos: ${error.message}`);
    const rows = ((data ?? []) as any[]).map(mapBooking);
    const total = count ?? rows.length;

    const filters = {
      estado: status || undefined,
      q: q || undefined,
      desde: from || undefined,
      hasta: to || undefined,
      cliente: clientId || undefined,
    };
    const params = { ...base, vista: view === "proximos" ? undefined : view, ...filters };
    const without = (key: keyof typeof filters) => href({ ...params, [key]: undefined });
    const active: ActiveFilter[] = [];
    if (status) active.push({ key: "estado", label: STATUS_LABEL[status], clearHref: without("estado") });
    if (from) active.push({ key: "desde", label: `Desde ${fmtDate(dayStart(from))}`, clearHref: without("desde") });
    if (to) active.push({ key: "hasta", label: `Hasta ${fmtDate(dayStart(to))}`, clearHref: without("hasta") });
    if (q) active.push({ key: "q", label: `“${q}”`, clearHref: without("q") });
    if (clientId) active.push({ key: "cliente", label: "Un cliente", clearHref: without("cliente") });

    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Vista"
            items={(Object.keys(VIEWS) as View[]).map((v) => ({
              href: href({ ...base, vista: v === "proximos" ? undefined : v, ...filters }),
              label: VIEWS[v],
              active: v === view,
            }))}
          />
          <div className="flex flex-wrap items-center gap-2">
          {blockButton}
          <FilterDialog
            basePath="/admin/agenda"
            keep={{ ...base, vista: params.vista }}
            active={active}
            clearHref={href({ ...base, vista: params.vista })}
            description={`Turnos de ${sector.name}.`}
          >
            <FilterField label="Estado" htmlFor="f-estado">
              <select id="f-estado" name="estado" defaultValue={status} className={FIELD}>
                <option value="">{view === "proximos" ? "Activos" : "Todos"}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </FilterField>
            <div className="grid grid-cols-2 gap-3">
              <FilterField label="Desde" htmlFor="f-desde">
                <input id="f-desde" type="date" name="desde" defaultValue={from} className={FIELD} />
              </FilterField>
              <FilterField label="Hasta" htmlFor="f-hasta">
                <input id="f-hasta" type="date" name="hasta" defaultValue={to} className={FIELD} />
              </FilterField>
            </div>
            <FilterField label="Cliente" htmlFor="f-q">
              <input
                id="f-q"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Nombre, email o teléfono"
                className={FIELD}
              />
            </FilterField>
            {clientId && <input type="hidden" name="cliente" value={clientId} />}
          </FilterDialog>
          </div>
        </div>

        <p className="mt-5 font-mono text-xs text-fg-faint">
          {total} {total === 1 ? "turno" : "turnos"}
          {clientId && " de este cliente"}
        </p>
        <div className="mt-2">
          <BookingList rows={rows} nowISO={nowISO} empty="No hay turnos con esos filtros." />
        </div>
        <Pager basePath="/admin/agenda" params={params} page={page} pageSize={PAGE} total={total} />
      </>
    );
  } else if (ver === "semana") {
    const week = DATE_RE.test(one(sp.semana)) ? mondayOf(one(sp.semana)) : mondayOf(today);
    const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
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
        .select(
          "id, starts_at, resource_id, status, membership_id, block_label, memberships(locked), profiles!user_id(full_name)",
        )
        .eq("sector_id", sector.id)
        .in("status", ACTIVE)
        .gte("starts_at", dayStart(week))
        .lt("starts_at", dayStart(addDays(week, 7)))
        .order("starts_at"),
    ]);
    if (gridRes.error) loadErrors.push(`Semana: ${gridRes.error.message}`);
    const grid: GridBooking[] = ((gridRes.data ?? []) as any[]).map((b) => {
      const parts = String(b.profiles?.full_name ?? b.block_label ?? "Cliente").trim().split(/\s+/);
      return {
        id: b.id,
        startsAt: b.starts_at,
        resourceId: b.resource_id,
        status: b.status,
        client: parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0],
        membership: b.membership_id ? { locked: Boolean(b.memberships?.locked) } : null,
        block: Boolean(b.block_label),
      };
    });
    const weekHref = (w: string) => href({ ...base, semana: w });
    const thisWeek = week === mondayOf(today);

    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold capitalize text-fg">
            {dateLabel(days[0])} – {dateLabel(days[6])}
            {thisWeek && <span className="font-normal text-fg-faint"> · esta semana</span>}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {blockButton}
            <Button asChild size="sm" variant="outline">
              <Link href={weekHref(addDays(week, -7))} aria-label="Semana anterior">
                <ChevronLeft aria-hidden />
              </Link>
            </Button>
            {!thisWeek && (
              <Button asChild size="sm" variant="outline">
                <Link href={weekHref(mondayOf(today))}>Hoy</Link>
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href={weekHref(addDays(week, 7))} aria-label="Semana siguiente">
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-4">
          <BedWeekGrid beds={(beds ?? []) as any[]} days={days} bookings={grid} today={today} tz={tz} />
        </div>
        <p className="mt-2 text-xs text-fg-faint">
          Incluye turnos sueltos y horarios bloqueados. El candado marca horarios fijos; en
          ámbar, cuotas sin pagar.
        </p>
      </>
    );
  } else {
    const estado = (ABONO_STATES as readonly string[]).includes(one(sp.abono))
      ? (one(sp.abono) as (typeof ABONO_STATES)[number])
      : "vigentes";
    const plans = sectorPlans.filter((p) => p.active);
    const planFilter = sectorPlans.some((p) => p.id === one(sp.plan)) ? one(sp.plan) : "";
    const fijo = one(sp.fijo) === "1";
    const q = one(sp.q).replace(/[,()%*\\"]/g, " ").trim().slice(0, 60);
    const page = Math.max(1, Number.parseInt(one(sp.pagina), 10) || 1);

    // "Con cuota vencida": live abonos with a pending cuota past its due day.
    // Read first (a view, not a joinable embed), then filtered by id.
    let overdueIds: string[] | null = null;
    if (estado === "vencidas") {
      const { data: od } = await supabase
        .from("membership_periods_v")
        .select("membership_id")
        .eq("status", "pending")
        .in("membership_status", MEMBERSHIP_ACTIVE)
        .lt("due_on", today);
      overdueIds = [...new Set(((od ?? []) as { membership_id: string }[]).map((p) => p.membership_id))];
    }
    let listQ = supabase
      .from("memberships")
      .select(
        `id, user_id, status, locked, starts_on, ends_on, roll_error, services(name), membership_slots(weekday, start_time, resources(name)), profiles!memberships_user_id_fkey${q ? "!inner" : ""}(full_name, email, whatsapp_phone)`,
        { count: "exact" },
      )
      .eq("sector_id", sector.id)
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE, page * PAGE - 1);
    listQ =
      estado === "vigentes" || estado === "vencidas"
        ? listQ.in("status", MEMBERSHIP_ACTIVE)
        : listQ.eq("status", estado);
    if (overdueIds) listQ = listQ.in("id", overdueIds.length ? overdueIds : ["00000000-0000-0000-0000-000000000000"]);
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
    const total = listRes.count ?? list.length;

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

    const filters = {
      abono: estado === "vigentes" ? undefined : estado,
      plan: planFilter || undefined,
      fijo: fijo ? "1" : undefined,
      q: q || undefined,
    };
    const params = { ...base, ...filters };
    const without = (key: keyof typeof filters) => href({ ...params, [key]: undefined });
    const active: ActiveFilter[] = [];
    if (filters.abono) active.push({ key: "abono", label: ABONO_STATE_LABEL[estado], clearHref: without("abono") });
    if (planFilter) {
      active.push({
        key: "plan",
        label: sectorPlans.find((p) => p.id === planFilter)?.name ?? "Plan",
        clearHref: without("plan"),
      });
    }
    if (fijo) active.push({ key: "fijo", label: "Horario fijo", clearHref: without("fijo") });
    if (q) active.push({ key: "q", label: `“${q}”`, clearHref: without("q") });

    const [ny, nm] = today.split("-").map(Number);
    const nextFirst = nm === 12 ? `${ny + 1}-01-01` : `${ny}-${String(nm + 1).padStart(2, "0")}-01`;

    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterDialog
            basePath="/admin/agenda"
            keep={base}
            active={active}
            clearHref={href(base)}
            description={`Abonos de ${sector.name}.`}
          >
            <FilterField label="Estado" htmlFor="f-abono">
              <select id="f-abono" name="abono" defaultValue={estado} className={FIELD}>
                {ABONO_STATES.map((s) => (
                  <option key={s} value={s === "vigentes" ? "" : s}>
                    {ABONO_STATE_LABEL[s]}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Plan" htmlFor="f-plan">
              <select id="f-plan" name="plan" defaultValue={planFilter} className={FIELD}>
                <option value="">Todos los planes</option>
                {sectorPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FilterField>
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                name="fijo"
                value="1"
                defaultChecked={fijo}
                className="size-4 accent-[var(--color-accent)]"
              />
              Solo horario fijo
            </label>
            <FilterField label="Cliente" htmlFor="f-aq">
              <input
                id="f-aq"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Nombre, email o teléfono"
                className={FIELD}
              />
            </FilterField>
          </FilterDialog>
          <NewMembershipDialog
            plans={plans}
            today={today}
            maxStart={nextFirst}
            initialEmail={one(sp.email)}
          />
        </div>

        <p className="mt-5 font-mono text-xs text-fg-faint">
          {total} {total === 1 ? "abono" : "abonos"}
        </p>
        {list.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-faint">
            No hay abonos con esos filtros.
          </p>
        ) : (
          <ul className="surface-card mt-2 divide-y divide-border">
            {list.map((m) => {
              const due = dueBy.get(m.id);
              const status = m.status as MembershipStatus;
              const live = status === "pending" || status === "active";
              return (
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/clientes/${m.user_id}`}
                        className="font-medium text-fg underline-offset-4 hover:underline"
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
                        {due.is_late && (() => {
                          const first = String(m.profiles?.full_name ?? "").split(" ")[0];
                          const wa = clientWaLink(
                            m.profiles?.whatsapp_phone,
                            `Hola ${first}! Te escribimos de VULL: la cuota de ${monthLabel(due.period, false)} de tu abono (${formatARS(due.amount_due_ars)}) está pendiente. La podés pagar desde la app, en Mi abono.`,
                          );
                          return wa ? (
                            <>
                              {" · "}
                              <a
                                href={wa}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent underline-offset-4 hover:underline"
                              >
                                Recordar por WhatsApp
                              </a>
                            </>
                          ) : null;
                        })()}
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
        <Pager basePath="/admin/agenda" params={params} page={page} pageSize={PAGE} total={total} />
      </>
    );
  }

  return (
    <PageShell size="wide" top="tight" eyebrow="Panel" title="Agenda">
      <LoadErrors errors={loadErrors} />
      <FlaggedPayments result={flagged} />
      {sectors.length > 1 && <div className="mb-6">{sectorSwitch}</div>}
      {hasAbonos && (
        <div className="mb-5">
          <Segmented
            label="Qué ver"
            items={[
              { href: href({ sector: sector.slug }), label: "Semana", active: ver === "semana" },
              { href: href({ sector: sector.slug, ver: "turnos" }), label: "Turnos", active: ver === "turnos" },
              { href: href({ sector: sector.slug, ver: "abonos" }), label: "Abonos", active: ver === "abonos" },
            ]}
          />
        </div>
      )}
      {body}
    </PageShell>
  );
}

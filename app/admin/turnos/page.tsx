import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABEL } from "@/lib/format";
import { BookingList } from "../admin-bookings";
import {
  BOOKINGS_SELECT,
  BOOKINGS_SELECT_BY_CLIENT,
  mapBooking,
} from "../bookings-select";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { LoadErrors } from "@/components/admin/load-errors";
import { Pager } from "@/components/admin/pager";
import { FIELD } from "@/components/admin/stat";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const PAGE = 25;
const ACTIVE = ["pending", "awaiting_payment", "confirmed"];
const VIEWS = { proximos: "Próximos", pasados: "Pasados", todos: "Todos" } as const;
type View = keyof typeof VIEWS;
const STATUSES = Object.keys(STATUS_LABEL) as BookingStatus[];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Start of a local calendar day as an instant. Argentina has no DST, so the
// salon's offset is a constant; revisit if settings.timezone ever changes.
function dayStart(date: string): string {
  return new Date(`${date}T00:00:00-03:00`).toISOString();
}
function dayEnd(date: string): string {
  return new Date(new Date(`${date}T00:00:00-03:00`).getTime() + 86400000).toISOString();
}

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function TurnosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

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

  const nowISO = new Date().toISOString();
  const supabase = await createClient();

  let query = supabase
    .from("bookings")
    .select(q ? BOOKINGS_SELECT_BY_CLIENT : BOOKINGS_SELECT, { count: "exact" });

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
    .order("starts_at", { ascending: view === "proximos" })
    .order("id", { ascending: true })
    .range((page - 1) * PAGE, page * PAGE - 1);

  const rows = ((data ?? []) as any[]).map(mapBooking);
  const total = count ?? rows.length;
  const filtered = Boolean(status || q || from || to || clientId);
  const params = {
    vista: view === "proximos" ? undefined : view,
    estado: status || undefined,
    q: q || undefined,
    desde: from || undefined,
    hasta: to || undefined,
    cliente: clientId || undefined,
  };

  return (
    <PageShell size="wide" nav={<AdminTabs />} eyebrow="Panel" title="Turnos">
      <LoadErrors errors={error ? [`Turnos: ${error.message}`] : []} />

      <form method="get" className="surface-card flex flex-wrap items-end gap-3 p-4">
        {clientId && <input type="hidden" name="cliente" value={clientId} />}
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Vista
          <select name="vista" defaultValue={view} className={FIELD}>
            {Object.entries(VIEWS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Estado
          <select name="estado" defaultValue={status} className={FIELD}>
            <option value="">{view === "proximos" ? "Activos" : "Todos"}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Desde
          <input type="date" name="desde" defaultValue={from} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Hasta
          <input type="date" name="hasta" defaultValue={to} className={FIELD} />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-xs text-fg-muted">
          Cliente
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Nombre, email o teléfono"
            className={FIELD}
          />
        </label>
        <Button type="submit">Filtrar</Button>
        {filtered && (
          <Button asChild variant="ghost">
            <Link href={view === "proximos" ? "/admin/turnos" : `/admin/turnos?vista=${view}`}>
              Limpiar
            </Link>
          </Button>
        )}
      </form>

      <p className="mt-6 font-mono text-xs text-fg-faint">
        {total} {total === 1 ? "turno" : "turnos"}
        {clientId && " de este cliente"}
      </p>

      <BookingList
        rows={rows}
        nowISO={nowISO}
        empty="No hay turnos con esos filtros."
      />
      <Pager
        basePath="/admin/turnos"
        params={params}
        page={page}
        pageSize={PAGE}
        total={total}
      />
    </PageShell>
  );
}

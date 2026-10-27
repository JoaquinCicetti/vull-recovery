import Link from "next/link";
import { Search } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";
import { LoadErrors } from "@/components/admin/load-errors";
import { Pager } from "@/components/admin/pager";
import { FIELD } from "@/components/admin/stat";
import { FilterDialog, FilterField, type ActiveFilter } from "@/components/admin/filter-dialog";
import { PageShell } from "@/components/ui/page-shell";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";

const PAGE = 25;
const SORTS = {
  recent: "Más nuevos",
  credits: "Mayor saldo",
  bookings: "Más turnos",
  name: "Nombre",
} as const;
type Sort = keyof typeof SORTS;

// Row shape of public.admin_user_list() (see the admin_backoffice migration).
type ClientRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  whatsapp_phone: string | null;
  is_admin: boolean;
  created_at: string;
  bookings_total: number;
  bookings_upcoming: number;
  last_booking_at: string | null;
  credits: number;
  total_count: number;
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
function href(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `/admin/clientes?${s}` : "/admin/clientes";
}

// Every client as one line: who, how to reach them, how many turnos and what
// they have to their favour. The search box is the main control; order and
// the balance filter live in the dialog.
export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 60);
  const onlyBalance = one(sp.saldo) === "1";
  const sort: Sort = one(sp.orden) in SORTS ? (one(sp.orden) as Sort) : "recent";
  const page = Math.max(1, Number.parseInt(one(sp.pagina), 10) || 1);

  const supabase = await createClient();
  // Admin check and the list in one round trip (the RPC is admin-gated itself).
  const [, { data, error }] = await Promise.all([
    requireAdmin(),
    supabase.rpc("admin_user_list", {
      p_search: q || null,
      p_only_balance: onlyBalance,
      p_sort: sort,
      p_limit: PAGE,
      p_offset: (page - 1) * PAGE,
    }),
  ]);
  const rows = (data ?? []) as ClientRow[];
  const total = rows[0]?.total_count ?? 0;

  const params = {
    q: q || undefined,
    saldo: onlyBalance ? "1" : undefined,
    orden: sort === "recent" ? undefined : sort,
  };
  const active: ActiveFilter[] = [];
  if (onlyBalance) active.push({ key: "saldo", label: "Con saldo", clearHref: href({ ...params, saldo: undefined }) });
  if (sort !== "recent") active.push({ key: "orden", label: SORTS[sort], clearHref: href({ ...params, orden: undefined }) });

  return (
    <PageShell size="wide" top="tight" eyebrow="Panel" title="Clientes">
      <LoadErrors errors={error ? [`Clientes: ${error.message}`] : []} />

      <div className="flex flex-wrap items-center gap-2">
        <form method="get" action="/admin/clientes" className="relative min-w-0 flex-1 basis-56">
          {onlyBalance && <input type="hidden" name="saldo" value="1" />}
          {sort !== "recent" && <input type="hidden" name="orden" value={sort} />}
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-faint"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Nombre, email o teléfono"
            aria-label="Buscar cliente"
            className={cn(FIELD, "w-full pl-9")}
          />
        </form>
        <FilterDialog
          basePath="/admin/clientes"
          keep={{ q: q || undefined }}
          active={active}
          clearHref={href({ q: q || undefined })}
        >
          <FilterField label="Orden" htmlFor="f-orden">
            <select id="f-orden" name="orden" defaultValue={sort} className={FIELD}>
              {Object.entries(SORTS).map(([k, label]) => (
                <option key={k} value={k === "recent" ? "" : k}>
                  {label}
                </option>
              ))}
            </select>
          </FilterField>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              name="saldo"
              value="1"
              defaultChecked={onlyBalance}
              className="size-4 accent-[var(--color-accent)]"
            />
            Solo con sesiones a favor
          </label>
        </FilterDialog>
      </div>

      <p className="mt-5 font-mono text-xs text-fg-faint">
        {total} {total === 1 ? "cliente" : "clientes"}
        {q && ` para “${q}”`}
      </p>

      {rows.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-faint">
          {error ? "—" : "No hay clientes con esos filtros."}
        </p>
      ) : (
        <ul className="surface-card mt-2 divide-y divide-border">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/clientes/${c.id}`}
                className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2/60 sm:gap-4 sm:px-4"
              >
                <UserAvatar seed={c.id} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium text-fg">
                    <span className="truncate">{c.full_name || "Sin nombre"}</span>
                    {c.is_admin && (
                      <span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-fg-muted">
                        Admin
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-fg-faint">
                    {[c.email, c.whatsapp_phone].filter(Boolean).join(" · ") || "Sin contacto"}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-faint sm:hidden">
                    {c.bookings_total} {c.bookings_total === 1 ? "turno" : "turnos"}
                    {c.bookings_upcoming > 0 && ` · ${c.bookings_upcoming} próximos`}
                    {c.credits > 0 && (
                      <span className="text-accent"> · {c.credits} a favor</span>
                    )}
                  </p>
                </div>
                <dl className="hidden shrink-0 gap-6 text-right sm:flex">
                  <div>
                    <dt className="text-[11px] text-fg-faint">Turnos</dt>
                    <dd className="font-mono text-sm tabular-nums text-fg">
                      {c.bookings_total}
                      {c.bookings_upcoming > 0 && (
                        <span className="text-fg-faint"> +{c.bookings_upcoming}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-fg-faint">A favor</dt>
                    <dd
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        c.credits > 0 ? "font-semibold text-accent" : "text-fg-faint",
                      )}
                    >
                      {c.credits}
                    </dd>
                  </div>
                  <div className="w-24">
                    <dt className="text-[11px] text-fg-faint">Último turno</dt>
                    <dd className="font-mono text-xs tabular-nums text-fg-muted">
                      {c.last_booking_at ? fmtDate(c.last_booking_at) : "—"}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pager basePath="/admin/clientes" params={params} page={page} pageSize={PAGE} total={total} />
    </PageShell>
  );
}

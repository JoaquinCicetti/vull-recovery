import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { LoadErrors } from "@/components/admin/load-errors";
import { Pager } from "@/components/admin/pager";
import { FIELD } from "@/components/admin/stat";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";

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

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 60);
  const onlyBalance = one(sp.saldo) === "1";
  const sort: Sort = one(sp.orden) in SORTS ? (one(sp.orden) as Sort) : "recent";
  const page = Math.max(1, Number.parseInt(one(sp.pagina), 10) || 1);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_user_list", {
    p_search: q || null,
    p_only_balance: onlyBalance,
    p_sort: sort,
    p_limit: PAGE,
    p_offset: (page - 1) * PAGE,
  });
  const rows = (data ?? []) as ClientRow[];
  const total = rows[0]?.total_count ?? 0;

  return (
    <PageShell size="wide" nav={<AdminTabs />} eyebrow="Panel" title="Clientes">
      <LoadErrors errors={error ? [`Clientes: ${error.message}`] : []} />

      <form method="get" className="surface-card flex flex-wrap items-end gap-3 p-4">
        <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-xs text-fg-muted">
          Buscar
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Nombre, email o teléfono"
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Orden
          <select name="orden" defaultValue={sort} className={FIELD}>
            {Object.entries(SORTS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-10 items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            name="saldo"
            value="1"
            defaultChecked={onlyBalance}
            className="size-4 accent-[var(--color-accent)]"
          />
          Solo con saldo
        </label>
        <Button type="submit">Filtrar</Button>
        {(q || onlyBalance) && (
          <Button asChild variant="ghost">
            <Link href="/admin/clientes">Limpiar</Link>
          </Button>
        )}
      </form>

      <p className="mt-6 font-mono text-xs text-fg-faint">
        {total} {total === 1 ? "cliente" : "clientes"}
        {onlyBalance && " con saldo"}
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-fg-faint">
          {error ? "—" : "No hay clientes con esos filtros."}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/clientes/${c.id}`}
                className="surface-card surface-lift flex flex-wrap items-center justify-between gap-4 p-5"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-fg">
                    {c.full_name || "Sin nombre"}
                    {c.is_admin && (
                      <span className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-fg-muted">
                        Admin
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-fg-faint">
                    {[c.email, c.whatsapp_phone].filter(Boolean).join(" · ") || "Sin contacto"}
                  </p>
                  <p className="mt-1 text-xs text-fg-faint">
                    Alta {fmtDate(c.created_at)}
                    {c.last_booking_at && ` · último turno ${fmtDate(c.last_booking_at)}`}
                  </p>
                </div>
                <dl className="flex shrink-0 gap-6 text-right">
                  <div>
                    <dt className="text-xs text-fg-faint">Turnos</dt>
                    <dd className="font-mono text-sm tabular-nums text-fg">
                      {c.bookings_total}
                      {c.bookings_upcoming > 0 && (
                        <span className="text-fg-faint"> +{c.bookings_upcoming}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-fg-faint">Saldo</dt>
                    <dd
                      className={`font-mono text-sm tabular-nums ${
                        c.credits > 0 ? "font-semibold text-accent" : "text-fg-faint"
                      }`}
                    >
                      {c.credits}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-fg-faint">
        Turnos: realizados (y +próximos). Saldo: sesiones a favor sin usar.
      </p>

      <Pager
        basePath="/admin/clientes"
        params={{
          q: q || undefined,
          saldo: onlyBalance ? "1" : undefined,
          orden: sort === "recent" ? undefined : sort,
        }}
        page={page}
        pageSize={PAGE}
        total={total}
      />
    </PageShell>
  );
}

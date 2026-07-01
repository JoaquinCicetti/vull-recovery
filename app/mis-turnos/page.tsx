import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyBalances } from "@/lib/credits";
import { fmtDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { PageShell } from "@/components/ui/page-shell";
import type { Booking } from "@/lib/types";

type Row = Booking & { services: { name: string } | null };

export default async function MisTurnosPage() {
  await requireUser("/mis-turnos");

  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("*, services(name)")
    .order("starts_at", { ascending: true });

  const bookings = (data ?? []) as Row[];

  // Credit balances (for packs) + the names of the services they apply to.
  const balances = await getMyBalances();
  const balEntries = Object.entries(balances);
  const creditNames: Record<string, string> = {};
  if (balEntries.length > 0) {
    const { data: svcs } = await supabase
      .from("services")
      .select("id, name")
      .in(
        "id",
        balEntries.map(([id]) => id),
      );
    for (const s of (svcs ?? []) as { id: string; name: string }[]) {
      creditNames[s.id] = s.name;
    }
  }

  return (
    <PageShell eyebrow="Tus reservas" title="Mis turnos">
      {balEntries.length > 0 && (
        <section className="mb-10">
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
            Mis créditos
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {balEntries.map(([sid, n]) => (
              <li
                key={sid}
                className="surface-card flex items-center justify-between gap-4 p-5"
              >
                <p className="font-semibold text-fg">
                  {creditNames[sid] ?? "Servicio"}
                </p>
                <span className="font-mono text-accent">
                  {n} {n === 1 ? "sesión" : "sesiones"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-fg-faint">
            Usás un crédito al reservar cada turno.
          </p>
        </section>
      )}
      {bookings.length === 0 ? (
        <div className="surface-card animate-fade-up border-dashed p-10 text-center text-fg-muted">
          Todavía no tenés turnos.{" "}
          <Link
            href="/"
            className="font-medium text-accent underline underline-offset-4"
          >
            Reservá uno
          </Link>
          .
        </div>
      ) : (
        <ul className="stagger-children flex flex-col gap-3">
          {bookings.map((b) => (
            <li key={b.id}>
              <Link
                href={`/turno/${b.id}`}
                className="surface-card surface-lift flex items-center justify-between gap-4 p-5 transition-colors duration-150 hover:border-border-strong"
              >
                <div>
                  <p className="font-semibold text-fg">
                    {b.services?.name ?? "Servicio"}
                  </p>
                  <p className="mt-0.5 text-sm capitalize text-fg-muted">
                    {fmtDateTime(b.starts_at)}
                  </p>
                </div>
                <StatusBadge status={b.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

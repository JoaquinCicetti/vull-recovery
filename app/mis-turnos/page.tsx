import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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

  return (
    <PageShell eyebrow="Tus reservas" title="Mis turnos">
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

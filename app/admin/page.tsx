import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { AdminPayments } from "./admin-payments";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AdminPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: rawPayments } = await supabase
    .from("payments")
    .select(
      "id, amount_ars, receipt_path, created_at, bookings(id, starts_at, services(name), profiles(full_name, whatsapp_phone))",
    )
    .eq("provider", "manual")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const payments = await Promise.all(
    ((rawPayments ?? []) as any[]).map(async (p) => {
      let receiptUrl: string | null = null;
      if (p.receipt_path) {
        const { data } = await supabase.storage
          .from("receipts")
          .createSignedUrl(p.receipt_path, 3600);
        receiptUrl = data?.signedUrl ?? null;
      }
      return {
        id: p.id as string,
        amount: p.amount_ars as number,
        receiptUrl,
        service: p.bookings?.services?.name ?? "Servicio",
        when: (p.bookings?.starts_at as string) ?? null,
        client: p.bookings?.profiles?.full_name ?? "—",
        phone: (p.bookings?.profiles?.whatsapp_phone as string) ?? null,
      };
    }),
  );

  const { data: rawUpcoming } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, status, services(name), profiles(full_name, whatsapp_phone)",
    )
    .gte("starts_at", new Date().toISOString())
    .in("status", ["pending", "awaiting_payment", "confirmed"])
    .order("starts_at", { ascending: true })
    .limit(50);

  const upcoming = (rawUpcoming ?? []) as any[];

  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Panel</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Administración</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/configuracion">Disponibilidad</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/servicios">Planes y precios</Link>
          </Button>
        </div>
      </div>

      <section className="mt-12">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
          Pagos por transferencia a verificar
        </h2>
        <AdminPayments payments={payments} />
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
          Próximos turnos
        </h2>
        {upcoming.length === 0 ? (
          <p className="mt-4 text-sm text-fg-faint">Sin turnos próximos.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {upcoming.map((b) => (
              <li
                key={b.id}
                className="surface-card flex items-center justify-between gap-4 p-5"
              >
                <div>
                  <p className="font-semibold text-fg">
                    {b.services?.name ?? "Servicio"}
                  </p>
                  <p className="mt-0.5 text-sm capitalize text-fg-muted">
                    {fmtDateTime(b.starts_at)}
                  </p>
                  <p className="mt-0.5 text-sm text-fg-faint">
                    {b.profiles?.full_name ?? "—"}
                    {b.profiles?.whatsapp_phone
                      ? ` · ${b.profiles.whatsapp_phone}`
                      : ""}
                  </p>
                </div>
                <StatusBadge status={b.status as BookingStatus} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

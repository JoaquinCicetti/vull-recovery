import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPayments } from "./admin-payments";
import { AdminBookings, type AdminBookingRow } from "./admin-bookings";
import { PageShell } from "@/components/ui/page-shell";
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

  // Upcoming + the last 7 days, every status (cancelled shown muted). Filtering
  // by status here is what made the list look empty.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rawBookings } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, status, services(name), profiles(full_name, whatsapp_phone, email)",
    )
    .gte("starts_at", since)
    .order("starts_at", { ascending: true })
    .limit(100);

  const bookings: AdminBookingRow[] = ((rawBookings ?? []) as any[]).map((b) => ({
    id: b.id as string,
    startsAt: b.starts_at as string,
    status: b.status as BookingStatus,
    service: b.services?.name ?? "Servicio",
    client: b.profiles?.full_name ?? "—",
    phone: (b.profiles?.whatsapp_phone as string) ?? null,
    email: (b.profiles?.email as string) ?? null,
  }));

  const nowISO = new Date().toISOString();
  const upcoming = bookings.filter((b) => b.startsAt >= nowISO);
  // Most-recent past first.
  const past = bookings.filter((b) => b.startsAt < nowISO).reverse();

  return (
    <PageShell
      size="wide"
      eyebrow="Panel"
      title="Administración"
      actions={
        <>
          <Button asChild variant="outline">
            <Link href="/admin/configuracion">Disponibilidad</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/servicios">Planes y precios</Link>
          </Button>
        </>
      }
    >
      <section>
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
          Pagos por transferencia a verificar
        </h2>
        <AdminPayments payments={payments} />
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
          Turnos
        </h2>
        <AdminBookings upcoming={upcoming} past={past} />
      </section>
    </PageShell>
  );
}

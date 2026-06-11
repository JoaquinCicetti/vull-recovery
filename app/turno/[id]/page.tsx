import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatARS, waLink } from "@/lib/site";
import { fmtDateTime } from "@/lib/format";
import { PaymentPanel } from "./payment-panel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { Booking } from "@/lib/types";

type BookingWithService = Booking & {
  services: { name: string; price_ars: number; duration_minutes: number } | null;
};

export default async function TurnoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile } = await requireUser(`/turno/${id}`);

  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("*, services(name, price_ars, duration_minutes)")
    .eq("id", id)
    .single();

  const booking = data as BookingWithService | null;
  if (!booking) notFound();

  const svcName = booking.services?.name ?? "Servicio";
  const price = booking.services?.price_ars ?? 0;
  const when = fmtDateTime(booking.starts_at);
  const ref = booking.id.slice(0, 8).toUpperCase();
  const firstName = (profile?.full_name ?? "").split(" ")[0];
  const greeting = firstName ? `Hola! Soy ${firstName}.` : "Hola!";
  const waMsg = `${greeting} Quiero coordinar mi turno de ${svcName} del ${when}. (Reserva ${ref})`;
  const isConfirmed = booking.status === "confirmed";
  const needsPayment =
    booking.status === "pending" || booking.status === "awaiting_payment";

  return (
    <div className="mx-auto max-w-xl px-5 py-16">
      <p className="eyebrow">Tu turno</p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{svcName}</h1>

      <div className="surface-card mt-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <p className="capitalize text-fg-muted">{when}</p>
          <StatusBadge status={booking.status} />
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm text-fg-muted">
          <span>Total</span>
          <span className="font-mono text-base font-semibold text-fg">
            {formatARS(price)}
          </span>
        </div>
      </div>

      {needsPayment && (
        <PaymentPanel
          bookingId={booking.id}
          amount={price}
          status={booking.status}
        />
      )}

      {isConfirmed ? (
        <div className="surface-card mt-6 p-6">
          <p className="font-semibold text-fg">Tu turno está confirmado ✓</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            Te enviamos el comprobante <span className="font-mono">{ref}</span> a
            tu email. Escribinos por WhatsApp con tu nombre así coordinamos los
            últimos detalles; si no, mostrá el comprobante del email al llegar.
          </p>
          <Button asChild size="lg" className="mt-4 w-full">
            <a href={waLink(waMsg)} target="_blank" rel="noopener noreferrer">
              Escribinos por WhatsApp
            </a>
          </Button>
        </div>
      ) : (
        <>
          <Button asChild variant="outline" size="lg" className="mt-6 w-full">
            <a href={waLink(waMsg)} target="_blank" rel="noopener noreferrer">
              ¿Dudas? Escribinos por WhatsApp
            </a>
          </Button>
          <p className="mt-2 text-center text-xs text-fg-faint">
            Al escribirnos primero, podemos responderte sin costo.
          </p>
        </>
      )}
    </div>
  );
}

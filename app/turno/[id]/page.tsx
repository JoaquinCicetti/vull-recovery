import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatARS, waLink } from "@/lib/site";
import { fmtDateTime, localDate } from "@/lib/format";
import Link from "next/link";
import { PaymentPanel } from "@/components/payment/payment-panel";
import { HoldCountdown } from "@/components/hold-countdown";
import { ClassActions } from "@/components/membership/class-actions";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { CancelBooking } from "@/components/cancel-booking";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";
import type { Booking } from "@/lib/types";
import { isActiveStatus } from "@/lib/booking-status";
import type { TaloTransfer } from "@/components/talo-transfer-panel";

type BookingWithService = Booking & {
  services: { name: string; price_ars: number; duration_minutes: number } | null;
  sectors: {
    slug: string;
    name: string;
    timezone: string;
    cancel_notice_hours: number;
    change_notice_hours: number;
  } | null;
  resources: { name: string } | null;
};

export default async function TurnoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const nowISO = new Date().toISOString();

  // This page is the landing after "Reservar", so its render time is part of how
  // long booking feels. The three reads are independent (RLS scopes the selects
  // by the cookie session, they don't need `user` first), so issue them together:
  // 4 sequential round trips → 1. requireUser still redirects when signed out.
  const supabase = await createClient();
  const [{ profile }, { data }, { data: taloRow }] = await Promise.all([
    requireUser(`/turno/${id}`),
    supabase
      .from("bookings")
      .select(
        "*, services(name, price_ars, duration_minutes), sectors(slug, name, timezone, cancel_notice_hours, change_notice_hours), resources(name)",
      )
      .eq("id", id)
      .single(),
    // A CVU already minted for this booking (Talo, still open). Lets a reload —
    // or the return trip from the bank app — show the same alias again instead of
    // minting a second one. Readable through payments_select_own via the booking.
    supabase
      .from("payments")
      .select("talo_cvu, talo_alias, talo_expires_at, amount_ars")
      .eq("booking_id", id)
      .eq("provider", "talo")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const booking = data as BookingWithService | null;
  if (!booking) notFound();

  // An abono class: its money is the month's cuota, and it can be moved or
  // swapped instead of paid/cancelled for a credit.
  const isClass = Boolean(booking.membership_id);
  const [{ data: unpaidPeriod }, { data: outgoing }, { data: sameSector }] = isClass
    ? await Promise.all([
        supabase
          .from("membership_periods")
          .select("id")
          .eq("membership_id", booking.membership_id!)
          .eq("status", "pending")
          .order("period")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("swap_requests")
          .select("id")
          .eq("from_booking_id", booking.id)
          .eq("status", "pending")
          .maybeSingle(),
        // The member's other classes: a move can't land on a day they already
        // have one (one class a day per sector).
        supabase
          .from("bookings")
          .select("starts_at")
          .eq("user_id", booking.user_id)
          .eq("sector_id", booking.sector_id)
          .in("status", ["pending", "awaiting_payment", "confirmed"])
          .neq("id", booking.id)
          .gte("starts_at", nowISO),
      ])
    : [{ data: null }, { data: null }, { data: null }];
  const tz = booking.sectors?.timezone ?? "America/Argentina/Buenos_Aires";
  const busyDays = ((sameSector ?? []) as { starts_at: string }[]).map((b) =>
    localDate(b.starts_at, tz),
  );
  const talo: TaloTransfer | null =
    taloRow && (taloRow.talo_cvu || taloRow.talo_alias)
      ? {
          cvu: (taloRow.talo_cvu as string) ?? null,
          alias: (taloRow.talo_alias as string) ?? null,
          amount: (taloRow.amount_ars as number) ?? 0,
          expiresAt: (taloRow.talo_expires_at as string) ?? null,
          paymentUrl: null,
        }
      : null;

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
  // The slot is held server-side until hold_expires_at; show the live countdown
  // only in the `pending` window. That window covers a Talo transfer too: the
  // booking stays `pending` (with the hold extended to the CVU's expiry) until
  // Talo sees money, so an abandoned CVU is swept like any lapsed hold. Once a
  // receipt is uploaded the status flips to awaiting_payment and the hold is
  // kept until verification.
  const showHold =
    booking.status === "pending" && Boolean(booking.hold_expires_at);
  // Read the clock once, outside the render expression: calling Date.now() inline
  // is an impure render (react-hooks/purity) and can disagree between renders.
  const nowMs = new Date(nowISO).getTime();
  const cancellable =
    new Date(booking.starts_at).getTime() > nowMs && isActiveStatus(booking.status);
  // Mirrors return_cancelled_booking: a confirmed (paid) turno comes back as a
  // credit only with the sector's notice (cancel_notice_hours). Unconfirmed
  // turnos have nothing to return.
  const noticeHours = booking.sectors?.cancel_notice_hours ?? 24;
  const lateCancel =
    new Date(booking.starts_at).getTime() - nowMs < noticeHours * 60 * 60_000;
  const changeNotice = booking.sectors?.change_notice_hours ?? 24;
  const changeable =
    isClass &&
    isConfirmed &&
    new Date(booking.starts_at).getTime() - nowMs >= changeNotice * 60 * 60_000;
  const place =
    booking.sectors && booking.sectors.slug !== "recovery"
      ? `${booking.sectors.name} · ${booking.resources?.name ?? ""}`
      : null;
  const cancelPrompt = isClass
    ? "¿Cancelar esta clase? Las clases del abono no se devuelven ni se acreditan. Si podés, movela a otro horario."
    : !isConfirmed
    ? undefined
    : lateCancel
    ? `Faltan menos de ${noticeHours} h: si cancelás, la sesión no se devuelve. ¿Cancelar igual?`
    : "¿Cancelar este turno? Te devolvemos la sesión como crédito para reservar otro día.";

  return (
    <PageShell eyebrow={isClass ? "Tu clase" : "Tu turno"} title={svcName}>
      <div className="surface-card surface-lift p-6">
        <div className="flex items-start justify-between gap-4">
          <p className="capitalize text-fg-muted">{when}</p>
          <StatusBadge status={booking.status} />
        </div>
        {(place || isClass) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {place && <span className="text-sm text-fg">{place}</span>}
            {isClass && (
              <Badge variant="outline" className="font-mono text-[11px] uppercase tracking-wider">
                Abono
              </Badge>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm text-fg-muted">
          {isClass ? (
            <>
              <span>Incluida en tu abono</span>
              <Link href="/cuenta/plan" className="text-accent underline-offset-4 hover:underline">
                Ver mi plan
              </Link>
            </>
          ) : (
            <>
              <span>Total</span>
              <span className="font-mono text-base font-semibold text-fg">
                {formatARS(price)}
              </span>
            </>
          )}
        </div>
      </div>

      {isClass && needsPayment && (
        <div className="surface-card mt-6 p-5">
          <p className="font-semibold text-fg">Falta pagar la cuota del mes</p>
          <p className="mt-1 text-sm text-fg-muted">
            Tus clases se confirman cuando la cuota está paga.
          </p>
          {unpaidPeriod && (
            <Button asChild className="mt-3">
              <Link href={`/cuenta/plan/pagar/${unpaidPeriod.id}`}>Pagar la cuota</Link>
            </Button>
          )}
        </div>
      )}

      {!isClass && showHold && (
        <HoldCountdown
          expiresAt={booking.hold_expires_at!}
          startedAt={booking.created_at}
          expiredHref={`/reservar/${booking.service_id}`}
        />
      )}

      {!isClass && needsPayment && (
        <PaymentPanel
          target={{ booking_id: booking.id }}
          receiptPrefix={booking.id}
          amount={price}
          awaiting={booking.status === "awaiting_payment"}
          talo={talo}
        />
      )}

      {isClass && isConfirmed && new Date(booking.starts_at).getTime() > nowMs && (
        <ClassActions
          bookingId={booking.id}
          serviceId={booking.service_id}
          startsAt={booking.starts_at}
          resourceId={booking.resource_id}
          timezone={tz}
          noticeHours={changeNotice}
          changeable={changeable}
          outgoingRequestId={(outgoing?.id as string | undefined) ?? null}
          busyDays={busyDays}
        />
      )}

      {isConfirmed && isClass ? null : isConfirmed ? (
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

      {cancellable && (
        <div className="mt-8 flex justify-center border-t border-border pt-6">
          <CancelBooking
            bookingId={booking.id}
            confirmPrompt={cancelPrompt}
            {...(isClass ? { label: "Cancelar esta clase", confirmLabel: "Cancelar igual" } : {})}
          />
        </div>
      )}
    </PageShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

// Live "we're holding your slot" countdown shown while a booking is still in the
// pre-payment `pending` window. The hold itself is enforced server-side
// (bookings.hold_expires_at + the DB no-overlap constraint); this is purely the
// realtime UI. Reads the server's hold_expires_at so it can't drift from the
// actual hold. Once the receipt is uploaded the booking moves to
// `awaiting_payment` and this stops showing (the slot is then held until an admin
// verifies the transfer).
function fmt(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function HoldCountdown({
  expiresAt,
  startedAt,
  serviceId,
}: {
  /** bookings.hold_expires_at (ISO) */
  expiresAt: string;
  /** bookings.created_at (ISO) — used to size the progress bar */
  startedAt: string;
  /** to offer a precise "pick another time" link once it lapses */
  serviceId: string;
}) {
  const router = useRouter();
  const end = new Date(expiresAt).getTime();
  const start = new Date(startedAt).getTime();
  const total = Math.max(1, end - start);

  // Start from the deterministic hold-start so the server and the first client
  // render agree (no hydration mismatch); the interval then drives real time.
  const [now, setNow] = useState<number>(start);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ticked = now !== start; // a real clock value has arrived
  const remaining = end - now;
  const expired = ticked && remaining <= 0;

  // When the hold lapses, refresh once so the server can reflect the expired
  // status (and the payment panel disappears).
  useEffect(() => {
    if (expired) router.refresh();
  }, [expired, router]);

  if (expired) {
    return (
      <div className="surface-card mt-6 border-danger/30 bg-danger/5 p-5">
        <p className="font-semibold text-fg">Se venció la reserva</p>
        <p className="mt-1 text-sm text-fg-muted">
          Liberamos el horario porque pasaron los minutos de la reserva. Podés
          elegir otro turno, sigue disponible si nadie lo tomó.
        </p>
        <Link
          href={`/reservar/${serviceId}`}
          className="mt-3 inline-block text-sm font-medium text-accent underline underline-offset-4"
        >
          Elegir un horario
        </Link>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  // Warn (amber) under two minutes left.
  const low = ticked && remaining <= 2 * 60 * 1000;

  return (
    <div className="surface-card mt-6 p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Clock className="size-4 shrink-0" />
          <span>Te guardamos el lugar</span>
        </div>
        <span
          className={cn(
            "font-mono text-lg font-semibold tabular-nums",
            low ? "text-danger" : "text-fg",
          )}
          aria-live="off"
        >
          {ticked ? fmt(remaining) : fmt(total)}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-1000 ease-linear",
            low ? "bg-danger" : "bg-accent",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2.5 text-xs text-fg-faint">
        Completá el pago antes de que termine el tiempo para asegurar el turno.
      </p>
    </div>
  );
}

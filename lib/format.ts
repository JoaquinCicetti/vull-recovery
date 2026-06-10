import type { BookingStatus } from "@/lib/types";

export const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

export function fmtDateTime(iso: string, tz: string = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function fmtTime(iso: string, tz: string = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// `dateStr` is a plain "YYYY-MM-DD" calendar date.
export function fmtDayLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Pendiente de pago",
  awaiting_payment: "Verificando pago",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  expired: "Expirado",
};

export const STATUS_STYLE: Record<BookingStatus, string> = {
  pending: "bg-amber-400/15 text-amber-300",
  awaiting_payment: "bg-sky-400/15 text-sky-300",
  confirmed: "bg-accent/15 text-accent",
  cancelled: "bg-surface-2 text-fg-faint",
  expired: "bg-surface-2 text-fg-faint",
};

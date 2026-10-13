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

// "YYYY-MM-DD" calendar date of an instant in the given timezone. Matches the
// salon-local day strings returned by `availability`.
export function localDate(iso: string, tz: string = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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
  no_show: "No asistió",
};

export const STATUS_STYLE: Record<BookingStatus, string> = {
  pending: "bg-amber-400/15 text-amber-300",
  awaiting_payment: "bg-sky-400/15 text-sky-300",
  confirmed: "bg-accent/15 text-accent",
  cancelled: "bg-surface-2 text-fg-faint",
  expired: "bg-surface-2 text-fg-faint",
  no_show: "bg-danger/10 text-danger",
};

// Short calendar date of an instant ("12 oct 2026"), for admin tables.
export function fmtDate(iso: string, tz: string = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

// The pieces of a turno's date, for the "date tile" (big day number, short
// month and weekday) used across the account area.
export function fmtDateParts(iso: string, tz: string = DEFAULT_TZ) {
  const d = new Date(iso);
  const part = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("es-AR", { timeZone: tz, ...opts })
      .format(d)
      .replace(".", "");
  return {
    day: part({ day: "numeric" }),
    month: part({ month: "short" }),
    weekday: part({ weekday: "long" }),
    time: fmtTime(iso, tz),
  };
}

// "hoy" / "mañana" / "en 5 días" / "hace 3 días", by LOCAL calendar day (so a
// turno at 9:00 tomorrow is "mañana" even when it is less than 24 h away).
export function fmtRelativeDay(iso: string, nowISO: string, tz: string = DEFAULT_TZ) {
  const day = (s: string) => Date.parse(`${localDate(s, tz)}T00:00:00Z`);
  const diff = Math.round((day(iso) - day(nowISO)) / 86400000);
  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  if (diff === -1) return "ayer";
  return diff > 0 ? `en ${diff} días` : `hace ${-diff} días`;
}

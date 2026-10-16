// Monthly plans ("abonos"): types and pure helpers shared by client and server
// components. The rules themselves live in the database
// (supabase/migrations/20261015150000_memberships.sql) and the edge functions;
// nothing here decides anything, it only formats.
//
//   membership  a client's abono of one plan: weekly pattern + whether it renews
//   slot        one weekday of the pattern: time and bed
//   period      one calendar month of it: amount, due date, paid or not
//
// Each class of a membership is an ordinary `bookings` row (bookings.membership_id).

export type MembershipStatus = "pending" | "active" | "cancelled" | "expired";
export type PeriodStatus = "pending" | "paid" | "void";

export type Membership = {
  id: string;
  user_id: string;
  service_id: string;
  sector_id: string;
  status: MembershipStatus;
  locked: boolean;
  starts_on: string; // YYYY-MM-DD
  ends_on: string | null;
  hold_expires_at: string | null;
  roll_error: string | null;
  created_at: string;
};

export type MembershipSlot = {
  membership_id?: string;
  weekday: number; // 0=Sun … 6=Sat
  start_time: string; // "HH:MM" or "HH:MM:SS"
  resource_id: string;
  resource_name?: string;
};

// A row of the membership_periods_v view (the surcharge is derived there).
export type MembershipPeriod = {
  id: string;
  membership_id: string;
  period: string; // YYYY-MM-01
  classes: number;
  amount_ars: number;
  amount_due_ars: number;
  is_late: boolean;
  releasable: boolean;
  days_late: number;
  status: PeriodStatus;
  due_on: string;
  paid_at: string | null;
  payment_id: string | null;
};

export type SwapRequestRow = {
  id: string;
  direction: "in" | "out";
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  from_booking_id: string;
  to_booking_id: string;
  from_starts_at: string;
  from_resource: string | null;
  to_starts_at: string;
  to_resource: string | null;
  counterpart_label: string;
  created_at: string;
};

// What the membership-availability function returns.
export type MembershipAvailability = {
  timezone: string;
  duration_minutes: number;
  classes_per_week: number;
  price_ars: number;
  range: { from: string; to: string };
  resources: { id: string; name: string }[];
  weekdays: {
    weekday: number;
    occurrences_this_month: number;
    occurrences_full_month: number;
    times: { start_time: string; resources_free: string[] }[];
  }[];
};

// The picker's value: one per chosen weekday.
export type SchedulePick = {
  weekday: number;
  start_time: string; // "HH:MM"
  resource_id: string;
};

export const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const WEEKDAY_LONG = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
// Display order Mon → Sun, as JS weekday numbers.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// "18:00:00" → "18:00"
export const hm = (t: string) => t.slice(0, 5);

// Sort picks/slots Mon → Sun.
export function byWeekOrder<T extends { weekday: number }>(xs: T[]): T[] {
  return [...xs].sort(
    (a, b) => WEEK_ORDER.indexOf(a.weekday) - WEEK_ORDER.indexOf(b.weekday),
  );
}

// "2026-10-15" → "2026-10-31"
export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

// "2026-10-01" → "octubre 2026"; withYear=false → "octubre"
export function monthLabel(period: string, withYear = true): string {
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

// "octubre de 2026" → "Octubre de 2026" (CSS capitalize would give "De" too).
export const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// "2026-10-20" → "lun 20 oct"
export function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace(/\./g, "");
}

// Estimate of the first cuota, from what membership-availability counted. The
// database computes the real amount when the membership is created (same
// formula: price × classes left this month / classes in the whole month).
export function quoteFirstPeriod(
  data: Pick<MembershipAvailability, "price_ars" | "weekdays">,
  weekdays: number[],
): { classes: number; full: number; amount: number } {
  let classes = 0;
  let full = 0;
  for (const w of data.weekdays) {
    if (!weekdays.includes(w.weekday)) continue;
    classes += w.occurrences_this_month;
    full += w.occurrences_full_month;
  }
  const amount =
    full === 0 || classes >= full
      ? data.price_ars
      : Math.round((data.price_ars * classes) / full);
  return { classes, full, amount };
}

export const MEMBERSHIP_STATUS_LABEL: Record<MembershipStatus, string> = {
  pending: "Pendiente de pago",
  active: "Activo",
  cancelled: "Dado de baja",
  expired: "Finalizado",
};

export const MEMBERSHIP_STATUS_STYLE: Record<MembershipStatus, string> = {
  pending: "bg-amber-400/15 text-amber-300",
  active: "bg-accent/15 text-accent",
  cancelled: "bg-surface-2 text-fg-faint",
  expired: "bg-surface-2 text-fg-faint",
};

export function periodStatusLabel(p: Pick<MembershipPeriod, "status" | "is_late">) {
  if (p.status === "paid") return "Pagada";
  if (p.status === "void") return "Anulada";
  return p.is_late ? "Vencida" : "A pagar";
}

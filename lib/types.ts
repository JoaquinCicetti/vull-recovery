export type Profile = {
  id: string;
  full_name: string | null;
  whatsapp_phone: string | null;
  email: string | null;
  is_admin: boolean;
  notify_email: boolean;
  notify_push: boolean;
};

// An area of the business with its own agenda and policies (recovery, pilates…).
// `active = false` is the launch flag: RLS shows the sector, its plans and its
// agenda to admins only until it goes live.
export type Sector = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  sort_order: number;
  timezone: string;
  lead_minutes: number;
  hold_minutes: number;
  cancel_notice_hours: number;
  change_notice_hours: number;
  // Monthly plans (abonos): the cuota is due by `due_day`, costs `late_fee_pct`
  // more after it, and from `release_day` admins may free an unpaid slot.
  due_day: number;
  late_fee_pct: number;
  release_day: number;
};

// One open range of one weekday (table sector_hours). A weekday with no rows is
// closed; several rows on a day are separate ranges (morning, evening).
export type SectorHours = {
  sector_id: string;
  weekday: number; // 0=Sun … 6=Sat
  opens: string; // "HH:MM:SS"
  closes: string;
};

// What a turno occupies inside a sector: recovery's room, a pilates bed. The
// server assigns the first free one; clients only ever pick a time.
export type Resource = {
  id: string;
  sector_id: string;
  name: string;
  active: boolean;
  sort_order: number;
};

export type Service = {
  id: string;
  sector_id: string;
  name: string;
  description: string | null;
  price_ars: number;
  duration_minutes: number;
  active: boolean;
  sort_order: number;
  // A plan with sessions_included > 1 is a pack: buying it grants that many
  // credits for THIS service, valid `validity_days` (null = forever), and each
  // booking spends one. Ordinary plans keep sessions_included = 1.
  sessions_included: number;
  validity_days: number | null;
  // billing = "monthly" is an abono: the client picks `classes_per_week` fixed
  // weekly classes and pays price_ars per month (see lib/membership.ts).
  billing: "session" | "monthly";
  classes_per_week: number | null;
};

export function isMonthly(s: Pick<Service, "billing">): boolean {
  return s.billing === "monthly";
}

// A pack is a plan that includes more than one session. Lives here rather than in
// lib/credits.ts so client components can use it without pulling in the server
// Supabase client.
export function isPack(s: Pick<Service, "sessions_included">): boolean {
  return s.sessions_included > 1;
}

// A per-user, per-service appointment-credit balance (from my_credit_balances()).
export type CreditBalance = {
  service_id: string;
  balance: number;
};

export type BookingStatus =
  | "pending"
  | "awaiting_payment"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "no_show";

export type Booking = {
  id: string;
  user_id: string;
  service_id: string;
  sector_id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  membership_id: string | null;
  google_event_id: string | null;
  hold_expires_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_at: string;
};

// A bookable open slot returned by the `availability` Edge Function.
export type Slot = {
  starts_at: string; // ISO
  ends_at: string; // ISO
};

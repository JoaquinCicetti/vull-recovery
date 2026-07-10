export type Profile = {
  id: string;
  full_name: string | null;
  whatsapp_phone: string | null;
  email: string | null;
  is_admin: boolean;
  notify_email: boolean;
  notify_push: boolean;
};

export type Service = {
  id: string;
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
};

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
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
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

// Center configuration (singleton row, id = true). Drives availability.
export type Settings = {
  working_hours_start: string; // "HH:MM" / "HH:MM:SS"
  working_hours_end: string; // "HH:MM" / "HH:MM:SS"
  working_days: number[]; // JS weekday numbers: 0=Sun … 6=Sat
  timezone: string; // IANA tz, e.g. "America/Argentina/Buenos_Aires"
};

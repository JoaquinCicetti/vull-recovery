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
  working_hours_start: string; // "HH:MM:SS"
  working_hours_end: string;
  working_days: number[]; // 0=Sun … 6=Sat
  lead_minutes: number;
  hold_minutes: number;
  cancel_notice_hours: number;
  change_notice_hours: number;
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
  sector_id: string;
  resource_id: string;
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

// Sectors: recovery, pilates, … — each with its own agenda, policies and
// resources (beds). See supabase/migrations/20261014120000_sectors_resources.sql.
//
// The functions run with the service role, which skips RLS, so the rule RLS
// applies to the browser ("an inactive sector is admins-only") is re-checked
// here. That is the feature flag: pilates stays inactive until it launches.
import type { SupabaseClient, User } from "jsr:@supabase/supabase-js@2";
import { calendarId } from "./google.ts";
import type { OpenRange, Settings } from "./booking-rules.ts";

export type SectorHour = OpenRange & { id?: string; sector_id?: string };

export type Sector = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  timezone: string;
  // Open ranges per weekday (table sector_hours), embedded on every load.
  sector_hours: SectorHour[];
  google_calendar_id: string | null;
  lead_minutes: number;
  // How far ahead clients may book (see bookingWindow in booking-rules.ts).
  booking_window: "rolling" | "week";
  rolling_days: number;
  next_week_opens_dow: number;
  next_week_opens_at: string;
  hold_minutes: number;
  cancel_notice_hours: number;
  change_notice_hours: number;
  // Monthly plans: pay before due_day, late_fee_pct after it, admins may free
  // the slot from release_day.
  due_day: number;
  late_fee_pct: number;
  release_day: number;
};

// The sector columns every function needs, with its hours (and slot grid)
// embedded.
export const SECTOR_SELECT = "*, sector_hours(weekday, opens, closes, slot_minutes)";

// deno-lint-ignore no-explicit-any
export type ServiceWithSector = Record<string, any> & {
  id: string;
  active: boolean;
  duration_minutes: number;
  sector_id: string;
  sectors: Sector;
};

// A plan with its sector embedded, or null if either is missing.
export async function loadServiceWithSector(
  admin: SupabaseClient,
  serviceId: string,
): Promise<ServiceWithSector | null> {
  const { data } = await admin
    .from("services")
    .select(`*, sectors(${SECTOR_SELECT})`)
    .eq("id", serviceId)
    .single();
  return data?.sectors ? (data as ServiceWithSector) : null;
}

// A sector with its hours, or null.
export async function loadSector(
  admin: SupabaseClient,
  sectorId: string,
): Promise<Sector | null> {
  const { data } = await admin
    .from("sectors")
    .select(SECTOR_SELECT)
    .eq("id", sectorId)
    .maybeSingle();
  return (data as Sector | null) ?? null;
}

export async function isAdminUser(admin: SupabaseClient, user: User | null) {
  if (!user) return false;
  const { data } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  return Boolean(data?.is_admin);
}

// Whether `user` may see and book in this sector: everyone when it is active,
// only admins while it is hidden.
export async function canUseSector(
  admin: SupabaseClient,
  sector: Sector,
  user: User | null,
): Promise<boolean> {
  return sector.active || (await isAdminUser(admin, user));
}

export function sectorSettings(sector: Sector): Settings {
  return {
    timezone: sector.timezone,
    lead_minutes: sector.lead_minutes,
    hours: (sector.sector_hours ?? []).map((h) => ({
      weekday: h.weekday,
      opens: h.opens,
      closes: h.closes,
      slot_minutes: h.slot_minutes,
    })),
    booking_window: sector.booking_window,
    rolling_days: sector.rolling_days,
    next_week_opens_dow: sector.next_week_opens_dow,
    next_week_opens_at: sector.next_week_opens_at,
  };
}

// The Google Calendar a sector's turnos are mirrored to and checked against.
// Recovery predates sectors.google_calendar_id and keeps using GOOGLE_CALENDAR_ID
// until it is copied into its row; any other sector has a calendar only once one
// is set (calendar-poll still syncs the env calendar only).
export function sectorCalendarId(sector: Sector): string | null {
  if (sector.google_calendar_id) return sector.google_calendar_id;
  return sector.slug === "recovery" ? calendarId() : null;
}

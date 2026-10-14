// Sectors: recovery, pilates, … — each with its own agenda, policies and
// resources (beds). See supabase/migrations/20261014120000_sectors_resources.sql.
//
// The functions run with the service role, which skips RLS, so the rule RLS
// applies to the browser ("an inactive sector is admins-only") is re-checked
// here. That is the feature flag: pilates stays inactive until it launches.
import type { SupabaseClient, User } from "jsr:@supabase/supabase-js@2";
import { calendarId } from "./google.ts";
import type { Settings } from "./booking-rules.ts";

export type Sector = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  timezone: string;
  working_hours_start: string;
  working_hours_end: string;
  working_days: number[];
  google_calendar_id: string | null;
  lead_minutes: number;
  hold_minutes: number;
  cancel_notice_hours: number;
  change_notice_hours: number;
};

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
    .select("*, sectors(*)")
    .eq("id", serviceId)
    .single();
  return data?.sectors ? (data as ServiceWithSector) : null;
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
    working_hours_start: sector.working_hours_start,
    working_hours_end: sector.working_hours_end,
    working_days: sector.working_days,
    timezone: sector.timezone,
    lead_minutes: sector.lead_minutes,
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

import { createClient } from "@/lib/supabase/server";
import type { Service } from "@/lib/types";

// A pack is a plan that includes more than one session.
export function isPack(s: Pick<Service, "sessions_included">): boolean {
  return s.sessions_included > 1;
}

// The signed-in user's live credit balances, keyed by the bookable service id.
// Reads through my_credit_balances() (auth.uid()-scoped, expiry-aware).
export async function getMyBalances(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_credit_balances");
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { service_id: string; balance: number }[]) {
    out[row.service_id] = row.balance;
  }
  return out;
}

import { createClient } from "@/lib/supabase/server";
import type { Service } from "@/lib/types";

// A pack is a service that grants credits for another (bookable) service.
export function isPack(s: Pick<Service, "grants_service_id">): boolean {
  return s.grants_service_id != null;
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

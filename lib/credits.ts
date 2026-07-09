import { createClient } from "@/lib/supabase/server";

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

export type Credit = { serviceId: string; name: string; remaining: number };

// Live balances joined to their service names, for the credit cards on
// /mis-turnos and /cuenta. Empty for a signed-out visitor.
export async function getMyCredits(): Promise<Credit[]> {
  const balances = await getMyBalances();
  const ids = Object.keys(balances);
  if (ids.length === 0) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("services")
    .select("id, name")
    .in("id", ids);

  const names: Record<string, string> = {};
  for (const s of (data ?? []) as { id: string; name: string }[]) {
    names[s.id] = s.name;
  }
  return ids.map((id) => ({
    serviceId: id,
    name: names[id] ?? "Servicio",
    remaining: balances[id],
  }));
}

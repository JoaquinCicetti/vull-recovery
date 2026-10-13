import { createClient as createAnonClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Service } from "@/lib/types";

function configured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export async function getActiveServices(): Promise<Service[]> {
  if (!configured()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("services")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  return data ?? [];
}

export async function getService(id: string): Promise<Service | null> {
  if (!configured()) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("services")
    .select("*")
    .eq("id", id)
    .single<Service>();
  return data ?? null;
}

// Cookie-less read for STATIC pages, run at build time: touching cookies() (as
// the server client does) would make the page dynamic. Public rows only (RLS
// as anon). Plans refreshes this list in the browser, so a stale snapshot
// only lasts until hydration.
export async function getActiveServicesStatic(): Promise<Service[]> {
  if (!configured()) return [];
  const supabase = createAnonClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data } = await supabase
    .from("services")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  return data ?? [];
}

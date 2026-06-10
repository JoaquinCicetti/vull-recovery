import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ServicesManager } from "./services-manager";
import type { Service } from "@/lib/types";

export default async function ServiciosPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("services")
    .select("*")
    .order("sort_order", { ascending: true });

  return (
    <div className="mx-auto max-w-2xl px-5 py-16">
      <Link
        href="/admin"
        className="text-sm text-fg-faint transition-colors hover:text-fg"
      >
        ← Volver al panel
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Planes y precios</h1>
      <ServicesManager initial={(data ?? []) as Service[]} />
    </div>
  );
}

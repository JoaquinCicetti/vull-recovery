import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ServicesManager } from "./services-manager";
import { PageShell } from "@/components/ui/page-shell";
import type { Service } from "@/lib/types";

export default async function ServiciosPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("services")
    .select("*")
    .order("sort_order", { ascending: true });

  return (
    <PageShell
      nav={
        <Link
          href="/admin"
          className="text-sm text-fg-faint transition-colors hover:text-fg"
        >
          ← Volver al panel
        </Link>
      }
      eyebrow="Panel"
      title="Planes y precios"
    >
      <ServicesManager initial={(data ?? []) as Service[]} />
    </PageShell>
  );
}

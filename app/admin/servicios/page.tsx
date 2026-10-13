import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ServicesManager } from "./services-manager";
import { AdminTabs } from "@/components/admin/admin-tabs";
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
      size="wide"
      nav={<AdminTabs />}
      eyebrow="Panel"
      title="Planes y precios"
    >
      <div className="max-w-2xl">
        <ServicesManager initial={(data ?? []) as Service[]} />
      </div>
    </PageShell>
  );
}

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { PageShell } from "@/components/ui/page-shell";
import type { Settings } from "@/lib/types";

const DEFAULTS: Settings = {
  working_hours_start: "09:00",
  working_hours_end: "18:00",
  working_days: [1, 2, 3, 4, 5],
  timezone: "America/Argentina/Buenos_Aires",
};

export default async function ConfiguracionPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("settings")
    .select("working_hours_start, working_hours_end, working_days, timezone")
    .eq("id", true)
    .single<Settings>();

  return (
    <PageShell
      size="wide"
      nav={<AdminTabs />}
      eyebrow="Panel"
      title="Disponibilidad"
      description="Definí el horario y los días en que se pueden reservar turnos. Esto controla la disponibilidad que ven los clientes."
    >
      <div className="max-w-2xl">
        <SettingsForm initial={data ?? DEFAULTS} />
      </div>
    </PageShell>
  );
}

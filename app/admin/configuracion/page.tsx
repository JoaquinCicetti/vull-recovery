import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";
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
    <div className="mx-auto max-w-2xl px-5 py-16">
      <Link
        href="/admin"
        className="text-sm text-fg-faint transition-colors hover:text-fg"
      >
        ← Volver al panel
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">
        Disponibilidad
      </h1>
      <p className="mt-2 text-sm text-fg-muted">
        Definí el horario y los días en que se pueden reservar turnos. Esto
        controla la disponibilidad que ven los clientes.
      </p>
      <SettingsForm initial={data ?? DEFAULTS} />
    </div>
  );
}

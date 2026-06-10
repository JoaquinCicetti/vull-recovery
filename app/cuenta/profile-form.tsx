"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const supabase = createClient();
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [phone, setPhone] = useState(profile.whatsapp_phone ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    // Store the number as digits only (e.g. 5491122334455) so it matches the
    // `from` WhatsApp sends to the webhook exactly.
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName, whatsapp_phone: phone.replace(/\D/g, "") })
      .eq("id", profile.id);
    setSaving(false);
    if (error) setError(error.message);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-8 flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-fg-muted">
          Nombre y apellido
        </label>
        <input
          className="field"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Tu nombre"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-fg-muted">WhatsApp</label>
        <input
          className="field"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+54 9 11 2233 4455"
          inputMode="tel"
        />
        <p className="text-xs text-fg-faint">
          Lo usamos para coordinar y confirmar tus turnos por WhatsApp.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {saved && <span className="text-sm text-accent">Guardado ✓</span>}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={signOut}
        className="mt-4 self-start text-sm text-fg-faint transition-colors hover:text-danger"
      >
        Cerrar sesión
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Shown before booking when the signed-in user has no name on file yet, so
// every appointment is tied to a real name (and optional WhatsApp). Google
// sign-ins already carry a name and skip this; email-OTP sign-ins land here.
export function NameGate() {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      setError("Tu sesión expiró. Ingresá de nuevo.");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: name.trim(),
        whatsapp_phone: phone.trim() || null,
      })
      .eq("id", user.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-10 surface-card p-5">
      <p className="eyebrow">Antes de reservar</p>
      <h2 className="mt-3 text-lg font-semibold text-fg">¿Cómo te llamás?</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Lo usamos para tu turno y para coordinar con vos.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <input
          className="field"
          placeholder="Nombre y apellido"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
        <input
          className="field font-mono"
          inputMode="tel"
          placeholder="WhatsApp (opcional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button className="btn-primary self-start" disabled={busy}>
          {busy ? "Guardando…" : "Continuar"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </form>
  );
}

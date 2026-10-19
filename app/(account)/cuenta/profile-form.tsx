"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const digits = (s: string) => s.replace(/\D/g, "");

export function ProfileForm({
  userId,
  fullName,
  phone,
}: {
  userId: string;
  fullName: string | null;
  phone: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState(fullName ?? "");
  const [tel, setTel] = useState(phone ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = name.trim().length >= 2;
  // Optional, but if given it has to be a dialable number (country + area + line).
  const telOk = digits(tel).length === 0 || digits(tel).length >= 10;
  const dirty = name.trim() !== (fullName ?? "") || digits(tel) !== digits(phone ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!nameOk || !telOk) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    // Store the number as digits only (e.g. 5491122334455) so it matches the
    // `from` WhatsApp sends to the webhook exactly.
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: name.trim(), whatsapp_phone: digits(tel) || null })
      .eq("id", userId);
    setSaving(false);
    if (error) setError("No se pudo guardar. Probá de nuevo.");
    else {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-name" className="text-fg-muted">
          Nombre y apellido
        </Label>
        <Input
          id="profile-name"
          value={name}
          maxLength={120}
          autoComplete="name"
          aria-invalid={!nameOk && name.length > 0}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          placeholder="Tu nombre"
        />
        {!nameOk && name.length > 0 && (
          <p className="text-xs text-danger">Escribí tu nombre completo.</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-phone" className="text-fg-muted">
          WhatsApp
        </Label>
        <Input
          id="profile-phone"
          className="font-mono"
          value={tel}
          maxLength={24}
          autoComplete="tel"
          inputMode="tel"
          aria-invalid={!telOk}
          onChange={(e) => {
            setTel(e.target.value);
            setSaved(false);
          }}
          placeholder="+54 9 11 2233 4455"
        />
        <p className={`text-xs ${telOk ? "text-fg-faint" : "text-danger"}`}>
          {telOk
            ? "Con código de país y de área. Ej. +54 9 341 555 1234."
            : "Parece incompleto: incluí el código de país y de área."}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button disabled={saving || !dirty || !nameOk || !telOk}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </Button>
        <span aria-live="polite" className="text-sm">
          {saved && <span className="text-accent">Guardado ✓</span>}
          {error && <span className="text-danger">{error}</span>}
        </span>
      </div>
    </form>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <Button variant="outline" onClick={signOut} disabled={busy}>
      {busy ? "Saliendo…" : "Cerrar sesión"}
    </Button>
  );
}

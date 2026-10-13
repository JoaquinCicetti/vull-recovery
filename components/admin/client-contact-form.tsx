"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Admin edit of a client's name / WhatsApp. Allowed by profiles_admin_update;
// email and is_admin are not writable from the browser at all (column grants).
export function ClientContactForm({
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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = name !== (fullName ?? "") || tel !== (phone ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase
      .from("profiles")
      .update({
        full_name: name.trim() || null,
        whatsapp_phone: tel.trim() || null,
      })
      .eq("id", userId)
      .select("id");
    setBusy(false);
    // An RLS-filtered update is not an error: it just touches zero rows.
    if (error || !data || data.length === 0) {
      setMsg({ ok: false, text: error?.message ?? "No se pudo guardar." });
      return;
    }
    setMsg({ ok: true, text: "Guardado." });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="min-w-40 flex-1">
          <Label className="text-xs text-fg-muted">Nombre</Label>
          <Input
            className="mt-1.5"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="min-w-40 flex-1">
          <Label className="text-xs text-fg-muted">WhatsApp</Label>
          <Input
            className="mt-1.5 font-mono"
            inputMode="tel"
            value={tel}
            maxLength={30}
            onChange={(e) => setTel(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" disabled={busy || !dirty}>
          Guardar
        </Button>
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</p>
        )}
      </div>
    </form>
  );
}

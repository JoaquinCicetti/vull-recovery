"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import { PushManager } from "@/components/push-manager";

// Per-user notification preferences. Each toggle saves on change (own-row RLS +
// the column grant added in the notification_prefs migration). The push toggle is
// the DELIVERY preference; the PushManager button below it is what actually
// registers this device — a user can want push yet not have subscribed here yet.
export function NotificationSettings({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const [email, setEmail] = useState(profile.notify_email);
  const [push, setPush] = useState(profile.notify_push);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Partial<Pick<Profile, "notify_email" | "notify_push">>) {
    setError(null);
    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", profile.id);
    if (error) {
      setError("No se pudo guardar. Probá de nuevo.");
      // Roll the optimistic toggle back so the UI matches the stored value.
      if ("notify_email" in patch) setEmail(!patch.notify_email);
      if ("notify_push" in patch) setPush(!patch.notify_push);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-semibold text-fg">Notificaciones</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Elegí cómo querés que te avisemos sobre tus turnos: confirmaciones,
          cancelaciones y sesiones acreditadas.
        </p>
      </div>

      <label className="flex items-center justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-sm font-medium text-fg">Email</span>
          <span className="text-xs text-fg-faint">A {profile.email}</span>
        </span>
        <Switch
          checked={email}
          onCheckedChange={(v) => {
            setEmail(v);
            save({ notify_email: v });
          }}
        />
      </label>

      <label className="flex items-center justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-sm font-medium text-fg">
            Notificaciones push
          </span>
          <span className="text-xs text-fg-faint">En tus dispositivos</span>
        </span>
        <Switch
          checked={push}
          onCheckedChange={(v) => {
            setPush(v);
            save({ notify_push: v });
          }}
        />
      </label>

      {push && (
        <div className="border-t border-border pt-4">
          <PushManager />
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

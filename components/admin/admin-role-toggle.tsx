"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

// Grant or remove panel access. Two taps on purpose: an admin sees every
// client's data and can approve payments. admin_set_admin() re-checks the caller
// server-side and refuses a self-demotion.
export function AdminRoleToggle({
  userId,
  isAdmin,
  isSelf,
}: {
  userId: string;
  isAdmin: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("admin_set_admin", {
      p_user: userId,
      p_value: !isAdmin,
    });
    setBusy(false);
    setConfirming(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">
        {isAdmin
          ? "Es administrador: ve todos los clientes, turnos y pagos, y puede aprobarlos."
          : "Es un cliente común. Un administrador ve todos los clientes, turnos y pagos, y puede aprobarlos."}
      </p>
      {isSelf ? (
        <p className="text-xs text-fg-faint">
          Sos vos. Para quitarte el permiso, pedíselo a otro administrador.
        </p>
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={isAdmin ? "destructive" : "default"}
            onClick={apply}
            disabled={busy}
          >
            {isAdmin ? "Sí, quitar acceso" : "Sí, hacer administrador"}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button
          variant={isAdmin ? "destructive" : "outline"}
          className="self-start"
          onClick={() => setConfirming(true)}
        >
          {isAdmin ? "Quitar administrador" : "Hacer administrador"}
        </Button>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

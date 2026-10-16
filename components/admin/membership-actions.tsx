"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { Button } from "@/components/ui/button";

// Admin actions on one abono: collect a cuota in cash, switch renewal on/off,
// free the slots. Inline two-step confirm for the destructive one.
export function MembershipActions({
  membershipId,
  pendingPeriodId,
  locked,
  active,
}: {
  membershipId: string;
  pendingPeriodId: string | null;
  locked: boolean;
  active: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.functions.invoke("admin-membership", { body });
    setBusy(false);
    setConfirm(false);
    if (err) {
      setError(await readError(err, "No se pudo completar."));
      return;
    }
    router.refresh();
  }

  if (!active) return null;
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-1.5">
        {pendingPeriodId && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => act({ action: "mark_paid", period_id: pendingPeriodId })}
          >
            Cobré en efectivo
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => act({ action: "set_locked", membership_id: membershipId, locked: !locked })}
        >
          {locked ? "Quitar horario fijo" : "Hacer horario fijo"}
        </Button>
        {!confirm ? (
          <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => setConfirm(true)}>
            Liberar lugar
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => act({ action: "release", membership_id: membershipId })}
            >
              {busy ? "Liberando…" : "Sí, liberar"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
              No
            </Button>
          </>
        )}
      </div>
      {confirm && (
        <p className="max-w-xs text-right text-xs text-fg-muted">
          Se cancelan las clases posteriores al último mes pago y el horario queda libre.
        </p>
      )}
      {error && (
        <p role="alert" className="max-w-xs text-right text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

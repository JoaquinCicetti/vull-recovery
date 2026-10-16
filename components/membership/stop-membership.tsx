"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { dateLabel, type MembershipStatus } from "@/lib/membership";
import { waLink } from "@/lib/site";
import { Button } from "@/components/ui/button";

// The way out, depending on the state: an unpaid signup is cancelled (its
// schedule frees up); a recurring abono stops renewing (paid months stay); a
// one-month abono simply ends.
export function StopMembership({
  membershipId,
  status,
  locked,
  endsOn,
}: {
  membershipId: string;
  status: MembershipStatus;
  locked: boolean;
  endsOn: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "active" && !locked) {
    return (
      <p className="text-sm text-fg-faint">
        Tu abono termina {endsOn ? `el ${dateLabel(endsOn)}` : "con el mes"}. Las clases pagas no
        se devuelven; si no podés ir a alguna, movela desde Mis turnos.{" "}
        <a
          href={waLink("Hola! Tengo una consulta sobre mi abono.")}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg-muted underline underline-offset-4"
        >
          Escribinos
        </a>
      </p>
    );
  }

  const pending = status === "pending";
  async function run() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.functions.invoke(
      "membership",
      {
        body: pending
          ? { action: "cancel_pending", membership_id: membershipId }
          : { action: "set_locked", membership_id: membershipId, locked: false },
      },
    );
    setBusy(false);
    if (err) {
      setError(await readError(err, "No se pudo completar. Probá de nuevo."));
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {!confirming ? (
        <Button variant="ghost" className="text-fg-muted" onClick={() => setConfirming(true)}>
          {pending ? "Cancelar abono" : "Dejar de renovar"}
        </Button>
      ) : (
        <>
          <p className="max-w-sm text-sm text-fg">
            {pending
              ? "¿Cancelar el abono? Se libera el horario que te guardamos."
              : "Tus clases pagas siguen. Desde el mes que viene el lugar queda libre para otra persona. ¿Confirmar?"}
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={busy} onClick={run}>
              {busy ? "Un momento…" : "Sí, confirmar"}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              No
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

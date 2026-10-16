"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { fmtTime, localDate } from "@/lib/format";
import { dateLabel, type SwapRequestRow } from "@/lib/membership";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const RESOLVED: Record<string, string> = {
  accepted: "Aceptado",
  declined: "Rechazado",
  cancelled: "Cancelado",
  expired: "Vencido (menos de 24 h o la clase cambió)",
};

function when(iso: string, tz: string, bed: string | null) {
  return `${dateLabel(localDate(iso, tz))} · ${fmtTime(iso, tz)}${bed ? ` · ${bed}` : ""}`;
}

// Swap offers in both directions. Incoming: accept (two-step) or decline.
// Outgoing: withdraw. Resolved ones stay visible a week, dimmed.
export function SwapInbox({ swaps, timezone }: { swaps: SwapRequestRow[]; timezone: string }) {
  if (swaps.length === 0) {
    return (
      <p className="text-sm text-fg-faint">
        No tenés propuestas. Para ofrecer una de tus clases, abrila desde Mis turnos.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {swaps.map((s) => (
        <SwapRow key={s.id} swap={s} timezone={timezone} />
      ))}
    </ul>
  );
}

function SwapRow({ swap: s, timezone }: { swap: SwapRequestRow; timezone: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const incoming = s.direction === "in";
  const mine = incoming ? when(s.to_starts_at, timezone, s.to_resource) : when(s.from_starts_at, timezone, s.from_resource);
  const theirs = incoming ? when(s.from_starts_at, timezone, s.from_resource) : when(s.to_starts_at, timezone, s.to_resource);

  async function act(action: "accept" | "decline" | "cancel") {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.functions.invoke("swap-booking", {
      body: { action, request_id: s.id },
    });
    setBusy(false);
    if (err) {
      setError(await readError(err, "No se pudo completar."));
      setConfirming(false);
      return;
    }
    router.refresh();
  }

  const open = s.status === "pending";
  return (
    <li className={cn("surface-card p-4", !open && "opacity-60")}>
      <p className="text-sm text-fg-muted">
        {incoming ? (
          <>
            <span className="font-medium text-fg">{s.counterpart_label}</span> te propone cambiar tu
            clase del <span className="font-medium text-fg">{mine}</span> por la suya del{" "}
            <span className="font-medium text-fg">{theirs}</span>.
          </>
        ) : (
          <>
            Le propusiste a <span className="font-medium text-fg">{s.counterpart_label}</span> cambiar
            tu clase del <span className="font-medium text-fg">{mine}</span> por la suya del{" "}
            <span className="font-medium text-fg">{theirs}</span>.
          </>
        )}
      </p>
      {!open && <p className="mt-1.5 text-xs text-fg-faint">{RESOLVED[s.status] ?? s.status}</p>}
      {open && !incoming && <p className="mt-1.5 text-xs text-fg-faint">Esperando respuesta.</p>}
      {open && (
        <div className="mt-3 flex flex-wrap gap-2">
          {incoming && !confirming && (
            <>
              <Button size="sm" disabled={busy} onClick={() => setConfirming(true)}>
                Aceptar
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("decline")}>
                Rechazar
              </Button>
            </>
          )}
          {incoming && confirming && (
            <>
              <span className="w-full text-sm text-fg">Las dos clases se intercambian ahora. ¿Confirmar?</span>
              <Button size="sm" disabled={busy} onClick={() => act("accept")}>
                {busy ? "Intercambiando…" : "Sí, intercambiar"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                No
              </Button>
            </>
          )}
          {!incoming && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("cancel")}>
              {busy ? "Cancelando…" : "Cancelar propuesta"}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

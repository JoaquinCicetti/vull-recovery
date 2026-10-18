"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { fmtDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

export type FailedNotification = {
  id: string;
  kind: string;
  audience: "admins" | "user";
  createdAt: string;
  error: string;
  attempts: number;
};

// The notifications outbox kinds (ADR 0013), in the owner's words.
const KIND_LABEL: Record<string, string> = {
  booking_received: "Reserva recibida",
  booking_confirmed: "Turno confirmado",
  booking_cancelled: "Turno cancelado",
  booking_rescheduled: "Turno reprogramado",
  payment_to_verify: "Pago por verificar",
  payment_rejected: "Comprobante rechazado",
  pack_purchased: "Pack acreditado",
  membership_paid: "Cuota pagada",
  membership_created_by_admin: "Abono reservado",
  membership_cancelled: "Abono dado de baja",
  class_moved: "Clase movida",
  swap_proposed: "Propuesta de intercambio",
  swap_resolved: "Respuesta de intercambio",
  admin_alert: "Alerta",
};

// Notices that could not be delivered (email rejected, push down, nothing
// configured…). "Reintentar" puts them back in the queue and sends right away
// through admin-booking's dispatch_notifications; the notify-dispatch cron
// would pick them up too.
export function FailedNotifications({ rows }: { rows: FailedNotification[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    for (const r of rows) {
      const { error: rpcErr } = await supabase.rpc("retry_notification", { p_id: r.id });
      if (rpcErr) {
        setBusy(false);
        setError("No se pudo reintentar.");
        return;
      }
    }
    const { error: fnErr } = await supabase.functions.invoke("admin-booking", {
      body: { action: "dispatch_notifications" },
    });
    setBusy(false);
    if (fnErr) setError(await readError(fnErr, "Quedaron en la cola; se envían en unos minutos."));
    router.refresh();
  }

  return (
    <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-fg-muted">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-fg">Avisos no enviados</p>
          <p className="mt-1">
            Estos emails o notificaciones no salieron. Revisá el motivo y reintentá.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={retry} disabled={busy}>
          {busy ? "Reintentando…" : "Reintentar"}
        </Button>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="border-t border-danger/20 pt-2">
            <p className="text-fg">
              {KIND_LABEL[r.kind] ?? r.kind}
              <span className="text-fg-faint">
                {" "}
                · {r.audience === "admins" ? "a administración" : "al cliente"} ·{" "}
                {fmtDateTime(r.createdAt)} · {r.attempts}{" "}
                {r.attempts === 1 ? "intento" : "intentos"}
              </span>
            </p>
            <p className="mt-0.5 break-words font-mono text-xs text-fg-faint">{r.error}</p>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </div>
  );
}

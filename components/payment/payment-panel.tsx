"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatARS, TALO_ENABLED, waLink } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TaloTransferPanel, type TaloTransfer } from "@/components/talo-transfer-panel";
import { SettlementPoller } from "@/components/settlement-poller";
import { readError } from "@/lib/read-error";

// What is being paid: one turno, or one month (cuota) of an abono.
export type PaymentTarget = { booking_id: string } | { membership_period_id: string };

// One way to pay: the automatic transfer. Talo mints a one-time CVU/alias,
// the client transfers, Talo settles it and the turno confirms itself. There
// is no receipt upload and no manual approval (ADR 0014): cash at the desk is
// handled by the admin blocking the slot.
export function PaymentPanel({
  target,
  amount,
  awaiting,
  talo,
  what = "el turno",
}: {
  target: PaymentTarget;
  amount: number;
  /** A transfer was detected and is settling. */
  awaiting: boolean;
  /** A CVU already minted for this target (survives a reload). */
  talo: TaloTransfer | null;
  /** What gets confirmed, for the copy: "el turno", "tu abono". */
  what?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<TaloTransfer | null>(talo);

  async function payWithTalo() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("create-payment", {
      body: { ...target, method: "talo" },
    });
    setLoading(false);
    if (error || !data || (!data.cvu && !data.alias && !data.payment_url)) {
      setError(
        error
          ? await readError(error, "No pudimos generar la transferencia. Probá de nuevo.")
          : "No pudimos generar la transferencia. Probá de nuevo.",
      );
      return;
    }
    setTransfer({
      cvu: data.cvu ?? null,
      alias: data.alias ?? null,
      amount: data.amount ?? amount,
      expiresAt: data.expires_at ?? null,
      paymentUrl: data.payment_url ?? null,
    });
    // The hold was just extended to the payment window; re-render the countdown.
    router.refresh();
  }

  return (
    <Card className="mt-6 [--card-spacing:--spacing(6)]">
      <CardContent>
        {/* Confirmation arrives asynchronously; keep the page in step. */}
        <SettlementPoller active={Boolean(transfer) || awaiting} />

        <p className="font-semibold text-fg">
          Pagar{" "}
          <span className="font-mono text-accent">{formatARS(amount)}</span>
        </p>

        {transfer ? (
          <div className="mt-4">
            <TaloTransferPanel transfer={transfer} detected={awaiting} />
          </div>
        ) : !TALO_ENABLED ? (
          <p className="mt-4 text-sm text-fg-muted">
            El pago online no está disponible en este momento.{" "}
            <a
              href={waLink(`Hola! Quiero coordinar el pago de ${what}.`)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-4"
            >
              Escribinos por WhatsApp
            </a>{" "}
            y lo resolvemos.
          </p>
        ) : (
          <>
            <Button size="lg" onClick={payWithTalo} disabled={loading} className="mt-4 w-full">
              {loading ? "Generando la transferencia…" : "Pagar por transferencia"}
            </Button>
            <p className="mt-2 text-center text-xs text-fg-faint">
              Te damos un alias para transferir. Se confirma {what} solo, en general en
              menos de un minuto.
            </p>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

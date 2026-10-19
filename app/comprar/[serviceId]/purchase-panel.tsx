"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatARS, TALO_ENABLED, waLink } from "@/lib/site";
import { readError } from "@/lib/read-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TaloTransferPanel, type TaloTransfer } from "@/components/talo-transfer-panel";

// Buy a multi-session pack (create-payment with pack_service_id). Same single
// path as the booking PaymentPanel: the automatic transfer via Talo. On
// settlement the webhook grants the credits.
export function PurchasePanel({
  packId,
  amount,
  isAuthed,
}: {
  packId: string;
  amount: number;
  isAuthed: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<(TaloTransfer & { paymentId: string }) | null>(null);

  const requireLogin = () =>
    router.push(`/login?next=${encodeURIComponent(`/comprar/${packId}`)}`);

  async function payWithTalo() {
    if (!isAuthed) return requireLogin();
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("create-payment", {
      body: { pack_service_id: packId, method: "talo" },
    });
    setLoading(false);
    if (error || !data?.payment_id || (!data.cvu && !data.alias && !data.payment_url)) {
      setError(
        error
          ? await readError(error, "No pudimos generar la transferencia. Probá de nuevo.")
          : "No pudimos generar la transferencia. Probá de nuevo.",
      );
      return;
    }
    setTransfer({
      paymentId: data.payment_id,
      cvu: data.cvu ?? null,
      alias: data.alias ?? null,
      amount: data.amount ?? amount,
      expiresAt: data.expires_at ?? null,
      paymentUrl: data.payment_url ?? null,
    });
  }

  return (
    <Card className="mt-6 [--card-spacing:--spacing(6)]">
      <CardContent>
        <p className="font-semibold text-fg">
          Comprar <span className="font-mono text-accent">{formatARS(amount)}</span>
        </p>

        {transfer ? (
          <div className="mt-4">
            <TaloTransferPanel transfer={transfer} />
            <Button asChild variant="outline" size="lg" className="mt-4 w-full">
              <Link href={`/comprar/exito?ref=${transfer.paymentId}`}>
                Ya transferí — ver estado
              </Link>
            </Button>
          </div>
        ) : !TALO_ENABLED ? (
          <p className="mt-4 text-sm text-fg-muted">
            La compra online no está disponible en este momento.{" "}
            <a
              href={waLink("Hola! Quiero comprar un pack de sesiones.")}
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
              {loading
                ? "Generando la transferencia…"
                : !isAuthed
                  ? "Ingresar y comprar"
                  : "Pagar por transferencia"}
            </Button>
            <p className="mt-2 text-center text-xs text-fg-faint">
              Te damos un alias para transferir. Las sesiones se acreditan solas.
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatARS } from "@/lib/site";
import { fmtDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

type PendingPayment = {
  id: string;
  amount: number;
  receiptUrl: string | null;
  service: string;
  when: string | null;
  client: string;
  phone: string | null;
};

export function AdminPayments({ payments }: { payments: PendingPayment[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    setError(null);
    const { error } = await supabase.functions.invoke("admin-payment", {
      body: { payment_id: id, action },
    });
    setBusy(null);
    if (error) {
      setError("No se pudo procesar el pago.");
      return;
    }
    router.refresh();
  }

  if (payments.length === 0) {
    return (
      <p className="mt-4 text-sm text-fg-faint">
        No hay pagos pendientes de verificación.
      </p>
    );
  }

  return (
    <ul className="mt-4 flex flex-col gap-3">
      {payments.map((p) => (
        <li key={p.id} className="surface-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-fg">
                {p.service} —{" "}
                <span className="font-mono text-accent">
                  {formatARS(p.amount)}
                </span>
              </p>
              {p.when && (
                <p className="mt-0.5 text-sm capitalize text-fg-muted">
                  {fmtDateTime(p.when)}
                </p>
              )}
              <p className="mt-0.5 text-sm text-fg-faint">
                {p.client}
                {p.phone ? ` · ${p.phone}` : ""}
              </p>
            </div>
            {p.receiptUrl && (
              <a
                href={p.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-sm text-accent underline underline-offset-4"
              >
                Ver comprobante
              </a>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => act(p.id, "approve")}
              disabled={busy === p.id}
            >
              Aprobar
            </Button>
            <Button
              variant="destructive"
              onClick={() => act(p.id, "reject")}
              disabled={busy === p.id}
            >
              Rechazar
            </Button>
          </div>
        </li>
      ))}
      {error && <p className="text-sm text-danger">{error}</p>}
    </ul>
  );
}

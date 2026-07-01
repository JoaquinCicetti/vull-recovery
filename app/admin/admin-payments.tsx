"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatARS } from "@/lib/site";
import { fmtDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

async function readError(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return body.error as string;
    }
  } catch {
    /* ignore */
  }
  return "No se pudo procesar el pago.";
}

type PendingPayment = {
  id: string;
  amount: number;
  receiptPath: string | null;
  service: string;
  when: string | null;
  client: string;
  phone: string | null;
};

export function AdminPayments({
  payments,
  total,
}: {
  payments: PendingPayment[];
  total: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  // Per-row error so it renders next to the acted row, not at the bottom.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openingReceipt, setOpeningReceipt] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    const { error } = await supabase.functions.invoke("admin-payment", {
      body: { payment_id: id, action },
    });
    setBusy(null);
    if (error) {
      const msg = await readError(error);
      setErrors((e) => ({ ...e, [id]: msg }));
      return;
    }
    router.refresh();
  }

  // Generate the signed receipt URL on demand (no N+1 at page load). Open a tab
  // synchronously so the popup isn't blocked, then point it at the signed URL.
  async function viewReceipt(id: string, path: string) {
    setOpeningReceipt(id);
    const win = window.open("", "_blank", "noopener,noreferrer");
    const { data } = await supabase.storage
      .from("receipts")
      .createSignedUrl(path, 120);
    setOpeningReceipt(null);
    if (data?.signedUrl && win) win.location.href = data.signedUrl;
    else {
      win?.close();
      setErrors((e) => ({ ...e, [id]: "No se pudo abrir el comprobante." }));
    }
  }

  if (payments.length === 0) {
    return (
      <p className="mt-4 text-sm text-fg-faint">
        No hay pagos pendientes de verificación.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <p className="font-mono text-xs text-fg-faint">
        {total} pendiente{total === 1 ? "" : "s"}
        {payments.length < total ? ` · mostrando ${payments.length}` : ""}
      </p>
      <ul className="mt-3 flex flex-col gap-3">
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
              {p.receiptPath && (
                <button
                  type="button"
                  onClick={() => viewReceipt(p.id, p.receiptPath!)}
                  disabled={openingReceipt === p.id}
                  className="shrink-0 text-sm text-accent underline underline-offset-4 disabled:opacity-60"
                >
                  {openingReceipt === p.id ? "Abriendo…" : "Ver comprobante"}
                </button>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => act(p.id, "approve")} disabled={busy === p.id}>
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
            {errors[p.id] && (
              <p className="mt-2 text-sm text-danger">{errors[p.id]}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

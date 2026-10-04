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
  provider: "manual" | "talo";
  status: "pending" | "approved" | "rejected";
  adminFlag: string | null;
  reversed: boolean;
  service: string;
  when: string | null;
  client: string;
  phone: string | null;
};

// What the settle path could not resolve on its own, in the owner's words.
// Keys are the admin_flag values written by _shared/talo-settle.ts.
const FLAG_LABEL: Record<string, string> = {
  underpaid: "pagó de menos",
  amount_mismatch: "pagó de menos",
  overpaid: "pagó de más — devolver la diferencia",
  unverified: "no se pudo verificar con Talo",
  unverified_amount: "monto no verificable",
  expired_with_funds: "plata en un CVU vencido",
  paid_no_slot: "cobrado sin turno — reprogramar o devolver",
  reversed: "el dinero volvió al cliente",
  currency_mismatch: "moneda inesperada",
  unknown_status: "estado desconocido en Talo",
  orphan_payment: "pago sin turno asociado",
};

function Tag({ children, tone }: { children: React.ReactNode; tone: "warn" | "info" }) {
  return (
    <span
      className={
        tone === "warn"
          ? "rounded-md bg-danger/10 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-danger"
          : "rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-fg-muted"
      }
    >
      {children}
    </span>
  );
}

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

  async function act(id: string, action: "approve" | "reject" | "dismiss") {
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
  //
  // The feature string must NOT contain `noopener`: window.open() returns null
  // whenever it is present, so we'd have no handle to navigate. We drop the
  // opener by hand instead, which buys the same protection.
  async function viewReceipt(id: string, path: string) {
    setOpeningReceipt(id);
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;

    const { data, error } = await supabase.storage
      .from("receipts")
      .createSignedUrl(path, 120);
    setOpeningReceipt(null);

    if (!data?.signedUrl) {
      console.error("signed receipt url failed:", error);
      win?.close();
      setErrors((e) => ({ ...e, [id]: "No se pudo abrir el comprobante." }));
      return;
    }

    // Popup blocked: fall back to a direct open, which needs no handle.
    if (win) win.location.replace(data.signedUrl);
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (payments.length === 0) {
    return (
      <p className="mt-4 text-sm text-fg-faint">
        No hay pagos que requieran atención.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <p className="font-mono text-xs text-fg-faint">
        {total} por revisar
        {payments.length < total ? ` · mostrando ${payments.length}` : ""}
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {payments.map((p) => {
          const isTalo = p.provider === "talo";
          // A settled Talo row only needs the owner to acknowledge the flag.
          const settled = p.status !== "pending";
          const flag = p.adminFlag ? FLAG_LABEL[p.adminFlag] ?? p.adminFlag : null;
          return (
            <li key={p.id} className="surface-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone="info">{isTalo ? "Talo" : "Comprobante"}</Tag>
                    {flag && <Tag tone="warn">{flag}</Tag>}
                    {p.reversed && !p.adminFlag && <Tag tone="warn">reintegrado</Tag>}
                  </div>
                  <p className="mt-2 font-semibold text-fg">
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

              {isTalo && !settled && (
                <p className="mt-3 text-xs leading-relaxed text-fg-faint">
                  Pago por transferencia automática. Si el dinero ya entró en
                  Talo, «Rechazar» no lo devuelve: hacé la devolución desde el
                  panel de Talo y después rechazá. «Aprobar» confirma el turno
                  con lo que haya entrado.
                </p>
              )}

              <div className="mt-4 flex gap-2">
                {settled ? (
                  <Button
                    variant="outline"
                    onClick={() => act(p.id, "dismiss")}
                    disabled={busy === p.id}
                  >
                    Listo, lo vi
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => act(p.id, "approve")} disabled={busy === p.id}>
                      Aprobar
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => act(p.id, "reject")}
                      disabled={busy === p.id}
                    >
                      {isTalo ? "Rechazar (sin dinero)" : "Rechazar"}
                    </Button>
                  </>
                )}
              </div>
              {errors[p.id] && (
                <p className="mt-2 text-sm text-danger">{errors[p.id]}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

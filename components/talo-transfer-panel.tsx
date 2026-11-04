"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { DEV_MODE, formatARS } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { DevFakePayment } from "@/components/dev-fake-payment";
import { fmtTime } from "@/lib/format";

export type TaloTransfer = {
  cvu: string | null;
  alias: string | null;
  amount: number;
  expiresAt: string | null;
  paymentUrl: string | null;
  /** The full price and the percent off it, when a coupon applied. */
  listAmount: number | null;
  couponPct: number | null;
};

/** The price in the panel's heading: the discount, once the server applied one. */
export function TransferPrice({
  transfer,
  amount,
}: {
  transfer: TaloTransfer | null;
  amount: number;
}) {
  return (
    <>
      {transfer?.listAmount != null && (
        <span className="mr-1.5 font-mono font-normal text-fg-faint line-through">
          {formatARS(transfer.listAmount)}
        </span>
      )}
      <span className="font-mono text-accent">{formatARS(transfer?.amount ?? amount)}</span>
      {transfer?.couponPct != null && (
        <span className="ml-1.5 font-mono text-sm font-normal text-fg-muted">
          −{transfer.couponPct}%
        </span>
      )}
    </>
  );
}

// A live transfer, when the client comes back to it. The way to pay is Talo's
// hosted page, which has the live status and sends them back here once paid. The
// one-time CVU/alias stays available by hand; settlement is the same either way.
// Rendered instead of the manual "Transferí a: <alias>" block — NEVER next to it:
// the manual alias and this CVU are different bank accounts, and showing both is
// how a client pays the wrong one.
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      /* clipboard unavailable — the value is still selectable */
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary px-3 py-2.5">
      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-widest text-fg-faint">
          {label}
        </p>
        <p className="mt-0.5 select-all break-all font-mono text-sm font-medium text-fg">
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copiar ${label}`}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        {copied ? <CheckIcon size={14} className="text-accent" /> : <CopyIcon size={14} />}
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

export function TaloTransferPanel({
  transfer,
  detected,
}: {
  transfer: TaloTransfer;
  /** Talo already recorded a transfer on its way (booking `awaiting_payment`). */
  detected?: boolean;
}) {
  const { paymentUrl, expiresAt } = transfer;

  if (detected) {
    return (
      <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-3 text-sm text-fg-muted">
        Detectamos tu transferencia. En cuanto se acredite te confirmamos el
        turno acá mismo y por email — no hace falta que hagas nada más.
      </div>
    );
  }

  // Rows from before the page URL was stored have nowhere to send the client.
  if (!paymentUrl) return <ManualTransfer transfer={transfer} />;

  return (
    <div>
      <Button asChild size="lg" className="w-full">
        <a href={paymentUrl}>Continuar el pago</a>
      </Button>
      <p className="mt-2 text-center text-xs text-fg-faint">
        Se abre la página de pago de Talo, con el estado en vivo.
        {expiresAt && (
          <>
            {" "}
            Te guardamos el lugar hasta las{" "}
            <span className="font-mono text-fg-muted">{fmtTime(expiresAt)}</span>.
          </>
        )}
      </p>
      <details className="mt-4 text-sm" open={DEV_MODE}>
        <summary className="cursor-pointer text-fg-muted hover:text-fg">
          Prefiero transferir a mano
        </summary>
        <div className="mt-3">
          <ManualTransfer transfer={transfer} />
        </div>
      </details>
    </div>
  );
}

function ManualTransfer({ transfer }: { transfer: TaloTransfer }) {
  const { cvu, alias, amount, expiresAt } = transfer;

  return (
    <div>
      <p className="text-sm text-fg-muted">
        Transferí{" "}
        <span className="font-mono font-semibold text-fg">
          exactamente {formatARS(amount)}
        </span>{" "}
        desde tu home banking o billetera a esta cuenta. Si transferís otro
        importe el pago queda trabado y lo revisamos a mano.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {alias && <CopyRow label="Alias" value={alias} />}
        {cvu && <CopyRow label="CVU" value={cvu} />}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-fg-faint">
        Se acredita solo, en general en menos de un minuto.
        {expiresAt && (
          <>
            {" "}
            Te guardamos el lugar hasta las{" "}
            <span className="font-mono text-fg-muted">{fmtTime(expiresAt)}</span>.
          </>
        )}
      </p>

      {DEV_MODE && cvu && <DevFakePayment cvu={cvu} />}
    </div>
  );
}

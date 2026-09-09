"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { formatARS } from "@/lib/site";
import { fmtTime } from "@/lib/format";

export type TaloTransfer = {
  cvu: string | null;
  alias: string | null;
  amount: number;
  expiresAt: string | null;
  paymentUrl: string | null;
};

// The one-time CVU/alias a client transfers to. Talo settles it automatically;
// the parent polls for the confirmation. Rendered instead of the manual
// "Transferí a: <alias>" block — NEVER next to it: the manual alias and this CVU
// are different bank accounts, and showing both is how a client pays the wrong one.
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
  const { cvu, alias, amount, expiresAt, paymentUrl } = transfer;

  if (detected) {
    return (
      <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-3 text-sm text-fg-muted">
        Detectamos tu transferencia. En cuanto se acredite te confirmamos el
        turno acá mismo y por email — no hace falta que hagas nada más.
      </div>
    );
  }

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
        {!alias && !cvu && paymentUrl && (
          <a
            href={paymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-accent underline underline-offset-4"
          >
            Ver los datos para transferir
          </a>
        )}
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

      {paymentUrl && (alias || cvu) && (
        <a
          href={paymentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-fg-faint underline underline-offset-4 hover:text-fg-muted"
        >
          Abrir en Talo <ExternalLinkIcon size={12} />
        </a>
      )}
    </div>
  );
}

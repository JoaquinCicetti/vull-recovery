"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConicalIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// DEV_MODE only: asks dev-fake-payment to fund this CVU from Talo's sandbox
// faucet. The confirmation then arrives the real way (Talo webhook → settle),
// picked up by the page's SettlementPoller like any other transfer.
export function DevFakePayment({ cvu }: { cvu: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function fake() {
    setState("sending");
    setError(null);
    const { error } = await createClient().functions.invoke("dev-fake-payment", {
      body: { cvu },
    });
    if (error) {
      let msg = "No se pudo simular el pago";
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.error) msg = body.error;
      } catch {
        /* keep the fallback */
      }
      setError(msg);
      setState("idle");
      return;
    }
    setState("sent");
    router.refresh();
  }

  return (
    <div className="mt-3 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2.5">
      <button
        type="button"
        onClick={fake}
        disabled={state !== "idle"}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 disabled:opacity-60 dark:text-amber-400"
      >
        <FlaskConicalIcon size={14} />
        {state === "sending"
          ? "Simulando…"
          : state === "sent"
            ? "Transferencia simulada — esperando el webhook de Talo"
            : "Simular pago (dev)"}
      </button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

// Fixed corner badge so a dev deployment is never mistaken for production.
export function DevModeBadge() {
  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-50 rounded-md bg-amber-500 px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-widest text-black shadow">
      Dev mode
    </div>
  );
}

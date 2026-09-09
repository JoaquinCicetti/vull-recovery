"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { uploadReceipt as uploadReceiptToStorage } from "@/lib/receipt-upload";
import { formatARS, TRANSFER_ALIAS, TALO_ENABLED } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from "@/components/kibo-ui/dropzone";
import { TaloTransferPanel, type TaloTransfer } from "@/components/talo-transfer-panel";
import { SettlementPoller } from "@/components/settlement-poller";

async function readError(error: unknown, fallback: string): Promise<string> {
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return body.error as string;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

// Two ways to pay, never both on screen at once: the automatic transfer (Talo
// mints a one-time CVU and settles it) and the manual receipt (transfer to the
// centre's own alias, upload the proof, an admin approves). The two targets are
// DIFFERENT bank accounts, so the panel is a mode switch, not a list.
type Mode = "choose" | "talo" | "receipt";

export function PaymentPanel({
  bookingId,
  amount,
  status,
  talo,
}: {
  bookingId: string;
  amount: number;
  status: string;
  /** A CVU already minted for this booking (survives a reload). */
  talo: TaloTransfer | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [receipt, setReceipt] = useState<File[] | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<TaloTransfer | null>(talo);
  const [mode, setMode] = useState<Mode>(
    talo ? "talo" : TALO_ENABLED ? "choose" : "receipt",
  );

  const awaiting = status === "awaiting_payment";

  async function payWithTalo() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("create-payment", {
      body: { booking_id: bookingId, method: "talo" },
    });
    setLoading(false);
    if (error || !data || (!data.cvu && !data.alias && !data.payment_url)) {
      setError(
        error
          ? await readError(error, "No pudimos generar la transferencia. Probá subiendo un comprobante.")
          : "No pudimos generar la transferencia. Probá subiendo un comprobante.",
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
    setMode("talo");
    // The hold was just extended to the payment window; re-render the countdown.
    router.refresh();
  }

  async function uploadReceipt(file: File) {
    setUploading(true);
    setError(null);
    const res = await uploadReceiptToStorage(supabase, {
      file,
      pathPrefix: bookingId,
    });
    if (!res.ok) {
      setUploading(false);
      setError(res.message);
      return;
    }
    const { error: fnErr } = await supabase.functions.invoke("create-payment", {
      body: { booking_id: bookingId, method: "manual", receipt_path: res.path },
    });
    setUploading(false);
    if (fnErr) {
      setError(await readError(fnErr, "No se pudo registrar el comprobante. Probá de nuevo."));
      return;
    }
    router.refresh();
  }

  return (
    <Card className="mt-6 [--card-spacing:--spacing(6)]">
      <CardContent>
        {/* Confirmation arrives asynchronously; keep the page in step. */}
        <SettlementPoller active={mode === "talo" || awaiting} />

        {awaiting && mode !== "talo" && (
          <div className="mb-4 rounded-md border border-border bg-secondary px-3 py-3 text-sm text-fg-muted">
            Si ya pagaste, lo estamos verificando. Te avisamos por WhatsApp
            cuando quede confirmado.
          </div>
        )}

        <p className="font-semibold text-fg">
          Pagar{" "}
          <span className="font-mono text-accent">{formatARS(amount)}</span>
        </p>

        {mode === "choose" && (
          <>
            <Button
              size="lg"
              onClick={payWithTalo}
              disabled={loading || uploading}
              className="mt-4 w-full"
            >
              {loading ? "Generando la transferencia…" : "Pagar por transferencia (se acredita solo)"}
            </Button>
            <p className="mt-2 text-center text-xs text-fg-faint">
              Te damos un alias para transferir. El turno se confirma solo, en
              general en menos de un minuto.
            </p>
            <button
              type="button"
              onClick={() => setMode("receipt")}
              className="mt-4 w-full text-center text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
            >
              Ya transferí a {TRANSFER_ALIAS || "la cuenta del centro"} — subir comprobante
            </button>
          </>
        )}

        {mode === "talo" && transfer && (
          <div className="mt-4">
            <TaloTransferPanel transfer={transfer} detected={awaiting} />
            {!awaiting && (
              <button
                type="button"
                onClick={() => setMode("receipt")}
                className="mt-4 text-sm text-fg-faint underline underline-offset-4 hover:text-fg-muted"
              >
                ¿Preferís transferir a otra cuenta y subir el comprobante?
              </button>
            )}
          </div>
        )}

        {mode === "receipt" && (
          <>
            <p className="mt-4 text-sm font-medium text-fg">
              {TALO_ENABLED ? "Ya transferí — subir comprobante" : "Pagá por transferencia"}
            </p>
            {TRANSFER_ALIAS && (
              <p className="mt-1 text-sm text-fg-muted">
                Transferí a:{" "}
                <span className="font-mono font-medium text-fg">
                  {TRANSFER_ALIAS}
                </span>
              </p>
            )}
            <p className="mt-1 text-xs text-fg-faint">
              Subí el comprobante y lo verificamos a mano. Te confirmamos el turno en
              cuanto lo revisemos.
              {transfer && " Al subirlo, el alias automático deja de estar activo."}
            </p>

            <Dropzone
              className="mt-3"
              accept={{ "image/*": [], "application/pdf": [] }}
              maxFiles={1}
              maxSize={20 * 1024 * 1024}
              disabled={uploading || loading}
              src={receipt}
              onDrop={(files) => {
                const file = files[0];
                if (!file) return;
                setReceipt(files);
                uploadReceipt(file);
              }}
              onError={(e) =>
                setError(
                  /larger|size/i.test(e?.message ?? "")
                    ? "El archivo es muy grande (máximo 20 MB)."
                    : "Ese archivo no se puede subir.",
                )
              }
            >
              <DropzoneEmptyState>
                <div className="flex flex-col items-center justify-center">
                  <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <UploadIcon size={16} />
                  </div>
                  <p className="my-2 text-sm font-medium">Subir comprobante</p>
                  <p className="text-xs font-normal text-muted-foreground">
                    Arrastrá el archivo o tocá para elegirlo (imagen o PDF).
                  </p>
                </div>
              </DropzoneEmptyState>
              <DropzoneContent>
                <div className="flex flex-col items-center justify-center">
                  <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <UploadIcon size={16} />
                  </div>
                  <p className="my-2 w-full truncate text-sm font-medium">
                    {uploading ? "Subiendo…" : receipt?.[0]?.name}
                  </p>
                  <p className="text-xs font-normal text-muted-foreground">
                    {uploading
                      ? "Esperá un momento."
                      : "Tocá para reemplazar el archivo."}
                  </p>
                </div>
              </DropzoneContent>
            </Dropzone>

            {TALO_ENABLED && !awaiting && (
              <button
                type="button"
                onClick={() => setMode(transfer ? "talo" : "choose")}
                className="mt-4 text-sm text-fg-faint underline underline-offset-4 hover:text-fg-muted"
              >
                Volver a la transferencia automática
              </button>
            )}
          </>
        )}

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}

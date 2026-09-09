"use client";

import { useState } from "react";
import Link from "next/link";
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

type Mode = "choose" | "talo" | "receipt";

// Buy a multi-session pack (create-payment with pack_service_id). Mirrors the
// booking PaymentPanel: automatic transfer via Talo OR manual receipt, never
// both targets on screen. On approval the webhook / admin grants the credits.
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
  const [uploading, setUploading] = useState(false);
  const [receipt, setReceipt] = useState<File[] | undefined>();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<(TaloTransfer & { paymentId: string }) | null>(null);
  const [mode, setMode] = useState<Mode>(TALO_ENABLED ? "choose" : "receipt");

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
          ? await readError(error, "No pudimos generar la transferencia. Probá subiendo un comprobante.")
          : "No pudimos generar la transferencia. Probá subiendo un comprobante.",
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
    setMode("talo");
  }

  async function uploadReceipt(file: File) {
    if (!isAuthed) return requireLogin();
    setUploading(true);
    setError(null);
    const res = await uploadReceiptToStorage(supabase, {
      file,
      pathPrefix: `pack-${packId}`,
    });
    if (!res.ok) {
      setUploading(false);
      setError(res.message);
      return;
    }
    const { error: fnErr } = await supabase.functions.invoke("create-payment", {
      body: {
        pack_service_id: packId,
        method: "manual",
        receipt_path: res.path,
      },
    });
    setUploading(false);
    if (fnErr) {
      setError(await readError(fnErr, "No se pudo registrar el comprobante. Probá de nuevo."));
      return;
    }
    setDone(true);
  }

  // Deliberately no "reservar" call to action here: a transfer stays `pending`
  // until an admin approves the receipt, and grant_pack_credits refuses until
  // then — so the credits do not exist yet and a booking link would dead-end.
  if (done) {
    return (
      <Card className="mt-6">
        <CardContent>
          <p className="font-semibold text-fg">¡Comprobante recibido!</p>
          <p className="mt-1 text-sm text-fg-muted">
            Verificamos la transferencia y acreditamos tus sesiones. Te avisamos
            por WhatsApp cuando queden disponibles.
          </p>
          <Link
            href="/mis-turnos"
            className="mt-4 inline-block text-sm font-medium text-accent underline underline-offset-4"
          >
            Ver mis créditos
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6 [--card-spacing:--spacing(6)]">
      <CardContent>
        <p className="font-semibold text-fg">
          Comprar <span className="font-mono text-accent">{formatARS(amount)}</span>
        </p>

        {mode === "choose" && (
          <>
            <Button
              size="lg"
              onClick={payWithTalo}
              disabled={loading || uploading}
              className="mt-4 w-full"
            >
              {loading
                ? "Generando la transferencia…"
                : !isAuthed
                  ? "Ingresar y comprar"
                  : "Pagar por transferencia (se acredita solo)"}
            </Button>
            <p className="mt-2 text-center text-xs text-fg-faint">
              Te damos un alias para transferir. Las sesiones se acreditan solas.
            </p>
            <button
              type="button"
              onClick={() => (isAuthed ? setMode("receipt") : requireLogin())}
              className="mt-4 w-full text-center text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
            >
              Ya transferí a {TRANSFER_ALIAS || "la cuenta del centro"} — subir comprobante
            </button>
          </>
        )}

        {mode === "talo" && transfer && (
          <div className="mt-4">
            <TaloTransferPanel transfer={transfer} />
            <Button asChild variant="outline" size="lg" className="mt-4 w-full">
              <Link href={`/comprar/exito?ref=${transfer.paymentId}`}>
                Ya transferí — ver estado
              </Link>
            </Button>
            <button
              type="button"
              onClick={() => setMode("receipt")}
              className="mt-4 text-sm text-fg-faint underline underline-offset-4 hover:text-fg-muted"
            >
              ¿Preferís transferir a otra cuenta y subir el comprobante?
            </button>
          </div>
        )}

        {mode === "receipt" && (
          <>
            {!isAuthed && (
              <Button size="lg" onClick={requireLogin} className="mt-4 w-full">
                Ingresar y comprar
              </Button>
            )}
            <p className="mt-4 text-sm font-medium text-fg">
              {TALO_ENABLED ? "Ya transferí — subir comprobante" : "Pagá por transferencia"}
            </p>
            {TRANSFER_ALIAS && (
              <p className="mt-1 text-sm text-fg-muted">
                Transferí a:{" "}
                <span className="font-mono font-medium text-fg">{TRANSFER_ALIAS}</span>
              </p>
            )}
            <p className="mt-1 text-xs text-fg-faint">
              Subí el comprobante y lo verificamos a mano.
              {transfer && " Al subirlo, el alias automático deja de estar activo."}
            </p>

            <Dropzone
              className="mt-3"
              accept={{ "image/*": [], "application/pdf": [] }}
              maxFiles={1}
              maxSize={20 * 1024 * 1024}
              disabled={uploading || loading || !isAuthed}
              src={receipt}
              onDrop={(files) => {
                const file = files[0];
                if (!file) return;
                if (!isAuthed) return requireLogin();
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
                    {uploading ? "Esperá un momento." : "Tocá para reemplazar el archivo."}
                  </p>
                </div>
              </DropzoneContent>
            </Dropzone>

            {TALO_ENABLED && (
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

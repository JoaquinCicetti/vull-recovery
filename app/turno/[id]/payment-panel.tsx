"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { uploadReceipt as uploadReceiptToStorage } from "@/lib/receipt-upload";
import { formatARS, TRANSFER_ALIAS } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from "@/components/kibo-ui/dropzone";

export function PaymentPanel({
  bookingId,
  amount,
  status,
}: {
  bookingId: string;
  amount: number;
  status: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [receipt, setReceipt] = useState<File[] | undefined>();
  const [error, setError] = useState<string | null>(null);

  async function payOnline() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("create-payment", {
      body: { booking_id: bookingId, method: "mobbex" },
    });
    if (error || !data?.url) {
      setLoading(false);
      setError("No pudimos iniciar el pago online. Probá con transferencia.");
      return;
    }
    window.location.href = data.url;
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
      setError("No se pudo registrar el comprobante. Probá de nuevo.");
      return;
    }
    router.refresh();
  }

  return (
    <Card className="mt-6 [--card-spacing:--spacing(6)]">
      <CardContent>
        {status === "awaiting_payment" && (
          <div className="mb-4 rounded-md border border-border bg-secondary px-3 py-3 text-sm text-fg-muted">
            Si ya pagaste, lo estamos verificando. Te avisamos por WhatsApp
            cuando quede confirmado.
          </div>
        )}

        <p className="font-semibold text-fg">
          Pagar{" "}
          <span className="font-mono text-accent">{formatARS(amount)}</span>
        </p>

        <Button
          size="lg"
          onClick={payOnline}
          disabled={loading}
          className="mt-4 w-full"
        >
          {loading
            ? "Abriendo el pago…"
            : "Pagar online (tarjeta · transferencia · QR)"}
        </Button>

        <div className="my-5 flex items-center gap-3 font-mono text-xs uppercase tracking-widest text-fg-faint">
          <span className="h-px flex-1 bg-border" />o<span className="h-px flex-1 bg-border" />
        </div>

        <p className="text-sm font-medium text-fg">Pagué por transferencia</p>
        {TRANSFER_ALIAS && (
          <p className="mt-1 text-sm text-fg-muted">
            Transferí a:{" "}
            <span className="font-mono font-medium text-fg">
              {TRANSFER_ALIAS}
            </span>
          </p>
        )}
        <p className="mt-1 text-xs text-fg-faint">
          Subí el comprobante y lo verificamos a mano.
        </p>

        <Dropzone
          className="mt-3"
          accept={{ "image/*": [], "application/pdf": [] }}
          maxFiles={1}
          maxSize={20 * 1024 * 1024}
          disabled={uploading}
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

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}

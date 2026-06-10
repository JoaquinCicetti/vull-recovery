"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatARS, TRANSFER_ALIAS } from "@/lib/site";

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

  async function uploadReceipt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploading(false);
      setError("Tu sesión expiró. Ingresá de nuevo.");
      return;
    }
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/${bookingId}-${Date.now()}.${ext}`;
    const up = await supabase.storage.from("receipts").upload(path, file);
    if (up.error) {
      setUploading(false);
      setError("No se pudo subir el comprobante.");
      return;
    }
    const { error: fnErr } = await supabase.functions.invoke("create-payment", {
      body: { booking_id: bookingId, method: "manual", receipt_path: path },
    });
    setUploading(false);
    if (fnErr) {
      setError("No se pudo registrar el comprobante.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="surface-card mt-6 p-6">
      {status === "awaiting_payment" && (
        <div className="mb-4 rounded-md border border-border bg-surface-2 px-3 py-3 text-sm text-fg-muted">
          Si ya pagaste, lo estamos verificando. Te avisamos por WhatsApp cuando
          quede confirmado.
        </div>
      )}

      <p className="font-semibold text-fg">
        Pagar{" "}
        <span className="font-mono text-accent">{formatARS(amount)}</span>
      </p>

      <button
        onClick={payOnline}
        disabled={loading}
        className="btn-primary mt-4 w-full py-3"
      >
        {loading
          ? "Abriendo el pago…"
          : "Pagar online (tarjeta · transferencia · QR)"}
      </button>

      <div className="my-5 flex items-center gap-3 font-mono text-xs uppercase tracking-widest text-fg-faint">
        <span className="h-px flex-1 bg-border" />o<span className="h-px flex-1 bg-border" />
      </div>

      <p className="text-sm font-medium text-fg">Pagué por transferencia</p>
      {TRANSFER_ALIAS && (
        <p className="mt-1 text-sm text-fg-muted">
          Transferí a:{" "}
          <span className="font-mono font-medium text-fg">{TRANSFER_ALIAS}</span>
        </p>
      )}
      <p className="mt-1 text-xs text-fg-faint">
        Subí el comprobante y lo verificamos a mano.
      </p>

      <label className="mt-3 inline-flex cursor-pointer items-center rounded-md border border-border px-4 py-2.5 text-sm font-semibold text-fg transition-colors duration-150 hover:border-border-strong hover:bg-surface-2">
        {uploading ? "Subiendo…" : "Subir comprobante"}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          disabled={uploading}
          onChange={uploadReceipt}
        />
      </label>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";

// Receipt (comprobante) normalization + upload for the manual bank-transfer flow.
//
// The backend only accepts png/jpg/webp/pdf (create-payment `RECEIPT_EXT`) and the
// admin verification screen renders the file in the browser — so HEIC/HEIF (the
// default iPhone photo format) can't be stored as-is. We re-encode any non-web image
// to JPEG in the browser before upload; PDFs and already-web images pass through.

// Types the backend accepts and a browser can display, mapped to their extension.
const PASSTHROUGH: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export class ReceiptDecodeError extends Error {}

// Normalize a picked receipt to a web format the backend accepts. iPhone HEIC/HEIF
// (and any other/unknown image type) is re-encoded to JPEG via canvas — iOS Safari,
// where these files originate, can decode them. Throws ReceiptDecodeError when the
// browser cannot decode the image (e.g. a .heic on desktop Chrome).
export async function prepareReceipt(
  file: File,
): Promise<{ blob: Blob; ext: string; contentType: string }> {
  const passthroughExt = PASSTHROUGH[file.type];
  if (passthroughExt) {
    return { blob: file, ext: passthroughExt, contentType: file.type };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ReceiptDecodeError("No se pudo decodificar la imagen.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new ReceiptDecodeError("No se pudo procesar la imagen.");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!blob) throw new ReceiptDecodeError("No se pudo procesar la imagen.");
  return { blob, ext: "jpg", contentType: "image/jpeg" };
}

export type UploadReceiptResult =
  | { ok: true; path: string }
  | {
      ok: false;
      reason: "auth" | "decode" | "bucket" | "storage";
      message: string;
    };

// Prepare + upload a receipt into the caller's own folder in the private `receipts`
// bucket (path convention: `<user_id>/<prefix>-<timestamp>.<ext>`). Returns a typed
// result so the UI can show a precise message and the real storage error is logged.
export async function uploadReceipt(
  supabase: SupabaseClient,
  { file, pathPrefix }: { file: File; pathPrefix: string },
): Promise<UploadReceiptResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      reason: "auth",
      message: "Tu sesión expiró. Ingresá de nuevo.",
    };
  }

  let prepared: { blob: Blob; ext: string; contentType: string };
  try {
    prepared = await prepareReceipt(file);
  } catch {
    return {
      ok: false,
      reason: "decode",
      message:
        "No pudimos procesar esa imagen. Probá sacar una captura de pantalla o subirla como JPG o PDF.",
    };
  }

  const path = `${user.id}/${pathPrefix}-${Date.now()}.${prepared.ext}`;
  const { error } = await supabase.storage
    .from("receipts")
    .upload(path, prepared.blob, { contentType: prepared.contentType });

  if (error) {
    console.error("receipt upload failed:", error);
    const missingBucket = /bucket.*not.*found/i.test(error.message);
    return {
      ok: false,
      reason: missingBucket ? "bucket" : "storage",
      message: missingBucket
        ? "El sistema de pagos no está configurado. Avisanos por WhatsApp."
        : "No se pudo subir el comprobante. Probá de nuevo.",
    };
  }

  return { ok: true, path };
}

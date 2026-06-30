// Server-to-server verification of a Mobbex operation.
//
// Mobbex sends NO signature/HMAC on its IPN (confirmed against mobbex.dev), so
// the webhook body alone cannot be trusted to confirm a payment. When the API
// credentials are present we re-query Mobbex for the authoritative status of our
// own `reference` (== booking id). This is the real guarantee that a booking was
// actually paid; the webhook's shared `token` is only a first gate.
//
// Endpoint: GET https://api.mobbex.com/p/operations/{uid}  (a `ref\<reference>`
// identifier looks the operation up by the reference we sent at checkout time;
// this replaced the legacy /2.0/transactions/details endpoint). Auth via the
// same x-api-key / x-access-token used to create the checkout.
//
// NOTE: the operations response schema is not fully published by Mobbex — the
// parser below reads the status code/total defensively and, when it cannot get a
// clean answer, the caller falls back to the (now token-gated) IPN body. Validate
// this path against a Mobbex sandbox payment before relying on it in production.

const API_BASE = "https://api.mobbex.com";

export type OperationLookup =
  | { ok: true; code: number; total: number | null }
  | { ok: false };

// deno-lint-ignore no-explicit-any
function pickOperation(body: any): any | null {
  if (!body) return null;
  const d = body.data ?? body;
  if (Array.isArray(d)) {
    // Prefer an approved operation; otherwise the most recent entry.
    // deno-lint-ignore no-explicit-any
    return d.find((o: any) => Number(o?.status?.code) === 200) ?? d[d.length - 1] ?? null;
  }
  return d ?? null;
}

export async function getOperationByReference(
  reference: string,
): Promise<OperationLookup> {
  const apiKey = Deno.env.get("MOBBEX_API_KEY");
  const accessToken = Deno.env.get("MOBBEX_ACCESS_TOKEN");
  if (!apiKey || !accessToken) return { ok: false };

  const id = encodeURIComponent(`ref\\${reference}`);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/p/operations/${id}`, {
      headers: { "x-api-key": apiKey, "x-access-token": accessToken },
    });
  } catch {
    return { ok: false };
  }
  if (!res.ok) return { ok: false };

  const body = await res.json().catch(() => null);
  const op = pickOperation(body);
  if (!op) return { ok: false };

  const code = Number(op.status?.code ?? op.payment?.status?.code);
  if (Number.isNaN(code)) return { ok: false };
  const totalRaw = Number(op.total ?? op.payment?.total);
  return { ok: true, code, total: Number.isNaN(totalRaw) ? null : totalRaw };
}

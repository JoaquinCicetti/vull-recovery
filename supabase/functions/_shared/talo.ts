// Server-to-server client for Talo (talo.com.ar) bank-transfer payments.
//
// Talo sends NO signature on its webhook, and the webhook body carries no status
// and no amount — by design ("enviamos el mínimo necesario"). So the webhook is a
// TRIGGER only and every fact about money comes from GET /payments/{id} with a
// Bearer token. Nothing in here ever throws into a money path: every export
// returns a discriminated result and the caller decides, exactly like the
// OperationLookup shape in ./mobbex.ts.
//
// Docs: https://docs.talo.com.ar/transfers/payments-api
//
// UNVERIFIED ASSUMPTIONS (see docs/adr/0010-payments-talo-transfers.md). Each is
// handled defensively here rather than assumed:
//   - whether POST /payments/ needs the Bearer (one doc page says required,
//     another implies public) -> we always send it;
//   - the field that carries the amount actually RECEIVED (vs. the amount we
//     requested) -> parseReceived() reads several shapes and returns null rather
//     than guess. null MUST be treated as "unverified", never as "matches";
//   - the token's TTL -> read from the JWT's own `exp`, with a short fallback.

const PROD = "https://api.talo.com.ar";
const SANDBOX = "https://sandbox-api.talo.com.ar";

export function taloBase(): string {
  return (Deno.env.get("TALO_TEST") ?? "false") === "true" ? SANDBOX : PROD;
}

export function taloUserId(): string {
  return Deno.env.get("TALO_USER_ID") ?? "";
}

export function taloConfigured(): boolean {
  return Boolean(
    Deno.env.get("TALO_USER_ID") &&
      Deno.env.get("TALO_CLIENT_ID") &&
      Deno.env.get("TALO_CLIENT_SECRET"),
  );
}

// ── Token cache ─────────────────────────────────────────────────────────────
// Edge workers are per-region Deno isolates, single-threaded and reused across
// requests, so module state is isolate-local: no data races, but N isolates hold
// N tokens. That is fine as long as we NEVER fail open — an unusable token makes
// verification fail, and a failed verification leaves the payment `pending`.

type CachedToken = { token: string; expiresAtMs: number };
let cachedToken: CachedToken | null = null;
let inFlight: Promise<CachedToken | null> | null = null;

function b64urlDecode(seg: string): string | null {
  try {
    const pad = seg.length % 4 === 0 ? "" : "=".repeat(4 - (seg.length % 4));
    return atob(seg.replace(/-/g, "+").replace(/_/g, "/") + pad);
  } catch {
    return null;
  }
}

// Read `exp` out of the TL- prefixed JWT. We are scheduling a refresh, not
// authenticating anyone, so the signature is deliberately not checked.
function jwtExpMs(token: string): number | null {
  const raw = token.startsWith("TL-") ? token.slice(3) : token;
  const parts = raw.split(".");
  if (parts.length < 2) return null;
  const json = b64urlDecode(parts[1]);
  if (!json) return null;
  try {
    const exp = JSON.parse(json)?.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

async function fetchToken(): Promise<CachedToken | null> {
  const userId = taloUserId();
  const clientId = Deno.env.get("TALO_CLIENT_ID");
  const clientSecret = Deno.env.get("TALO_CLIENT_SECRET");
  if (!userId || !clientId || !clientSecret) return null;

  let res: Response;
  try {
    res = await fetch(
      `${taloBase()}/users/${encodeURIComponent(userId)}/tokens`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
      },
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const body = await res.json().catch(() => null);
  const token = body?.token ?? body?.data?.token;
  if (typeof token !== "string" || !token) return null;

  const exp = jwtExpMs(token);
  // 60s of clock skew, or a deliberately short fallback when `exp` is absent.
  const expiresAtMs = exp ? exp - 60_000 : Date.now() + 5 * 60_000;
  return { token, expiresAtMs };
}

/** Cached Bearer token. `force` discards the cache (used once after a 401). */
export async function taloToken(force = false): Promise<string | null> {
  if (force) {
    cachedToken = null;
    inFlight = null;
  } else if (cachedToken && cachedToken.expiresAtMs > Date.now()) {
    return cachedToken.token;
  }
  // Cache the in-flight PROMISE, not a boolean lock: concurrent callers in the
  // same isolate then await one request instead of stampeding the token endpoint.
  if (!inFlight) {
    const p = fetchToken();
    inFlight = p;
    p.finally(() => {
      if (inFlight === p) inFlight = null;
    });
  }
  const got = await inFlight;
  if (got) cachedToken = got;
  return got?.token ?? null;
}

/** Run an authenticated request, retrying EXACTLY once on 401/403 with a fresh
 *  token (some gateways answer 403 for an expired credential). */
async function withAuth(
  run: (token: string) => Promise<Response>,
): Promise<Response | null> {
  const token = await taloToken();
  if (!token) return null;
  let res: Response | null = await run(token).catch(() => null);
  if (res && (res.status === 401 || res.status === 403)) {
    const fresh = await taloToken(true);
    if (!fresh) return null;
    res = await run(fresh).catch(() => null);
  }
  return res;
}

// ── Types ───────────────────────────────────────────────────────────────────

export type TaloResult<T> = { ok: true; data: T } | { ok: false; reason: string };

export type TaloPaymentStatus =
  | "PENDING"
  | "SUCCESS"
  | "OVERPAID"
  | "UNDERPAID"
  | "EXPIRED";

export type TaloPayment = {
  id: string;
  status: string;
  /** The amount WE asked for. Equal to payments.amount_ars by construction, so
   *  it proves nothing about whether the client paid. */
  requested: number | null;
  /** The amount that actually ARRIVED, net of refunds. `null` means we could not
   *  read it — the caller must treat that as unverified, never as a match. */
  received: number | null;
  currency: string | null;
  externalId: string | null;
  userId: string | null;
  txCount: number;
  refunded: boolean;
  expiresAt: string | null;
};

export type TaloCreated = {
  id: string;
  paymentUrl: string | null;
  cvu: string | null;
  alias: string | null;
  expiresAt: string | null;
};

// ── Parsing ─────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function num(...candidates: any[]): number | null {
  for (const c of candidates) {
    if (c === null || c === undefined || c === "") continue;
    const n = typeof c === "number" ? c : Number(String(c));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

// The transaction schema is not published. Read it across the shapes Talo's own
// examples use and REFUSE to guess: an unknown shape returns null, which the
// caller turns into "unverified + admin alert" rather than an approval.
// deno-lint-ignore no-explicit-any
function parseReceived(data: any): number | null {
  const direct = num(
    data?.received_amount,
    data?.paid_amount,
    data?.settled_amount,
    data?.total_paid,
  );
  if (direct !== null) return direct;

  const txs = data?.transactions;
  if (!Array.isArray(txs)) return null;
  if (txs.length === 0) return 0;

  let total = 0;
  for (const t of txs) {
    const amt = num(t?.amount, t?.value, t?.price?.amount, t?.amount_ars);
    if (amt === null) return null; // unknown shape → do not guess
    const dir = String(t?.direction ?? t?.type ?? "").toUpperCase();
    const outbound = t?.is_refund === true || dir === "OUTBOUND";
    total += outbound ? -amt : amt;
  }
  return total;
}

// deno-lint-ignore no-explicit-any
function parsePayment(body: any): TaloPayment | null {
  const d = body?.data ?? body;
  const id = d?.id ?? d?.payment_id;
  if (typeof id !== "string" || !id) return null;
  const txs = Array.isArray(d?.transactions) ? d.transactions : [];
  return {
    id,
    status: String(d?.payment_status ?? d?.status ?? ""),
    requested: num(d?.price?.amount, d?.amount),
    received: parseReceived(d),
    currency: d?.price?.currency ? String(d.price.currency) : null,
    externalId: d?.external_id ? String(d.external_id) : null,
    userId: d?.user_id ? String(d.user_id) : null,
    txCount: txs.length,
    refunded: Array.isArray(d?.refunds) && d.refunds.length > 0,
    expiresAt: d?.expiration_timestamp ? String(d.expiration_timestamp) : null,
  };
}

// ── API ─────────────────────────────────────────────────────────────────────

/** Create a transfer payment: mints a one-time CVU + alias. */
export async function createTaloPayment(opts: {
  amount: number;
  externalId: string;
  motive: string;
  webhookUrl: string;
  redirectUrl: string;
  expiresAt?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}): Promise<TaloResult<TaloCreated>> {
  if (!taloConfigured()) return { ok: false, reason: "unconfigured" };

  const client_data: Record<string, string> = {};
  if (opts.email) client_data.email = opts.email;
  if (opts.firstName) client_data.first_name = opts.firstName;
  if (opts.lastName) client_data.last_name = opts.lastName;

  const payload: Record<string, unknown> = {
    user_id: taloUserId(),
    price: { amount: opts.amount, currency: "ARS" },
    payment_options: ["transfer"],
    external_id: opts.externalId,
    webhook_url: opts.webhookUrl,
    redirect_url: opts.redirectUrl,
    motive: opts.motive,
  };
  if (opts.expiresAt) payload.expiration_timestamp = opts.expiresAt;
  if (Object.keys(client_data).length) payload.client_data = client_data;

  // The docs disagree on whether this endpoint is authenticated. Sending the
  // Bearer is correct in both worlds.
  const res = await withAuth((token) =>
    fetch(`${taloBase()}/payments/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
  );
  if (!res) return { ok: false, reason: "unreachable" };
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };

  const d = body?.data ?? body;
  const id = d?.id;
  if (typeof id !== "string" || !id) return { ok: false, reason: "no_id" };
  const quote = Array.isArray(d?.quotes) ? d.quotes[0] : null;
  return {
    ok: true,
    data: {
      id,
      paymentUrl: d?.payment_url ? String(d.payment_url) : null,
      cvu: quote?.cvu ? String(quote.cvu) : null,
      alias: quote?.alias ? String(quote.alias) : null,
      expiresAt: d?.expiration_timestamp ? String(d.expiration_timestamp) : null,
    },
  };
}

/** The ONLY source of truth about a payment. Never trust a webhook body. */
export async function getTaloPayment(
  paymentId: string,
): Promise<TaloResult<TaloPayment>> {
  if (!taloConfigured()) return { ok: false, reason: "unconfigured" };
  const res = await withAuth((token) =>
    fetch(`${taloBase()}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  );
  if (!res) return { ok: false, reason: "unreachable" };
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  const parsed = parsePayment(await res.json().catch(() => null));
  return parsed ? { ok: true, data: parsed } : { ok: false, reason: "unparsable" };
}

/** Move a payment's expiry. Used to kill a CVU the moment its turno goes
 *  terminal or its payment is superseded — otherwise a cancelled turno leaves a
 *  live CVU that can still take the client's money. */
export async function setTaloExpiration(
  paymentId: string,
  isoTimestamp: string,
): Promise<TaloResult<true>> {
  if (!taloConfigured()) return { ok: false, reason: "unconfigured" };
  const res = await withAuth((token) =>
    fetch(`${taloBase()}/payments/${encodeURIComponent(paymentId)}/expiration`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ expiration_timestamp: isoTimestamp }),
    })
  );
  if (!res) return { ok: false, reason: "unreachable" };
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  return { ok: true, data: true };
}

/** Re-price a live payment. Must be done together with payments.amount_ars or
 *  the settle-time amount check compares against a stale number. */
export async function setTaloPrice(
  paymentId: string,
  amount: number,
): Promise<TaloResult<true>> {
  if (!taloConfigured()) return { ok: false, reason: "unconfigured" };
  const res = await withAuth((token) =>
    fetch(`${taloBase()}/payments/${encodeURIComponent(paymentId)}/price`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currency: "ARS", amount }),
    })
  );
  if (!res) return { ok: false, reason: "unreachable" };
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  return { ok: true, data: true };
}

/** Talo payment ids look like "VAR-<uuid>-<suffix>". Validated before any DB or
 *  network work so a forged webhook flood costs nothing. */
export const TALO_PAYMENT_ID_RE = /^VAR-[A-Za-z0-9._-]{1,64}$/;

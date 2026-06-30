// CORS policy.
//
// Browser-facing functions (availability, create-booking, create-payment,
// admin-payment, cancel-booking) use responder(req): it echoes the request
// Origin back ONLY when it is in the allow-list (APP_URL + CORS_EXTRA_ORIGINS +
// localhost), instead of the old wildcard "*". A disallowed origin gets no
// Access-Control-Allow-Origin and the browser blocks the response.
//
// Server-to-server callers (mobbex/whatsapp webhooks, keep-alive, cron) use the
// plain json() below, which emits no ACAO at all — browsers never call them.

const STATIC_ALLOWED = ["http://localhost:3000", "http://127.0.0.1:3000"];

function allowList(): string[] {
  const out = [...STATIC_ALLOWED];
  const app = Deno.env.get("APP_URL");
  if (app) out.push(app.replace(/\/+$/, ""));
  const extra = Deno.env.get("CORS_EXTRA_ORIGINS"); // comma-separated
  if (extra) {
    out.push(
      ...extra
        .split(",")
        .map((s) => s.trim().replace(/\/+$/, ""))
        .filter(Boolean),
    );
  }
  return out;
}

const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";
const ALLOW_METHODS = "POST, GET, OPTIONS";

export function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    Vary: "Origin",
  };
  const origin = req.headers.get("Origin");
  if (origin && allowList().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// Request-scoped responder with allow-listed CORS, for browser-facing functions.
export function responder(req: Request) {
  const cors = corsHeaders(req);
  return {
    options: () => new Response("ok", { headers: cors }),
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      }),
  };
}

// Server-to-server JSON response: no Access-Control-Allow-Origin (webhooks/cron).
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Minimal Google Calendar access via a service account (no deps).
// If GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY / GOOGLE_CALENDAR_ID are unset,
// all helpers no-op so the system still works (DB bookings drive availability).

type ServiceAccount = { client_email: string; private_key: string };

const CAL_SCOPE = "https://www.googleapis.com/auth/calendar";

function loadSA(): ServiceAccount | null {
  // Only the two fields the JWT signer needs — no full service-account JSON.
  const client_email = Deno.env.get("GOOGLE_CLIENT_EMAIL");
  const private_key = Deno.env.get("GOOGLE_PRIVATE_KEY");
  if (!client_email || !private_key) return null;
  return {
    client_email,
    // Env stores the PEM with literal "\n"; restore real newlines.
    private_key: private_key.replace(/\\n/g, "\n"),
  };
}

export function calendarId(): string | null {
  return Deno.env.get("GOOGLE_CALENDAR_ID") ?? null;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(data: ArrayBuffer | string): string {
  let bin: string;
  if (typeof data === "string") {
    bin = data;
  } else {
    bin = "";
    for (const b of new Uint8Array(data)) bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Token cache ─────────────────────────────────────────────────────────────
// Minting a token means an RSA signature + a round trip to Google (~300–500 ms).
// create-booking used to do it twice per request and availability once per grid
// load. Tokens live 1 h; cache per isolate (module state, single-threaded, reused
// across requests — see _shared/talo.ts for the same pattern) and refresh a minute
// early. A failed mint is never cached, so we can't fail open on a bad token.
type CachedToken = { token: string; expiresAtMs: number };
let cachedToken: CachedToken | null = null;
let inFlight: Promise<CachedToken> | null = null;
const TOKEN_SKEW_MS = 60_000;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - TOKEN_SKEW_MS > now) {
    return cachedToken.token;
  }
  if (!inFlight) {
    inFlight = mintAccessToken(sa).finally(() => {
      inFlight = null;
    });
  }
  const fresh = await inFlight;
  cachedToken = fresh;
  return fresh.token;
}

async function mintAccessToken(sa: ServiceAccount): Promise<CachedToken> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: CAL_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const ttlSec = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return { token: data.access_token as string, expiresAtMs: Date.now() + ttlSec * 1000 };
}

// `cal` is the sector's calendar (see sectorCalendarId); null = the sector has
// none, so there is nothing busy outside the DB.
export async function getBusy(
  timeMin: string,
  timeMax: string,
  cal: string | null = calendarId(),
): Promise<{ start: string; end: string }[]> {
  const sa = loadSA();
  if (!sa || !cal) return [];
  const token = await getAccessToken(sa);
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: cal }] }),
  });
  if (!res.ok) throw new Error(`freeBusy error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.calendars?.[cal]?.busy ?? [];
}

// deno-lint-ignore no-explicit-any
type CalEvent = any;

// Incremental events list. Pass a syncToken for a delta since the last run
// (bootstrap without one over a forward window). Returns expired=true on a 410
// (the syncToken is stale → caller should clear it and re-bootstrap).
export async function listEvents(opts: {
  syncToken?: string;
  timeMin?: string;
}): Promise<{ items: CalEvent[]; nextSyncToken: string | null; expired: boolean }> {
  const sa = loadSA();
  const cal = calendarId();
  if (!sa || !cal) return { items: [], nextSyncToken: null, expired: false };
  const token = await getAccessToken(sa);
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events`;

  let items: CalEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  do {
    const params = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "true",
      maxResults: "250",
    });
    if (opts.syncToken) params.set("syncToken", opts.syncToken);
    else if (opts.timeMin) params.set("timeMin", opts.timeMin);
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${base}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 410) return { items: [], nextSyncToken: null, expired: true };
    if (!res.ok) throw new Error(`listEvents ${res.status}: ${await res.text()}`);
    const data = await res.json();
    items = items.concat(data.items ?? []);
    pageToken = data.nextPageToken;
    nextSyncToken = data.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  return { items, nextSyncToken, expired: false };
}

export async function createEvent(opts: {
  summary: string;
  description?: string;
  start: string;
  end: string;
  status?: "tentative" | "confirmed";
  /** The sector's calendar; null = none (no event). Defaults to the env one. */
  calendar?: string | null;
}): Promise<string | null> {
  const sa = loadSA();
  const cal = opts.calendar === undefined ? calendarId() : opts.calendar;
  if (!sa || !cal) return null;
  const token = await getAccessToken(sa);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: opts.summary,
        description: opts.description,
        start: { dateTime: opts.start },
        end: { dateTime: opts.end },
        status: opts.status ?? "tentative",
      }),
    },
  );
  if (!res.ok) throw new Error(`createEvent error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}

export async function patchEventStatus(
  eventId: string,
  status: "tentative" | "confirmed" | "cancelled",
): Promise<void> {
  const sa = loadSA();
  const cal = calendarId();
  if (!sa || !cal) return;
  const token = await getAccessToken(sa);
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events/${eventId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
}

// Move an event's time (used when a booking is rescheduled). Best-effort no-op
// when Google isn't configured.
export async function patchEventTime(
  eventId: string,
  start: string,
  end: string,
): Promise<void> {
  const sa = loadSA();
  const cal = calendarId();
  if (!sa || !cal) return;
  const token = await getAccessToken(sa);
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events/${eventId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ start: { dateTime: start }, end: { dateTime: end } }),
    },
  );
}

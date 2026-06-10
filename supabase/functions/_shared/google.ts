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

function calendarId(): string | null {
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

async function getAccessToken(sa: ServiceAccount): Promise<string> {
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
  return data.access_token as string;
}

export async function getBusy(
  timeMin: string,
  timeMax: string,
): Promise<{ start: string; end: string }[]> {
  const sa = loadSA();
  const cal = calendarId();
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

export async function createEvent(opts: {
  summary: string;
  description?: string;
  start: string;
  end: string;
  status?: "tentative" | "confirmed";
}): Promise<string | null> {
  const sa = loadSA();
  const cal = calendarId();
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

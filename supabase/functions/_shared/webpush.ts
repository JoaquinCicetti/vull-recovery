// Web Push (RFC 8291 aes128gcm payload + RFC 8292 VAPID) with no npm dependency —
// pure WebCrypto, the same hand-rolled approach as google.ts. Free (standard Web
// Push needs no FCM billing). No-ops when VAPID_* env is unset.
//
// Env: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (base64url; from `web-push
// generate-vapid-keys`) + VAPID_SUBJECT ("mailto:owner@vull.com.ar").
//
// ⚠️ This crypto path can only be fully verified against a REAL push
// subscription (browser/device). Validate early against one live subscription
// before relying on it in production; a subtle bug is silent non-delivery.

function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const bin = atob(s + "=".repeat(pad));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function vapidConfigured(): boolean {
  return Boolean(
    Deno.env.get("VAPID_PUBLIC_KEY") &&
      Deno.env.get("VAPID_PRIVATE_KEY") &&
      Deno.env.get("VAPID_SUBJECT"),
  );
}

// VAPID `Authorization: vapid t=<ES256 JWT>, k=<public key>` for the endpoint origin.
async function vapidAuthHeader(endpoint: string): Promise<string> {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY")!;
  const priv = Deno.env.get("VAPID_PRIVATE_KEY")!;
  const sub = Deno.env.get("VAPID_SUBJECT")!;
  const url = new URL(endpoint);
  const enc = (o: unknown) =>
    bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({
    aud: `${url.protocol}//${url.host}`,
    exp: now + 12 * 3600,
    sub,
  })}`;

  const pubBytes = b64urlToBytes(pub); // 0x04 || X(32) || Y(32)
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: priv.replace(/=+$/, ""),
    x: bytesToB64url(pubBytes.slice(1, 33)),
    y: bytesToB64url(pubBytes.slice(33, 65)),
    ext: true,
  };
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `vapid t=${signingInput}.${bytesToB64url(sig)}, k=${pub}`;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  len: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    len * 8,
  );
  return new Uint8Array(bits);
}

async function encryptPayload(
  payload: string,
  p256dh: string,
  authSecretB64: string,
): Promise<Uint8Array> {
  const uaPub = b64urlToBytes(p256dh); // 65
  const authSecret = b64urlToBytes(authSecretB64); // 16
  const as = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey)); // 65
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPub,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256),
  );
  const te = new TextEncoder();
  // RFC 8291: IKM = HKDF(auth, ecdh, "WebPush: info\0"|ua|as, 32)
  const ikm = await hkdf(
    authSecret,
    ecdh,
    concat(te.encode("WebPush: info\0"), uaPub, asPub),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const plain = concat(te.encode(payload), new Uint8Array([0x02])); // single-record delimiter
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, plain),
  );
  // aes128gcm header: salt(16) | rs(4, BE) | idlen(1)=65 | as_public(65)
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = 65;
  header.set(asPub, 21);
  return concat(header, ct);
}

export type PushSub = { endpoint: string; p256dh: string; auth: string };

// Returns the HTTP status (0 when VAPID is unconfigured). 404/410 mean the
// subscription is gone and the caller should delete it.
export async function sendPush(sub: PushSub, payload: string): Promise<number> {
  if (!vapidConfigured()) return 0;
  const [auth, body] = await Promise.all([
    vapidAuthHeader(sub.endpoint),
    encryptPayload(payload, sub.p256dh, sub.auth),
  ]);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Authorization: auth,
    },
    body,
  });
  return res.status;
}

// Centralized site/brand config.
export const SITE_NAME = "VULL";

// Resolve the app's base URL, preferring explicit env over the request origin.
// NEXT_PUBLIC_SITE_URL   -> set per-env in Vercel (production custom domain)
// NEXT_PUBLIC_VERCEL_URL -> auto-injected per deployment (covers previews)
// Used for OAuth redirects so they don't fall back to Supabase's Site URL.
export function getURL(path = "") {
  let url =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    "http://localhost:3000";
  url = url.startsWith("http") ? url : `https://${url}`;
  url = url.replace(/\/+$/, ""); // strip trailing slash
  return `${url}${path}`;
}
export const SITE_TAGLINE =
  "Recuperación deportiva. Entrenás al límite, recuperá igual.";

// Public contact details (footer, emails). The phone is the owner's number for
// "turnos y consultas". Mirrored for the edge functions in
// supabase/functions/_shared/site.ts. Change one, change both.
export const CONTACT_PHONE_DISPLAY = "3412 10-2151";
export const CONTACT_WHATSAPP_NUMBER = "5493412102151"; // +54 9 341 210-2151, wa.me format
export const ADDRESS_LINE = "Montevideo 40 | Complejo Loyal";
export const INSTAGRAM_HANDLE = "@vull.recovery";
export const INSTAGRAM_URL = "https://instagram.com/vull.recovery";

// Business WhatsApp number, international format without "+", e.g. 5491122334455.
// The env var still overrides; `||` (not `??`) so the blank
// NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER= in .env.example falls back too.
export const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER || CONTACT_WHATSAPP_NUMBER;

// Alias/CBU shown to clients paying by manual bank transfer.
export const TRANSFER_ALIAS = process.env.NEXT_PUBLIC_TRANSFER_ALIAS ?? "";

// Automatic bank transfers via Talo (talo.com.ar). While this is false the
// "se acredita solo" option is hidden entirely rather than shown and failing:
// `create-payment` answers 503 "Pagos online no configurados" without the
// TALO_* edge secrets, so the button would be a dead primary call to action.
// Manual transfer + receipt stays the fallback either way. Flip
// NEXT_PUBLIC_TALO_ENABLED=true once the TALO_* secrets are set (sandbox first:
// TALO_TEST=true). See docs/adr/0010-payments-talo-transfers.md.
export const TALO_ENABLED = process.env.NEXT_PUBLIC_TALO_ENABLED === "true";

// Dev mode: shows a "DEV" badge and a "Simular pago" button on Talo transfers
// (calls the dev-fake-payment function, which itself requires the DEV_MODE
// edge secret + Talo sandbox). Must be false in production.
export const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE === "true";

// Legacy Mobbex switch. Never enabled in production; Talo replaced it. Kept
// only until the Mobbex code is deleted.
export const MOBBEX_ENABLED = process.env.NEXT_PUBLIC_MOBBEX_ENABLED === "true";

// Build a wa.me deep link. The client tapping this messages us FIRST, which
// opens the free 24h reply window (see plan). Optional prefilled message.
export function waLink(message?: string) {
  if (!WHATSAPP_NUMBER) return "#";
  const url = `https://wa.me/${WHATSAPP_NUMBER}`;
  return message ? `${url}?text=${encodeURIComponent(message)}` : url;
}

// A wa.me link to a CLIENT's number (admin → client), or null when the number
// is unusable. Unlike waLink, this opens a chat with them, not with us.
export function clientWaLink(phone: string | null | undefined, message?: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const url = `https://wa.me/${digits}`;
  return message ? `${url}?text=${encodeURIComponent(message)}` : url;
}

export function formatARS(amount: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

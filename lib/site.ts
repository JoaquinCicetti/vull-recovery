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

// Business WhatsApp number, international format without "+", e.g. 5491122334455.
export const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER ?? "";

// Alias/CBU shown to clients paying by manual bank transfer.
export const TRANSFER_ALIAS = process.env.NEXT_PUBLIC_TRANSFER_ALIAS ?? "";

// Build a wa.me deep link. The client tapping this messages us FIRST, which
// opens the free 24h reply window (see plan). Optional prefilled message.
export function waLink(message?: string) {
  if (!WHATSAPP_NUMBER) return "#";
  const url = `https://wa.me/${WHATSAPP_NUMBER}`;
  return message ? `${url}?text=${encodeURIComponent(message)}` : url;
}

export function formatARS(amount: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

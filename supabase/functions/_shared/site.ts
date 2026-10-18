// Deno mirror of the contact constants in lib/site.ts (footer of every email
// built by _shared/email.ts shell()). Next.js and Deno cannot share a module, so
// this is a deliberate duplicate. Change one, change both.
export const CONTACT_PHONE_DISPLAY = "3412 10-2151";
export const CONTACT_WHATSAPP_NUMBER = "5493412102151"; // +54 9 341 210-2151, wa.me format
export const ADDRESS_LINE = "Montevideo 40 | Complejo Loyal";
export const INSTAGRAM_HANDLE = "@vull.recovery";
export const INSTAGRAM_URL = "https://instagram.com/vull.recovery";

/** wa.me link to the business number. */
export function waUrl(n: string = CONTACT_WHATSAPP_NUMBER): string {
  return `https://wa.me/${n}`;
}

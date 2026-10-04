// Browser-side mirror of supabase/functions/_shared/booking-status.ts.
//
// Next.js and the Deno edge functions cannot share a module, so this file is a
// deliberate duplicate of the canonical set documented in
// docs/booking-invariants.md. Change one, change both.

/** A booking holds its slot and its day only in these statuses. */
export const ACTIVE_STATUSES = [
  "pending",
  "awaiting_payment",
  "confirmed",
] as const;

/** Statuses in which the client still owes us money. */
export const PAYABLE_STATUSES = ["pending", "awaiting_payment"] as const;

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}
export function isPayableStatus(status: string): boolean {
  return (PAYABLE_STATUSES as readonly string[]).includes(status);
}

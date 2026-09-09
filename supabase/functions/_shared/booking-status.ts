// The booking-status sets, in one place.
//
// docs/booking-invariants.md ("Active statuses (single source of truth)") names
// this set as canonical and then it gets copy-pasted into every guard. Each copy
// is a chance for the DB predicates (bookings_no_overlap, bookings_one_per_day)
// and the application guards to drift apart, which is exactly how a cancelled
// turno gets resurrected onto somebody else's slot.
//
// Edge functions import from here. The browser cannot (Deno vs. Next), so the
// frontend has its own copy in lib/booking-status.ts — keep the two in step.

/** A booking holds its slot AND its day only in these statuses. Must match the
 *  bookings_no_overlap EXCLUDE predicate and the bookings_one_per_day index. */
export const ACTIVE = ["pending", "awaiting_payment", "confirmed"] as const;

/** A booking may only be confirmed out of these. `cancelled`, `expired` and
 *  `no_show` are terminal: confirming them would resurrect a turno whose slot
 *  the no-overlap constraint has already handed to somebody else. */
export const CONFIRMABLE = ["pending", "awaiting_payment"] as const;

/** A booking may only be paid for while it is still awaiting settlement. */
export const PAYABLE = CONFIRMABLE;

/** Terminal states. Nothing moves a booking out of these. */
export const TERMINAL = ["cancelled", "expired", "no_show"] as const;

// Mutable copies for the Supabase client's `.in()` / `Array.includes()`, which
// do not accept `readonly string[]`.
export const ACTIVE_LIST: string[] = [...ACTIVE];
export const CONFIRMABLE_LIST: string[] = [...CONFIRMABLE];
export const PAYABLE_LIST: string[] = [...PAYABLE];
export const TERMINAL_LIST: string[] = [...TERMINAL];

export function isActive(status: string): boolean {
  return ACTIVE_LIST.includes(status);
}
export function isConfirmable(status: string): boolean {
  return CONFIRMABLE_LIST.includes(status);
}

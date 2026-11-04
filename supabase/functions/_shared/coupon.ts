// Pure coupon rules (ADR 0016). The shape mirrors the coupons.code check.

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

/** What a client typed, as stored; null when it can't be a code at all. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** The price after `pct`, in whole pesos. Never reaches zero on a real price:
 *  Talo can't charge it, and percents stop at 99 for that same reason. */
export function discounted(list: number, pct: number): number {
  return Math.max(1, Math.round((list * (100 - pct)) / 100));
}

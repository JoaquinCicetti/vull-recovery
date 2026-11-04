import type { TaloTransfer } from "@/components/talo-transfer-panel";

/** The payments columns a page needs to bring a live transfer back. */
export const TALO_ROW_COLS =
  "status, talo_cvu, talo_alias, talo_expires_at, talo_payment_url, amount_ars, list_amount_ars, coupon_pct";

type TaloRow = {
  status: string;
  talo_cvu: string | null;
  talo_alias: string | null;
  talo_expires_at: string | null;
  talo_payment_url: string | null;
  amount_ars: number | null;
  list_amount_ars: number | null;
  coupon_pct: number | null;
};

const notExpired = (expiresAt: string | null) =>
  !expiresAt || new Date(expiresAt).getTime() > Date.now();

/** Past its expiry Talo's page still says "Esperando pago" and shows the alias,
 *  so the client is never sent there: a dead transfer is no transfer, and they
 *  generate a new one. Unless money was already detected on it, which is a state
 *  the client has to keep seeing. */
export function restoreTransfer(row: TaloRow | null, moneyDetected: boolean): TaloTransfer | null {
  if (!row || row.status !== "pending" || (!row.talo_cvu && !row.talo_alias)) return null;
  if (!moneyDetected && !notExpired(row.talo_expires_at)) return null;
  return {
    cvu: row.talo_cvu,
    alias: row.talo_alias,
    amount: row.amount_ars ?? 0,
    expiresAt: row.talo_expires_at,
    paymentUrl: row.talo_payment_url,
    listAmount: row.list_amount_ars,
    couponPct: row.coupon_pct,
  };
}

/** Same tab: Talo's page sends the client back here on its own once paid, and a
 *  new tab can be blocked. No-op when there is no live page to go to. */
export function goToTalo(transfer: TaloTransfer) {
  if (transfer.paymentUrl && notExpired(transfer.expiresAt)) {
    window.location.assign(transfer.paymentUrl);
  }
}

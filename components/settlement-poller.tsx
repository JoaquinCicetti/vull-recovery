"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// A bank transfer is confirmed asynchronously (Talo → webhook → DB), so the
// page a client is staring at has to refresh itself. Fast at first, then slow;
// pauses while the tab is hidden; gives up after the payment window is long
// gone. Rendering it with `active={false}` is a no-op, so callers can keep it
// mounted and just flip the flag once the status settles.
const FAST_MS = 5_000;
const FAST_FOR_MS = 2 * 60_000;
const SLOW_MS = 30_000;
const GIVE_UP_MS = 40 * 60_000;

export function SettlementPoller({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const elapsed = Date.now() - started;
      if (elapsed > GIVE_UP_MS) return;
      timer = setTimeout(tick, elapsed < FAST_FOR_MS ? FAST_MS : SLOW_MS);
    };
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
      schedule();
    };
    // Refresh immediately when the tab comes back, then resume the cadence.
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, router]);

  return null;
}

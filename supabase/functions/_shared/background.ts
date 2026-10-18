// Run best-effort work (calendar events, emails, push) AFTER the response is sent.
// Supabase's edge runtime exposes `EdgeRuntime.waitUntil(promise)`, which keeps the
// isolate alive until the promise settles instead of tearing it down with the
// response. Without it (older local runtimes) the task still starts and usually
// finishes, it just isn't guaranteed. Errors never reach the response (nothing
// here may turn a committed booking into a failed request) but they are logged.
// A lost notice is not lost for good: it is a row in the notifications outbox,
// and the notify-dispatch cron sends it (ADR 0013).
type EdgeRuntimeLike = { waitUntil(p: Promise<unknown>): void };

export function defer(task: () => Promise<unknown>): void {
  let p: Promise<unknown>;
  try {
    p = task();
  } catch (e) {
    console.error("[defer] task threw", e);
    return;
  }
  const settled = p.catch((e) => console.error("[defer] task failed", e));
  const rt = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  if (rt) rt.waitUntil(settled);
  else console.warn("[defer] no EdgeRuntime.waitUntil: task may be cut short");
}

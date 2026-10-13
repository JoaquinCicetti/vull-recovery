// Run best-effort work (calendar events, emails, push) AFTER the response is sent.
// Supabase's edge runtime exposes `EdgeRuntime.waitUntil(promise)`, which keeps the
// isolate alive until the promise settles instead of tearing it down with the
// response. Without it (older local runtimes) the task still starts and usually
// finishes, it just isn't guaranteed. Errors are swallowed: nothing here may ever
// turn a committed booking into a failed request.
type EdgeRuntimeLike = { waitUntil(p: Promise<unknown>): void };

export function defer(task: () => Promise<unknown>): void {
  let p: Promise<unknown>;
  try {
    p = task();
  } catch {
    return;
  }
  const settled = p.catch(() => {});
  const rt = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  rt?.waitUntil(settled);
}

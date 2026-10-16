// The `{ error }` body an Edge Function returned with a non-2xx status, or a
// fallback. supabase.functions.invoke() wraps it in a FunctionsHttpError whose
// `context` is the raw Response.
export async function readError(
  error: unknown,
  fallback = "Algo salió mal. Probá de nuevo.",
): Promise<string> {
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return body.error as string;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

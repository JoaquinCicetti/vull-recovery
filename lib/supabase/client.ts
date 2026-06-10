import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client (uses the public publishable key + RLS).
// Falls back to harmless placeholders when env is unset, so the UI can render
// without a backend (auth/data calls simply fail and are handled gracefully).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

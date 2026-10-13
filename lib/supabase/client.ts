import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client (uses the public publishable key + RLS).
// Falls back to harmless placeholders when env is unset, so the UI can render
// without a backend (auth/data calls simply fail and are handled gracefully).
//
// `x-region`: Edge Functions run near the VISITOR by default (sa-east-1 for
// Argentina) while the database lives in us-west-2, so every DB/Auth call inside a
// function crosses the continent (~180 ms each; create-booking makes a dozen).
// Pinning the function to the DB's region trades one longer hop for the browser
// against a dozen short ones for the function — measured 2–3× faster for
// `availability` and `create-booking`. PostgREST/Auth ignore the header.
// (supabase-js 2.106 has no client-level `functions.region` option.)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { global: { headers: { "x-region": "us-west-2" } } },
  );
}

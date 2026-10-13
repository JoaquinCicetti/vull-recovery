import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session on every request and keeps the
// auth cookies in sync between the browser and Server Components.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Anonymous visitors (most traffic) have no session to refresh — skip the
  // Supabase client entirely. Auth cookies are `sb-<ref>-auth-token[.N]`.
  const hasSession = request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
  if (!hasSession) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: refreshes an expired token and writes the new cookies; do not
  // remove. getClaims() verifies the JWT locally (asymmetric keys, cached JWKS)
  // and only calls Supabase Auth when the token actually needs refreshing —
  // getUser() made that round trip on every request.
  await supabase.auth.getClaims();

  return response;
}

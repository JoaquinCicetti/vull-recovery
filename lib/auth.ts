import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// The signed-in user as the session cookie states it. Verified locally (the
// JWT's ES256 signature against the project's cached JWKS), so reading it
// costs no round trip: Supabase Auth is in another continent and a getUser()
// call was ~300 ms on EVERY authenticated page before any data was read.
export type SessionUser = { id: string; email: string | null };

// `cache()` de-dupes per request: the layout and the page share one check.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Render signed-out (rather than crash) if Supabase isn't configured yet.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return null;
  }
  const supabase = await createClient();
  // getClaims() verifies the token offline (JWKS cached 10 min per isolate)
  // and only talks to Auth when the token must be refreshed — the middleware
  // already did that for this request.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  };
});

// Current user + their profile row (both null if signed out). The profile is
// the only read here; issue page data in parallel with it (Promise.all) rather
// than after it.
export const getUserAndProfile = cache(async () => {
  const user = await getSessionUser();
  if (!user) return { user: null as SessionUser | null, profile: null as Profile | null };

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, whatsapp_phone, email, is_admin, notify_email, notify_push, created_at")
    .eq("id", user.id)
    .single<Profile>();

  return { user: user as SessionUser | null, profile: profile ?? null };
});

// Redirects to /login when signed out; otherwise returns the user (no profile,
// no round trip). For pages that only need `user.id` to scope their reads.
export async function requireSession(next = "/"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

// Redirects to /login when signed out; otherwise returns user + profile.
export async function requireUser(next = "/") {
  const result = await getUserAndProfile();
  if (!result.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return result;
}

// Redirects non-admins away from admin-only pages. Costs one profile read:
// run it inside the page's Promise.all so the data loads alongside it (RLS
// already scopes every row by the cookie, so nothing leaks to a non-admin
// who gets redirected a moment later).
export async function requireAdmin() {
  const result = await getUserAndProfile();
  if (!result.user) redirect("/login?next=/admin");
  if (!result.profile?.is_admin) redirect("/");
  return result;
}

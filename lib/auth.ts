import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Current authenticated user + their profile row (null if signed out).
// `cache()` de-dupes per request: the layout header and a page's
// requireUser/requireAdmin share one getUser() round-trip instead of several.
export const getUserAndProfile = cache(async () => {
  // Render signed-out (rather than crash) if Supabase isn't configured yet.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return { user: null, profile: null as Profile | null };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, profile: null as Profile | null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, whatsapp_phone, email, is_admin")
    .eq("id", user.id)
    .single<Profile>();

  return { user, profile };
});

// Redirects to /login when signed out; otherwise returns user + profile.
export async function requireUser(next = "/") {
  const result = await getUserAndProfile();
  if (!result.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return result;
}

// Redirects non-admins away from admin-only pages.
export async function requireAdmin() {
  const result = await getUserAndProfile();
  if (!result.user) redirect("/login?next=/admin");
  if (!result.profile?.is_admin) redirect("/");
  return result;
}

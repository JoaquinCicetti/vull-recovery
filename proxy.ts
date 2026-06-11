import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next 16 "proxy" convention (formerly middleware): refresh the Supabase
// session and keep auth cookies in sync on every matched request.
export async function proxy(request: NextRequest) {
  // Resilience: Supabase can land the auth `code` (OAuth / magic link) on a
  // non-callback path — e.g. the Site URL root `https://…/?code=…` — where
  // nothing exchanges it, so the user ends up logged out. Forward any stray
  // `code` to /auth/callback, which exchanges it for a session and redirects.
  const { pathname, searchParams } = request.nextUrl;
  if (searchParams.has("code") && pathname !== "/auth/callback") {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    if (!searchParams.has("next")) {
      url.searchParams.set("next", pathname === "/" ? "/" : pathname);
    }
    return NextResponse.redirect(url);
  }

  return await updateSession(request);
}

export const config = {
  // Run on everything except static assets and image files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

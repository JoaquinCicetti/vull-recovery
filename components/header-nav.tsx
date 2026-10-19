"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type Auth = { status: "loading" } | { status: "out" } | { status: "in"; isAdmin: boolean };

// The header's signed-in/signed-out links, resolved in the browser. Reading the
// session on the server here would make EVERY page dynamic (the header is in the
// root layout); in the browser getSession() is a local cookie read, so public
// pages stay static and this costs one profiles query only for signed-in users.
export function HeaderNav() {
  const [auth, setAuth] = useState<Auth>({ status: "loading" });

  useEffect(() => {
    const supabase = createClient();
    let alive = true;

    async function resolve(userId: string | null) {
      if (!userId) {
        if (alive) setAuth({ status: "out" });
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", userId)
        .maybeSingle();
      if (alive) setAuth({ status: "in", isAdmin: Boolean(data?.is_admin) });
    }

    supabase.auth.getSession().then(({ data }) => resolve(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        resolve(session?.user.id ?? null);
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Reserve the button's footprint while the session resolves, so the header
  // doesn't flash "Ingresar" at a signed-in user or shift when it settles.
  if (auth.status === "loading") {
    return <nav aria-hidden className="h-9 w-24" />;
  }

  return (
    <nav className="flex items-center gap-1 text-sm">
      {auth.status === "in" ? (
        <>
          {auth.isAdmin && (
            <Link
              href="/admin/agenda"
              className="rounded-lg px-3 py-2 text-fg-muted transition-colors hover:text-fg"
            >
              Panel
            </Link>
          )}
          {/* One door into the account area (it opens on the turnos; profile,
              plan and sessions are tabs inside). Two links to the same place
              read as two places. */}
          <Button asChild variant="outline" className="ml-1">
            <Link href="/mis-turnos">Mi cuenta</Link>
          </Button>
        </>
      ) : (
        <Button asChild>
          <Link href="/login">Ingresar</Link>
        </Button>
      )}
    </nav>
  );
}

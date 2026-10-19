import type { ReactNode } from "react";
import { getUserAndProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AccountTabs } from "@/components/account/account-tabs";

// The account bar lives in the layout, so it persists across /mis-turnos and
// /cuenta/* (no re-mount, no fade on every navigation) and stays put while a
// page's loading skeleton swaps in beneath it.
//
// A client sees only what they have: "Abono" is the pilates membership and
// "Sesiones" the recovery pack balance — two different things, and someone
// who has neither gets neither tab. The pages themselves stay reachable by
// URL (each explains how to get one). Pages still gate with requireUser().
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const { user } = await getUserAndProfile();
  let hasPlan = false;
  let hasSessions = false;
  if (user) {
    const supabase = await createClient();
    const [memberships, credits] = await Promise.all([
      supabase
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      // Any pack ever bought (a spent one still has its history on the page).
      supabase
        .from("user_credits")
        .select("service_id", { count: "exact", head: true })
        .eq("user_id", user.id),
    ]);
    hasPlan = (memberships.count ?? 0) > 0;
    hasSessions = (credits.count ?? 0) > 0;
  }

  return (
    <>
      <div className="mx-auto w-full max-w-3xl px-5 pt-10 sm:pt-12">
        <AccountTabs showPlan={hasPlan} showSessions={hasSessions} />
      </div>
      {children}
    </>
  );
}

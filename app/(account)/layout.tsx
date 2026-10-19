import type { ReactNode } from "react";
import { AccountTabs } from "@/components/account/account-tabs";

// The account bar lives in the layout, so it persists across /mis-turnos and
// /cuenta/* (no re-mount, no fade on every navigation) and stays put while a
// page's loading skeleton swaps in beneath it. Pages still gate with
// requireUser(); this renders nothing personal.
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mx-auto w-full max-w-2xl px-5 pt-10 sm:pt-12">
        <AccountTabs />
      </div>
      {children}
    </>
  );
}

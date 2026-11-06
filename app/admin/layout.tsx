import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminTabs } from "@/components/admin/admin-tabs";

// Backstop to the robots.txt disallow: never index the panel.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// The section bar lives in the layout, so it persists across admin pages
// (no re-mount, no fade on every navigation) and stays put while a page's
// loading skeleton swaps in beneath it. Each page still gates with
// requireAdmin(); this renders nothing sensitive.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mx-auto w-full max-w-3xl px-5 pt-10 sm:pt-12">
        <AdminTabs />
      </div>
      {children}
    </>
  );
}

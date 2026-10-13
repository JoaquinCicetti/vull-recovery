import Link from "next/link";
import { Logo } from "@/components/logo";
import { SiteChrome } from "@/components/landing/site-chrome";
import { HeaderNav } from "@/components/header-nav";

// Static on purpose: no session read here (see HeaderNav), so the root layout
// doesn't force every page to render per request.
export function SiteHeader() {
  return (
    <SiteChrome>
      <Link
        href="/"
        aria-label="Inicio"
        className="transition-opacity hover:opacity-80"
      >
        <Logo imgClassName="h-12" />
      </Link>
      <HeaderNav />
    </SiteChrome>
  );
}

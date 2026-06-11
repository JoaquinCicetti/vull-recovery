"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Scroll-aware header shell. On the homepage the header floats transparently
 * over the cinematic hero, then turns solid + blurred once you scroll past it.
 * On every other route it's solid from the start (and a spacer reserves its
 * height, since it's fixed-positioned).
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const solid = scrolled || !isHome;

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
          solid
            ? "border-b border-border bg-surface/80 backdrop-blur"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          {children}
        </div>
      </header>
      {!isHome && <div aria-hidden className="h-16" />}
    </>
  );
}

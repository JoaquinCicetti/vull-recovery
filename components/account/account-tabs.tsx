"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, Ticket, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/mis-turnos", label: "Turnos", icon: CalendarDays },
  { href: "/cuenta/sesiones", label: "Sesiones", icon: Ticket },
  { href: "/cuenta/notificaciones", label: "Avisos", icon: Bell },
  { href: "/cuenta", label: "Perfil", icon: User },
];

// The client's own area: one bar across turnos, session balance, notification
// settings and profile, so each page stays short and does one thing.
export function AccountTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Tu cuenta"
      className="flex border-b border-border sm:gap-1"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // Phone: four equal columns, icon over label (never scrolls or clips).
              "-mb-px flex flex-1 flex-col items-center gap-1.5 border-b-2 px-1 py-2.5 text-xs transition-colors duration-150",
              "sm:flex-none sm:flex-row sm:gap-2 sm:px-3 sm:text-sm",
              active
                ? "border-accent font-semibold text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, Settings2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

// The backoffice sections: what happens (Agenda, per sector), who (Clientes),
// how it is going (Métricas) and how it is set up (Ajustes). Money needs no
// section: Talo settles turnos on its own, cash is an admin slot block, and the
// abonos' cuotas live with the abonos. Rendered once by app/admin/layout.tsx so
// the bar never re-mounts between pages. On a phone: equal columns, icon over label.
const TABS = [
  { href: "/admin/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/admin/clientes", label: "Clientes", icon: Users },
  { href: "/admin/metricas", label: "Métricas", icon: BarChart3 },
  { href: "/admin/ajustes", label: "Ajustes", icon: Settings2 },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones del panel" className="flex border-b border-border sm:gap-1">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
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

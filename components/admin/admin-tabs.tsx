"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Inicio" },
  { href: "/admin/turnos", label: "Turnos" },
  { href: "/admin/clientes", label: "Clientes" },
  { href: "/admin/metricas", label: "Métricas" },
  { href: "/admin/servicios", label: "Planes" },
  { href: "/admin/configuracion", label: "Disponibilidad" },
];

// The backoffice sections. Rendered through PageShell's `nav` slot by every
// admin page, so it sits in the same column as the page it belongs to.
export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Secciones del panel"
      className="-mx-5 flex gap-1 overflow-x-auto border-b border-border px-5"
    >
      {TABS.map((t) => {
        const active =
          t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors",
              active
                ? "border-accent font-semibold text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

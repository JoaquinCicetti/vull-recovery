import Link from "next/link";
import { Button } from "@/components/ui/button";

// Prev/next links for a server-rendered, query-string-driven list. `params` are
// the current filters; they are carried over so paging never drops them.
export function Pager({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  function href(p: number) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    if (p > 1) qs.set("pagina", String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  }

  return (
    <div className="mt-6 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page - 1)}>← Anterior</Link>
        </Button>
      ) : (
        <span />
      )}
      <span className="font-mono text-xs text-fg-faint">
        Página {page} de {pages}
      </span>
      {page < pages ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page + 1)}>Siguiente →</Link>
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

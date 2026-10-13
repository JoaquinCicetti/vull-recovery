import { AccountTabs } from "@/components/account/account-tabs";
import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageShell nav={<AccountTabs />} eyebrow="Tu cuenta" title="Mis turnos">
      <div aria-hidden="true">
        <Skeleton className="h-44 w-full rounded-lg" />
        <Skeleton className="mt-12 h-3 w-28" />
        <div className="mt-4 flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] w-full rounded-lg" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

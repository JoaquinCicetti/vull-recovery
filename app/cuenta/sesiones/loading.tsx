import { AccountTabs } from "@/components/account/account-tabs";
import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageShell nav={<AccountTabs />} eyebrow="Tu cuenta" title="Sesiones">
      <div aria-hidden="true">
        <Skeleton className="h-36 w-full rounded-lg" />
        <Skeleton className="mt-12 h-3 w-24" />
        <Skeleton className="mt-4 h-20 w-full rounded-lg" />
        <Skeleton className="mt-12 h-3 w-32" />
        <Skeleton className="mt-4 h-40 w-full rounded-lg" />
      </div>
    </PageShell>
  );
}

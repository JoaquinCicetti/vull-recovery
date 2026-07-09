import { getActiveServices } from "@/lib/services";
import { getMyBalances } from "@/lib/credits";
import { ExperienceClient } from "@/components/experience/experience-client";
import { Plans } from "@/components/landing/plans";

export default async function Home() {
  const [services, balances] = await Promise.all([
    getActiveServices(),
    getMyBalances(),
  ]);

  return (
    <>
      {/* Pinned scroll story (video scrub → WebGL). Flows into plans + CTA below. */}
      <ExperienceClient />
      <Plans services={services} balances={balances} />
    </>
  );
}

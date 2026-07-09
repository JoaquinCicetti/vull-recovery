import { getActiveServices } from "@/lib/services";
import { getMyBalances } from "@/lib/credits";
import { Hero } from "@/components/landing/hero";
import { RecoveryJourney } from "@/components/landing/recovery-journey";
import { Plans } from "@/components/landing/plans";

// The original cinematic landing — now also the reduced-motion / no-WebGL home for
// the scroll experience at `/`.
export default async function PlanesPage() {
  const [services, balances] = await Promise.all([
    getActiveServices(),
    getMyBalances(),
  ]);

  return (
    <>
      <Hero />
      <RecoveryJourney />
      <Plans services={services} balances={balances} />
    </>
  );
}

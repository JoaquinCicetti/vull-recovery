import { getActiveServices } from "@/lib/services";
import { Hero } from "@/components/landing/hero";
import { RecoveryJourney } from "@/components/landing/recovery-journey";
import { Plans } from "@/components/landing/plans";

// The original cinematic landing — now also the reduced-motion / no-WebGL home for
// the scroll experience at `/`.
export default async function PlanesPage() {
  const services = await getActiveServices();

  return (
    <>
      <Hero />
      <RecoveryJourney />
      <Plans services={services} />
    </>
  );
}

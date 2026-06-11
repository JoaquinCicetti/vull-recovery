import { getActiveServices } from "@/lib/services";
import { Hero } from "@/components/landing/hero";
import { RecoveryJourney } from "@/components/landing/recovery-journey";
import { Plans } from "@/components/landing/plans";

export default async function Home() {
  const services = await getActiveServices();

  return (
    <>
      <Hero />
      <RecoveryJourney />
      <Plans services={services} />
    </>
  );
}

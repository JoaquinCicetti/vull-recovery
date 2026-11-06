import type { Metadata } from "next";
import { getActiveServicesStatic } from "@/lib/services";
import { Hero } from "@/components/landing/hero";
import { RecoveryJourney } from "@/components/landing/recovery-journey";
import { Plans } from "@/components/landing/plans";

// Same purpose as the home page, so it points search engines there (docs/seo.md).
export const metadata: Metadata = {
  title: "Planes",
  alternates: { canonical: "/" },
};

// The original cinematic landing — now also the reduced-motion / no-WebGL home for
// the scroll experience at `/`.
export default async function PlanesPage() {
  const services = await getActiveServicesStatic();

  return (
    <>
      <Hero />
      <RecoveryJourney />
      <Plans initialServices={services} />
    </>
  );
}

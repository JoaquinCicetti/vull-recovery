import { getActiveServicesStatic } from "@/lib/services";
import { ExperienceClient } from "@/components/experience/experience-client";
import { Plans } from "@/components/landing/plans";

export default async function Home() {
  const services = await getActiveServicesStatic();

  return (
    <>
      {/* Pinned scroll story (video scrub → WebGL). Flows into plans + CTA below. */}
      <ExperienceClient />
      <Plans initialServices={services} />
    </>
  );
}

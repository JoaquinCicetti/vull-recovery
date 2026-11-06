import type { Metadata } from "next";
import { getActiveServicesStatic } from "@/lib/services";
import { ExperienceClient } from "@/components/experience/experience-client";
import { About } from "@/components/landing/about";
import { Plans } from "@/components/landing/plans";
import { LocalBusinessJsonLd } from "@/components/seo/local-business-jsonld";

// Title and description are the root layout's defaults; this is the one page
// in the sitemap (docs/seo.md). Don't add an `openGraph` key here: metadata
// merges shallowly, so it would replace the layout's whole openGraph object.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function Home() {
  const services = await getActiveServicesStatic();

  return (
    <>
      <LocalBusinessJsonLd />
      {/* Pinned scroll story (video scrub → WebGL). Flows into plans + CTA below. */}
      <ExperienceClient />
      {/* Server-rendered, always-visible copy: what VULL is, where, how it works. */}
      <About />
      <Plans initialServices={services} />
    </>
  );
}

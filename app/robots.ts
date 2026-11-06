import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Signed-in areas are kept out of the crawl entirely (they only redirect to
// /login for a bot anyway). Public but transactional pages (/reservar, /abono,
// /comprar, /login) stay crawlable and say `noindex` themselves: a disallowed
// page can't show its noindex, and its URL can still end up indexed.
// Cloudflare's managed robots.txt, if on for the zone, prepends its
// content-signal block to this file. See docs/seo.md.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/cuenta", "/mis-turnos", "/turno/", "/auth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

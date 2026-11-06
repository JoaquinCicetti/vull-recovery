import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Only the home page: /planes points its canonical at "/", and the booking /
// purchase pages are noindex. Add a URL here when a new indexable page exists.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 }];
}

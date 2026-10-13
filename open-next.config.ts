import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Prerendered pages (/, /planes, …) are served straight from Workers static
// assets: read-only, no revalidation — they change on deploy. Anything live on
// them (prices, credits, the header's session) is fetched in the browser.
// Cache interception answers those pages before the Next server even loads.
// Switch to the R2 cache if a page ever needs `revalidate` (ISR).
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});

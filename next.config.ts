import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next doesn't infer it from stray lockfiles elsewhere.
  turbopack: {
    root: __dirname,
  },
  images: {
    // Serve AVIF (then WebP) instead of the original JPEGs — large savings on the
    // facility photography. Optimized variants are immutable, so cache them for a year.
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31536000,
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next doesn't infer it from stray lockfiles elsewhere.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;

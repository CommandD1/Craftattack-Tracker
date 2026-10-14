import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  cacheMaxMemorySize: 16 * 1024 * 1024,
  serverExternalPackages: ["pg"],
  partialPrefetching: true,
  experimental: {
    cpus: 1,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

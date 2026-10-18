import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "book.sfdcinsight.xyz"],
  serverExternalPackages: ["better-sqlite3", "sharp", "unzipper", "archiver", "exceljs"],
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./next/**/*", "./legacy-data/**/*", "./.env", "./.env.*", "./tests/**/*"]
  },
  cacheComponents: false,
  poweredByHeader: false,
  experimental: {
    // Hydration must work when a reverse proxy cannot forward the HMR socket.
    reactDebugChannel: false,
    serverActions: {
      bodySizeLimit: "10mb"
    }
  },
  images: {
    unoptimized: true
  },
  async redirects() {
    return [
      { source: "/user/signup", destination: "/signup", permanent: false },
      { source: "/dashboard/branches/detail", has: [{ type: "query", key: "branch", value: "(?<branch>[^/]+)" }], destination: "/inventory/branches/:branch", permanent: false },
      { source: "/dashboard/branches/:branch", destination: "/inventory/branches/:branch", permanent: false },
      { source: "/dashboard/branches", has: [{ type: "query", key: "search", value: "(?<query>.*)" }], destination: "/inventory?q=:query", permanent: false },
      { source: "/dashboard/branches", destination: "/inventory", permanent: false }
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  }
};

export default nextConfig;

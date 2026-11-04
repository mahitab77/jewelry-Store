import type { NextConfig } from "next";
import { siteIndexingAllowed } from "./src/lib/site.ts";

const nextConfig: NextConfig = {
  // Linux containers opt in; keep the existing native `next start` workflow.
  output: process.env.NEXT_STANDALONE === "true" ? "standalone" : undefined,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ...(!siteIndexingAllowed() ? [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] : []),
    ] }];
  },
};

export default nextConfig;

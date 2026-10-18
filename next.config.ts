import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  /*
    Next 16 type-checks <Link href> against the routes that exist. The sidebar
    deliberately links ahead of the build — teams, athletes, trainers, gyms and
    seasons arrive in Phase 2 — so this stays off until those routes are real.
    Turn it back on then: it catches genuine dead links.
  */
  typedRoutes: false,

  experimental: {
    /*
      A game sheet is a phone photograph, and a Server Action's body is capped
      at 1 MB by default — which rejected every upload with a framework error
      rather than ours. 12 MB is the 10 MB in `MAX_IMAGE_BYTES` plus multipart
      overhead; the real limit a person meets is ours, on the field, with a
      sentence about the file being too large.
    */
    serverActions: { bodySizeLimit: "12mb" },
  },
};

// Points the plugin at our request config, which resolves the locale per request.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);

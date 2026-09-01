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
};

// Points the plugin at our request config, which resolves the locale per request.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);

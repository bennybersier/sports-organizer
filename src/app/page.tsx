import { redirect } from "next/navigation";

import { getCurrentUser, getIsPlatformAdmin, getMemberships } from "@/server/auth/context";

/**
 * Entry point. Sends each caller to the right home, resolved server-side:
 * platform staff to the system console, club members to their dashboard.
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [memberships, isPlatformAdmin] = await Promise.all([
    getMemberships(),
    getIsPlatformAdmin(),
  ]);

  if (memberships.length > 0) redirect("/dashboard");
  if (isPlatformAdmin) redirect("/admin");
  redirect("/no-access");
}

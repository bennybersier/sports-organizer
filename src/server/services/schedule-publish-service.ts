import "server-only";

import { fromDatabaseError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";

/**
 * Publishes a schedule version, whatever the transport.
 *
 * Authorization happens here, in TypeScript, against the caller's resolved
 * permissions — which works identically for a browser session, an MCP key and a
 * background job. The transaction itself lives in
 * `internal_publish_schedule_version`, which is service_role-only precisely
 * because it performs no check of its own.
 *
 * The session-facing `publish_schedule_version` RPC still exists and still
 * checks `auth.uid()`; it is the right thing for a browser and the wrong thing
 * for a caller that has no JWT.
 */
export async function publishScheduleVersion(
  context: AuthContext,
  versionId: string,
): Promise<void> {
  assertPermission(context, "schedule.publish");

  const { error } = await createAdminClient().rpc(
    "internal_publish_schedule_version",
    { p_version_id: versionId, p_user_id: context.user.id },
  );

  if (error) throw fromDatabaseError(error, { resource: "schedule" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.SCHEDULE_PUBLISHED,
    resourceType: "schedule_version",
    resourceId: versionId,
  });
}

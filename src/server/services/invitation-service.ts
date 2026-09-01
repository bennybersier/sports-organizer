import "server-only";

import { hashSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reading an invitation before you belong to the club.
 *
 * An invitee has no membership yet, so RLS correctly hides the `invitations`
 * row from them. The token is the bearer credential: we look the row up by its
 * hash with the secret-key client and return only what the accept screen
 * needs to render. No tenant data beyond the club's display name is exposed,
 * and the token hash itself never leaves the server.
 */

export interface InvitationPreview {
  status: "VALID" | "EXPIRED" | "ALREADY_USED" | "REVOKED" | "NOT_FOUND";
  tenantName?: string;
  roleName?: string;
  email?: string;
  expiresAt?: string;
}

export async function describeInvitation(rawToken: string): Promise<InvitationPreview> {
  if (!rawToken || rawToken.length < 20) return { status: "NOT_FOUND" };

  const { data, error } = await createAdminClient()
    .from("invitations")
    .select("email, status, expires_at, tenants(name), roles(name)")
    .eq("token_hash", hashSecret(rawToken))
    .maybeSingle<{
      email: string;
      status: string;
      expires_at: string;
      tenants: { name: string } | null;
      roles: { name: string } | null;
    }>();

  if (error || !data) return { status: "NOT_FOUND" };

  const shared = {
    tenantName: data.tenants?.name,
    roleName: data.roles?.name,
    email: data.email,
    expiresAt: data.expires_at,
  };

  if (data.status === "ACCEPTED") return { status: "ALREADY_USED", ...shared };
  if (data.status === "REVOKED") return { status: "REVOKED", ...shared };
  if (data.status === "EXPIRED" || new Date(data.expires_at) <= new Date()) {
    return { status: "EXPIRED", ...shared };
  }

  return { status: "VALID", ...shared };
}

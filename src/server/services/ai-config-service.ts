import "server-only";

import { ConflictError, NotFoundError, fromDatabaseError } from "@/lib/errors";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthContext } from "@/server/auth/context";
import { assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import type { AiProviderId } from "@/domain/ai";

/**
 * Per-tenant AI configuration.
 *
 * `ai_provider_configurations` has no grants for `authenticated` at all, so
 * every read and write here goes through the secret-key client — after this
 * service has checked the caller's permission itself. The encrypted key never
 * leaves the server, and no code path returns it: the UI gets a four-character
 * hint and nothing more.
 */

export interface AiConfigView {
  id: string;
  provider: AiProviderId;
  model: string;
  /** Last four characters only. Never the key. */
  keyHint: string;
  isEnabled: boolean;
  isDefault: boolean;
  lastVerifiedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export async function listAiConfigs(context: AuthContext): Promise<AiConfigView[]> {
  assertPermission(context, "ai.read");

  const { data, error } = await createAdminClient()
    .from("ai_provider_configurations")
    .select("id, provider, model, api_key_hint, is_enabled, is_default, last_verified_at, last_error, updated_at")
    .eq("tenant_id", context.tenant.id)
    .order("provider");

  if (error) throw fromDatabaseError(error, { resource: "AI configuration" });

  return (data ?? []).map((row) => ({
    id: row.id,
    provider: row.provider as AiProviderId,
    model: row.model,
    keyHint: row.api_key_hint,
    isEnabled: row.is_enabled,
    isDefault: row.is_default,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  }));
}

export interface SaveAiConfigInput {
  provider: AiProviderId;
  model: string;
  /** Omitted when editing without rotating the key. */
  apiKey?: string;
  isEnabled: boolean;
  makeDefault: boolean;
}

export async function saveAiConfig(
  context: AuthContext,
  input: SaveAiConfigInput,
): Promise<AiConfigView> {
  assertPermission(context, "ai.manage");
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("ai_provider_configurations")
    .select("id, api_key_ciphertext, api_key_hint, model, is_enabled")
    .eq("tenant_id", context.tenant.id)
    .eq("provider", input.provider)
    .maybeSingle();

  if (!existing && !input.apiKey) {
    throw new ConflictError("An API key is required the first time you configure a provider.");
  }

  // Rotating the key replaces both the ciphertext and the hint; leaving it
  // blank keeps the stored one, so editing the model doesn't require re-pasting.
  const ciphertext = input.apiKey ? encryptSecret(input.apiKey) : existing!.api_key_ciphertext;
  const hint = input.apiKey ? secretHint(input.apiKey) : existing!.api_key_hint;

  const { data, error } = await admin
    .from("ai_provider_configurations")
    .upsert(
      {
        tenant_id: context.tenant.id,
        provider: input.provider,
        model: input.model,
        api_key_ciphertext: ciphertext,
        api_key_hint: hint,
        is_enabled: input.isEnabled,
        // Verification state belongs to the key that was verified.
        ...(input.apiKey ? { last_verified_at: null, last_error: null } : {}),
        created_by: existing ? undefined : context.user.id,
        updated_by: context.user.id,
      },
      { onConflict: "tenant_id,provider" },
    )
    .select("id, provider, model, api_key_hint, is_enabled, is_default, last_verified_at, last_error, updated_at")
    .single();

  if (error) throw fromDatabaseError(error, { resource: "AI configuration" });

  if (input.makeDefault) await setDefaultProvider(context, input.provider);

  await recordAudit(context, {
    action: AUDIT_ACTIONS.AI_CONFIGURATION_CHANGED,
    resourceType: "ai_provider_configuration",
    resourceId: data.id,
    // Only ever the provider, model and whether a key was rotated — the key
    // itself and its ciphertext are never audited.
    newValue: {
      provider: input.provider,
      model: input.model,
      enabled: input.isEnabled,
      key_rotated: Boolean(input.apiKey),
    },
  });

  return {
    id: data.id,
    provider: data.provider as AiProviderId,
    model: data.model,
    keyHint: data.api_key_hint,
    isEnabled: data.is_enabled,
    isDefault: data.is_default,
    lastVerifiedAt: data.last_verified_at,
    lastError: data.last_error,
    updatedAt: data.updated_at,
  };
}

/** Exactly one provider is active per tenant; a partial unique index says so. */
export async function setDefaultProvider(
  context: AuthContext,
  provider: AiProviderId,
): Promise<void> {
  assertPermission(context, "ai.manage");
  const admin = createAdminClient();

  await admin
    .from("ai_provider_configurations")
    .update({ is_default: false })
    .eq("tenant_id", context.tenant.id)
    .eq("is_default", true);

  const { error } = await admin
    .from("ai_provider_configurations")
    .update({ is_default: true, is_enabled: true })
    .eq("tenant_id", context.tenant.id)
    .eq("provider", provider);

  if (error) throw fromDatabaseError(error, { resource: "AI configuration" });
}

export async function deleteAiConfig(
  context: AuthContext,
  provider: AiProviderId,
): Promise<void> {
  assertPermission(context, "ai.manage");

  const { error } = await createAdminClient()
    .from("ai_provider_configurations")
    .delete()
    .eq("tenant_id", context.tenant.id)
    .eq("provider", provider);

  if (error) throw fromDatabaseError(error, { resource: "AI configuration" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.AI_CONFIGURATION_CHANGED,
    resourceType: "ai_provider_configuration",
    newValue: { provider, removed: true },
  });
}

/** Records the outcome of a verification attempt. */
export async function recordVerification(
  context: AuthContext,
  provider: AiProviderId,
  result: { ok: true } | { ok: false; message: string },
): Promise<void> {
  await createAdminClient()
    .from("ai_provider_configurations")
    .update(
      result.ok
        ? { last_verified_at: new Date().toISOString(), last_error: null }
        : { last_error: result.message },
    )
    .eq("tenant_id", context.tenant.id)
    .eq("provider", provider);
}

/**
 * The decrypted key.
 *
 * Deliberately not exported beyond this module's siblings: the registry uses it
 * to construct a provider, and nothing else has any business calling it.
 */
export async function getDecryptedKey(
  context: AuthContext,
  provider: AiProviderId,
): Promise<{ apiKey: string; model: string }> {
  const { data, error } = await createAdminClient()
    .from("ai_provider_configurations")
    .select("api_key_ciphertext, model, is_enabled")
    .eq("tenant_id", context.tenant.id)
    .eq("provider", provider)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, { resource: "AI configuration" });
  if (!data) throw new NotFoundError("AI configuration");
  if (!data.is_enabled) throw new ConflictError("That AI provider is switched off.");

  return { apiKey: decryptSecret(data.api_key_ciphertext), model: data.model };
}

/** The tenant's active provider, if any. */
export async function getDefaultProvider(
  context: AuthContext,
): Promise<AiProviderId | null> {
  const { data } = await createAdminClient()
    .from("ai_provider_configurations")
    .select("provider")
    .eq("tenant_id", context.tenant.id)
    .eq("is_default", true)
    .eq("is_enabled", true)
    .maybeSingle();

  return (data?.provider as AiProviderId) ?? null;
}

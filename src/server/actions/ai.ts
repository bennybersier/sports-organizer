"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import {
  deleteAiConfig,
  saveAiConfig,
  setDefaultProvider,
} from "@/server/services/ai-config-service";
import { verifyConfiguredProvider } from "@/server/ai/schedule-assistant";

const providerSchema = z.enum(["ANTHROPIC", "GEMINI", "OPENAI"]);

const saveSchema = z.object({
  provider: providerSchema,
  model: z.string().trim().min(1).max(100),
  // Optional so the model can be edited without re-pasting the key.
  apiKey: z.string().trim().min(10).max(500).optional().or(z.literal("").transform(() => undefined)),
  isEnabled: z.coerce.boolean().default(true),
  makeDefault: z.coerce.boolean().default(false),
});

export async function saveAiConfigAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("ai.manage");
    await saveAiConfig(context, parseInput(saveSchema, input));
    revalidatePath("/integrations");
    return null;
  });
}

export async function verifyAiConfigAction(
  provider: string,
): Promise<ActionResult<{ ok: boolean; message?: string }>> {
  return runAction(async () => {
    const context = await requirePermission("ai.manage");
    const result = await verifyConfiguredProvider(
      context,
      parseInput(providerSchema, provider),
    );
    revalidatePath("/integrations");
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  });
}

export async function setDefaultProviderAction(provider: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("ai.manage");
    await setDefaultProvider(context, parseInput(providerSchema, provider));
    revalidatePath("/integrations");
    return null;
  });
}

export async function deleteAiConfigAction(provider: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("ai.manage");
    await deleteAiConfig(context, parseInput(providerSchema, provider));
    revalidatePath("/integrations");
    return null;
  });
}

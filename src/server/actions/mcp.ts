"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/domain/permissions";
import {
  createMcpKey,
  revokeMcpKey,
  rotateMcpKey,
} from "@/server/services/mcp-key-service";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(PERMISSIONS)).default([]),
  expiresInDays: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(3650)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

export async function createMcpKeyAction(
  input: unknown,
): Promise<ActionResult<{ secret: string; prefix: string; name: string }>> {
  return runAction(async () => {
    const context = await requirePermission("mcp.manage");
    const { key, secret } = await createMcpKey(context, parseInput(createSchema, input));
    revalidatePath("/integrations");
    return { secret, prefix: key.prefix, name: key.name };
  });
}

export async function revokeMcpKeyAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("mcp.manage");
    await revokeMcpKey(context, id);
    revalidatePath("/integrations");
    return null;
  });
}

export async function rotateMcpKeyAction(
  id: string,
): Promise<ActionResult<{ secret: string; prefix: string }>> {
  return runAction(async () => {
    const context = await requirePermission("mcp.manage");
    const { key, secret } = await rotateMcpKey(context, id);
    revalidatePath("/integrations");
    return { secret, prefix: key.prefix };
  });
}

"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { env } from "@/env";
import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/context";
import { LOCALE_COOKIE, LOCALES } from "@/i18n/config";
import { z } from "zod";

const localeSchema = z.object({ locale: z.enum(LOCALES) });

/**
 * Changes the interface language.
 *
 * Written to two places on purpose: the cookie is what every request reads (no
 * database round-trip to render a page), and the profile is what makes the
 * choice follow the person to a new browser or device. Signing in seeds the
 * cookie from the profile, so the two converge.
 *
 * Works for signed-out visitors too — the cookie alone is enough to translate
 * the sign-in page.
 */
export async function setLocale(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { locale } = parseInput(localeSchema, input);

    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE, locale, {
      httpOnly: false, // read by the client only to keep the picker in sync
      sameSite: "lax",
      secure: env.APP_ENV !== "development",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    const user = await getCurrentUser();
    if (user) {
      const supabase = await createClient();
      await supabase.from("profiles").update({ locale }).eq("id", user.id);
    }

    revalidatePath("/", "layout");
    return null;
  });
}

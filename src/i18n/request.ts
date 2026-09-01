import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, matchLocale, type Locale } from "./config";

/**
 * Resolves the locale for the current request, in order of how deliberate the
 * signal is:
 *
 *   1. the cookie, written when the user picks a language (and mirrored to
 *      their profile, so a new device picks it up on first sign-in)
 *   2. the browser's Accept-Language header
 *   3. English
 *
 * The profile is not read here on purpose: this runs on every request including
 * unauthenticated ones, and a database round-trip per request to fetch a value
 * we already mirror into a cookie is not worth it. `setLocale` keeps the two in
 * step, and the sign-in flow seeds the cookie from the profile.
 */
async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const headerList = await headers();
  return matchLocale(headerList.get("accept-language")) ?? DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // The club's timezone governs scheduling; this only affects how absolute
    // times are rendered when a component does not specify one.
    now: new Date(),
  };
});

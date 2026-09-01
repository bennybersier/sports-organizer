/**
 * Supported locales.
 *
 * Deliberately no locale URL prefix: the whole app sits behind authentication
 * and is marked noindex, so the SEO argument for `/en/...` and `/it/...` does
 * not apply. Language is a property of the person, not the URL — it lives on
 * their profile, so it follows them across devices and stays stable when a link
 * is shared between colleagues who read different languages.
 */
export const LOCALES = ["en", "it"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Names written in each language, as a language picker should show them. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  it: "Italiano",
};

export const LOCALE_COOKIE = "sco_locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported locale from an Accept-Language header.
 * Matches on the primary subtag, so `it-CH` resolves to `it`.
 */
export function matchLocale(acceptLanguage: string | null): Locale | null {
  if (!acceptLanguage) return null;

  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const quality = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: quality ? Number(quality.split("=")[1]) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

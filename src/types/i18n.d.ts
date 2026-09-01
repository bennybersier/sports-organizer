import type messages from "../../messages/en.json";
import type { Locale } from "@/i18n/config";

/**
 * Makes translation keys type-checked.
 *
 * English is the reference catalogue, so `t("nav.teams")` autocompletes and a
 * typo becomes a build error rather than a raw key rendered to a user. Italian
 * is kept in step by a parity check in `pnpm i18n:check`.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}

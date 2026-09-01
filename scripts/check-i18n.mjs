/**
 * Keeps the message catalogues in step.
 *
 * English is the reference: every key it defines must exist in every other
 * locale, with no extras. A missing key would otherwise surface as a raw
 * `nav.teams` string in front of a user, which TypeScript cannot catch because
 * only the English catalogue is used for the key types.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "messages";
const REFERENCE = "en";

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object"
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

const load = (locale) => JSON.parse(readFileSync(join(DIR, `${locale}.json`), "utf8"));
const reference = new Set(flatten(load(REFERENCE)));
const locales = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(".json", ""));

let failed = false;
console.log(`Reference: ${REFERENCE} (${reference.size} keys)\n`);

for (const locale of locales) {
  if (locale === REFERENCE) continue;
  const keys = new Set(flatten(load(locale)));
  const missing = [...reference].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !reference.has(k));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`  ${locale}: complete (${keys.size} keys)`);
  } else {
    failed = true;
    console.log(`  ${locale}: ${missing.length} missing, ${extra.length} extra`);
    missing.forEach((k) => console.log(`      missing: ${k}`));
    extra.forEach((k) => console.log(`      extra:   ${k}`));
  }
}

process.exit(failed ? 1 : 0);

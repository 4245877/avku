// apps/web/scripts/check-i18n.mjs
// Перевіряє паритет ключів між public/lang/uk.json і public/lang/en.json.
// Падає з кодом 1, якщо набори ключів відрізняються або JSON невалідний.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const langDir = path.resolve(here, "..", "public", "lang");

const read = (name) => {
  const file = path.join(langDir, name);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`✖ Не вдалося прочитати/розпарсити ${name}: ${err.message}`);
    process.exit(1);
  }
};

const uk = read("uk.json");
const en = read("en.json");

const a = new Set(Object.keys(uk));
const b = new Set(Object.keys(en));

const onlyUk = [...a].filter((k) => !b.has(k)).sort();
const onlyEn = [...b].filter((k) => !a.has(k)).sort();

// Додатково: ключі з порожніми значеннями (часто = забутий переклад)
const emptyUk = [...a].filter((k) => !String(uk[k] ?? "").trim()).sort();
const emptyEn = [...b].filter((k) => !String(en[k] ?? "").trim()).sort();

if (onlyUk.length || onlyEn.length || emptyUk.length || emptyEn.length) {
  console.error("✖ i18n key mismatch:");
  if (onlyUk.length) console.error("  onlyUk:", onlyUk);
  if (onlyEn.length) console.error("  onlyEn:", onlyEn);
  if (emptyUk.length) console.error("  emptyUk:", emptyUk);
  if (emptyEn.length) console.error("  emptyEn:", emptyEn);
  process.exit(1);
}

console.log(`✓ i18n keys in sync: ${a.size} keys in both uk.json and en.json`);

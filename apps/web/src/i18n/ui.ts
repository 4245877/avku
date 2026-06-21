import { readFileSync } from "node:fs";

/**
 * Єдине джерело правди для перекладів.
 *
 * Словники лежать у public/lang/*.json (їх же читає scripts/check-i18n.mjs).
 * Тут вони підвантажуються на етапі збірки (SSG), тому переклад застосовується
 * на сервері — без FOUC і без клієнтського перемикання тексту.
 */

export const locales = ["uk", "en"] as const;
export type Lang = (typeof locales)[number];
export const defaultLang: Lang = "uk";

export const SITE_URL = "https://avku.org";

type Dict = Record<string, string>;

const readDict = (lang: Lang): Dict => {
  const url = new URL(`../../public/lang/${lang}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Dict;
};

export const ui: Record<Lang, Dict> = {
  uk: readDict("uk"),
  en: readDict("en"),
};

export const isLang = (value: unknown): value is Lang =>
  typeof value === "string" && (locales as readonly string[]).includes(value);

export const oppositeLang = (lang: Lang): Lang => (lang === "uk" ? "en" : "uk");

export const ogLocale = (lang: Lang): string =>
  lang === "uk" ? "uk_UA" : "en_US";

export const htmlLangAttr = (lang: Lang): string => (lang === "uk" ? "uk" : "en");

const warnedKeys = new Set<string>();

/**
 * t(key) повертає рядок поточної локалі.
 * Fallback на українську лишається лише як технічний захист (не основний механізм).
 */
export function useTranslations(lang: Lang) {
  const dict = ui[lang] ?? ui[defaultLang];
  return function t(key: string): string {
    const value = dict[key] ?? ui[defaultLang][key];
    if (typeof value !== "string") {
      if (!warnedKeys.has(key)) {
        warnedKeys.add(key);
        console.warn(`[i18n] missing translation key: "${key}"`);
      }
      return key;
    }
    return value;
  };
}

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "/") || "/";

const baseWithSlash = BASE.endsWith("/") ? BASE : `${BASE}/`;

/** Нормалізує логічний шлях до вигляду "/", "/about" (без локалі, без base). */
export function normalizePath(path: string): string {
  let p = String(path || "/").trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

/** Внутрішнє посилання з урахуванням BASE_URL і локалі. uk → /about, en → /en/about */
export function localePath(path: string, lang: Lang): string {
  const logical = normalizePath(path);
  const clean = logical === "/" ? "" : logical.replace(/^\//, "");
  const prefix = lang === defaultLang ? "" : `${lang}`;

  const parts = [prefix, clean].filter(Boolean).join("/");
  if (!parts) return baseWithSlash; // домашня сторінка локалі
  return `${baseWithSlash}${parts}`;
}

/** Абсолютний URL для canonical / og:url / hreflang (без зайвого трейлінг-слеша). */
export function absoluteUrl(path: string, lang: Lang): string {
  const logical = normalizePath(path);
  const clean = logical === "/" ? "" : logical.replace(/^\//, "");
  const prefix = lang === defaultLang ? "" : `${lang}`;
  const parts = [prefix, clean].filter(Boolean).join("/");
  return parts ? `${SITE_URL}/${parts}` : `${SITE_URL}/`;
}

export type Alternate = { hreflang: string; href: string };

/** hreflang-альтернативи для <head> (uk, en, x-default). */
export function alternates(path: string): Alternate[] {
  return [
    { hreflang: "uk", href: absoluteUrl(path, "uk") },
    { hreflang: "en", href: absoluteUrl(path, "en") },
    { hreflang: "x-default", href: absoluteUrl(path, "uk") },
  ];
}

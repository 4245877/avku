// apps/web/public/scripts/app.js
(function () {
  const storageKey = "avku_lang";
  const defaultLang = document.documentElement.lang || "uk";

  // Базовый путь из мета-тега (Astro BASE_URL), например "/avku/"
  const BASE =
    document
      .querySelector('meta[name="app-base"]')
      ?.getAttribute("content") || "/";

  function join(path) {
    // Если вдруг передали полный URL — не трогаем
    if (/^https?:\/\//i.test(String(path))) return String(path);

    const clean = String(path).replace(/^\//, "");
    const baseFixed = BASE.endsWith("/") ? BASE : BASE + "/";
    return baseFixed + clean;
  }

  function setNavHandlers() {
    const btn = document.querySelector("[data-nav-toggle]");
    const nav = document.querySelector("[data-nav]");
    if (!btn || !nav) return;

    btn.addEventListener("click", () => {
      const isOpen = nav.getAttribute("data-open") === "true";
      nav.setAttribute("data-open", String(!isOpen));
    });

    // Закрывать меню при клике по ссылке (мобилки)
    nav.addEventListener("click", (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (a) nav.setAttribute("data-open", "false");
    });
  }

  async function loadDict(lang) {
    try {
      // Важно: без ведущего "/" внутри join
      const res = await fetch(join(`lang/${lang}.json`), { cache: "no-cache" });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function getOriginal(el, slot, read) {
    const key = `translateOriginal${slot}`;
    if (!(key in el.dataset)) {
      el.dataset[key] = read();
    }
    return el.dataset[key];
  }

  function valueFrom(dict, key) {
    if (!dict || !key) return "";
    const value = dict[key];
    return typeof value === "string" ? value : "";
  }

  function applyText(el, dict, lang) {
    const original = getOriginal(el, "Text", () => el.textContent || "");
    const direct = el.getAttribute(`data-translate-${lang}`) || "";
    const keyed = valueFrom(dict, el.getAttribute("data-translate"));

    el.textContent = keyed || direct || original;
  }

  const translatableAttrs = [
    { attr: "placeholder", suffix: "placeholder" },
    { attr: "aria-label", suffix: "aria-label" },
    { attr: "alt", suffix: "alt" },
    { attr: "title", suffix: "title" },
    { attr: "value", suffix: "value" },
    { attr: "data-title", suffix: "data-title" },
    { attr: "data-alt", suffix: "data-alt" },
    { attr: "data-caption", suffix: "data-caption" },
  ];

  function applyAttr(el, dict, lang, config) {
    const { attr, suffix } = config;
    const original = getOriginal(el, `Attr${suffix.replace(/[^a-z0-9]/gi, "")}`, () =>
      el.getAttribute(attr) || ""
    );
    const direct = el.getAttribute(`data-translate-${lang}-${suffix}`) || "";
    const keyed = valueFrom(dict, el.getAttribute(`data-translate-${suffix}`));
    const next = keyed || direct || original;

    if (next) el.setAttribute(attr, next);
  }

  function applyDict(dict, lang) {
    const textSelector = [
      "[data-translate]",
      "[data-translate-en]",
      "[data-translate-uk]",
    ].join(",");

    document.querySelectorAll(textSelector).forEach((el) => {
      applyText(el, dict, lang);
    });

    for (const config of translatableAttrs) {
      const selector = [
        `[data-translate-${config.suffix}]`,
        `[data-translate-en-${config.suffix}]`,
        `[data-translate-uk-${config.suffix}]`,
      ].join(",");

      document.querySelectorAll(selector).forEach((el) => {
        applyAttr(el, dict, lang, config);
      });
    }
  }

  async function setLanguage(lang) {
    const safeLang = (lang || "").trim() || defaultLang;

    localStorage.setItem(storageKey, safeLang);
    document.documentElement.lang = safeLang;

    const dict = await loadDict(safeLang);
    applyDict(dict, safeLang);

    // Подсветка кнопок языка (класс .active управляет градиентом в CSS)
    document.querySelectorAll("[data-lang]").forEach((b) => {
      const isCurrent = b.getAttribute("data-lang") === safeLang;
      b.setAttribute("aria-pressed", String(isCurrent));
      b.classList.toggle("active", isCurrent);
    });

    document.dispatchEvent(
      new CustomEvent("avku:language-change", {
        detail: { lang: safeLang },
      })
    );
  }

  function setLangHandlers() {
    document.querySelectorAll("[data-lang]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lang = btn.getAttribute("data-lang");
        setLanguage(lang);
      });
    });
  }

  // Init
  setNavHandlers();
  setLangHandlers();

  const saved = localStorage.getItem(storageKey);
  setLanguage(saved || defaultLang);
})();

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

  function applyDict(dict) {
    if (!dict) return;

    document.querySelectorAll("[data-translate]").forEach((el) => {
      const key = el.getAttribute("data-translate");
      if (!key) return;

      const value = dict[key];
      if (typeof value === "string" && value.length) {
        el.textContent = value;
      }
    });
  }

  async function setLanguage(lang) {
    const safeLang = (lang || "").trim() || defaultLang;

    localStorage.setItem(storageKey, safeLang);
    document.documentElement.lang = safeLang;

    const dict = await loadDict(safeLang);
    applyDict(dict);

    // Подсветка кнопок языка
    document.querySelectorAll("[data-lang]").forEach((b) => {
      b.setAttribute(
        "aria-pressed",
        String(b.getAttribute("data-lang") === safeLang)
      );
    });
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

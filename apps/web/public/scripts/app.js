// apps/web/public/scripts/app.js
//
// Переклад тепер виконується на сервері (SSR/SSG) за URL-локаллю:
//   uk → /about, en → /en/about
// Тому клієнтський рушій перекладу прибрано. Цей скрипт лишає тільки
// допоміжні задачі: запам'ятовування обраної мови та м'який редірект
// з кореня сайту на бажану локаль для тих, хто вже робив вибір.
(function () {
  "use strict";

  const KEY = "avku_lang";

  function safeSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  }
  function safeGet(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  }

  // 1) Запам'ятовуємо явний вибір мови (посилання-перемикачі мають data-lang-switch).
  document.querySelectorAll("[data-lang-switch]").forEach((a) => {
    a.addEventListener("click", () => {
      const lang = a.getAttribute("data-lang-switch");
      if (lang === "uk" || lang === "en") safeSet(KEY, lang);
    });
  });

  // 2) Одноразовий м'який редірект із кореня (uk) на бажану локаль (en),
  //    якщо користувач уже обирав англійську. Без циклів (sessionStorage-прапор).
  try {
    const base =
      document.querySelector('meta[name="app-base"]')?.getAttribute("content") ||
      "/";
    const baseFixed = base.endsWith("/") ? base : base + "/";
    const enRoot = baseFixed + "en/";

    const pref = safeGet(KEY);
    const path = location.pathname;
    const onUkRoot =
      path === baseFixed || path === baseFixed.replace(/\/$/, "");

    const REDIR_FLAG = "avku_lang_redirected";
    const alreadyRedirected = (() => {
      try {
        return sessionStorage.getItem(REDIR_FLAG) === "1";
      } catch {
        return true; // якщо sessionStorage недоступний — не ризикуємо циклом
      }
    })();

    if (onUkRoot && pref === "en" && !alreadyRedirected) {
      try {
        sessionStorage.setItem(REDIR_FLAG, "1");
      } catch {}
      location.replace(enRoot);
    }
  } catch {}
})();

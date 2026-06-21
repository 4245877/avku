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

  // Применяет переведённый текст, СОХРАНЯЯ дочерние элементы (иконки <i>, <svg>, <img>)
  // и многострочность (<br>). Перевод никогда не вставляется как HTML — только как текст.
  function setTranslatedText(el, text) {
    const nodes = Array.from(el.childNodes);
    const elementChildren = nodes.filter((n) => n.nodeType === Node.ELEMENT_NODE);
    const hasBr = elementChildren.some((n) => n.tagName === "BR");
    const hasOtherEl = elementChildren.some((n) => n.tagName !== "BR");

    // Простой случай: только текст — заменяем целиком.
    if (!hasBr && !hasOtherEl) {
      el.textContent = text;
      return;
    }

    // Многострочный блок (например адрес): \n в переводе → отдельные строки через <br>.
    if (hasBr && !hasOtherEl) {
      const lines = String(text).split("\n");
      el.replaceChildren();
      lines.forEach((line, i) => {
        if (i > 0) el.appendChild(document.createElement("br"));
        el.appendChild(document.createTextNode(line));
      });
      return;
    }

    // Есть дочерние элементы (иконки): меняем только текстовые узлы, иконки сохраняем.
    const textNodes = nodes.filter((n) => n.nodeType === Node.TEXT_NODE);
    const significant = textNodes.filter((n) => n.nodeValue.trim() !== "");

    if (significant.length === 0) {
      // Текстового узла нет — добавим, сохранив отступ от иконки.
      const firstIsIcon =
        nodes[0] && nodes[0].nodeType === Node.ELEMENT_NODE;
      const node = document.createTextNode(firstIsIcon ? " " + text : text + " ");
      if (firstIsIcon) el.appendChild(node);
      else el.insertBefore(node, el.firstChild);
      return;
    }

    // Сохраняем исходные пробелы вокруг текста (отступ до/после иконки).
    const first = significant[0];
    const leading = (first.nodeValue.match(/^\s*/) || [""])[0];
    const trailing = (first.nodeValue.match(/\s*$/) || [""])[0];
    first.nodeValue = leading + text + trailing;
    significant.slice(1).forEach((n) => {
      n.nodeValue = "";
    });
  }

  function applyText(el, dict, lang) {
    const original = getOriginal(el, "Text", () => el.textContent || "");
    const direct = el.getAttribute(`data-translate-${lang}`) || "";
    const keyed = valueFrom(dict, el.getAttribute("data-translate"));

    setTranslatedText(el, keyed || direct || original);
  }

  const translatableAttrs = [
    { attr: "placeholder", suffix: "placeholder" },
    { attr: "aria-label", suffix: "aria-label" },
    { attr: "alt", suffix: "alt" },
    { attr: "title", suffix: "title" },
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
  setLangHandlers();

  const saved = localStorage.getItem(storageKey);
  setLanguage(saved || defaultLang);
})();

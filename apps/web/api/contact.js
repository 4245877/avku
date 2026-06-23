// apps/web/api/contact.js
//
// Канонічний обробник звернень із сайту (Vercel serverless function → /api/contact).
// Приймає всі три форми сайту (contact / join / donation-report) і пересилає їх у Telegram.
//
// Захист: allowlist origin-ів (CORS), honeypot, валідація e-mail/довжини, best-effort
// rate-limit. Для відвідувачів без JavaScript повертає просту HTML-сторінку-підтвердження.

const FORM_TITLES = {
  contact: "Contact form",
  join: "Volunteer form",
  "donation-report": "Donation report request",
};

// Поля-пастки для ботів. Реальні користувачі лишають їх порожніми.
const HONEYPOT_FIELDS = ["company", "website", "_gotcha"];

// Origin-и, яким дозволено звертатися до API. Розширюється через ENV ALLOWED_ORIGINS.
const DEFAULT_ALLOWED_ORIGINS = ["https://avku.org", "https://www.avku.org"];

// Best-effort rate limit. У serverless памʼять живе лише в межах теплого інстансу,
// тож це не залізний бар'єр, а м'яке гальмо проти простого флуду.
const RATE_LIMIT_MAX = 6;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const rateHits = new Map(); // ip -> number[] (timestamps)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Максимальні довжини полів (захист від «роздування» повідомлень).
const FIELD_LIMITS = {
  name: 120,
  email: 160,
  contact: 160,
  city: 120,
  direction: 160,
  campaign: 200,
  amount: 60,
  message: 4000,
  comment: 4000,
  page: 300,
};

function allowedOrigins() {
  const extra = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]);
}

// Налаштовує CORS-заголовки. Повертає { ok, origin }:
// - дозволений origin → рефлектимо його;
// - origin відсутній (native-сабміт/curl) → пропускаємо (CORS тут не захищає);
// - чужий origin → ok:false (блокуємо).
function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const origin = req.headers?.origin;
  if (!origin) return { ok: true, origin: null };

  if (allowedOrigins().has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    return { ok: true, origin };
  }
  return { ok: false, origin };
}

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (typeof res.status === "function") return res.status(status).json(data);
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function html(res, status, markup) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.statusCode = status;
  return res.end(markup);
}

function clean(value, max = 1200) {
  return String(value ?? "").replace(/\r/g, "").trim().slice(0, max);
}

function clientIp(req) {
  const xff = String(req.headers?.["x-forwarded-for"] || "");
  if (xff) return xff.split(",")[0].trim();
  return (
    req.headers?.["x-real-ip"] ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "unknown"
  );
}

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (rateHits.get(ip) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX) {
    rateHits.set(ip, recent);
    return true;
  }

  recent.push(now);
  rateHits.set(ip, recent);

  // Періодичне прибирання, щоб Map не ріс безмежно на теплому інстансі.
  if (rateHits.size > 5000) {
    for (const [key, list] of rateHits) {
      const fresh = list.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
      if (fresh.length) rateHits.set(key, fresh);
      else rateHits.delete(key);
    }
  }
  return false;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body || (await readRawBody(req));
  if (!raw) return {};

  const contentType = String(req.headers?.["content-type"] || "");
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Повертає { code, error } або null.
function validate(type, data) {
  if (type === "contact") {
    if (!data.name || !data.email || !data.message) {
      return { code: "validation", error: "Name, email, and message are required." };
    }
    if (!EMAIL_RE.test(data.email)) {
      return { code: "email", error: "Please provide a valid email address." };
    }
    if (data.message.length < 5) {
      return { code: "validation", error: "Message is too short." };
    }
    return null;
  }

  if (type === "join") {
    if (!data.name || !data.contact) {
      return { code: "validation", error: "Name and contact are required." };
    }
    return null;
  }

  if (type === "donation-report") {
    if (!data.contact) {
      return { code: "validation", error: "Contact is required." };
    }
    return null;
  }

  return null;
}

function buildTelegramText(type, data) {
  const title = FORM_TITLES[type] || "Website form";
  const rows = [
    ["Type", title],
    ["Name", data.name],
    ["Email", data.email],
    ["Contact", data.contact],
    ["City", data.city],
    ["Direction", data.direction],
    ["Campaign", data.campaign],
    ["Amount", data.amount],
    ["Message", data.message],
    ["Comment", data.comment],
    ["Page", data.page],
  ].filter(([, value]) => clean(value));

  return ["New AVKU website request", "", ...rows.map(([key, value]) => `${key}: ${clean(value)}`)].join("\n");
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, status: 503, code: "not_configured", error: "Telegram delivery is not configured." };
  }

  // Без parse_mode: надсилаємо звичайний текст, тож спецсимволи в полях нічого не ламають.
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    return { ok: false, status: 502, code: "delivery_failed", error: "Telegram delivery failed." };
  }

  return { ok: true };
}

// Запит без JS (нативний сабміт форми) очікує HTML, а не JSON.
function wantsHtml(req) {
  const accept = String(req.headers?.accept || "");
  return accept.includes("text/html") && !accept.includes("application/json");
}

// Безпечне посилання «назад»: лише наші origin-и (або localhost для розробки).
function safeBackUrl(data, corsOrigin, req) {
  const allow = new Set([...DEFAULT_ALLOWED_ORIGINS]);
  const candidates = [clean(data.page, 300), req.headers?.referer, corsOrigin, "https://avku.org"];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const u = new URL(candidate);
      const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      if (allow.has(`${u.protocol}//${u.host}`) || (isLocal && u.protocol.startsWith("http"))) {
        return u.toString();
      }
    } catch {
      /* ignore malformed candidate */
    }
  }
  return "https://avku.org";
}

function htmlPage({ heading, message, backUrl }) {
  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(heading)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
  .card{max-width:480px;text-align:center;background:#1e293b;border-radius:16px;padding:40px 32px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
  h1{font-size:1.4rem;margin:0 0 12px}
  p{margin:0 0 24px;line-height:1.6;color:#cbd5e1}
  a{display:inline-block;padding:12px 24px;border-radius:9999px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600}
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="${encodeURI(backUrl)}">← Повернутися на сайт / Back to site</a>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = cors.ok ? 204 : 403;
    return res.end();
  }

  if (req.method !== "POST") {
    return json(res, 405, { success: false, code: "method", error: "Method Not Allowed" });
  }

  if (!cors.ok) {
    return json(res, 403, { success: false, code: "forbidden", error: "Origin not allowed." });
  }

  const useHtml = wantsHtml(req);

  if (isRateLimited(clientIp(req))) {
    if (useHtml) {
      return html(
        res,
        429,
        htmlPage({
          heading: "Забагато запитів / Too many requests",
          message: "Будь ласка, зачекайте кілька хвилин і спробуйте ще раз. / Please wait a few minutes and try again.",
          backUrl: safeBackUrl({}, cors.origin, req),
        }),
      );
    }
    return json(res, 429, { success: false, code: "rate_limited", error: "Too many requests. Please try again later." });
  }

  const rawBody = await parseBody(req);
  const data = Object.fromEntries(
    Object.entries(rawBody).map(([key, value]) => [key, clean(value, FIELD_LIMITS[key] ?? 1200)]),
  );
  const type = data.formType || data.type || "contact";
  const backUrl = safeBackUrl(data, cors.origin, req);

  // Honeypot: якщо приховане поле заповнене — це бот. Вдаємо успіх, але нічого не шлемо.
  if (HONEYPOT_FIELDS.some((field) => clean(rawBody[field]))) {
    if (useHtml) {
      return html(res, 200, htmlPage({ heading: "Дякуємо! / Thank you!", message: "Повідомлення надіслано. / Your message has been sent.", backUrl }));
    }
    return json(res, 200, { success: true });
  }

  const validationError = validate(type, data);
  if (validationError) {
    if (useHtml) {
      return html(res, 400, htmlPage({
        heading: "Перевірте форму / Check the form",
        message: validationError.error,
        backUrl,
      }));
    }
    return json(res, 400, { success: false, code: validationError.code, error: validationError.error });
  }

  try {
    const delivery = await sendTelegram(buildTelegramText(type, data));
    if (!delivery.ok) {
      if (useHtml) {
        return html(res, delivery.status || 502, htmlPage({
          heading: "Не вдалося надіслати / Could not send",
          message: "Спробуйте пізніше або напишіть нам напряму. / Please try later or contact us directly.",
          backUrl,
        }));
      }
      return json(res, delivery.status || 502, { success: false, code: delivery.code, error: delivery.error });
    }

    if (useHtml) {
      return html(res, 200, htmlPage({
        heading: "Дякуємо! / Thank you!",
        message: "Повідомлення надіслано. Ми звʼяжемося з вами. / Your message has been sent. We will get back to you.",
        backUrl,
      }));
    }
    return json(res, 200, { success: true });
  } catch (error) {
    if (useHtml) {
      return html(res, 502, htmlPage({
        heading: "Сталася помилка / Something went wrong",
        message: "Спробуйте пізніше або напишіть нам напряму. / Please try later or contact us directly.",
        backUrl,
      }));
    }
    return json(res, 502, { success: false, code: "delivery_failed", error: "Message delivery failed.", details: String(error) });
  }
}

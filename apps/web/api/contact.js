const FORM_TITLES = {
  contact: "Contact form",
  join: "Volunteer form",
  "donation-report": "Donation report request",
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (typeof res.status === "function") return res.status(status).json(data);
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}

function clean(value, max = 1200) {
  return String(value ?? "").replace(/\r/g, "").trim().slice(0, max);
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

  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body || await readRawBody(req);
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

function validate(type, data) {
  if (type === "contact" && (!data.name || !data.email || !data.message)) {
    return "Name, email, and message are required.";
  }

  if (type === "join" && (!data.name || !data.contact)) {
    return "Name and contact are required.";
  }

  if (type === "donation-report" && !data.contact) {
    return "Contact is required.";
  }

  return "";
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
    return { ok: false, status: 503, error: "Telegram delivery is not configured." };
  }

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
    return { ok: false, status: 502, error: "Telegram delivery failed." };
  }

  return { ok: true };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return json(res, 405, { success: false, error: "Method Not Allowed" });

  const rawBody = await parseBody(req);
  const data = Object.fromEntries(Object.entries(rawBody).map(([key, value]) => [key, clean(value)]));
  const type = data.formType || data.type || "contact";
  const validationError = validate(type, data);

  if (validationError) {
    return json(res, 400, { success: false, error: validationError });
  }

  try {
    const delivery = await sendTelegram(buildTelegramText(type, data));
    if (!delivery.ok) {
      return json(res, delivery.status || 502, { success: false, error: delivery.error });
    }

    return json(res, 200, { success: true });
  } catch (error) {
    return json(res, 502, { success: false, error: "Message delivery failed.", details: String(error) });
  }
}

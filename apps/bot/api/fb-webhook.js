// apps/bot/api/fb-webhook.js
const crypto = require("crypto");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyMetaSignature(rawBody, signature256, appSecret) {
  if (!signature256 || !appSecret) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return timingSafeEqual(expected, signature256);
}

module.exports = async (req, res) => {
  // 1) Webhook verification (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.FB_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send("Forbidden");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // 2) Read raw body (needed for signature verification)
  const raw = await readRawBody(req);
  const sig = req.headers["x-hub-signature-256"];
  const okSig = verifyMetaSignature(raw, sig, process.env.FB_APP_SECRET);
  if (!okSig) {
    // можно ослабить до логирования, но лучше держать строго
    res.status(401).send("Invalid signature");
    return;
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).send("Bad JSON");
    return;
  }

  // 3) Быстро отвечаем Meta, а обработку делаем отдельно
  res.status(200).send("OK");

  // 4) Извлекаем сообщения Page/Messenger
  // Формат: entry[].messaging[] для Messenger webhooks
  const jobs = [];
  for (const entry of body.entry || []) {
    for (const evt of entry.messaging || []) {
      const msg = evt.message;
      if (!msg || msg.is_echo) continue;

      const text = (msg.text || "").trim();
      const attachments = (msg.attachments || [])
        .map((a) => ({
          type: a.type,
          url: a?.payload?.url || null,
        }))
        .filter((a) => a.url);

      // если вообще пусто — пропускаем
      if (!text && attachments.length === 0) continue;

      jobs.push({
        pageId: entry.id,
        senderId: evt.sender?.id,
        timestamp: evt.timestamp,
        text,
        attachments,
      });
    }
  }

  // 5) Триггерим обработчик (внутренний endpoint)
  // Важно: это уже не блокирует ответ Meta.
  const secret = process.env.INTERNAL_JOB_SECRET;
  const target = process.env.PROCESS_ENDPOINT_URL; // например https://<bot>.vercel.app/api/process-fb-event
  if (!target || !secret) return;

  for (const job of jobs) {
    try {
      await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": secret,
        },
        body: JSON.stringify(job),
      });
    } catch (e) {
      // здесь лучше логирование в Sentry/Logtail, но без падения
      console.error("enqueue failed", e);
    }
  }
};

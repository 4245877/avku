// apps/bot/api/tg-reports-webhook.js
const crypto = require("crypto");
const { Redis } = require("@upstash/redis");
const { waitUntil } = require("@vercel/functions");
const dns = require("node:dns");

dns.setDefaultResultOrder("ipv4first");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const REPORTS_JSON_PATH =
  process.env.REPORTS_JSON_PATH || "apps/web/src/data/reports.json";
const GALLERY_FOLDER = process.env.GALLERY_FOLDER || "Фото звіт 2026";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(
  url,
  opts = {},
  { retries = 5, timeoutMs = 15000 } = {}
) {
  let attempt = 0;
  while (true) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: ac.signal });
      clearTimeout(t);

      // ретраим 429 и 5xx
      if (
        (r.status === 429 || (r.status >= 500 && r.status <= 599)) &&
        attempt < retries
      ) {
        const backoff =
          Math.min(5000, 300 * 2 ** attempt) +
          Math.floor(Math.random() * 200);
        await sleep(backoff);
        attempt++;
        continue;
      }
      return r;
    } catch (e) {
      clearTimeout(t);
      const code = e?.cause?.code;
      const transient =
        e?.name === "AbortError" ||
        ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"].includes(code);

      if (!transient || attempt >= retries) throw e;

      const backoff =
        Math.min(5000, 300 * 2 ** attempt) +
        Math.floor(Math.random() * 200);
      await sleep(backoff);
      attempt++;
    }
  }
}

function getMsg(update) {
  return (
    update?.message ||
    update?.edited_message ||
    update?.channel_post ||
    update?.edited_channel_post ||
    update?.callback_query?.message ||
    null
  );
}

function extractCommands(msg) {
  const text = msg?.text || msg?.caption || "";
  const ents = msg?.entities || msg?.caption_entities || [];
  const out = new Set();

  for (const e of ents) {
    if (e.type !== "bot_command") continue;
    const raw = text.slice(e.offset, e.offset + e.length); // "/publish@Bot"
    const cmd = raw
      .split(/\s+/)[0]
      .replace(/@[\w_]+$/i, "")
      .toLowerCase();
    out.add(cmd);
  }

  // запасной вариант, если entities нет
  if (out.size === 0 && text) {
    const m = text.match(/(^|\s)(\/[a-z0-9_]+)(@[\w_]+)?(\s|$)/i);
    if (m?.[2]) out.add(m[2].toLowerCase());
  }

  return out;
}

function encGhPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function kyivDateISO(ts) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kiev",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(ts));
}

function pickCategory(text) {
  const t = (text || "").toLowerCase();
  const m = t.match(/#category\s+([a-z0-9_-]+)/i);
  if (m) return m[1];
  if (t.includes("#partners")) return "partners";
  if (t.includes("#events")) return "events";
  if (t.includes("#aid")) return "aid";
  return "reports";
}

function stripMeta(text) {
  return (text || "")
    .split("\n")
    .filter((l) => !l.trim().toLowerCase().startsWith("#category"))
    .join("\n")
    .trim();
}

function slugifyUA(str) {
  const map = {
    а: "a",
    б: "b",
    в: "v",
    г: "h",
    ґ: "g",
    д: "d",
    е: "e",
    є: "ie",
    ж: "zh",
    з: "z",
    и: "y",
    і: "i",
    ї: "i",
    й: "i",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "kh",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ь: "",
    ю: "iu",
    я: "ia",
    А: "a",
    Б: "b",
    В: "v",
    Г: "h",
    Ґ: "g",
    Д: "d",
    Е: "e",
    Є: "ie",
    Ж: "zh",
    З: "z",
    И: "y",
    І: "i",
    Ї: "i",
    Й: "i",
    К: "k",
    Л: "l",
    М: "m",
    Н: "n",
    О: "o",
    П: "p",
    Р: "r",
    С: "s",
    Т: "t",
    У: "u",
    Ф: "f",
    Х: "kh",
    Ц: "ts",
    Ч: "ch",
    Ш: "sh",
    Щ: "shch",
    Ь: "",
    Ю: "iu",
    Я: "ia",
  };
  const tr = (str || "")
    .split("")
    .map((c) => (map[c] !== undefined ? map[c] : c))
    .join("");
  return tr
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function allowedUser(fromId) {
  const s = (process.env.TG_ALLOWED_USER_IDS || "").trim();
  if (!s) return true; // если не задано — доступ открыт
  const set = new Set(s.split(",").map((x) => x.trim()).filter(Boolean));
  return set.has(String(fromId));
}

async function tgSend(chatId, text) {
  const token = process.env.TG_REPORTS_BOT_TOKEN;
  if (!token) throw new Error("Missing TG_REPORTS_BOT_TOKEN");

  const r = await fetchRetry(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    },
    { timeoutMs: 12000, retries: 6 }
  );

  const j = await r.json().catch(() => null);
  if (!j?.ok) {
    throw new Error(
      `Telegram sendMessage failed: ${j?.description || r.status}`
    );
  }
}

// мягкая отправка — чтобы сетевые сбои/ошибки телеги не рвали логику
async function tgSendSafe(chatId, text) {
  try {
    await tgSend(chatId, text);
  } catch (e) {
    console.error("[tg] send failed", e?.cause?.code || e?.message || e);
  }
}

async function tgGetFileUrl(fileId) {
  const token = process.env.TG_REPORTS_BOT_TOKEN;
  const r = await fetchRetry(
    `https://api.telegram.org/bot${token}/getFile`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    },
    { timeoutMs: 12000, retries: 6 }
  );
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram getFile failed: ${j.description || "?"}`);

  const filePath = j.result.file_path;
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const ext = (filePath.split(".").pop() || "jpg").toLowerCase();
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  return { url, ext: safeExt === "jpeg" ? "jpg" : safeExt };
}

async function openaiTransform({ text, nPhotos }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");

  const system = [
    "Ти редактор сайту АВКУ.",
    "Зроби заголовок і короткий підсумок українською.",
    "Без хештегів. Тон нейтральний, ввічливий.",
    "Поверни СУВОРО JSON без markdown.",
    `Схема: {"title":"...","summary":"...","media":[{"alt":"...","caption":"..."}]}`,
    `Масив media має бути довжини ${nPhotos}.`,
  ].join("\n");

  const r = await fetchRetry("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: text || "" },
      ],
    }),
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`OpenAI error: ${data?.error?.message || r.status}`);

  let obj = {};
  try {
    obj = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
  } catch {}

  const title = String(obj.title || "").trim() || "Фото звіт";
  const summary = String(obj.summary || "").trim() || "Короткий опис події.";
  const media = Array.isArray(obj.media) ? obj.media : [];
  while (media.length < nPhotos) media.push({ alt: "Фото звіт", caption: "" });

  return { title, summary, media: media.slice(0, nPhotos) };
}

async function ghRequest(method, urlPath, body) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repo || !token) throw new Error("Missing GitHub env");

  const url = `https://api.github.com/repos/${owner}/${repo}${urlPath}`;
  const r = await fetchRetry(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!r.ok) {
    throw new Error(`GitHub API error: ${json?.message || text || r.status}`);
  }

  return json;
}

async function ghGetFile(path, ref) {
  const p = encGhPath(path);
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = await ghRequest("GET", `/contents/${p}${q}`);
  const buf = Buffer.from(data.content || "", "base64");
  return { sha: data.sha, text: buf.toString("utf8") };
}

async function ghCommitMany({ branch, message, files }) {
  const ref = await ghRequest(
    "GET",
    `/git/ref/heads/${encodeURIComponent(branch)}`
  );
  const headSha = ref.object.sha;
  const headCommit = await ghRequest("GET", `/git/commits/${headSha}`);
  const baseTreeSha = headCommit.tree.sha;

  const blobs = [];
  for (const f of files) {
    const blob = await ghRequest("POST", `/git/blobs`, {
      content: f.contentBase64,
      encoding: "base64",
    });
    blobs.push({ path: f.path, sha: blob.sha });
  }

  const tree = await ghRequest("POST", `/git/trees`, {
    base_tree: baseTreeSha,
    tree: blobs.map((b) => ({
      path: b.path,
      mode: "100644",
      type: "blob",
      sha: b.sha,
    })),
  });

  const commit = await ghRequest("POST", `/git/commits`, {
    message,
    tree: tree.sha,
    parents: [headSha],
  });

  await ghRequest(
    "PATCH",
    `/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      sha: commit.sha,
      force: false,
    }
  );

  return commit.sha;
}

function nextIndex(reports, folderName) {
  const prefix = `images/gallery/${folderName}/`;
  let max = 0;

  for (const r of reports) {
    for (const m of r.media || []) {
      const src = String(m.src || "");
      if (!src.startsWith(prefix)) continue;
      const name = src.slice(prefix.length);
      const n = parseInt(name.split(".")[0], 10);
      if (!Number.isNaN(n)) max = Math.max(max, n);
    }
  }

  return max + 1;
}

async function loadDraft(chatId) {
  return (await redis.get(`draft:reports:${chatId}`)) || null;
}

async function saveDraft(chatId, draft) {
  await redis.set(`draft:reports:${chatId}`, draft, { ex: 60 * 60 * 24 });
}

async function clearDraft(chatId) {
  await redis.del(`draft:reports:${chatId}`);
}

function extractPhotoFileIds(msg) {
  const ids = [];

  // обычные фото
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const largest = msg.photo[msg.photo.length - 1];
    if (largest?.file_id) ids.push(largest.file_id);
  }

  // если отправят "файлом" (document), но это картинка
  const doc = msg.document;
  if (doc?.file_id && typeof doc.mime_type === "string") {
    if (doc.mime_type.startsWith("image/")) ids.push(doc.file_id);
  }

  return ids;
}

// Вся обработка "после 200 OK" — здесь
async function processUpdate(update) {
  try {
    const msg = getMsg(update);
    if (!msg) {
      console.log("[tg] skip: no msg keys", Object.keys(update || {}));
      return;
    }

    const chatId = msg.chat?.id;

    // ВАЖНО: для callback_query правильный fromId — update.callback_query.from.id
    const fromId =
      update?.callback_query?.from?.id ||
      update?.inline_query?.from?.id ||
      msg.from?.id ||
      null;

    const text = (msg.text || msg.caption || "").trim();
    const commands = extractCommands(msg);

    console.log("[tg] update", {
      update_id: update?.update_id,
      chatId,
      fromId,
      text: text.slice(0, 80),
      commands: Array.from(commands),
    });

    if (!chatId) return;
    if (!fromId) return;

    if (!allowedUser(fromId)) {
      await tgSendSafe(chatId, "Вибач, у тебе немає доступу до публікації.");
      return;
    }

    // команды
    if (commands.has("/start") || commands.has("/help")) {
      await tgSendSafe(
        chatId,
        [
          "Як користуватись:",
          "1) Надішли текст (можна з #category partners).",
          "2) Надішли фото (можна альбомом або кількома повідомленнями).",
          "3) Надішли /publish — я додам звіт на сайт.",
          "Команди: /publish, /cancel",
        ].join("\n")
      );
      return;
    }

    if (commands.has("/cancel")) {
      await clearDraft(chatId);
      await tgSendSafe(chatId, "Добре. Чернетку скасовано.");
      return;
    }

    if (commands.has("/publish")) {
      const draft = await loadDraft(chatId);
      if (!draft || !draft.photos?.length) {
        await tgSendSafe(
          chatId,
          "Я не бачу чернетки з фото. Надішли текст і фото, будь ласка."
        );
        return;
      }

      try {
        const dateISO = kyivDateISO(draft.timestamp || Date.now());
        const year = dateISO.slice(0, 4);
        const cleanText = stripMeta(draft.text || "");
        const category = pickCategory(draft.text || "");

        const ai = await openaiTransform({
          text: cleanText,
          nPhotos: draft.photos.length,
        });

        const { text: jsonText } = await ghGetFile(
          REPORTS_JSON_PATH,
          GITHUB_BRANCH
        );

        let root = {};
        try {
          root = JSON.parse(jsonText);
        } catch {}

        const reports = Array.isArray(root.reports) ? root.reports : [];
        let idx = nextIndex(reports, GALLERY_FOLDER);

        const filesToCommit = [];
        const mediaEntries = [];

        for (let i = 0; i < draft.photos.length; i++) {
          const fileId = draft.photos[i];
          const { url, ext } = await tgGetFileUrl(fileId);

          const imgRes = await fetchRetry(url, {}, { timeoutMs: 20000, retries: 6 });
          if (!imgRes.ok) throw new Error(`Photo download failed: ${imgRes.status}`);

          const buf = Buffer.from(await imgRes.arrayBuffer());
          const fileName = `${idx}.${ext}`;
          idx++;

          const repoPath = `apps/web/public/images/gallery/${GALLERY_FOLDER}/${fileName}`;
          filesToCommit.push({
            path: repoPath,
            contentBase64: buf.toString("base64"),
          });

          const meta = ai.media[i] || {};
          mediaEntries.push({
            src: `images/gallery/${GALLERY_FOLDER}/${fileName}`,
            alt: String(meta.alt || "Фото звіт").trim(),
            caption: String(meta.caption || "").trim(),
          });
        }

        const slug =
          slugifyUA(ai.title) ||
          crypto
            .createHash("sha1")
            .update(ai.title + dateISO)
            .digest("hex")
            .slice(0, 10);

        // логика по годам: report-2026-...
        let id = `report-${year}-${slug}`;
        const exists = new Set(reports.map((r) => r.id));
        if (exists.has(id)) id = `${id}-${Date.now().toString().slice(-4)}`;

        const titleKey = `report_${year}_${slug}_title`;
        const summaryKey = `report_${year}_${slug}_sum`;

        const record = {
          id,
          dateISO,
          category,
          titleKey,
          titleFallback: ai.title,
          summaryKey,
          summaryFallback: ai.summary,
          media: mediaEntries,
        };

        const nextRoot = { ...root, reports: [record, ...reports] };
        const nextText = JSON.stringify(nextRoot, null, 2) + "\n";

        filesToCommit.push({
          path: REPORTS_JSON_PATH,
          contentBase64: Buffer.from(nextText, "utf8").toString("base64"),
        });

        const commitSha = await ghCommitMany({
          branch: GITHUB_BRANCH,
          message: `chore(reports): add ${id}`,
          files: filesToCommit,
        });

        await clearDraft(chatId);
        await tgSendSafe(chatId, `Готово. Додано: ${id}\nCommit: ${commitSha}`);
      } catch (e) {
        console.error("[publish] error", e?.stack || e);
        await tgSendSafe(chatId, `Сталася помилка: ${String(e?.message || e)}`);
      }
      return;
    }

    // обычное сообщение: сохраняем/обновляем черновик
    const fileIds = extractPhotoFileIds(msg);
    const draft = (await loadDraft(chatId)) || {
      text: "",
      photos: [],
      timestamp: msg.date ? msg.date * 1000 : Date.now(),
    };

    if (text) draft.text = text;
    if (fileIds.length) draft.photos.push(...fileIds);
    draft.timestamp = msg.date ? msg.date * 1000 : Date.now();

    await saveDraft(chatId, draft);

    const hint = draft.photos.length
      ? `Чернетку збережено: фото=${draft.photos.length}. Надішли /publish.`
      : "Текст збережено. Тепер додай фото і надішли /publish.";

    await tgSendSafe(chatId, hint);
  } catch (e) {
    console.error("[tg] processUpdate failed", e?.message || e);
  }
}

module.exports = async (req, res) => {
  // Для проверки в браузере разрешаем GET/HEAD без секрета
  if (req.method !== "POST") {
    res.status(200).send("OK");
    return;
  }

  // Telegram secret header (secret_token при setWebhook)
  const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
  if (
    process.env.TG_WEBHOOK_SECRET &&
    secretHeader !== process.env.TG_WEBHOOK_SECRET
  ) {
    res.status(401).send("Unauthorized");
    return;
  }

  let update;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    update = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.status(400).send("Bad JSON");
    return;
  }

  res.status(200).send("OK");
  waitUntil(processUpdate(update));
};

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

const GALLERY_FOLDER_PREFIX =
  process.env.GALLERY_FOLDER_PREFIX || "Фото звіт"; // => "Фото звіт 2026"

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

      if (
        (r.status === 409 ||
          r.status === 429 ||
          (r.status >= 500 && r.status <= 599)) &&
        attempt < retries
      ) {
        const backoff =
          Math.min(5000, 300 * 2 ** attempt) + Math.floor(Math.random() * 200);
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
        Math.min(5000, 300 * 2 ** attempt) + Math.floor(Math.random() * 200);
      await sleep(backoff);
      attempt++;
    }
  }
}

function safeJsonParse(s, fallback = null) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
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
    const raw = text.slice(e.offset, e.offset + e.length);
    const cmd = raw
      .split(/\s+/)[0]
      .replace(/@[\w_]+$/i, "")
      .toLowerCase();
    out.add(cmd);
  }

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

function stripMeta(text) {
  return (text || "")
    .split("\n")
    .filter((l) => {
      const t = l.trim().toLowerCase();
      return !t.startsWith("#category");
    })
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
  if (!s) return true;
  const set = new Set(s.split(",").map((x) => x.trim()).filter(Boolean));
  return set.has(String(fromId));
}

function mimeByExt(ext) {
  const e = String(ext || "jpg").toLowerCase();
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  return "image/jpeg";
}

function tgFileExtFromPath(filePath) {
  const ext = (filePath.split(".").pop() || "jpg").toLowerCase();
  return ["jpg", "jpeg", "png", "webp"].includes(ext)
    ? ext === "jpeg"
      ? "jpg"
      : ext
    : "jpg";
}

function pendingKey(chatId, originMessageId) {
  return `pending:reports:${chatId}:${originMessageId}`;
}

function lastPendingKey(chatId) {
  return `pending:reports:last:${chatId}`;
}

function lockKey(chatId, originMessageId) {
  return `lock:reports:${chatId}:${originMessageId}`;
}

function dedupeUpdateKey(updateId) {
  return `dedupe:tg:update:${updateId}`;
}

function globalPublishLockKey() {
  return "lock:reports:publish:global";
}

async function acquireGlobalPublishLock() {
  return await setNx(globalPublishLockKey(), "1", 60); // 60 сек хватает с запасом
}

async function releaseGlobalPublishLock() {
  await redis.del(globalPublishLockKey());
}

// ---------- Telegram ----------
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
  return j.result;
}

async function tgSendKb(chatId, text, reply_markup) {
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
        reply_markup,
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
  return j.result;
}

async function tgAnswerCallback(id, text) {
  const token = process.env.TG_REPORTS_BOT_TOKEN;
  if (!token) throw new Error("Missing TG_REPORTS_BOT_TOKEN");

  const r = await fetchRetry(
    `https://api.telegram.org/bot${token}/answerCallbackQuery`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callback_query_id: id,
        ...(text ? { text } : {}),
      }),
    },
    { timeoutMs: 12000, retries: 6 }
  );

  const j = await r.json().catch(() => null);
  if (!j?.ok) {
    console.error(
      "[tg] answerCallbackQuery failed",
      j?.description || r.status
    );
  }
}

async function tgSendSafe(chatId, text) {
  try {
    await tgSend(chatId, text);
  } catch (e) {
    console.error("[tg] send failed", e?.cause?.code || e?.message || e);
  }
}

async function tgGetFileMeta(fileId) {
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

  const j = await r.json().catch(() => null);
  if (!j?.ok) throw new Error(`Telegram getFile failed: ${j?.description || "?"}`);

  const filePath = j.result.file_path;
  return {
    filePath,
    ext: tgFileExtFromPath(filePath),
    url: `https://api.telegram.org/file/bot${token}/${filePath}`,
  };
}

async function tgDownloadFile(fileId) {
  const meta = await tgGetFileMeta(fileId);
  const imgRes = await fetchRetry(meta.url, {}, { timeoutMs: 20000, retries: 6 });
  if (!imgRes.ok) throw new Error(`Photo download failed: ${imgRes.status}`);

  const buf = Buffer.from(await imgRes.arrayBuffer());
  return { ...meta, buffer: buf };
}

// ---------- OpenAI ----------
function fallbackTransform({ text, nPhotos, isPartners, defaultDateISO }) {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  const title =
    clean.split(".")[0]?.slice(0, 96).trim() ||
    (isPartners ? "Звіт від партнерів" : "Фото звіт");
  const summary =
    clean ||
    (isPartners
      ? "Наші партнери передали допомогу. Дякуємо за підтримку."
      : "Короткий опис події.");

  const media = Array.from({ length: nPhotos }, () => ({
    alt: "Фото звіт",
    caption: "",
  }));

  return {
    dateISO: defaultDateISO,
    category: "zsu",
    title,
    summary,
    media,
  };
}

function extractResponsesOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data?.output)) {
    let out = "";
    for (const item of data.output) {
      if (!Array.isArray(item?.content)) continue;
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c.text === "string") {
          out += c.text;
        }
      }
    }
    if (out.trim()) return out.trim();
  }

  return "";
}

function sanitizeAiResult(obj, { nPhotos, defaultDateISO, isPartners }) {
  const title = String(obj?.title || "").trim() || (isPartners ? "Звіт від партнерів" : "Фото звіт");
  const summary = String(obj?.summary || "").trim() || "Короткий опис події.";
  const dateISO =
    /^\d{4}-\d{2}-\d{2}$/.test(String(obj?.dateISO || ""))
      ? String(obj.dateISO)
      : defaultDateISO;

  const rawCat = String(obj?.category || "").trim().toLowerCase();

  // мягкая нормализация "похожих" значений от ИИ
  const aliases = {
    med: "medical",
    medicine: "medical",
    medical: "medical",
    evac: "other",
    evacuation: "other",
    civilians: "other",
    civil: "other",
    events: "other",
    repair: "repair",
    partners: "partners",
    humanitarian: "humanitarian",
    zsu: "zsu",
    other: "other",
  };

  const normalizedCat = aliases[rawCat] || "other";
  const allowedCats = new Set(["zsu", "repair", "humanitarian", "medical", "partners", "other"]);
  const category = allowedCats.has(normalizedCat) ? normalizedCat : "other";

  const media = Array.isArray(obj?.media) ? obj.media.slice(0, nPhotos) : [];
  while (media.length < nPhotos) media.push({ alt: "Фото звіт", caption: "" });

  return {
    dateISO,
    category,
    title,
    summary,
    media: media.map((m) => ({
      alt: String(m?.alt || "Фото звіт").trim().slice(0, 160),
      caption: String(m?.caption || "").trim().slice(0, 200),
    })),
  };
}

async function openaiTransform({ text, images, isPartners, defaultDateISO }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");

  const nPhotos = images.length;

  const partnersLine = isPartners
    ? "Обов’язково вкажи, що допомога/дія здійснена нашими партнерами. Формулюй коректно й без перебільшень."
    : "Не згадуй партнерів, якщо їх явно не вказано у вхідному тексті.";

  const prompt = [
    "Ти редактор фотозвітів АВКУ (українською мовою).",
    "Завдання: сформувати короткий заголовок, короткий суцільний опис, alt/caption для фото.",
    partnersLine,
    "Не вигадуй точних фактів (кількість, назви підрозділів, місце, модель техніки), якщо цього немає у вхідних даних.",
    "Стиль: коротко, чітко, грамотно, теплий офіційний тон.",
    "Без хештегів, без списків.",
    "Категорія має бути однією з: zsu, repair, humanitarian, medical, partners, other.",
    `Якщо дату не можна визначити з тексту/фото, постав dateISO=${defaultDateISO}.`,
  ].join("\n");

  const content = [
    { type: "input_text", text: `Контекст від користувача:\n${text || ""}` },
  ];

  for (const img of images) {
    const mime = mimeByExt(img.ext);
    const b64 = img.buffer.toString("base64");
    content.push({
      type: "input_image",
      image_url: `data:${mime};base64,${b64}`,
    });
  }

  const schema = {
    name: "avku_report_entry",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["dateISO", "category", "title", "summary", "media"],
      properties: {
        dateISO: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        category: {
          type: "string",
          enum: ["zsu", "repair", "humanitarian", "medical", "partners", "other"],
        },
        title: { type: "string", minLength: 3, maxLength: 140 },
        summary: { type: "string", minLength: 10, maxLength: 900 },
        media: {
          type: "array",
          minItems: nPhotos,
          maxItems: nPhotos,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["alt", "caption"],
            properties: {
              alt: { type: "string", minLength: 2, maxLength: 160 },
              caption: { type: "string", minLength: 0, maxLength: 200 },
            },
          },
        },
      },
    },
  };

  const r = await fetchRetry(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: prompt }],
          },
          {
            role: "user",
            content,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            ...schema,
          },
        },
      }),
    },
    { timeoutMs: 45000, retries: 3 }
  );

  const data = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(`OpenAI error: ${data?.error?.message || r.status}`);
  }

  const rawText = extractResponsesOutputText(data);
  const parsed = safeJsonParse(rawText, null);
  if (!parsed) {
    throw new Error("OpenAI returned invalid JSON");
  }

  return sanitizeAiResult(parsed, { nPhotos, defaultDateISO, isPartners });
}

async function openaiTransformSafe(args) {
  try {
    return await openaiTransform(args);
  } catch (e) {
    console.error("[openai] failed, fallback", e?.message || e);
    return fallbackTransform({
      text: args.text,
      nPhotos: args.images.length,
      isPartners: args.isPartners,
      defaultDateISO: args.defaultDateISO,
    });
  }
}

// ---------- GitHub ----------
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
    const err = new Error(`GitHub API error: ${json?.message || text || r.status}`);
    err.status = r.status;
    err.body = json || text;
    throw err;
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

async function ghGetFileOptional(path, ref) {
  try {
    return await ghGetFile(path, ref);
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
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

async function ghCommitManyRetry(args, retries = 3) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await ghCommitMany(args);
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || "");
      const transient = e?.status === 409 || /Reference update failed|fast forward/i.test(msg);
      if (!transient || i === retries) break;
      await sleep(400 * (i + 1) + Math.floor(Math.random() * 200));
    }
  }
  throw lastErr;
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

function parseReportsFile(text) {
  const parsed = safeJsonParse(text, null);

  if (Array.isArray(parsed)) {
    // поддержка формата plain array (на случай если путь укажут на массив)
    return {
      kind: "array",
      root: parsed,
      reports: parsed,
    };
  }

  if (parsed && typeof parsed === "object") {
    const reports = Array.isArray(parsed.reports) ? parsed.reports : [];
    return {
      kind: "object",
      root: parsed,
      reports,
    };
  }

  return {
    kind: "object",
    root: { reports: [] },
    reports: [],
  };
}

function stringifyReportsFile(container, nextReports) {
  if (container.kind === "array") {
    return JSON.stringify(nextReports, null, 2) + "\n";
  }
  const nextRoot = { ...(container.root || {}), reports: nextReports };
  return JSON.stringify(nextRoot, null, 2) + "\n";
}

// ---------- Redis state ----------
async function setNx(key, value, exSec) {
  const r = await redis.set(key, value, { nx: true, ex: exSec });
  return !!r;
}

async function savePending(chatId, originMessageId, data) {
  await redis.set(pendingKey(chatId, originMessageId), data, { ex: 60 * 60 * 24 });
  await redis.set(lastPendingKey(chatId), String(originMessageId), { ex: 60 * 60 * 24 });
}

async function loadPending(chatId, originMessageId) {
  return (await redis.get(pendingKey(chatId, originMessageId))) || null;
}

async function loadLastPending(chatId) {
  const originMessageId = await redis.get(lastPendingKey(chatId));
  if (!originMessageId) return null;
  const p = await loadPending(chatId, Number(originMessageId));
  return p ? { originMessageId: Number(originMessageId), pending: p } : null;
}

async function clearPending(chatId, originMessageId) {
  await redis.del(pendingKey(chatId, originMessageId));

  const last = await redis.get(lastPendingKey(chatId));
  if (String(last || "") === String(originMessageId)) {
    await redis.del(lastPendingKey(chatId));
  }
}

async function markUpdateSeen(updateId) {
  if (updateId == null) return true;
  return await setNx(dedupeUpdateKey(updateId), "1", 60 * 60 * 24);
}

async function acquirePublishLock(chatId, originMessageId) {
  return await setNx(lockKey(chatId, originMessageId), "1", 60 * 10);
}

async function releasePublishLock(chatId, originMessageId) {
  await redis.del(lockKey(chatId, originMessageId));
}

// ---------- message/photo helpers ----------
function extractPhotoFileIds(msg) {
  const ids = [];

  // msg.photo = размеры одной и той же фотографии -> берём самый крупный
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const largest = msg.photo[msg.photo.length - 1];
    if (largest?.file_id) ids.push(largest.file_id);
  }

  // image as document
  const doc = msg.document;
  if (doc?.file_id && typeof doc.mime_type === "string") {
    if (doc.mime_type.startsWith("image/")) ids.push(doc.file_id);
  }

  return ids;
}

function makeQuestionKeyboard(originMessageId) {
  return {
    inline_keyboard: [
      [{ text: "Так, партнери", callback_data: `kind:partners:${originMessageId}` }],
      [{ text: "Ні", callback_data: `kind:reports:${originMessageId}` }],
    ],
  };
}

// ---------- publish pipeline ----------
async function publishPending({ chatId, originMessageId, pending, isPartners }) {
  const cleanText = stripMeta(pending.text || "");
  const defaultDateISO = kyivDateISO(pending.timestamp || Date.now());
  const year = defaultDateISO.slice(0, 4);
  const folderName = `${GALLERY_FOLDER_PREFIX} ${year}`;

  // 1) download photos (сейчас поддержка 1 фото, но код готов к нескольким id)
  const downloaded = [];
  for (const fileId of pending.photos || []) {
    downloaded.push(await tgDownloadFile(fileId));
  }
  if (!downloaded.length) throw new Error("No photos in pending");

  // 2) AI transform (text + images)
  const ai = await openaiTransformSafe({
    text: cleanText,
    images: downloaded.map((x) => ({ buffer: x.buffer, ext: x.ext })),
    isPartners,
    defaultDateISO,
  });

  const dateISO = ai.dateISO || defaultDateISO;
  const recordYear = dateISO.slice(0, 4);

  // 3) load reports json (or create if missing)
  const existingFile = await ghGetFileOptional(REPORTS_JSON_PATH, GITHUB_BRANCH);
  const container = existingFile
    ? parseReportsFile(existingFile.text)
    : { kind: "object", root: { reports: [] }, reports: [] };

  const reports = Array.isArray(container.reports) ? container.reports : [];

  let idx = nextIndex(reports, folderName);
  const filesToCommit = [];
  const mediaEntries = [];

  for (let i = 0; i < downloaded.length; i++) {
    const img = downloaded[i];
    const fileName = `${idx}.${img.ext}`;
    idx++;

    const repoPath = `apps/web/public/images/gallery/${folderName}/${fileName}`;
    filesToCommit.push({
      path: repoPath,
      contentBase64: img.buffer.toString("base64"),
    });

    const meta = ai.media[i] || {};
    mediaEntries.push({
      src: `images/gallery/${folderName}/${fileName}`,
      alt: String(meta.alt || "Фото звіт").trim() || "Фото звіт",
      caption: String(meta.caption || "").trim(),
    });
  }

  const slug =
    slugifyUA(ai.title) ||
    crypto
      .createHash("sha1")
      .update(String(ai.title || "") + dateISO)
      .digest("hex")
      .slice(0, 10);

  let id = `report-${recordYear}-${slug}`;
  const exists = new Set(reports.map((r) => r?.id).filter(Boolean));
  if (exists.has(id)) id = `${id}-${Date.now().toString().slice(-4)}`;

  const titleKey = `report_${recordYear}_${slug}_title`;
  const summaryKey = `report_${recordYear}_${slug}_sum`;

  const record = {
    id,
    dateISO,
    category: ai.category || "other",
    titleKey,
    titleFallback: ai.title,
    summaryKey,
    summaryFallback: ai.summary,
    media: mediaEntries,
  };

  const nextReports =
    container.kind === "array"
      ? [record, ...reports]
      : [record, ...reports];

  const nextText = stringifyReportsFile(container, nextReports);

  filesToCommit.push({
    path: REPORTS_JSON_PATH,
    contentBase64: Buffer.from(nextText, "utf8").toString("base64"),
  });

  const commitSha = await ghCommitManyRetry({
    branch: GITHUB_BRANCH,
    message: `chore(reports): add ${id}`,
    files: filesToCommit,
  });

  return { id, commitSha, record };
}

// ---------- Main processing ----------
async function processUpdate(update) {
  try {
    // idempotency for duplicated webhook deliveries
    const isFirst = await markUpdateSeen(update?.update_id);
    if (!isFirst) {
      console.log("[tg] duplicate update skipped", update?.update_id);
      return;
    }

    // 1) callback query first
    if (update?.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const fromId = cq.from?.id;
      const data = String(cq.data || "");

      // answer immediately to stop spinner
      if (cq?.id) {
        await tgAnswerCallback(cq.id).catch((e) =>
          console.error("[tg] answer callback error", e?.message || e)
        );
      }

      console.log("[tg] callback", { chatId, fromId, data });

      if (!chatId || !fromId) return;
      if (!allowedUser(fromId)) {
        await tgSendSafe(chatId, "Вибач, у тебе немає доступу до публікації.");
        return;
      }

      const m = data.match(/^kind:(partners|reports):(\d+)$/);
      if (!m) return;

      const kind = m[1];
      const originMessageId = Number(m[2]);
      const isPartners = kind === "partners";

      const pending = await loadPending(chatId, originMessageId);
      if (!pending) {
        await tgSendSafe(
          chatId,
          "Чернетку не знайдено або вона вже оброблена. Надішли фото з текстом ще раз, будь ласка."
        );
        return;
      }

      const locked = await acquirePublishLock(chatId, originMessageId);
      if (!locked) {
        await tgSendSafe(chatId, "Цей звіт уже обробляється. Будь ласка, зачекай.");
        return;
      }

      try {
        await tgSendSafe(
          chatId,
          isPartners
            ? "Добре. Публікую як звіт від партнерів…"
            : "Добре. Публікую як звичайний звіт…"
        );

        const globalLocked = await acquireGlobalPublishLock();
        if (!globalLocked) {
          await tgSendSafe(
            chatId,
            "Зараз обробляється інша публікація. Будь ласка, спробуй ще раз через кілька секунд."
          );
          return;
        }

        try {
          const result = await publishPending({
            chatId,
            originMessageId,
            pending,
            isPartners,
          });

          await clearPending(chatId, originMessageId);

          await tgSendSafe(
            chatId,
            `Готово ✅\nДодано: ${result.id}\nCommit: ${result.commitSha}`
          );
        } finally {
          await releaseGlobalPublishLock();
        }
      } catch (e) {
        console.error("[publish] error", e?.stack || e);
        await tgSendSafe(
          chatId,
          `Сталася помилка під час публікації: ${String(e?.message || e)}`
        );
      } finally {
        await releasePublishLock(chatId, originMessageId);
      }

      return;
    }

    // 2) regular message
    const msg = getMsg(update);
    if (!msg) {
      console.log("[tg] skip: no msg keys", Object.keys(update || {}));
      return;
    }

    const chatId = msg.chat?.id;
    const fromId =
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

    if (!chatId || !fromId) return;

    if (!allowedUser(fromId)) {
      await tgSendSafe(chatId, "Вибач, у тебе немає доступу до публікації.");
      return;
    }

    // help/start
    if (commands.has("/start") || commands.has("/help")) {
      await tgSendSafe(
        chatId,
        [
          "Як користуватись:",
          "1) Надішли фото з текстом (в одному повідомленні).",
          "2) Я спитаю: «Партнёры или нет?»",
          "3) Після відповіді я автоматично підготую запис і додам на сайт.",
          "",
          "Додатково: /cancel — скасувати останню чернетку",
          "/publish — повторно показати питання для останньої чернетки",
        ].join("\n")
      );
      return;
    }

    if (commands.has("/cancel")) {
      const last = await loadLastPending(chatId);
      if (!last) {
        await tgSendSafe(chatId, "Немає активної чернетки.");
        return;
      }
      await clearPending(chatId, last.originMessageId);
      await tgSendSafe(chatId, "Добре. Останню чернетку скасовано.");
      return;
    }

    // compatibility: /publish repeats question for last pending
    if (commands.has("/publish")) {
      const last = await loadLastPending(chatId);
      if (!last) {
        await tgSendSafe(
          chatId,
          "Я не бачу чернетки. Надішли фото з текстом одним повідомленням, будь ласка."
        );
        return;
      }

      await tgSendKb(chatId, "Партнёры или нет?", makeQuestionKeyboard(last.originMessageId));
      return;
    }

    // main required flow: photo + text => ask question immediately
    const fileIds = extractPhotoFileIds(msg);
    if (fileIds.length > 0) {
      if (!text) {
        await tgSendSafe(
          chatId,
          "Будь ласка, надішли фото разом із текстом (підписом) одним повідомленням."
        );
        return;
      }

      const originMessageId = msg.message_id;
      const pending = {
        chatId,
        fromId,
        originMessageId,
        text,
        photos: fileIds, // один file_id (найбільший розмір)
        timestamp: msg.date ? msg.date * 1000 : Date.now(),
        createdAt: Date.now(),
      };

      await savePending(chatId, originMessageId, pending);

      await tgSendKb(chatId, "Партнёры или нет?", makeQuestionKeyboard(originMessageId));
      return;
    }

    // plain text without photo
    if (text) {
      await tgSendSafe(
        chatId,
        "Текст отримала. Тепер, будь ласка, надішли фото разом із цим текстом в одному повідомленні."
      );
      return;
    }
  } catch (e) {
    console.error("[tg] processUpdate failed", e?.stack || e?.message || e);
  }
}

module.exports = async (req, res) => {
  // GET/HEAD for quick browser check
  if (req.method !== "POST") {
    res.status(200).send("OK");
    return;
  }

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

  // return 200 fast, process in background
  res.status(200).send("OK");
  waitUntil(processUpdate(update));
};
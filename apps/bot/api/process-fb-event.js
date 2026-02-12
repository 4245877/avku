// apps/bot/api/process-fb-event.js
const crypto = require("crypto");

function assertInternal(req) {
  const secret = req.headers["x-internal-secret"];
  return (
    secret &&
    process.env.INTERNAL_JOB_SECRET &&
    secret === process.env.INTERNAL_JOB_SECRET
  );
}

function kyivDateISO(ts) {
  const d = new Date(ts);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kiev",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d); // YYYY-MM-DD
}

function stripMetaTags(text) {
  return (text || "")
    .split("\n")
    .filter((line) => !line.trim().toLowerCase().startsWith("#category"))
    .join("\n")
    .trim();
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

function slugifyUA(str) {
  const map = {
    а:"a",б:"b",в:"v",г:"h",ґ:"g",д:"d",е:"e",є:"ie",ж:"zh",з:"z",и:"y",і:"i",ї:"i",й:"i",
    к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",
    ш:"sh",щ:"shch",ь:"",ю:"iu",я:"ia",
    А:"a",Б:"b",В:"v",Г:"h",Ґ:"g",Д:"d",Е:"e",Є:"ie",Ж:"zh",З:"z",И:"y",І:"i",Ї:"i",Й:"i",
    К:"k",Л:"l",М:"m",Н:"n",О:"o",П:"p",Р:"r",С:"s",Т:"t",У:"u",Ф:"f",Х:"kh",Ц:"ts",Ч:"ch",
    Ш:"sh",Щ:"shch",Ь:"",Ю:"iu",Я:"ia",
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

function encodeGhPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function ghRequest(method, urlPath, body) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repo || !token) throw new Error("Missing GitHub env");

  const url = `https://api.github.com/repos/${owner}/${repo}${urlPath}`;
  const r = await fetch(url, {
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
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    throw new Error(`GitHub API error: ${json?.message || text || r.status}`);
  }
  return json;
}

async function ghGetFile(path, ref) {
  const p = encodeGhPath(path);
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = await ghRequest("GET", `/contents/${p}${q}`);
  const buf = Buffer.from(data.content || "", "base64");
  return { sha: data.sha, text: buf.toString("utf8") };
}

async function ghCommitMany({ branch, message, files }) {
  // files: [{ path, contentBase64 }]
  const ref = await ghRequest("GET", `/git/ref/heads/${encodeURIComponent(branch)}`);
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

  await ghRequest("PATCH", `/git/refs/heads/${encodeURIComponent(branch)}`, {
    sha: commit.sha,
    force: false,
  });

  return commit.sha;
}

function extFromContentType(ct) {
  const c = (ct || "").toLowerCase().split(";")[0].trim();
  if (c === "image/jpeg") return "jpg";
  if (c === "image/png") return "png";
  if (c === "image/webp") return "webp";
  return "jpg";
}

async function downloadImage(url, maxBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Image download failed: ${r.status}`);
  const ct = r.headers.get("content-type") || "";
  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length > maxBytes) throw new Error(`Image too large: ${buf.length} bytes`);
  return { buf, contentType: ct };
}

async function openaiTransform({ text, nPhotos }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  // Статичный промпт (фиксированный)
  const system = [
    "Ти редактор сайту АВКУ.",
    "Перетвори вхідний текст у заголовок і короткий підсумок українською.",
    "Тон: нейтральний, уважний, без хештегів.",
    "Поверни СУВОРО JSON без markdown.",
    `Схема: {"title":"...","summary":"...","media":[{"alt":"...","caption":"..."}]}`,
    `Масив media має бути довжини ${nPhotos}. Якщо деталей не вистачає — роби нейтрально й доречно.`,
  ].join("\n");

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: text || "" },
      ],
    }),
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`OpenAI error: ${data?.error?.message || r.status}`);

  const content = data?.choices?.[0]?.message?.content || "{}";
  let obj = {};
  try { obj = JSON.parse(content); } catch {}

  const title = String(obj.title || "").trim() || "Фото звіт";
  const summary = String(obj.summary || "").trim() || "Короткий опис події.";
  const media = Array.isArray(obj.media) ? obj.media : [];

  // добиваем массив до нужной длины
  while (media.length < nPhotos) media.push({ alt: "Фото звіт", caption: "" });

  return { title, summary, media: media.slice(0, nPhotos) };
}

function nextIndexInFolder(reports, folderName) {
  const prefix = `images/gallery/${folderName}/`;
  let max = 0;
  for (const r of reports) {
    for (const m of r.media || []) {
      const src = String(m.src || "");
      if (!src.startsWith(prefix)) continue;
      const name = src.slice(prefix.length);
      const num = parseInt(name.split(".")[0], 10);
      if (!Number.isNaN(num)) max = Math.max(max, num);
    }
  }
  return max + 1;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  if (!assertInternal(req)) {
    res.status(401).send("Unauthorized");
    return;
  }

  let job;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    job = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.status(400).send("Bad JSON");
    return;
  }

  try {
    const reportsPath =
      process.env.REPORTS_JSON_PATH || "apps/web/src/data/reports.json";
    const branch = process.env.GITHUB_BRANCH || "main";

    const galleryFolder = process.env.GALLERY_FOLDER || "Фото звіт 2026";
    const galleryRoot = "apps/web/public/images/gallery";

    const dateISO = kyivDateISO(job.timestamp || Date.now());
    const year = dateISO.slice(0, 4);

    const rawText = stripMetaTags(job.text || "");
    const category = pickCategory(job.text || "");
    const photos = Array.isArray(job.photos) ? job.photos : [];

    // 1) AI
    const ai = await openaiTransform({ text: rawText, nPhotos: photos.length });

    // 2) Read reports.json
    const { text: reportsText } = await ghGetFile(reportsPath, branch);
    let reports = [];
    try { reports = JSON.parse(reportsText); } catch {}
    if (!Array.isArray(reports)) reports = [];

    // 3) Start index for folder numbering
    const startIdx = nextIndexInFolder(reports, galleryFolder);
    const maxMb = parseInt(process.env.MAX_IMAGE_MB || "15", 10);
    const maxBytes = Math.max(1, maxMb) * 1024 * 1024;

    // 4) Download photos + prepare commit files
    const commitFiles = [];
    const mediaEntries = [];
    let idx = startIdx;

    for (let i = 0; i < photos.length; i++) {
      const url = photos[i].url;
      const { buf, contentType } = await downloadImage(url, maxBytes);
      const ext = extFromContentType(contentType);
      const fileName = `${idx}.${ext}`;
      idx++;

      const repoPath = `${galleryRoot}/${galleryFolder}/${fileName}`;
      commitFiles.push({
        path: repoPath,
        contentBase64: buf.toString("base64"),
      });

      const meta = ai.media[i] || {};
      mediaEntries.push({
        src: `images/gallery/${galleryFolder}/${fileName}`,
        alt: String(meta.alt || "Фото звіт").trim(),
        caption: String(meta.caption || "").trim(),
      });
    }

    // 5) Build record
    const title = ai.title;
    const summary = ai.summary;

    const slug = slugifyUA(title) || crypto
      .createHash("sha1")
      .update(title + dateISO)
      .digest("hex")
      .slice(0, 10);

    let id = `report-${dateISO}-${slug}`;
    const existing = new Set(reports.map((r) => r.id));
    if (existing.has(id)) id = `${id}-${Date.now().toString().slice(-4)}`;

    // ключи в стиле примера: report_2026_slug_title / _sum
    const titleKey = `report_${year}_${slug}_title`;
    const summaryKey = `report_${year}_${slug}_sum`;

    const record = {
      id,
      dateISO,
      category,
      titleKey,
      titleFallback: title,
      summaryKey,
      summaryFallback: summary,
      media: mediaEntries,
    };

    const nextReports = [record, ...reports];
    const nextReportsText = JSON.stringify(nextReports, null, 2) + "\n";

    commitFiles.push({
      path: reportsPath,
      contentBase64: Buffer.from(nextReportsText, "utf8").toString("base64"),
    });

    const commitSha = await ghCommitMany({
      branch,
      message: `chore(reports): add ${id}`,
      files: commitFiles,
    });

    res.status(200).json({ ok: true, id, commitSha });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};

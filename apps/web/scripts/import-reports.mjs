import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const inputFile = path.join(root, "src", "data", "reports.json");
const outDir = path.join(root, "src", "content", "reports");

function normalizeReports(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.reports)) return data.reports;
  if (data && typeof data === "object") return [data];
  return [];
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140) || "report";
}

function normalizeDate(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function normalizeCategory(value) {
  const allowed = new Set([
    "zsu",
    "repair",
    "humanitarian",
    "medical",
    "partners",
    "other",
  ]);

  const v = String(value || "").trim();
  return allowed.has(v) ? v : "other";
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function cleanMedia(media) {
  if (!Array.isArray(media)) return [];

  return media
    .map((m) => ({
      src: cleanString(m?.src),
      alt: cleanString(m?.alt),
      caption: cleanString(m?.caption),
    }))
    .filter((m) => m.src);
}

function cleanDocs(docs) {
  if (!Array.isArray(docs)) return [];

  return docs
    .map((d) => ({
      labelFallback: cleanString(d?.labelFallback || d?.label || d?.title),
      labelKey: cleanString(d?.labelKey),
      href: cleanString(d?.href || d?.url),
    }))
    .filter((d) => d.labelFallback && d.href);
}

function cleanOptionalObject(obj, fallbackLabel) {
  if (!obj || typeof obj !== "object") return undefined;

  const href = cleanString(obj.href || obj.url);
  if (!href) return undefined;

  return {
    labelFallback: cleanString(obj.labelFallback || obj.label || fallbackLabel),
    labelKey: cleanString(obj.labelKey),
    href,
  };
}

function scalar(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (value === null) return "null";
  return JSON.stringify(String(value ?? ""));
}

function isScalar(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function removeEmpty(value) {
  if (Array.isArray(value)) {
    return value
      .map(removeEmpty)
      .filter((item) => {
        if (item === undefined) return false;
        if (Array.isArray(item)) return item.length > 0;
        if (item && typeof item === "object") return Object.keys(item).length > 0;
        return true;
      });
  }

  if (value && typeof value === "object") {
    const out = {};

    for (const [key, val] of Object.entries(value)) {
      const cleaned = removeEmpty(val);

      if (cleaned === undefined) continue;
      if (cleaned === "") continue;
      if (Array.isArray(cleaned) && cleaned.length === 0) continue;
      if (cleaned && typeof cleaned === "object" && Object.keys(cleaned).length === 0) continue;

      out[key] = cleaned;
    }

    return out;
  }

  return value;
}

function toYaml(value, indent = 0) {
  const pad = " ".repeat(indent);

  if (isScalar(value)) return scalar(value);

  if (Array.isArray(value)) {
    if (!value.length) return "[]";

    return "\n" + value.map((item) => {
      if (isScalar(item)) return `${pad}- ${scalar(item)}`;
      return `${pad}-\n${toYaml(item, indent + 2)}`;
    }).join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";

    return "\n" + entries.map(([key, val]) => {
      if (isScalar(val)) return `${pad}${key}: ${scalar(val)}`;
      return `${pad}${key}: ${toYaml(val, indent + 2)}`;
    }).join("\n");
  }

  return scalar(value);
}

function frontmatter(data) {
  return Object.entries(data)
    .map(([key, value]) => {
      if (isScalar(value)) return `${key}: ${scalar(value)}`;
      return `${key}: ${toYaml(value, 2)}`;
    })
    .join("\n");
}

const raw = await fs.readFile(inputFile, "utf8");
const parsed = JSON.parse(raw);
const reports = normalizeReports(parsed);

await fs.mkdir(outDir, { recursive: true });

const usedNames = new Map();
const skipped = [];

for (const report of reports) {
  const titleFallback = cleanString(report.titleFallback || report.title || report.name);
  const summaryFallback = cleanString(report.summaryFallback || report.summary || report.excerpt);
  const dateISO = normalizeDate(report.dateISO || report.date);

  if (!titleFallback || !summaryFallback || !dateISO) {
    skipped.push({
      id: report.id || "",
      reason: "missing titleFallback, summaryFallback or dateISO",
    });
    continue;
  }

  const baseId = slugify(report.id || `${dateISO}-${titleFallback}`);
  const count = usedNames.get(baseId) || 0;
  usedNames.set(baseId, count + 1);

  const fileId = count === 0 ? baseId : `${baseId}-${count + 1}`;

  const data = removeEmpty({
    titleFallback,
    titleKey: cleanString(report.titleKey),
    summaryFallback,
    summaryKey: cleanString(report.summaryKey),
    dateISO,
    category: normalizeCategory(report.category),
    media: cleanMedia(report.media),
    docs: cleanDocs(report.docs),
    donation: cleanOptionalObject(report.donation, "Підтримати збір"),
    social: cleanOptionalObject(report.social, "Пост у Facebook"),
    draft: Boolean(report.draft ?? false),
  });

  const body = cleanString(report.body || report.content || report.details || "");

  const md = `---\n${frontmatter(data)}\n---\n\n${body}\n`;

  await fs.writeFile(path.join(outDir, `${fileId}.md`), md, "utf8");
}

console.log(`Imported reports: ${reports.length - skipped.length}`);
console.log(`Skipped reports: ${skipped.length}`);

if (skipped.length) {
  await fs.writeFile(
    path.join(root, "scripts", "import-reports-skipped.json"),
    JSON.stringify(skipped, null, 2),
    "utf8"
  );

  console.log("Skipped list saved to scripts/import-reports-skipped.json");
}
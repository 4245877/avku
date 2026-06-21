// Public jar status endpoint for the web deployment. Requires server-side MONO_TOKEN.
const cache = new Map();

const CACHE_TTL_MS = 60_000;
const MONO_CLIENT_INFO_URL = "https://api.monobank.ua/personal/client-info";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (typeof res.status === "function") return res.status(status).json(data);
  res.statusCode = status;
  return res.end(JSON.stringify(data));
}

function queryValue(req, key) {
  if (req.query && typeof req.query[key] === "string") return req.query[key];
  const host = req.headers?.host || "localhost";
  const parsed = new URL(req.url || "/", `http://${host}`);
  return parsed.searchParams.get(key) || "";
}

function centsToUah(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n) / 100;
}

function responsePayload(jar) {
  const balanceUAH = centsToUah(jar.balance);
  const goalUAH = centsToUah(jar.goal);

  return {
    sendId: jar.sendId,
    title: jar.title || "",
    currencyCode: jar.currencyCode,
    source: "monobank-client-info",
    balanceUAH,
    goalUAH,
    balance: balanceUAH,
    goal: goalUAH,
    amount: balanceUAH,
    raised: balanceUAH,
    currentAmount: balanceUAH,
    target: goalUAH,
    targetAmount: goalUAH,
  };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method Not Allowed" });

  const sendId = queryValue(req, "sendId").trim();
  if (!sendId) return json(res, 400, { error: "Missing sendId" });

  const cached = cache.get(sendId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60");
    return json(res, 200, cached.data);
  }

  const token = process.env.MONO_TOKEN || process.env.MONOBANK_TOKEN;
  if (!token) return json(res, 503, { error: "MONO_TOKEN is not configured" });

  try {
    const monoRes = await fetch(MONO_CLIENT_INFO_URL, {
      headers: { "X-Token": token, Accept: "application/json" },
    });

    if (!monoRes.ok) {
      return json(res, monoRes.status, { error: `Monobank error: ${monoRes.status}` });
    }

    const info = await monoRes.json();
    const jar = Array.isArray(info.jars) ? info.jars.find((item) => item.sendId === sendId) : null;
    if (!jar) return json(res, 404, { error: "Jar not found for sendId" });

    const data = responsePayload(jar);
    cache.set(sendId, { ts: Date.now(), data });

    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60");
    return json(res, 200, data);
  } catch (error) {
    return json(res, 502, { error: "Monobank request failed", details: String(error) });
  }
}

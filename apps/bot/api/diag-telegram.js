const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

module.exports = async (req, res) => {
  const token = process.env.TG_REPORTS_BOT_TOKEN;
  const region = process.env.VERCEL_REGION || null;

  if (!token) {
    res.status(500).json({ ok: false, region, error: "Missing TG_REPORTS_BOT_TOKEN" });
    return;
  }

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const j = await r.json().catch(() => null);
    res.status(200).json({
      ok: true,
      region,
      node: process.version,
      status: r.status,
      tg_ok: j?.ok,
      result: j?.result || j?.description || null,
    });
  } catch (e) {
    res.status(200).json({
      ok: false,
      region,
      node: process.version,
      error: String(e?.cause?.code || e?.message || e),
    });
  }
};

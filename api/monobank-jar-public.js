// api/monobank-jar-public.js (headless-версія для Vercel)
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const cache = new Map();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sendId } = req.query || {};
  if (!sendId) return res.status(400).json({ error: 'Missing sendId' });

  const cached = cache.get(sendId);
  if (cached && Date.now() - cached.ts < 60_000) {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    return res.status(200).json(cached.data);
  }

  let browser;
  try {
    const executablePath =
      process.env.CHROME_EXECUTABLE_PATH || (await chromium.executablePath());

    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: chromium.headless,
      defaultViewport: { width: 1200, height: 900 }
    });

    const page = await browser.newPage();
    await page.goto(`https://send.monobank.ua/jar/${encodeURIComponent(sendId)}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Чекаємо появи валютних сум або кнопки «Поповнити банку»
    await page.waitForFunction(
      () =>
        /₴|грн/i.test(document.body.innerText) ||
        /Поповнити банку|Пополнить банку/i.test(document.body.innerText),
      { timeout: 15000 }
    );

    const { balanceUAH, goalUAH } = await page.evaluate(() => {
      const text = document.body.innerText;

      const nums = Array.from(text.matchAll(/(\d[\d\s\u00A0.,]*)\s*(?:₴|грн)/gi))
        .map(m => Number(m[1].replace(/[\s\u00A0]/g, '').replace(',', '.')))
        .filter(n => Number.isFinite(n) && n > 0);

      let balance = 0, goal = null;
      if (nums.length >= 2) {
        nums.sort((a, b) => a - b);
        balance = Math.round(nums[0]);
        goal    = Math.round(nums[nums.length - 1]);
      } else if (nums.length === 1) {
        balance = Math.round(nums[0]);
      }
      return { balanceUAH: balance, goalUAH: goal };
    });

    const data = { sendId, source: 'scrape-headless', balanceUAH, goalUAH };
    cache.set(sendId, { ts: Date.now(), data });

    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'Scrape failed', details: String(e) });
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
};

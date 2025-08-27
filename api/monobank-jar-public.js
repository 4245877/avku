// api/monobank-jar-public.js
const cache = new Map(); // sendId -> { ts, data }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sendId } = req.query || {};
  if (!sendId) return res.status(400).json({ error: 'Missing sendId' });

  // 1 хв кєш
  const cached = cache.get(sendId);
  if (cached && Date.now() - cached.ts < 60_000) {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    return res.status(200).json(cached.data);
  }

  try {
    const url = `https://send.monobank.ua/jar/${encodeURIComponent(sendId)}`;
    const r = await fetch(url, {
      headers: {
        // даємо UA щоб сторінка коректно рендерилась на стороні монобанку
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8'
      }
    });

    const html = await r.text();

    // ---- Грубий парс: шукаємо всі суми у форматі «12 345 ₴» чи «грн»
    // Далі беремо мінімальне як "зібрано", максимальне як "ціль"
    const amounts = Array.from(
      html.matchAll(/(\d[\d\s\u00A0.,]*)\s*(?:₴|грн)/gi)
    )
      .map(m => Number(m[1].replace(/[\s\u00A0]/g, '').replace(',', '.')))
      .filter(n => Number.isFinite(n) && n > 0);

    let balanceUAH = 0, goalUAH = null;

    if (amounts.length >= 2) {
      amounts.sort((a, b) => a - b);
      balanceUAH = Math.round(amounts[0]);                  // менше — зазвичай «зібрано»
      goalUAH    = Math.round(amounts[amounts.length - 1]); // більше — «ціль»
    } else if (amounts.length === 1) {
      balanceUAH = Math.round(amounts[0]);
    } else {
      // Якщо нічого не знайшли — скажемо фронту, що невдача
      return res.status(502).json({ error: 'Parse failed' });
    }

    const data = { sendId, source: 'scrape-html', balanceUAH, goalUAH };
    cache.set(sendId, { ts: Date.now(), data });

    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Server error', details: String(e) });
  }
};

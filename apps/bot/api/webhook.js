// server.js
// Работает и как Vercel serverless handler (module.exports = ...),
// и как standalone express server при запуске node server.js

const http = require('http');
const { URL } = require('url');

const cache = new Map(); // sendId -> { ts, data }

// helper: универсальный fetch (использует global fetch если есть, иначе node-fetch)
async function getFetch() {
  if (typeof fetch !== 'undefined') return fetch;
  // динамический импорт node-fetch для совместимости с CommonJS
  const nf = await import('node-fetch');
  return nf.default;
}

// -------------------- Monobank handler --------------------
async function handleMonobank(req, res, searchParams) {
  const TOKEN = process.env.MONO_TOKEN;
  const sendId = (searchParams && searchParams.get('sendId')) || '';

  if (!sendId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing sendId' }));
  }
  if (!TOKEN) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Server is not configured (MONO_TOKEN)' }));
  }

  const cached = cache.get(sendId);
  if (cached && Date.now() - cached.ts < 60_000) {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(cached.data));
  }

  try {
    const fetch = await getFetch();
    const r = await fetch('https://api.monobank.ua/personal/client-info', {
      headers: { 'X-Token': TOKEN }
    });

    if (!r.ok) {
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `Monobank error: ${r.status}` }));
    }

    const info = await r.json(); // ожидаем объект с массивом jars
    const jar = Array.isArray(info.jars) ? info.jars.find(j => j.sendId === sendId) : null;
    if (!jar) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Jar not found for sendId' }));
    }

    const data = {
      sendId: jar.sendId,
      title: jar.title,
      currencyCode: jar.currencyCode,
      balance: jar.balance, // в копейках
      goal: jar.goal        // в копейках
    };

    cache.set(sendId, { ts: Date.now(), data });
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  } catch (e) {
    console.error('Monobank error:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Server error', details: String(e) }));
  }
}

// -------------------- Telegram contact handler --------------------
async function handleTelegramPost(req, res, body) {
  // Разрешаем CORS (можно отрегулировать домен при необходимости)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // body уже распарсен и передан сюда как объект
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  const { name, email, message } = body || {};

  if (!name || !email || !message) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'Всі поля є обовʼязковими для заповнення' }));
  }

  const text = `Нове повідомлення з сайту! \n\n*Ім'я:* ${name}\n*Email:* ${email}\n*Сообщение:*\n${message}`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  };

  try {
    const fetch = await getFetch();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data && data.ok) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Повідомлення успішно надіслано!' }));
    } else {
      console.error('Telegram API error:', data);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Помилка при відправці в Telegram.' }));
    }
  } catch (error) {
    console.error('Telegram send error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'Внутрішня помилка сервера.' }));
  }
}

// -------------------- Vercel / serverless handler --------------------
module.exports = async (req, res) => {
  // Handle preflight CORS for any route
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
  res.statusCode = 200;
  return res.end();
  }


  // Parse URL to determine route & query
  let parsed;
  try {
    // some serverless envs provide full URL or only path; use host from headers
    const base = `http://${req.headers.host || 'localhost'}`;
    parsed = new URL(req.url, base);
  } catch (e) {
    parsed = { pathname: req.url || '/', searchParams: new URLSearchParams() };
  }
  const pathname = parsed.pathname || '';
  const searchParams = parsed.searchParams || new URLSearchParams();

  // Route for Monobank: GET with path containing 'monobank-jar' or presence of sendId
  if (req.method === 'GET' && (pathname.endsWith('/monobank-jar') || searchParams.has('sendId'))) {
    return handleMonobank(req, res, searchParams);
  }

  // Route for Telegram contact: accept POST to any path (original behavior)
  if (req.method === 'POST') {
    // Vercel уже обычно парсит JSON и кладёт в req.body.
    const body = req.body || {};

    return handleTelegramPost(req, res, body);
  }

  // Other methods: not allowed
  res.statusCode = 405;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({ success: false, error: 'Method Not Allowed' }));
};

// -------------------- Standalone express server (локальная разработка) --------------------
if (require.main === module) {
  // Запускаем express только при прямом запуске файла: node server.js
  (async () => {
    const express = require('express');
    const app = express();
    const port = process.env.PORT || 3000;

    app.use(express.json());

    // Telegram endpoint (POST)
    app.post('/api/send-telegram', async (req, res) => {
      // reuse same handler (it expects body object)
      // set CORS headers as in serverless
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') return res.status(200).end();
      await handleTelegramPost(req, res, req.body);
    });

    // Monobank endpoint (GET)
    app.get('/api/monobank-jar', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    await handleMonobank(req, res, req.query ? new URLSearchParams(req.query) : null);
    });


    // root diagnostic
    app.get('/', (req, res) => res.send('API is running. Use /api/send-telegram (POST) and /api/monobank-jar?sendId=... (GET)'));

    app.listen(port, () => console.log(`API ready on http://localhost:${port}`));
  })();
}

// apps/web/src/lib/config.ts
//
// Єдине джерело правди для публічних endpoint-ів.
//
// Статичний сайт хоститься на GitHub Pages (avku.org), а serverless API —
// на Vercel. Тому в продакшені браузер мусить звертатися до АБСОЛЮТНОГО URL
// Vercel, інакше POST піде на GitHub Pages і поверне 405.
//
// Абсолютний URL задається на етапі збірки змінною PUBLIC_CONTACT_API_URL
// (див. .env.example і .github/workflows/deploy-pages.yml). Відносний fallback
// лишає робочими `vercel dev` та превʼю, де сайт і API на одному origin.
export const CONTACT_ENDPOINT: string =
  import.meta.env.PUBLIC_CONTACT_API_URL ?? "/api/contact";

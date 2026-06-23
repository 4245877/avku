# Форми та API: архітектура й налаштування

## Топологія розгортання

Сайт і API живуть **на різних хостингах**:

| Частина | Що це | Хостинг | Домен |
| --- | --- | --- | --- |
| `apps/web` (Astro, статика) | HTML/CSS/JS, згенеровані `astro build` | **GitHub Pages** | `https://avku.org` (CNAME) |
| `apps/web/api/*.js` | Serverless-функції (контактна форма, Monobank) | **Vercel** | `https://<web>.vercel.app` |
| `apps/bot/api/*.js` | Бот/вебхуки (Telegram-репорти, Monobank, FB) | **Vercel** | `https://<bot>.vercel.app` |

> GitHub Pages віддає **лише статику** — serverless-функцій там немає. Тому запит
> на `https://avku.org/api/contact` повертав би `405`. Браузер мусить звертатися
> до **абсолютного URL Vercel**.

## Як фронтенд знаходить API

Єдина точка правди — [`src/lib/config.ts`](../src/lib/config.ts):

```ts
export const CONTACT_ENDPOINT =
  import.meta.env.PUBLIC_CONTACT_API_URL ?? "/api/contact";
```

`PUBLIC_CONTACT_API_URL` задається **на етапі збірки** і вшивається в HTML/JS:

- локально — через `.env` (див. [`.env.example`](../.env.example));
- у проді — через **GitHub Actions Variables**, які підхоплює
  [`deploy-pages.yml`](../../../.github/workflows/deploy-pages.yml).

`action` форми та `fetch` у [`public/scripts/forms.js`](../public/scripts/forms.js)
беруть саме цей URL, тож працює і submit через JS, і нативний submit без JS.

## Канонічний обробник

Звернення з усіх трьох форм сайту (`contact`, `join`, `donation-report`)
обробляє **один** файл — [`apps/web/api/contact.js`](../api/contact.js) → `/api/contact`.

`apps/bot/api/webhook.js` має власний (легасі) Telegram-обробник для сумісності;
його залишено узгодженим за форматом і безпекою, але сайт на нього **не** покладається.

## Захист

`apps/web/api/contact.js` робить:

- **CORS allowlist** — лише `https://avku.org`, `https://www.avku.org` (+ `ALLOWED_ORIGINS`);
- **honeypot** — приховане поле `company` (порожнє в людей; заповнене в ботів → тихий «успіх»);
- **валідацію** — обовʼязкові поля, формат e-mail, ліміти довжини;
- **rate-limit** — best-effort, 6 запитів / 10 хв на IP (памʼять теплого інстансу);
- **no-JS fallback** — для нативного submit повертає просту HTML-сторінку-підтвердження.

## Змінні оточення

### GitHub Actions → Variables (публічні, для збірки `apps/web`)

| Змінна | Приклад |
| --- | --- |
| `PUBLIC_CONTACT_API_URL` | `https://<web>.vercel.app/api/contact` |
| `PUBLIC_MONO_API_URL` | `https://<web>.vercel.app/api/monobank-jar-public` |
| `PUBLIC_MONO_SEND_ID` | `AYnqhv5wj7` |

### Vercel → Environment Variables (секрети, для функцій)

| Змінна | Призначення |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | токен бота для надсилання звернень |
| `TELEGRAM_CHAT_ID` | чат/канал, куди падають звернення |
| `MONO_TOKEN` | токен Monobank для статусу банки |
| `ALLOWED_ORIGINS` | *(опц.)* додаткові origin-и через кому (напр. превʼю-домен) |

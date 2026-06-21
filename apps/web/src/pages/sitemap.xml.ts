import type { APIRoute } from "astro";
import { absoluteUrl } from "../i18n/ui";

// Публічні сторінки (обидві локалі). 404/admin не індексуються.
const paths = [
  "/",
  "/about",
  "/events",
  "/news",
  "/publications",
  "/reports",
  "/donate",
  "/join",
  "/contacts",
];

const locales = ["uk", "en"] as const;
const lastmod = new Date().toISOString().slice(0, 10);

export const GET: APIRoute = () => {
  const blocks = paths
    .map((p) => {
      const alternates = [
        `      <xhtml:link rel="alternate" hreflang="uk" href="${absoluteUrl(p, "uk")}"/>`,
        `      <xhtml:link rel="alternate" hreflang="en" href="${absoluteUrl(p, "en")}"/>`,
        `      <xhtml:link rel="alternate" hreflang="x-default" href="${absoluteUrl(p, "uk")}"/>`,
      ].join("\n");

      return locales
        .map(
          (l) => `  <url>
    <loc>${absoluteUrl(p, l)}</loc>
    <lastmod>${lastmod}</lastmod>
${alternates}
  </url>`
        )
        .join("\n");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${blocks}
</urlset>
`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};

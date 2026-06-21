import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://avku.org",
  base: "/",
  i18n: {
    defaultLocale: "uk",
    locales: ["uk", "en"],
    routing: {
      // uk без префікса (/about), en з префіксом (/en/about)
      prefixDefaultLocale: false,
    },
  },
});

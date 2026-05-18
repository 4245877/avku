import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const news = defineCollection({
  loader: glob({
    pattern: "**/*.{md,mdx}",
    base: "./src/content/news",
  }),
  schema: z.object({
    title: z.string(),
    dateISO: z.string(),
    dateLabel: z.string().optional(),
    categoryKey: z.enum([
      "zsu",
      "humanitarian",
      "partnerships",
      "community",
      "awards",
      "events",
    ]).default("zsu"),
    excerpt: z.string(),
    href: z.string().optional(),
    img: z.string().optional(),
    imgAlt: z.string().optional(),
    sourceLabel: z.string().optional(),
    draft: z.boolean().optional().default(false),
  }),
});

const reports = defineCollection({
  loader: glob({
    pattern: "**/*.{md,mdx}",
    base: "./src/content/reports",
  }),
  schema: z.object({
    titleFallback: z.string(),
    titleKey: z.string().optional(),
    summaryFallback: z.string(),
    summaryKey: z.string().optional(),
    dateISO: z.string(),
    category: z.enum([
      "zsu",
      "repair",
      "humanitarian",
      "medical",
      "partners",
      "other",
    ]).default("other"),
    media: z.array(
      z.object({
        src: z.string(),
        alt: z.string().optional(),
        caption: z.string().optional(),
      })
    ).optional().default([]),
    docs: z.array(
      z.object({
        labelFallback: z.string(),
        labelKey: z.string().optional(),
        href: z.string(),
      })
    ).optional().default([]),
    donation: z.object({
      labelFallback: z.string().optional(),
      labelKey: z.string().optional(),
      href: z.string().optional(),
    }).optional(),
    social: z.object({
      labelFallback: z.string().optional(),
      labelKey: z.string().optional(),
      href: z.string().optional(),
    }).optional(),
    draft: z.boolean().optional().default(false),
  }),
});

export const collections = {
  news,
  reports,
};
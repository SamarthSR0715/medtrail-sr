import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { destinations } from "@/lib/travel-content";

const BASE_URL = "https://medtrail-sr.lovable.app";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/travel", changefreq: "weekly", priority: "0.9" },
          { path: "/destinations", changefreq: "weekly", priority: "0.9" },
          { path: "/travel-map", changefreq: "monthly", priority: "0.8" },
          { path: "/gallery", changefreq: "weekly", priority: "0.8" },
          { path: "/bucket-list", changefreq: "monthly", priority: "0.6" },
          { path: "/mbbs", changefreq: "monthly", priority: "0.8" },
          { path: "/fitness", changefreq: "monthly", priority: "0.7" },
          { path: "/portfolio", changefreq: "monthly", priority: "0.7" },
          ...destinations.map<SitemapEntry>((d) => ({
            path: `/destinations/${d.slug}`,
            changefreq: "monthly",
            priority: "0.8",
          })),
        ];

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
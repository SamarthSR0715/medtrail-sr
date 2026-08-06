import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { DestinationMap } from "@/components/travel/destination-map";
import { DestinationCard } from "@/components/travel/destination-sections";
import { categories, destinations, realPhotos, type Category } from "@/lib/travel-content";
import { cn } from "@/lib/utils";

const SITE = "https://medtrailsr.in";
const cover = `${SITE}${realPhotos.pawnaFromTikona}`;

export const Route = createFileRoute("/travel-map")({
  head: () => ({
    meta: [
      { title: "Interactive Travel Map — Trips Around Pune & the Sahyadris | MedTrail" },
      {
        name: "description",
        content:
          "An interactive clustered map of every completed trip from Pune — Kataldhar, Rajmachi, Visapur, Lohagad, Tikona and Pawna Lake with distances, difficulty and route cards.",
      },
      { property: "og:title", content: "Interactive Travel Map — MedTrail" },
      {
        property: "og:description",
        content: "Clustered map of Sahyadri trips with routes from Pune, distances and difficulty.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/travel-map` },
      { property: "og:image", content: cover },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: cover },
    ],
    links: [{ rel: "canonical", href: `${SITE}/travel-map` }],
  }),
  component: TravelMapPage,
});

function TravelMapPage() {
  const [filter, setFilter] = useState<"All" | Category>("All");
  const [routes, setRoutes] = useState(true);

  const visible = destinations.filter((d) => filter === "All" || d.categories.includes(filter));

  return (
    <div className="px-4 pb-20">
      <section className="mx-auto max-w-6xl">
        <SectionHeading
          align="left"
          eyebrow="Interactive Map"
          title={<>Every trip, pinned to the map.</>}
          description="Zoom, cluster and tap a pin for a photo preview, distance from Pune and a link to the full destination guide."
        />

        <Reveal delay={60} className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            <div className="glass flex flex-wrap gap-1 rounded-3xl p-1.5">
              {(["All", ...categories] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFilter(c)}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-medium transition-all",
                    filter === c
                      ? "bg-gradient-brand text-brand-foreground shadow-md"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRoutes((r) => !r)}
              aria-pressed={routes}
              className={cn(
                "rounded-full px-4 py-2.5 text-sm font-medium transition-all",
                routes ? "bg-gradient-brand text-brand-foreground shadow-md" : "glass text-muted-foreground",
              )}
            >
              Route lines from Pune
            </button>
          </div>
        </Reveal>

        <Reveal delay={100} className="mt-6">
          <div className="glass rounded-[1.75rem] p-3 sm:p-4">
            <ClientOnly
              fallback={
                <div className="h-[480px] w-full animate-pulse rounded-[1.5rem] bg-secondary/50" aria-hidden="true" />
              }
            >
              <DestinationMap key={`${filter}-${routes}`} destinations={visible} showRoutes={routes} height={480} />
            </ClientOnly>
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {visible.length} destinations · OpenStreetMap tiles · scroll-zoom disabled for smoother page scrolling
            </p>
          </div>
        </Reveal>

        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((d, i) => (
            <Reveal key={d.slug} delay={i * 60}>
              <DestinationCard d={d} />
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}

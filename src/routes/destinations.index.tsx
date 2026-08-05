import { createFileRoute } from "@tanstack/react-router";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { DestinationCard } from "@/components/travel/destination-sections";
import { destinations, realPhotos } from "@/lib/travel-content";

const SITE = "https://medtrail-sr.lovable.app";
const cover = `${SITE}${realPhotos.kataldharWide}`;

export const Route = createFileRoute("/destinations/")({
  head: () => ({
    meta: [
      { title: "Destination Guides — Detailed Trip Plans from Pune | MedTrail" },
      {
        name: "description",
        content:
          "Full destination guides for Kataldhar, Rajmachi, Visapur, Lohagad, Pawna Lake and Tikona — routes, timelines, real budgets, gear lists and safety notes.",
      },
      { property: "og:title", content: "Destination Guides — MedTrail" },
      {
        property: "og:description",
        content: "Route maps, timelines, budgets and gear lists for every Sahyadri trip from Pune.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/destinations` },
      { property: "og:image", content: cover },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: cover },
    ],
    links: [{ rel: "canonical", href: `${SITE}/destinations` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Sahyadri destination guides from Pune",
          itemListElement: destinations.map((d, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: d.name,
            url: `${SITE}/destinations/${d.slug}`,
          })),
        }),
      },
    ],
  }),
  component: DestinationsIndex,
});

function DestinationsIndex() {
  return (
    <div className="px-4 pb-20">
      <section className="mx-auto max-w-6xl">
        <SectionHeading
          align="left"
          eyebrow="Destinations"
          title={<>Guides, not just galleries.</>}
          description="Each guide carries the route card, a stop-by-stop timeline, real costs, gear lists and the things nobody tells you before the climb."
        />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {destinations.map((d, i) => (
            <Reveal key={d.slug} delay={i * 60}>
              <DestinationCard d={d} />
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}
import { createFileRoute } from "@tanstack/react-router";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { DestinationCard } from "@/components/travel/destination-sections";
import { destinations, realPhotos } from "@/lib/travel-content";

const SITE = "https://medtrailsr.in";
const cover = `${SITE}${realPhotos.kataldharWide}`;

export const Route = createFileRoute("/destinations/")({
  head: () => ({
    meta: [
      { title: "Sahydari Trek guides, Forts and Weekend Destination Near Pune|MedtrailSR" },
      {
        name: "description",
        content:
          "{
    "Explore detailed guides for Tikona Fort, Lohagad, Visapur, Rajmachi, Pawna Lake, Kataldhar Waterfall and other Sahyadri destinations with routes, maps, budgets and travel tips.",
},
      
      { property: "og:title", content: "Sahydari Trek and Destination guides|MedTrailSR" },
      {
        property: "og:description",
        content: 
"Explore detailed trekking guides, forts, waterfalls, camping spots and weekend destinations near Pune, Mumbai and Maharashtra.",
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
          name: "Sahyadri Trek & Destination Guides",
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
          title={<>Sahydari Trek & Destination Guide.</>}
          description="Find detailed travel guides for forts, waterfalls, camping spots and weekend getaways across Maharashtra. Every guide includes routes, timings, budgets, safety tips and original photographs."
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

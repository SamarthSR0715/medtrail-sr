import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import {
  Backpack,
  Camera,
  CloudSun,
  Compass,
  Lightbulb,
  ShieldAlert,
  Sparkles,
  Star,
} from "lucide-react";
import { Reveal } from "@/components/site/reveal";
import { DestinationMap } from "@/components/travel/destination-map";
import { PhotoGallery } from "@/components/travel/photo-gallery";
import {
  ExpenseCard,
  ListCard,
  RouteMapSection,
  SectionBlock,
  TravelInfoCards,
  DestinationCard,
} from "@/components/travel/destination-sections";
import { destinations, getDestination, photos } from "@/lib/travel-content";

const SITE = "https://medtrail-sr.lovable.app";

export const Route = createFileRoute("/destinations/$slug")({
  loader: ({ params }) => {
    const destination = getDestination(params.slug);
    if (!destination) throw notFound();
    return { destination };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Destination unavailable | MedTrail" }, { name: "robots", content: "noindex" }] };
    }
    const d = loaderData.destination;
    const title = `${d.name} from Pune — Route, Budget & Trek Guide | MedTrail`;
    const description = `${d.summary.slice(0, 150)}`;
    const url = `${SITE}/destinations/${d.slug}`;
    const image = `${SITE}${d.hero}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: `${d.name} — Complete Trip Guide` },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { property: "og:image", content: image },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: image },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "TouristAttraction",
              name: d.name,
              description: d.summary,
              url,
              image,
              address: {
                "@type": "PostalAddress",
                addressLocality: d.district,
                addressRegion: d.state,
                addressCountry: "IN",
              },
              geo: { "@type": "GeoCoordinates", latitude: d.lat, longitude: d.lng },
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: d.rating,
                bestRating: 5,
                ratingCount: 1,
              },
              touristType: d.categories.join(", "),
            },
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
                { "@type": "ListItem", position: 2, name: "Destinations", item: `${SITE}/destinations` },
                { "@type": "ListItem", position: 3, name: d.name, item: url },
              ],
            },
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: [
                {
                  "@type": "Question",
                  name: `How far is ${d.name} from Pune?`,
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: `${d.name} is about ${d.distanceKm} km from Pune and takes ${d.travelTime} to reach.`,
                  },
                },
                {
                  "@type": "Question",
                  name: `How difficult is the ${d.name} trek?`,
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: `The trek is rated ${d.difficulty}, covering roughly ${d.trekDistanceKm} km and taking ${d.trekTime}, topping out around ${d.elevationM} m.`,
                  },
                },
                {
                  "@type": "Question",
                  name: `What is the best time to visit ${d.name}?`,
                  acceptedAnswer: { "@type": "Answer", text: `${d.season}. ${d.weather}` },
                },
                {
                  "@type": "Question",
                  name: `How much does a trip to ${d.name} cost?`,
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: d.expenses.map((e) => `${e.label}: ${e.amount}`).join(". "),
                  },
                },
              ],
            },
          ]),
        },
      ],
    };
  },
  component: DestinationPage,
});

function DestinationPage() {
  const { slug } = Route.useParams();
  const d = getDestination(slug);
  if (!d) return null;
  const gallery = photos.filter((p) => p.slug === d.slug);
  const related = destinations.filter((x) => x.slug !== d.slug).slice(0, 3);

  return (
    <div className="px-4 pb-20">
      <article className="mx-auto max-w-6xl">
        <Reveal>
          <div className="glass relative overflow-hidden rounded-[2rem]">
            <img
              src={d.hero}
              alt={d.name}
              width={1920}
              height={1080}
              className="h-64 w-full object-cover sm:h-96"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/40 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6 sm:p-10">
              <p className="flex flex-wrap items-center gap-2 text-xs font-medium">
                {d.categories.map((c) => (
                  <span key={c} className="glass rounded-full px-3 py-1">
                    {c}
                  </span>
                ))}
              </p>
              <h1 className="font-display mt-4 text-3xl font-semibold leading-tight sm:text-5xl">{d.name}</h1>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">{d.tagline}</p>
              <p className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold">
                  <Star className="size-3.5 text-primary" aria-hidden="true" /> {d.rating}/5
                </span>
                <span className="glass rounded-full px-3 py-1.5">
                  {d.district}, {d.state}
                </span>
                <span className="glass rounded-full px-3 py-1.5">
                  Visited{" "}
                  {new Date(d.visitedOn).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </p>
            </div>
          </div>
        </Reveal>

        <SectionBlock eyebrow="At a glance" title="Trip essentials">
          <TravelInfoCards d={d} />
        </SectionBlock>

        <SectionBlock eyebrow="Route" title="Getting there from Pune">
          <RouteMapSection d={d} />
        </SectionBlock>

        <SectionBlock eyebrow="The day" title="Field notes">
          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <Reveal>
              <div className="glass rounded-[1.75rem] p-6 sm:p-8">
                <p className="text-sm leading-relaxed text-muted-foreground">{d.story}</p>
                <div className="mt-6 rounded-2xl border border-border/50 bg-secondary/35 p-5">
                  <p className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <CloudSun className="size-3.5 text-primary" aria-hidden="true" /> Weather
                  </p>
                  <p className="mt-2 text-sm leading-relaxed">{d.weather}</p>
                </div>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <ListCard icon={Sparkles} title="Highlights" items={d.highlights} />
            </Reveal>
          </div>
        </SectionBlock>

        <SectionBlock eyebrow="Plan it" title="Costs, gear & photo spots">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Reveal>
              <ExpenseCard d={d} />
            </Reveal>
            <Reveal delay={80}>
              <ListCard icon={Backpack} title="What to carry" items={d.carry} />
            </Reveal>
            <Reveal delay={160}>
              <ListCard icon={Camera} title="Photo spots" items={d.photoSpots} />
            </Reveal>
            <Reveal delay={200}>
              <ListCard icon={Lightbulb} title="Tips" items={d.tips} />
            </Reveal>
            <Reveal delay={240}>
              <ListCard icon={ShieldAlert} title="Safety" items={d.safety} />
            </Reveal>
            <Reveal delay={280}>
              <ListCard icon={Compass} title="Nearby" items={d.nearby} />
            </Reveal>
          </div>
        </SectionBlock>

        <SectionBlock eyebrow="Location" title="On the map">
          <Reveal>
            <div className="glass rounded-[1.75rem] p-3 sm:p-4">
              <ClientOnly
                fallback={
                  <div className="h-[360px] w-full animate-pulse rounded-[1.5rem] bg-secondary/50" aria-hidden="true" />
                }
              >
                <DestinationMap
                  destinations={[d]}
                  center={[d.lat, d.lng]}
                  zoom={12}
                  cluster={false}
                  height={360}
                />
              </ClientOnly>
            </div>
          </Reveal>
        </SectionBlock>

        {gallery.length ? (
          <SectionBlock eyebrow="Gallery" title={`Photos from ${d.name}`}>
            <PhotoGallery photos={gallery} withFilters={false} withSearch={false} />
          </SectionBlock>
        ) : null}

        <SectionBlock eyebrow="Keep exploring" title="More destinations">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r, i) => (
              <Reveal key={r.slug} delay={i * 60}>
                <DestinationCard d={r} />
              </Reveal>
            ))}
          </div>
          <div className="mt-6">
            <Link
              to="/destinations"
              className="glass inline-flex rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:scale-105"
            >
              All destination guides
            </Link>
          </div>
        </SectionBlock>
      </article>
    </div>
  );
}
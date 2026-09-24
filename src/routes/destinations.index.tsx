import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarClock,
  Compass,
  MapPin,
  Mountain,
  Sparkles,
  ArrowRight,
  Camera,
} from "lucide-react";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { StatsDashboard } from "@/components/travel/stats-dashboard";
import { DestinationCard } from "@/components/travel/destination-sections";
import { PhotoGallery } from "@/components/travel/photo-gallery";
import {
  bucketList,
  destinations,
  photos,
  realPhotos,
  travelStats,
} from "@/lib/travel-content";

const SITE = "https://medtrail-sr.lovable.app";
const cover = `${SITE}${realPhotos.kataldharWide}`;

export const Route = createFileRoute("/destinations/")({
  head: () => ({
    meta: [
      { title: "Destinations & Sahyadri Trek Guides | MedTrail" },
      {
        name: "description",
        content:
          "Explore detailed guides for Tikona Fort, Lohagad, Visapur, Rajmachi, Pawna Lake, Kataldhar Waterfall and other Sahyadri destinations with routes, maps, budgets and original photos.",
      },
      { property: "og:title", content: "Destinations & Sahyadri Trek Guides | MedTrail" },
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
          "@type": "CollectionPage",
          name: "Sahyadri Trek & Destination Guides",
          description:
            "Collection of Sahyadri trekking guides, weekend getaways, forts, waterfalls, camping destinations and nature trails in Maharashtra.",
          url: `${SITE}/destinations`,
          hasPart: destinations.map((d) => ({
            "@type": "TouristAttraction",
            name: d.name,
            url: `${SITE}/destinations/${d.slug}`,
            image: `${SITE}${d.hero}`,
            description: d.summary,
            address: {
              "@type": "PostalAddress",
              addressLocality: d.district,
              addressRegion: d.state,
              addressCountry: "IN",
            },
          })),
        }),
      },
    ],
  }),
  component: DestinationsIndex,
});

const quickLinks = [
  { to: "/travel-map", label: "Interactive Map", primary: true },
  { to: "/destinations", label: "All Destination Guides" },
  { to: "/travel", label: "MedTrail Trips (Group Treks)" },
  { to: "/gallery", label: "Photo Gallery" },
  { to: "/bucket-list", label: "Wishlist" },
] as const;

const wishlist = bucketList.filter((b) => b.status === "Wishlist");

function DestinationsIndex() {
  return (
    <div className="px-4 pb-20">
      <section className="mx-auto max-w-6xl">
        {/* Header */}
        <SectionHeading
          align="left"
          eyebrow="Destinations & Guides"
          title={<>Sahyadri Trek & Destination Guides</>}
          description="Find real travel guides for forts, waterfalls, camping spots and weekend getaways across Maharashtra. Every guide includes verified routes, timings, budgets, safety tips and original photographs shot on the trails."
        />

        {/* Quick Nav Chips */}
        <Reveal delay={40} className="mt-8">
          <div className="flex flex-wrap gap-2.5">
            {quickLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={
                  "primary" in l && l.primary
                    ? "bg-gradient-brand inline-flex rounded-full px-5 py-2.5 text-xs sm:text-sm font-semibold text-brand-foreground shadow-md transition-transform hover:scale-105"
                    : "glass inline-flex rounded-full px-5 py-2.5 text-xs sm:text-sm font-semibold transition-transform hover:scale-105"
                }
              >
                {l.label}
              </Link>
            ))}
          </div>
        </Reveal>

        {/* Stats Dashboard */}
        <div className="mt-10">
          <StatsDashboard />
        </div>

        {/* Interactive Map Callout Banner */}
        <div className="mt-12">
          <Reveal className="glass relative overflow-hidden rounded-[2rem] border border-primary/20 p-6 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
                  <Compass className="size-3.5" /> Interactive Topographic Map
                </span>
                <h3 className="mt-3 text-xl font-bold sm:text-2xl font-display">
                  Explore Sahyadri Trailhead Coordinates
                </h3>
                <p className="mt-1.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  View interactive Leaflet pin markers for Rajgad, Tikona, Visapur, Lohagad, Pawna
                  Lake, and Kataldhar with elevation profiles and driving directions from Pune & Mumbai.
                </p>
              </div>
              <Link
                to="/travel-map"
                className="bg-gradient-brand inline-flex shrink-0 items-center justify-center gap-2 rounded-full px-6 py-3 text-xs sm:text-sm font-semibold text-brand-foreground shadow-md transition-transform hover:scale-105"
              >
                <MapPin className="size-4" /> Open Fullscreen Map
              </Link>
            </div>
          </Reveal>
        </div>

        {/* Destination Guides Grid */}
        <section className="mt-16" id="guides">
          <Reveal>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Trek & Destination Guides
            </span>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Trips Documented on Trail</h2>
            <p className="mt-2 max-w-2xl text-xs sm:text-sm text-muted-foreground">
              Route cards, hour-by-hour timelines, real budgets and gear lists — latest trip:{" "}
              <strong className="text-foreground">{travelStats.recent.name}</strong>.
            </p>
          </Reveal>

          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {destinations.map((d, i) => (
              <Reveal key={d.slug} delay={i * 60}>
                <DestinationCard d={d} />
              </Reveal>
            ))}
          </div>
        </section>

        {/* Wishlist / Coming Soon */}
        <section className="mt-16">
          <Reveal>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Wishlist & Upcoming Expeditions
            </span>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Coming Soon to the Trail</h2>
            <p className="mt-2 max-w-2xl text-xs sm:text-sm text-muted-foreground">
              Not visited yet — these are verified upcoming trails. They move into full guides above
              the moment the trek happens.
            </p>
          </Reveal>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {wishlist.map((w, i) => (
              <Reveal key={w.id} delay={i * 60}>
                <article className="glass flex h-full flex-col rounded-[1.75rem] p-6 transition-transform hover:-translate-y-1">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-secondary/80">
                    <Mountain className="size-5 text-primary" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-base font-semibold">{w.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {w.district} · best {w.season}
                  </p>
                  <p className="mt-3 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {w.notes}
                  </p>
                  <span className="mt-5 inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary/80 px-3 py-1.5 text-[0.7rem] font-semibold text-foreground">
                    <CalendarClock className="size-3.5 text-primary" aria-hidden="true" /> Coming soon
                  </span>
                </article>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-6">
            <Link
              to="/bucket-list"
              className="glass inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs sm:text-sm font-semibold transition-transform hover:scale-105"
            >
              <Sparkles className="size-4" aria-hidden="true" /> See the full wishlist
            </Link>
          </Reveal>
        </section>

        {/* Gallery Preview */}
        <section className="mt-16 pb-4">
          <Reveal>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div>
                <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Trail Photography
                </span>
                <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Original Frames</h2>
                <p className="mt-2 max-w-xl text-xs sm:text-sm text-muted-foreground">
                  Original photographs from the Sahyadri trails — zero stock imagery anywhere on MedTrail.
                </p>
              </div>
              <Link
                to="/gallery"
                className="glass inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-xs sm:text-sm font-semibold transition-transform hover:scale-105"
              >
                <Camera className="size-3.5" /> Open Full Gallery
              </Link>
            </div>
          </Reveal>

          <PhotoGallery photos={photos.slice(0, 9)} withFilters={false} withSearch={false} />
        </section>
      </section>
    </div>
  );
}

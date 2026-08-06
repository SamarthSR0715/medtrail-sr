import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarClock, Mountain, Sparkles } from "lucide-react";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { StatsDashboard } from "@/components/travel/stats-dashboard";
import { DestinationCard } from "@/components/travel/destination-sections";
import { PhotoGallery } from "@/components/travel/photo-gallery";
import { bucketList, destinations, photos, realPhotos, travelStats } from "@/lib/travel-content";

const SITE = "https://medtrailsr.in";
const heroPhoto = `${SITE}${realPhotos.pawnaFromTikona}`;

export const Route = createFileRoute("/travel")({
  head: () => ({
    meta: [
      { title: "Weekend gateways near pune mumbai|sahydari Treks|MedtrailSR" },
      {
        name: "description",
        content:
          "Discover weekend getaways near Pune and Mumbai, Sahyadri treks, forts, waterfalls, nature trails, Lonavala trips, and real travel guides with photos by MedTrailsR.",
},.",
      },
      { property: "og:title", content: "Weekend Gateway near pune & mumbai| MedtrailSR" },
      {
        property: "og:description",
        content:
          "content:
"Explore Sahyadri treks, weekend trips, forts, waterfalls and nature trails around Pune, Mumbai and Maharashtra with original photos and detailed travel guides.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/travel` },
      { property: "og:image", content: heroPhoto },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: heroPhoto },
    ],
    links: [{ rel: "canonical", href: `${SITE}/travel` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Weekend Gateway near Pune and Mumbai",
          description:
"Collection of Sahyadri trekking guides, weekend getaways, forts, waterfalls, camping destinations and nature trails in Maharashtra.",
          url: `${SITE}/travel`,
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
  component: TravelJournal,
});

const quickLinks = [
  { to: "/travel-map", label: "Interactive map", primary: true },
  { to: "/destinations", label: "Destination guides" },
  { to: "/gallery", label: "Photo gallery" },
  { to: "/bucket-list", label: "Wishlist" },
] as const;

const wishlist = bucketList.filter((b) => b.status === "Wishlist");

function TravelJournal() {
  return (
    <div className="px-4">
      <section className="mx-auto max-w-6xl">
        <SectionHeading
          align="left"
          eyebrow="Travel Journal"
          title={<>Weekend gateway near pune mumbai and maharashtra</>}
          description="Explore real trekking guides, forts, waterfalls, nature trails, camping destinations and weekend trips across the Sahyadris with original photos and practical travel information."
        />

        <Reveal delay={40} className="mt-8">
          <div className="flex flex-wrap gap-3">
            {quickLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={
                  "primary" in l && l.primary
                    ? "bg-gradient-brand inline-flex rounded-full px-5 py-2.5 text-sm font-semibold text-brand-foreground shadow-md transition-transform hover:scale-105"
                    : "glass inline-flex rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:scale-105"
                }
              >
                {l.label}
              </Link>
            ))}
          </div>
        </Reveal>

        <div className="mt-10">
          <StatsDashboard />
        </div>

        <section className="mt-16">
          <Reveal>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Guides</span>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Trips I've actually completed</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Route cards, hour-by-hour timelines, real budgets and gear lists — latest trip:{" "}
              {travelStats.recent.name}.
            </p>
          </Reveal>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {destinations.map((d, i) => (
              <Reveal key={d.slug} delay={i * 60}>
                <DestinationCard d={d} />
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mt-16">
          <Reveal>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Wishlist</span>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Coming soon</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Not visited yet — so there are no photos or guides for these. They move up into the guides above the
              moment the trek actually happens.
            </p>
          </Reveal>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {wishlist.map((w, i) => (
              <Reveal key={w.id} delay={i * 60}>
                <article className="glass flex h-full flex-col rounded-[1.5rem] p-6">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-secondary/70">
                    <Mountain className="size-5 text-primary" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-base font-semibold">{w.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {w.district} · best {w.season}
                  </p>
                  <p className="mt-3 flex-1 text-xs leading-relaxed text-muted-foreground">{w.notes}</p>
                  <span className="mt-5 inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-[0.7rem] font-semibold">
                    <CalendarClock className="size-3.5" aria-hidden="true" /> Coming soon
                  </span>
                </article>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-6">
            <Link
              to="/bucket-list"
              className="glass inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:scale-105"
            >
              <Sparkles className="size-4" aria-hidden="true" /> See the full wishlist
            </Link>
          </Reveal>
        </section>

        <section className="mt-16 pb-4">
          <Reveal>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Gallery</span>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Recent frames</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Original photographs from the trails — no stock imagery anywhere on this site.
            </p>
          </Reveal>
          <PhotoGallery photos={photos.slice(0, 9)} withFilters={false} withSearch={false} />
          <Reveal className="mt-6">
            <Link
              to="/gallery"
              className="glass inline-flex rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:scale-105"
            >
              Open full gallery
            </Link>
          </Reveal>
        </section>
      </section>
    </div>
  );
}

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { IndianRupee, MapPin, Mountain, Star, Waves } from "lucide-react";
import fortImg from "@/assets/fort.jpg";
import waterfallImg from "@/assets/waterfall.jpg";
import hillImg from "@/assets/hillstation.jpg";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/travel")({
  head: () => ({
    meta: [
      { title: "Maharashtra Travel Journal — Forts, Waterfalls & Hill Stations | MedTrail" },
      {
        name: "description",
        content:
          "An interactive Maharashtra travel map with forts, waterfalls and hill stations — budgets, ratings, photos and field notes from every trip.",
      },
      { property: "og:title", content: "Maharashtra Travel Journal — Forts, Waterfalls & Hills" },
      {
        property: "og:description",
        content: "Interactive map of Maharashtra treks with budgets, ratings and photos.",
      },
    ],
  }),
  component: TravelJournal,
});

type Kind = "Fort" | "Waterfall" | "Hill station";

type Place = {
  id: string;
  name: string;
  kind: Kind;
  district: string;
  budget: number;
  rating: number;
  x: number;
  y: number;
  img: string;
  note: string;
};

const places: Place[] = [
  {
    id: "raigad",
    name: "Raigad Fort",
    kind: "Fort",
    district: "Raigad",
    budget: 900,
    rating: 4.9,
    x: 24,
    y: 52,
    img: fortImg,
    note: "1,737 steps or the ropeway. Reach the Nagarkhana Darwaja by sunrise — the valley fills with cloud.",
  },
  {
    id: "sinhagad",
    name: "Sinhagad Fort",
    kind: "Fort",
    district: "Pune",
    budget: 450,
    rating: 4.6,
    x: 38,
    y: 47,
    img: fortImg,
    note: "Best weekday trek near Pune. Pithla-bhakri at the top is non-negotiable.",
  },
  {
    id: "harishchandragad",
    name: "Harishchandragad",
    kind: "Fort",
    district: "Ahmednagar",
    budget: 1400,
    rating: 4.8,
    x: 33,
    y: 33,
    img: fortImg,
    note: "Konkankada at dusk is the single best view in the Sahyadris. Carry two litres minimum.",
  },
  {
    id: "thoseghar",
    name: "Thoseghar Falls",
    kind: "Waterfall",
    district: "Satara",
    budget: 600,
    rating: 4.7,
    x: 31,
    y: 63,
    img: waterfallImg,
    note: "Peak roar in late July. Go early — the viewing deck fills by 10am.",
  },
  {
    id: "randha",
    name: "Randha Falls",
    kind: "Waterfall",
    district: "Ahmednagar",
    budget: 700,
    rating: 4.4,
    x: 36,
    y: 28,
    img: waterfallImg,
    note: "Pair it with Bhandardara lake. Spray reaches the path, so bag covers help.",
  },
  {
    id: "mahabaleshwar",
    name: "Mahabaleshwar",
    kind: "Hill station",
    district: "Satara",
    budget: 3200,
    rating: 4.5,
    x: 27,
    y: 60,
    img: hillImg,
    note: "Arthur's Seat at dawn, strawberries after. Book stays outside the market for quiet.",
  },
  {
    id: "chikhaldara",
    name: "Chikhaldara",
    kind: "Hill station",
    district: "Amravati",
    budget: 2600,
    rating: 4.3,
    x: 66,
    y: 22,
    img: hillImg,
    note: "Vidarbha's only hill station — coffee plantations and near-empty viewpoints.",
  },
  {
    id: "lonavala",
    name: "Lonavala & Rajmachi",
    kind: "Hill station",
    district: "Pune",
    budget: 1800,
    rating: 4.2,
    x: 30,
    y: 41,
    img: hillImg,
    note: "Night trek to Rajmachi in monsoon; fireflies in the pre-monsoon weeks.",
  },
];

const filters: ("All" | Kind)[] = ["All", "Fort", "Waterfall", "Hill station"];

const kindIcon: Record<Kind, typeof Mountain> = {
  Fort: Mountain,
  Waterfall: Waves,
  "Hill station": MapPin,
};

function TravelJournal() {
  const [filter, setFilter] = useState<"All" | Kind>("All");
  const [activeId, setActiveId] = useState("raigad");

  const visible = places.filter((p) => filter === "All" || p.kind === filter);
  const active = places.find((p) => p.id === activeId) ?? places[0]!;
  const ActiveIcon = kindIcon[active.kind];

  return (
    <div className="px-4">
      <section className="mx-auto max-w-6xl">
        <SectionHeading
          align="left"
          eyebrow="Travel Journal"
          title={<>Maharashtra, one ridge at a time.</>}
          description="Tap a pin on the map to open the field notes — what it cost, how it rated and when to go."
        />

        <Reveal delay={80} className="mt-10">
          <div className="glass inline-flex gap-1 rounded-full p-1.5">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium transition-all",
                  filter === f
                    ? "bg-gradient-brand text-brand-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </Reveal>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          <Reveal>
            <div className="glass relative overflow-hidden rounded-[1.75rem] p-5 sm:p-7">
              <div className="relative aspect-4/3 w-full">
                <svg
                  viewBox="0 0 100 75"
                  className="absolute inset-0 size-full"
                  role="img"
                  aria-label="Stylised map of Maharashtra"
                >
                  <defs>
                    <linearGradient id="landGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="var(--chart-2)" stopOpacity="0.14" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M14 44 L18 30 L26 20 L38 14 L52 12 L64 10 L78 14 L90 20 L92 32 L86 44 L78 52 L68 58 L58 62 L46 66 L34 66 L24 60 L18 52 Z"
                    fill="url(#landGrad)"
                    stroke="var(--primary)"
                    strokeOpacity="0.45"
                    strokeWidth="0.6"
                  />
                  <path
                    d="M20 34 C26 40, 28 50, 30 62"
                    fill="none"
                    stroke="var(--primary)"
                    strokeOpacity="0.3"
                    strokeWidth="0.5"
                    strokeDasharray="2 2"
                  />
                </svg>

                {visible.map((p) => {
                  const Icon = kindIcon[p.kind];
                  const isActive = p.id === activeId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setActiveId(p.id)}
                      aria-label={`${p.name}, ${p.kind}`}
                      style={{ left: `${p.x}%`, top: `${p.y}%` }}
                      className={cn(
                        "absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-300",
                        isActive ? "z-10 scale-110" : "hover:scale-110",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-9 items-center justify-center rounded-full border shadow-lg",
                          isActive
                            ? "bg-gradient-brand border-transparent text-brand-foreground"
                            : "glass text-foreground",
                        )}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      {isActive ? (
                        <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-primary/40" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Stylised map · {visible.length} places shown
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <article className="glass h-full overflow-hidden rounded-[1.75rem]">
              <img
                src={active.img}
                alt={active.name}
                width={1280}
                height={960}
                loading="lazy"
                className="h-56 w-full object-cover sm:h-64"
              />
              <div className="p-6 sm:p-8">
                <span className="inline-flex items-center gap-2 rounded-full bg-secondary/70 px-3 py-1 text-xs font-medium">
                  <ActiveIcon className="size-3.5" aria-hidden="true" />
                  {active.kind} · {active.district}
                </span>
                <h3 className="mt-4 text-2xl font-semibold">{active.name}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{active.note}</p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-border/50 bg-secondary/35 p-4">
                    <p className="flex items-center gap-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      <IndianRupee className="size-3.5" aria-hidden="true" /> Budget
                    </p>
                    <p className="font-display mt-1.5 text-2xl font-semibold">
                      ₹{active.budget.toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/50 bg-secondary/35 p-4">
                    <p className="flex items-center gap-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      <Star className="size-3.5" aria-hidden="true" /> Rating
                    </p>
                    <p className="font-display mt-1.5 text-2xl font-semibold">{active.rating}/5</p>
                  </div>
                </div>
              </div>
            </article>
          </Reveal>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p, i) => {
            const Icon = kindIcon[p.kind];
            return (
              <Reveal key={p.id} delay={i * 60}>
                <button
                  type="button"
                  onClick={() => setActiveId(p.id)}
                  className={cn(
                    "glass flex w-full items-center gap-4 rounded-[1.5rem] p-5 text-left transition-all duration-500 hover:-translate-y-1",
                    p.id === activeId && "ring-2 ring-primary/50",
                  )}
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-secondary/70">
                    <Icon className="size-5 text-primary" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      ₹{p.budget.toLocaleString("en-IN")} · {p.rating}★
                    </span>
                  </span>
                </button>
              </Reveal>
            );
          })}
        </div>
      </section>
    </div>
  );
}
import type { ReactNode } from "react";
import {
  Bus,
  Car,
  Clock,
  Droplets,
  Flag,
  Footprints,
  Gauge,
  IndianRupee,
  MapPin,
  Mountain,
  Navigation,
  Route as RouteIcon,
  Ruler,
  Signal,
  Sunrise,
  Sunset,
  Tent,
  Ticket,
  Toilet,
  Train,
  TramFront,
  UserCheck,
  Utensils,
  Eye,
  CalendarDays,
  ParkingSquare,
} from "lucide-react";
import type { Destination, TimelineStop } from "@/lib/travel-content";
import { Reveal } from "@/components/site/reveal";

const modeIcon: Record<TimelineStop["mode"], typeof Train> = {
  start: Navigation,
  train: Train,
  metro: TramFront,
  bus: Bus,
  jeep: Car,
  walk: Footprints,
  trek: Mountain,
  view: Eye,
  end: Flag,
};

export function InfoCard({ icon: Icon, label, value }: { icon: typeof Train; label: string; value: string }) {
  return (
    <div className="glass rounded-[1.25rem] p-4">
      <p className="flex items-center gap-1.5 text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1.5 text-sm font-semibold leading-snug">{value}</p>
    </div>
  );
}

export function TravelInfoCards({ d }: { d: Destination }) {
  const items: { icon: typeof Train; label: string; value: string }[] = [
    { icon: Ruler, label: "Distance from Pune", value: `${d.distanceKm} km` },
    { icon: Clock, label: "Travel time", value: d.travelTime },
    { icon: Footprints, label: "Trek time", value: d.trekTime },
    { icon: Mountain, label: "Elevation", value: `${d.elevationM} m` },
    { icon: Gauge, label: "Difficulty", value: d.difficulty },
    { icon: Ticket, label: "Entry fee", value: d.info.entryFee },
    { icon: ParkingSquare, label: "Parking", value: d.info.parking },
    { icon: Utensils, label: "Food", value: d.info.food },
    { icon: Droplets, label: "Water", value: d.info.water },
    { icon: Toilet, label: "Washrooms", value: d.info.washrooms },
    { icon: Signal, label: "Network", value: d.info.network },
    { icon: Tent, label: "Camping", value: d.info.camping },
    { icon: UserCheck, label: "Guide", value: d.info.guide },
    { icon: CalendarDays, label: "Best season", value: d.season },
    { icon: Sunrise, label: "Sunrise", value: d.sunrise },
    { icon: Sunset, label: "Sunset", value: d.sunset },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, i) => (
        <Reveal key={item.label} delay={Math.min(i, 8) * 40}>
          <InfoCard {...item} />
        </Reveal>
      ))}
    </div>
  );
}

export function TravelTimeline({ stops }: { stops: TimelineStop[] }) {
  return (
    <ol className="relative ml-4 border-l border-dashed border-border">
      {stops.map((s, i) => {
        const Icon = modeIcon[s.mode];
        return (
          <Reveal key={`${s.title}-${i}`} delay={i * 60}>
            <li className="relative pb-7 pl-8">
              <span className="bg-gradient-brand absolute -left-4.5 flex size-9 items-center justify-center rounded-full text-brand-foreground shadow-lg">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <p className="text-sm font-semibold">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.detail}</p>
              <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-secondary/70 px-2.5 py-1 text-[0.68rem] font-medium">
                <Clock className="size-3" aria-hidden="true" /> {s.time}
              </p>
            </li>
          </Reveal>
        );
      })}
    </ol>
  );
}

export function RouteMapSection({ d }: { d: Destination }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
      <Reveal>
        <div className="glass overflow-hidden rounded-[1.75rem]">
          <img
            src={d.routeMap}
            alt={`Route map from Pune to ${d.name}`}
            loading="lazy"
            decoding="async"
            className="w-full bg-white object-contain"
          />
          <div className="flex flex-wrap items-center gap-3 p-5">
            <a
              href={d.googleMapsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="bg-gradient-brand inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-brand-foreground shadow-md transition-transform hover:scale-105"
            >
              <Navigation className="size-4" aria-hidden="true" /> Open in Google Maps
            </a>
            <span className="text-xs text-muted-foreground">Illustrated route card · Pune → {d.name}</span>
          </div>
        </div>
      </Reveal>
      <Reveal delay={100}>
        <div className="glass h-full rounded-[1.75rem] p-6 sm:p-7">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <RouteIcon className="size-4.5 text-primary" aria-hidden="true" /> Travel timeline
          </h3>
          <div className="mt-6">
            <TravelTimeline stops={d.timeline} />
          </div>
        </div>
      </Reveal>
    </div>
  );
}

export function ListCard({
  icon: Icon,
  title,
  items,
}: {
  icon: typeof Train;
  title: string;
  items: string[];
}) {
  return (
    <div className="glass h-full rounded-[1.5rem] p-6">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Icon className="size-4.5 text-primary" aria-hidden="true" /> {title}
      </h3>
      <ul className="mt-4 space-y-2.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExpenseCard({ d }: { d: Destination }) {
  return (
    <div className="glass h-full rounded-[1.5rem] p-6">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <IndianRupee className="size-4.5 text-primary" aria-hidden="true" /> Expenses per person
      </h3>
      <dl className="mt-4 divide-y divide-border/60">
        {d.expenses.map((e) => (
          <div key={e.label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-sm text-muted-foreground">{e.label}</dt>
            <dd className="font-display shrink-0 text-sm font-semibold">{e.amount}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function SectionBlock({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-16">
      <Reveal>
        {eyebrow ? (
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{eyebrow}</span>
        ) : null}
        <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">{title}</h2>
      </Reveal>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function DestinationCard({ d }: { d: Destination }) {
  return (
    <a
      href={`/destinations/${d.slug}`}
      className="glass group block overflow-hidden rounded-[1.5rem] transition-all duration-500 hover:-translate-y-1"
    >
      <img
        src={d.hero}
        alt={d.name}
        width={1280}
        height={960}
        loading="lazy"
        className="h-44 w-full object-cover transition-transform duration-700 group-hover:scale-105"
      />
      <div className="p-5">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden="true" /> {d.district}, {d.state} · {d.distanceKm} km
        </p>
        <h3 className="mt-2 text-base font-semibold leading-snug">{d.name}</h3>
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{d.tagline}</p>
        <p className="mt-3 flex flex-wrap gap-1.5">
          {d.categories.slice(0, 3).map((c) => (
            <span key={c} className="rounded-full bg-secondary/70 px-2.5 py-1 text-[0.65rem] font-medium">
              {c}
            </span>
          ))}
          <span className="rounded-full bg-secondary/70 px-2.5 py-1 text-[0.65rem] font-medium">{d.rating}★</span>
        </p>
      </div>
    </a>
  );
}
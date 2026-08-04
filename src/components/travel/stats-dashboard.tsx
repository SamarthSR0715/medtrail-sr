import { Camera, Footprints, Landmark, Map, MapPinned, Mountain, Route, Waves } from "lucide-react";
import { Reveal } from "@/components/site/reveal";
import { travelStats } from "@/lib/travel-content";
import { Counter } from "./counter";

const items = [
  { icon: Route, label: "Trips completed", value: travelStats.trips, suffix: "+" },
  { icon: MapPinned, label: "Destination guides", value: travelStats.destinations, suffix: "" },
  { icon: Landmark, label: "Forts explored", value: travelStats.forts, suffix: "" },
  { icon: Waves, label: "Waterfalls chased", value: travelStats.waterfalls, suffix: "" },
  { icon: Footprints, label: "Trek distance", value: travelStats.trekDistance, suffix: " km" },
  { icon: Map, label: "Distance travelled", value: travelStats.distanceTravelled, suffix: " km" },
  { icon: Mountain, label: "Highest elevation", value: travelStats.highestElevation, suffix: " m" },
  { icon: Camera, label: "Photos captured", value: travelStats.photos, suffix: "" },
];

export function StatsDashboard() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, i) => (
        <Reveal key={item.label} delay={i * 50}>
          <div className="glass h-full rounded-[1.5rem] p-5">
            <span className="bg-gradient-brand flex size-10 items-center justify-center rounded-2xl text-brand-foreground shadow-md">
              <item.icon className="size-4.5" aria-hidden="true" />
            </span>
            <p className="font-display mt-4 text-3xl font-semibold">
              <Counter value={item.value} suffix={item.suffix} />
            </p>
            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">{item.label}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
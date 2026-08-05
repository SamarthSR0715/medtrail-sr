import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, MapPin } from "lucide-react";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { bucketList, realPhotos } from "@/lib/travel-content";
import { cn } from "@/lib/utils";

const SITE = "https://medtrail-sr.lovable.app";
const cover = `${SITE}${realPhotos.tikonaPeak}`;

export const Route = createFileRoute("/bucket-list")({
  head: () => ({
    meta: [
      { title: "Travel Wishlist — Next Sahyadri Treks & Trips | MedTrail" },
      {
        name: "description",
        content:
          "The upcoming trek and travel wishlist — Kalsubai, Harishchandragad, Sinhagad, Devkund, Mahabaleshwar and more, with best seasons, priority and planning notes.",
      },
      { property: "og:title", content: "Travel Wishlist — MedTrail" },
      {
        property: "og:description",
        content: "Upcoming Sahyadri treks and trips with best seasons, priority and planning notes.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/bucket-list` },
      { property: "og:image", content: cover },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: cover },
    ],
    links: [{ rel: "canonical", href: `${SITE}/bucket-list` }],
  }),
  component: BucketListPage,
});

function BucketListPage() {
  const [done, setDone] = useState<Record<string, boolean>>(
    Object.fromEntries(bucketList.map((b) => [b.id, b.done])),
  );
  const completed = Object.values(done).filter(Boolean).length;

  return (
    <div className="px-4 pb-20">
      <section className="mx-auto max-w-4xl">
        <SectionHeading
          align="left"
          eyebrow="Wishlist"
          title={<>What's still on the list.</>}
          description="Places not visited yet, so there are no photos or guides for them. Tick one off as it happens — priority, season and the note-to-self for each plan."
        />

        <Reveal delay={60} className="mt-8">
          <div className="glass rounded-[1.5rem] p-6">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-sm font-medium">Progress</p>
              <p className="font-display text-sm font-semibold">
                {completed}/{bucketList.length} done
              </p>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="bg-gradient-brand h-full rounded-full transition-all duration-700"
                style={{ width: `${(completed / bucketList.length) * 100}%` }}
              />
            </div>
          </div>
        </Reveal>

        <ul className="mt-5 space-y-4">
          {bucketList.map((b, i) => {
            const isDone = done[b.id];
            return (
              <Reveal key={b.id} delay={i * 50}>
                <li className="glass flex items-start gap-4 rounded-[1.5rem] p-5">
                  <button
                    type="button"
                    onClick={() => setDone((d) => ({ ...d, [b.id]: !d[b.id] }))}
                    aria-pressed={isDone}
                    aria-label={`Mark ${b.name} as ${isDone ? "not done" : "done"}`}
                    className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border transition-all",
                      isDone
                        ? "bg-gradient-brand border-transparent text-brand-foreground"
                        : "border-border text-transparent hover:border-primary",
                    )}
                  >
                    <Check className="size-4" aria-hidden="true" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-semibold", isDone && "line-through opacity-60")}>{b.name}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" aria-hidden="true" /> {b.district} · {b.season}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{b.notes}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[0.65rem] font-semibold",
                        b.priority === "High"
                          ? "bg-gradient-brand text-brand-foreground"
                          : "bg-secondary/70 text-foreground",
                      )}
                    >
                      {b.priority}
                    </span>
                    <span className="rounded-full bg-secondary/70 px-2.5 py-1 text-[0.65rem] font-medium">
                      {b.status}
                    </span>
                  </div>
                </li>
              </Reveal>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
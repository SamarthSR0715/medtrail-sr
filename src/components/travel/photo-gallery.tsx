import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { categories, type Category, type Photo } from "@/lib/travel-content";
import { Reveal } from "@/components/site/reveal";
import { cn } from "@/lib/utils";
import { Lightbox } from "./lightbox";

export function PhotoGallery({
  photos,
  withFilters = true,
  withSearch = true,
}: {
  photos: Photo[];
  withFilters?: boolean;
  withSearch?: boolean;
}) {
  const [filter, setFilter] = useState<"All" | Category>("All");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return photos.filter((p) => {
      const matchesTag = filter === "All" || p.tags.includes(filter);
      const matchesQuery =
        !q ||
        [p.destination, p.district, p.state, p.caption, p.tags.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(q);
      return matchesTag && matchesQuery;
    });
  }, [photos, filter, query]);

  return (
    <div>
      {withSearch ? (
        <Reveal className="mt-8">
          <label className="glass flex items-center gap-3 rounded-full px-5 py-3">
            <Search className="size-4.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search destinations, districts or tags…"
              aria-label="Search photos"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
        </Reveal>
      ) : null}

      {withFilters ? (
        <Reveal delay={60} className="mt-5">
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
        </Reveal>
      ) : null}

      <p className="mt-5 text-xs text-muted-foreground">{visible.length} photos</p>

      <div className="mt-4 columns-1 gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5">
        {visible.map((p, i) => (
          <Reveal key={p.id} delay={Math.min(i, 8) * 50}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="glass group block w-full overflow-hidden rounded-[1.5rem] text-left transition-all duration-500 hover:-translate-y-1"
            >
              <span className="relative block overflow-hidden">
                <img
                  src={p.src}
                  alt={p.caption}
                  width={1280}
                  height={960}
                  loading="lazy"
                  decoding="async"
                  className="w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                {p.cover ? (
                  <span className="bg-gradient-brand absolute left-3 top-3 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-brand-foreground">
                    Cover
                  </span>
                ) : null}
              </span>
              <span className="block p-5">
                <span className="block text-sm font-semibold">{p.destination}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {p.district}, {p.state} ·{" "}
                  {new Date(p.date).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                </span>
                <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{p.caption}</span>
                <span className="mt-3 flex flex-wrap gap-1.5">
                  {p.tags.map((t) => (
                    <span key={t} className="rounded-full bg-secondary/70 px-2.5 py-1 text-[0.65rem] font-medium">
                      {t}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          </Reveal>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="glass mt-4 rounded-3xl p-8 text-center text-sm text-muted-foreground">
          No photos match that search yet.
        </p>
      ) : null}

      {open !== null ? (
        <Lightbox photos={visible} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}
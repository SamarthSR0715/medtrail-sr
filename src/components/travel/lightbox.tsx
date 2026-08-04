import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import type { Photo } from "@/lib/travel-content";
import { cn } from "@/lib/utils";

export function Lightbox({
  photos,
  index,
  onClose,
  onIndexChange,
}: {
  photos: Photo[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const touchX = useRef<number | null>(null);
  const photo = photos[index];

  const go = (dir: number) => {
    setZoomed(false);
    onIndexChange((index + dir + photos.length) % photos.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  });

  if (!photo) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.caption}
      className="fixed inset-0 z-[100] flex flex-col bg-background/80 backdrop-blur-2xl"
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX ?? null;
        if (start != null && end != null && Math.abs(end - start) > 50) go(end < start ? 1 : -1);
        touchX.current = null;
      }}
    >
      <div className="flex items-center justify-between gap-3 p-3 sm:p-5">
        <p className="min-w-0 truncate text-sm font-medium">
          {photo.destination}
          <span className="text-muted-foreground"> · {photo.district}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setZoomed((z) => !z)}
            aria-label={zoomed ? "Zoom out" : "Zoom in"}
            className="glass flex size-10 items-center justify-center rounded-full"
          >
            {zoomed ? <ZoomOut className="size-4.5" /> : <ZoomIn className="size-4.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close gallery"
            className="glass flex size-10 items-center justify-center rounded-full"
          >
            <X className="size-4.5" />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto px-3 pb-3">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous photo"
          className="glass absolute left-3 z-10 flex size-11 items-center justify-center rounded-full sm:left-6"
        >
          <ChevronLeft className="size-5" />
        </button>
        <img
          src={photo.src}
          alt={photo.caption}
          onClick={() => setZoomed((z) => !z)}
          className={cn(
            "max-h-full rounded-[1.5rem] object-contain shadow-2xl transition-transform duration-500",
            zoomed ? "max-w-none scale-150 cursor-zoom-out" : "max-w-full cursor-zoom-in",
          )}
        />
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next photo"
          className="glass absolute right-3 z-10 flex size-11 items-center justify-center rounded-full sm:right-6"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div className="glass-strong mx-3 mb-3 rounded-2xl p-4 sm:mx-6 sm:mb-6">
        <p className="text-sm">{photo.caption}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(photo.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} ·{" "}
          {photo.tags.join(" · ")} · {index + 1}/{photos.length}
        </p>
      </div>
    </div>
  );
}
import { createFileRoute } from "@tanstack/react-router";
import { SectionHeading } from "@/components/site/section-heading";
import { PhotoGallery } from "@/components/travel/photo-gallery";
import { photos } from "@/lib/travel-content";

export const Route = createFileRoute("/gallery")({
  head: () => ({
    meta: [
      { title: "Travel Photo Gallery — Sahyadri Forts, Falls & Lakes | MedTrail" },
      {
        name: "description",
        content:
          "A filterable masonry gallery of Maharashtra travel photography — forts, waterfalls, temples, lakes and camps, with captions, dates and a full-screen lightbox.",
      },
      { property: "og:title", content: "Travel Photo Gallery — MedTrail" },
      {
        property: "og:description",
        content: "Filterable masonry gallery of Sahyadri forts, waterfalls, temples and lakeside camps.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GalleryPage,
});

function GalleryPage() {
  return (
    <div className="px-4 pb-20">
      <section className="mx-auto max-w-6xl">
        <SectionHeading
          align="left"
          eyebrow="Gallery"
          title={<>Every frame from the trail.</>}
          description="Filter by category or search a district — tap any photo for the full-screen lightbox with zoom, swipe and captions."
        />
        <PhotoGallery photos={photos} />
      </section>
    </div>
  );
}
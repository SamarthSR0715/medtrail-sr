import { createFileRoute } from "@tanstack/react-router";
import { SectionHeading } from "@/components/site/section-heading";
import { PhotoGallery } from "@/components/travel/photo-gallery";
import { photos, realPhotos } from "@/lib/travel-content";

const SITE = "https://medtrail-sr.lovable.app";
const cover = `${SITE}${realPhotos.kataldharWide}`;

export const Route = createFileRoute("/gallery")({
  head: () => ({
    meta: [
      { title: "Travel Photo Gallery — Kataldhar, Tikona, Pawna & Bhaje | MedTrail" },
      {
        name: "description",
        content:
          "Original photographs from Sahyadri trips near Pune — Kataldhar Waterfall, Tikona Fort, Pawna Lake camping and the Bhaje caves, with captions, dates and a full-screen lightbox.",
      },
      { property: "og:title", content: "Travel Photo Gallery — MedTrail" },
      {
        property: "og:description",
        content: "Original photographs from Kataldhar, Tikona, Pawna Lake and the Bhaje caves.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/gallery` },
      { property: "og:image", content: cover },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: cover },
    ],
    links: [{ rel: "canonical", href: `${SITE}/gallery` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ImageGallery",
          name: "MedTrail Travel Photo Gallery",
          url: `${SITE}/gallery`,
          image: photos.map((p) => `${SITE}${p.src}`),
        }),
      },
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
          description="Every photo here was shot on the trip it names. Filter by category or search a district, then tap any frame for the full-screen lightbox with zoom, swipe and captions."
        />
        <PhotoGallery photos={photos} />
      </section>
    </div>
  );
}
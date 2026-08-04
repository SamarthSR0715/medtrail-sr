import { useEffect, useRef } from "react";
import type { Destination } from "@/lib/travel-content";

const PUNE: [number, number] = [18.5204, 73.8567];

export function DestinationMap({
  destinations,
  height = 480,
  zoom = 9,
  center = PUNE,
  cluster = true,
  showRoutes = false,
}: {
  destinations: Destination[];
  height?: number;
  zoom?: number;
  center?: [number, number];
  cluster?: boolean;
  showRoutes?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let map: { remove: () => void } | null = null;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cluster) await import("leaflet.markercluster");
      if (cancelled || !containerRef.current) return;

      const brand =
        getComputedStyle(containerRef.current).getPropertyValue("--primary").trim() || "#0f766e";

      map = L.map(containerRef.current, {
        center,
        zoom,
        scrollWheelZoom: false,
        attributionControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map as never);

      const layer = cluster
        ? (L as unknown as { markerClusterGroup: (o?: unknown) => never }).markerClusterGroup({
            showCoverageOnHover: false,
            maxClusterRadius: 45,
          })
        : L.layerGroup();

      destinations.forEach((d) => {
        const marker = L.marker([d.lat, d.lng], {
          title: d.name,
          icon: L.divIcon({
            className: "",
            html: `<span style="display:flex;height:34px;width:34px;align-items:center;justify-content:center;border-radius:9999px;background:${brand};box-shadow:0 8px 20px -6px rgba(0,0,0,.45)"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>`,
            iconSize: [34, 34],
            iconAnchor: [17, 34],
            popupAnchor: [0, -30],
          }),
        });
        marker.bindPopup(
          `<div style="width:220px;font-family:inherit">
            <img src="${d.hero}" alt="${d.name}" style="width:100%;height:110px;object-fit:cover;border-radius:12px" loading="lazy" />
            <p style="margin:10px 0 2px;font-weight:600;font-size:14px">${d.name}</p>
            <p style="margin:0;font-size:12px;opacity:.75">${d.summary.slice(0, 90)}…</p>
            <p style="margin:6px 0 0;font-size:12px;font-weight:600">${d.distanceKm} km from Pune · ${d.difficulty}</p>
            <a href="/destinations/${d.slug}" style="display:inline-block;margin-top:10px;padding:7px 12px;border-radius:9999px;background:${brand};color:#fff;font-size:12px;font-weight:600;text-decoration:none">View destination</a>
          </div>`,
        );
        (layer as unknown as { addLayer: (m: unknown) => void }).addLayer(marker);

        if (showRoutes) {
          L.polyline([PUNE, [d.lat, d.lng]], {
            color: brand,
            weight: 2,
            opacity: 0.55,
            dashArray: "6 8",
          }).addTo(map as never);
        }
      });

      (layer as unknown as { addTo: (m: unknown) => void }).addTo(map);
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [destinations, height, zoom, center, cluster, showRoutes]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      role="application"
      aria-label="Interactive map of visited destinations"
      className="w-full overflow-hidden rounded-[1.5rem] border border-border/60 bg-secondary/40 z-0"
    />
  );
}
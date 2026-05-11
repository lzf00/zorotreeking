import { useEffect, useRef } from "react";

type Point = { lat: number; lng: number; ele?: number };

interface Props {
  points: Point[];
  height?: number;
}

export default function GpxMap({ points, height = 360 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || points.length < 2) return;
    let map: any;
    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !ref.current) return;

      map = L.map(ref.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const latlngs = points.map((p) => [p.lat, p.lng]) as [number, number][];
      const line = L.polyline(latlngs, { color: "#16a34a", weight: 4, opacity: 0.85 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [20, 20] });

      // 起点/终点 marker
      const start = latlngs[0];
      const end = latlngs[latlngs.length - 1];
      L.circleMarker(start, { radius: 6, color: "#16a34a", fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(map).bindTooltip("起点");
      L.circleMarker(end, { radius: 6, color: "#dc2626", fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(map).bindTooltip("终点");
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points]);

  return (
    <div ref={ref} className="w-full rounded-xl overflow-hidden border border-[var(--border)]" style={{ height }} />
  );
}

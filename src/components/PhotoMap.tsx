import { useEffect, useRef } from "react";
import { normalizeSameOriginUrl } from "@/lib/safe-url";

/**
 * /photo/[slug] 页用：把相册里有 GPS 的照片标在 leaflet 小地图上。
 * 没 GPS 的照片自动跳过；如果整本相册没一张带 GPS 则不渲染。
 *
 * 风格：跟 GpxMap 一致（CartoDB Voyager tile + 极简 dot marker）
 */
interface PhotoPoint {
  lat: number;
  lng: number;
  thumb: string;
  alt: string;
  src: string;
}
interface Props {
  points: PhotoPoint[];
}

export default function PhotoMap({ points }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    let alive = true;
    let mapInstance: { remove: () => void } | null = null;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (!alive || !ref.current) return;

      const map = L.map(ref.current, {
        scrollWheelZoom: false,
        attributionControl: true,
      });
      mapInstance = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OSM &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 20,
      }).addTo(map);

      const dotIcon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#6b21a8;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const latlngs: [number, number][] = [];
      for (const p of points) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        const ll: [number, number] = [p.lat, p.lng];
        latlngs.push(ll);
        const marker = L.marker(ll, { icon: dotIcon }).addTo(map);
        const popup = document.createElement("div");
        popup.style.cssText = "font-family:Inter,system-ui;font-size:12px";

        const link = document.createElement("a");
        link.href = normalizeSameOriginUrl(p.src, window.location.origin);
        link.target = "_blank";
        link.rel = "noopener";

        const image = document.createElement("img");
        image.src = normalizeSameOriginUrl(p.thumb, window.location.origin);
        image.alt = String(p.alt ?? "");
        image.style.cssText = "width:120px;height:auto;display:block;border-radius:6px";
        link.append(image);

        const caption = document.createElement("div");
        caption.style.cssText = "margin-top:4px;color:#6b7280";
        caption.textContent = String(p.alt ?? "");
        popup.append(link, caption);
        marker.bindPopup(popup, { maxWidth: 160 });
      }

      if (latlngs.length > 0) {
        map.fitBounds(latlngs as any, { padding: [30, 30], maxZoom: 14 });
      }
    })();

    return () => {
      alive = false;
      mapInstance?.remove();
    };
  }, [points]);

  if (points.length === 0) return null;

  return (
    <div className="my-8">
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-mono mb-3 pb-2 border-b border-[var(--border)]">
        拍摄位置 · {points.length} 张含 GPS
      </div>
      <div ref={ref} style={{ height: 360, width: "100%", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }} />
    </div>
  );
}

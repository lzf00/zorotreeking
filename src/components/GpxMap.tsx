import { useEffect, useRef, useState } from "react";
import { trackPreview } from "@/lib/gpx-preview";

type Point = { lat: number; lng: number; ele?: number };

interface Props {
  points: Point[];
  height?: number;
}

/**
 * GPX 轨迹地图。
 *
 * 第 126 轮：**默认不加载 Leaflet**。
 * 原因：`/hike/sample-route/` 的 LCP 3.82 s（预算 3.5 s），LCP 元素就是 Leaflet 瓦片 ——
 * 地图一进视口就水合、拉 12 块瓦片，首屏最大图象变成第三方图片。而绝大多数访客
 * 只想看轨迹形状，不需要拖拽缩放；顺手也省掉每开一次页面给 openstreetmap.org 发 12 个请求。
 *
 * 现在：先用轨迹点画内联 SVG（不联网、无 JS 依赖），点「加载交互地图」才水合 Leaflet。
 */
export default function GpxMap({ points, height = 360 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const preview = trackPreview(points, { width: 640, height, padding: 24 });

  useEffect(() => {
    if (!active || !ref.current || points.length < 2) return;
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
  }, [active, points]);

  return (
    <div className="relative w-full" style={{ height }}>
      {active ? (
        <div ref={ref} className="h-full w-full rounded-xl overflow-hidden border border-[var(--border)]" data-gpx-map="leaflet" />
      ) : (
        <div className="relative h-full w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-muted,#f4f4f5)] dark:bg-zinc-900" data-gpx-map="preview">
          {preview && (
            <svg
              viewBox="0 0 640 360"
              preserveAspectRatio="xMidYMid meet"
              className="h-full w-full"
              role="img"
              aria-label="GPX 轨迹形状预览（静态），点击下方按钮加载可交互地图"
            >
              <path d={preview.path} fill="none" stroke="#16a34a" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
              <circle cx={preview.start.x} cy={preview.start.y} r={6} fill="#fff" stroke="#16a34a" strokeWidth={3} />
              <circle cx={preview.end.x} cy={preview.end.y} r={6} fill="#fff" stroke="#dc2626" strokeWidth={3} />
            </svg>
          )}
          <button
            type="button"
            onClick={() => setActive(true)}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--surface-0,#fff)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] shadow-sm transition hover:border-blue-400 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:bg-zinc-800 dark:text-zinc-100"
          >
            加载交互地图
            <span className="ml-1.5 font-normal opacity-70">（拖拽缩放，需联网）</span>
          </button>
        </div>
      )}
      {/* Leaflet 默认的版权署名是 50% 灰字压在瓦片上，瓦片浅色时对比度不到 4.5:1。
          加实底 + 深色文字，既满足 WCAG AA，也不受瓦片内容影响（审计数值更稳）。 */}
      <style>{`
        .leaflet-control-attribution {
          background: rgba(255, 255, 255, 0.92) !important;
          color: #333 !important;
          font-size: 11px !important;
          padding: 1px 6px !important;
        }
        .leaflet-control-attribution a { color: #1a5f30 !important; text-decoration: underline; }
        .dark .leaflet-control-attribution { background: rgba(24, 24, 27, 0.92) !important; color: #e4e4e7 !important; }
        .dark .leaflet-control-attribution a { color: #86efac !important; }
      `}</style>
    </div>
  );
}

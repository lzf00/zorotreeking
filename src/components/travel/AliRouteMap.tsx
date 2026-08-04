import { useEffect, useRef } from "react";

import type { AliRouteDay, AliRoutePoint, AliRoutePointKind } from "../../data/ali-route";

interface Props {
  points: AliRoutePoint[];
  days: AliRouteDay[];
}
const kindLabel: Record<AliRoutePointKind, string> = {
  airport: "机场",
  overnight: "住宿城市",
  city: "途经城市",
  attraction: "景点",
  viewpoint: "观景点",
  supply: "补给点",
};

function appendMeta(parent: HTMLElement, label: string, value: string) {
  const row = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}：`;
  row.append(strong, document.createTextNode(value));
  parent.append(row);
}

function createPopup(point: AliRoutePoint, days: number[]) {
  const root = document.createElement("article");
  root.className = "ali-route-popup";

  const eyebrow = document.createElement("div");
  eyebrow.className = "ali-route-popup__eyebrow";
  eyebrow.textContent = `${kindLabel[point.kind]} · ${days.map((day) => `D${String(day).padStart(2, "0")}`).join(" / ")}`;

  const title = document.createElement("h3");
  title.textContent = point.name;

  const detail = document.createElement("p");
  detail.textContent = point.detail;

  root.append(eyebrow, title, detail);
  if (point.elevationM) appendMeta(root, "参考海拔", `${point.elevationM.toLocaleString("zh-CN")} m`);
  if (point.services) appendMeta(root, "可用服务", point.services);
  if (point.coordinateNote) appendMeta(root, "坐标说明", point.coordinateNote);

  const link = document.createElement("a");
  link.href = `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=12/${point.lat}/${point.lng}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "在 OpenStreetMap 中查看 ↗";
  root.append(link);

  return root;
}

export default function AliRouteMap({ points, days }: Props) {
  const mapElement = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapElement.current || points.length === 0) return;

    let cancelled = false;
    let map: import("leaflet").Map | undefined;

    void (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !mapElement.current) return;

      const pointById = new Map(points.map((point) => [point.id, point]));
      const dayNumbersByPoint = new Map<string, number[]>();
      for (const day of days) {
        for (const id of new Set(day.pointIds)) {
          const dayNumbers = dayNumbersByPoint.get(id) ?? [];
          dayNumbers.push(day.day);
          dayNumbersByPoint.set(id, dayNumbers);
        }
      }

      map = L.map(mapElement.current, {
        scrollWheelZoom: false,
        attributionControl: true,
        zoomControl: true,
        preferCanvas: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        maxZoom: 18,
      }).addTo(map);

      const routeLayer = L.featureGroup().addTo(map);
      for (const day of days) {
        const coordinates = day.pointIds
          .map((id) => pointById.get(id))
          .filter((point): point is AliRoutePoint => Boolean(point))
          .map((point) => [point.lat, point.lng] as [number, number]);

        if (coordinates.length < 2) continue;
        const line = L.polyline(coordinates, {
          color: "#b64934",
          weight: 3,
          opacity: 0.78,
          dashArray: "8 9",
          lineCap: "round",
          lineJoin: "round",
        }).addTo(routeLayer);
        line.bindTooltip(`D${String(day.day).padStart(2, "0")} · ${day.title}`, {
          sticky: true,
          className: "ali-route-line-label",
        });
      }

      const markerLayer = L.featureGroup().addTo(map);
      for (const point of points) {
        const icon = L.divIcon({
          className: "ali-route-div-icon",
          html: `<span class="ali-route-marker ali-route-marker--${point.kind}" aria-hidden="true"></span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          popupAnchor: [0, -13],
        });

        const marker = L.marker([point.lat, point.lng], {
          icon,
          keyboard: true,
          title: `${point.name}，${kindLabel[point.kind]}`,
          alt: point.name,
          riseOnHover: true,
        }).addTo(markerLayer);

        marker.bindPopup(createPopup(point, dayNumbersByPoint.get(point.id) ?? []), {
          minWidth: 240,
          maxWidth: 320,
        });
        marker.bindTooltip(point.shortName, {
          direction: "top",
          offset: [0, -10],
          permanent: point.kind === "overnight" || point.kind === "airport",
          className: "ali-route-place-label",
        });
      }

      const bounds = markerLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 7 });

      requestAnimationFrame(() => map?.invalidateSize());
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [days, points]);

  return (
    <div className="ali-route-map-shell">
      <div
        ref={mapElement}
        className="ali-route-map"
        role="region"
        aria-label="阿里大环线真实底图，包含每日路线、途经城市、景点、补给点与住宿点"
      />
      <p className="ali-route-map-help">拖动查看 · 双击或按钮缩放 · 点击标记查看详情 · 已关闭滚轮缩放</p>
    </div>
  );
}

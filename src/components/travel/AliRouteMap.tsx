import { useEffect, useRef } from "react";

import {
  aliRoadLabels,
  aliRoutedDayGeometry,
  type AliRoadLabel,
} from "../../data/ali-road-geometry";
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
const majorRoadRefs = new Set(["G109", "G219", "G317", "G318"]);

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

function createRoadPopup(road: AliRoadLabel) {
  const root = document.createElement("article");
  root.className = "ali-route-popup ali-road-popup";

  const eyebrow = document.createElement("div");
  eyebrow.className = "ali-route-popup__eyebrow";
  eyebrow.textContent = `${road.ref} · ${road.days.map((day) => `D${String(day).padStart(2, "0")}`).join(" / ")}`;

  const title = document.createElement("h3");
  title.textContent = road.name;

  const detail = document.createElement("p");
  detail.textContent = road.description;
  root.append(eyebrow, title, detail);
  appendMeta(root, "地图用途", "公路编号与走向提示；实际通行以当天导航、交通管制和现场标志为准");
  return root;
}

function createRoadIcon(road: AliRoadLabel) {
  const root = document.createElement("span");
  root.className = `ali-road-shield ali-road-shield--${road.roadClass}`;

  const ref = document.createElement("strong");
  ref.textContent = road.ref;

  const name = document.createElement("span");
  name.textContent = road.name;
  root.append(ref, name);
  return root.outerHTML;
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

      const roadLayer = L.featureGroup().addTo(map);
      const routeLayer = L.featureGroup().addTo(map);
      for (const day of days) {
        const coordinates = aliRoutedDayGeometry[day.day] ?? day.pointIds
          .map((id) => pointById.get(id))
          .filter((point): point is AliRoutePoint => Boolean(point))
          .map((point) => [point.lat, point.lng] as [number, number]);

        if (coordinates.length < 2) continue;

        L.polyline(coordinates, {
          color: "#fff8e9",
          weight: 8,
          opacity: 0.9,
          lineCap: "round",
          lineJoin: "round",
          interactive: false,
        }).addTo(roadLayer);

        const road = L.polyline(coordinates, {
          color: "#d29a33",
          weight: 4,
          opacity: 0.96,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(roadLayer);
        road.bindTooltip(`D${String(day.day).padStart(2, "0")} · ${day.roads}`, {
          sticky: true,
          className: "ali-road-line-label",
        });

        const line = L.polyline(coordinates, {
          color: "#b64934",
          weight: 2,
          opacity: 0.9,
          dashArray: "3 10",
          lineCap: "round",
          lineJoin: "round",
        }).addTo(routeLayer);
        line.bindTooltip(`D${String(day.day).padStart(2, "0")} · ${day.title}`, {
          sticky: true,
          className: "ali-route-line-label",
        });
      }

      for (const road of aliRoadLabels) {
        const icon = L.divIcon({
          className: `ali-road-shield-icon${majorRoadRefs.has(road.ref) ? " ali-road-shield-icon--major" : ""}`,
          html: createRoadIcon(road),
          iconSize: [118, 30],
          iconAnchor: [59, 15],
          popupAnchor: [0, -17],
        });

        L.marker([road.lat, road.lng], {
          icon,
          keyboard: true,
          title: `${road.ref}，${road.name}`,
          alt: road.name,
          riseOnHover: true,
        }).bindPopup(createRoadPopup(road), {
          minWidth: 230,
          maxWidth: 300,
        }).addTo(roadLayer);
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

      L.control.layers({}, {
        "公路走向与编号": roadLayer,
        "逐日行驶路线": routeLayer,
        "城市、景点与补给": markerLayer,
      }, {
        collapsed: true,
        position: "topright",
      }).addTo(map);
      L.control.scale({ imperial: false, metric: true, position: "bottomleft" }).addTo(map);

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
        aria-label="阿里大环线真实底图，包含道路拟合线、公路编号、每日路线、途经城市、景点、补给点与住宿点"
      />
      <p className="ali-route-map-help">拖动查看 · 点击公路牌或地点查看详情 · 右上角可开关图层 · 已关闭滚轮缩放</p>
    </div>
  );
}

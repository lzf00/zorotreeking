import { useEffect, useRef, useState } from "react";

import {
  aliRoadLabels,
  aliRoutedDayGeometry,
  type AliRoadLabel,
} from "../../data/ali-road-geometry";
import type { AliRouteDay, AliRoutePoint, AliRoutePointKind } from "../../data/ali-route";
import { toAmapPosition } from "../../utils/amap-coordinate";

interface Props {
  points: AliRoutePoint[];
  days: AliRouteDay[];
}

type MapProvider = "loading" | "amap" | "osm";
type LayerKey = "roads" | "routes" | "places";

interface AMapOverlayGroup {
  show: () => void;
  hide: () => void;
}

interface AMapMapInstance {
  add: (overlay: unknown) => void;
  addControl: (control: unknown) => void;
  on: (event: string, handler: () => void) => void;
  setFitView: (overlays?: unknown[], immediately?: boolean, avoid?: number[], maxZoom?: number) => void;
  destroy: () => void;
}

interface AMapNamespace {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => AMapMapInstance;
  Polyline: new (options: Record<string, unknown>) => unknown;
  Marker: new (options: Record<string, unknown>) => {
    on: (event: string, handler: () => void) => void;
    getPosition: () => unknown;
  };
  OverlayGroup: new (overlays: unknown[]) => AMapOverlayGroup;
  InfoWindow: new (options: Record<string, unknown>) => {
    open: (map: AMapMapInstance, position: unknown) => void;
  };
  Pixel: new (x: number, y: number) => unknown;
  Scale: new (options?: Record<string, unknown>) => unknown;
  ToolBar: new (options?: Record<string, unknown>) => unknown;
}

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

const AMAP_JS_KEY = import.meta.env.PUBLIC_AMAP_JS_KEY?.trim() ?? "";
const AMAP_SECURITY_CODE = import.meta.env.PUBLIC_AMAP_SECURITY_CODE?.trim() ?? "";
const kindLabel: Record<AliRoutePointKind, string> = {
  airport: "机场",
  overnight: "住宿城市",
  city: "途经城市",
  attraction: "景点",
  viewpoint: "观景点",
  supply: "补给点",
};
const majorRoadRefs = new Set(["G109", "G219", "G317", "G318"]);
let amapLoader: Promise<AMapNamespace> | undefined;

function appendMeta(parent: HTMLElement, label: string, value: string) {
  const row = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}：`;
  row.append(strong, document.createTextNode(value));
  parent.append(row);
}

function createPopup(point: AliRoutePoint, days: number[], provider: "amap" | "osm") {
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
  link.href = provider === "amap"
    ? `https://ditu.amap.com/search?query=${encodeURIComponent(point.name)}`
    : `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=12/${point.lat}/${point.lng}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = provider === "amap" ? "在高德地图中查看 ↗" : "在 OpenStreetMap 中查看 ↗";
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

function createRoadIconElement(road: AliRoadLabel) {
  const root = document.createElement("span");
  root.className = `ali-road-shield ali-road-shield--${road.roadClass}${majorRoadRefs.has(road.ref) ? " ali-road-shield--major" : ""}`;

  const ref = document.createElement("strong");
  ref.textContent = road.ref;

  const name = document.createElement("span");
  name.textContent = road.name;
  root.append(ref, name);
  return root;
}

function getRouteIndexes(points: AliRoutePoint[], days: AliRouteDay[]) {
  const pointById = new Map(points.map((point) => [point.id, point]));
  const dayNumbersByPoint = new Map<string, number[]>();
  for (const day of days) {
    for (const id of new Set(day.pointIds)) {
      const dayNumbers = dayNumbersByPoint.get(id) ?? [];
      dayNumbers.push(day.day);
      dayNumbersByPoint.set(id, dayNumbers);
    }
  }
  return { pointById, dayNumbersByPoint };
}

function loadAmapSdk() {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapLoader) return amapLoader;

  window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE };
  amapLoader = new Promise<AMapNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => reject(new Error("高德地图 SDK 加载超时")), 12_000);
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(AMAP_JS_KEY)}&plugin=AMap.Scale,AMap.ToolBar`;
    script.async = true;
    script.dataset.amapSdk = "true";
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.AMap) resolve(window.AMap);
      else reject(new Error("高德地图 SDK 未初始化"));
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("高德地图 SDK 请求失败"));
    };
    document.head.append(script);
  });
  return amapLoader;
}

function addAmapInfoWindow(
  AMap: AMapNamespace,
  map: AMapMapInstance,
  marker: InstanceType<AMapNamespace["Marker"]>,
  content: HTMLElement,
) {
  marker.on("click", () => {
    const infoWindow = new AMap.InfoWindow({
      content,
      anchor: "bottom-center",
      offset: new AMap.Pixel(0, -12),
      closeWhenClickMap: true,
    });
    infoWindow.open(map, marker.getPosition());
  });
}

async function renderAmap(
  element: HTMLElement,
  AMap: AMapNamespace,
  points: AliRoutePoint[],
  days: AliRouteDay[],
  layerGroups: React.MutableRefObject<Partial<Record<LayerKey, AMapOverlayGroup>>>,
) {
  const { pointById, dayNumbersByPoint } = getRouteIndexes(points, days);
  const map = new AMap.Map(element, {
    viewMode: "2D",
    zoom: 5,
    center: toAmapPosition(30.3, 85.4),
    scrollWheel: false,
    resizeEnable: true,
    showLabel: true,
    mapStyle: "amap://styles/normal",
  });
  let stopReadinessCheck = () => {};
  const mapReady = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      stopReadinessCheck();
      if (error) reject(error);
      else resolve();
    };
    const handleCspViolation = (event: SecurityPolicyViolationEvent) => {
      const directive = event.effectiveDirective || event.violatedDirective;
      if (directive === "worker-src" && event.blockedURI === "blob") {
        finish(new Error("高德地图 Web Worker 被 CSP 阻止"));
      }
    };
    const timeout = window.setTimeout(() => finish(new Error("高德地图底图渲染超时")), 10_000);
    stopReadinessCheck = () => {
      window.clearTimeout(timeout);
      document.removeEventListener("securitypolicyviolation", handleCspViolation);
    };
    document.addEventListener("securitypolicyviolation", handleCspViolation);
    map.on("complete", () => {
      finish();
    });
  });

  const roadOverlays: unknown[] = [];
  const routeOverlays: unknown[] = [];
  for (const day of days) {
    const coordinates = aliRoutedDayGeometry[day.day] ?? day.pointIds
      .map((id) => pointById.get(id))
      .filter((point): point is AliRoutePoint => Boolean(point))
      .map((point) => [point.lat, point.lng] as [number, number]);
    if (coordinates.length < 2) continue;

    const path = coordinates.map(([lat, lng]) => toAmapPosition(lat, lng));
    roadOverlays.push(new AMap.Polyline({
      path,
      strokeColor: "#fff8e9",
      strokeWeight: 8,
      strokeOpacity: 0.9,
      lineJoin: "round",
      lineCap: "round",
      zIndex: 110,
    }));
    roadOverlays.push(new AMap.Polyline({
      path,
      strokeColor: "#d29a33",
      strokeWeight: 4,
      strokeOpacity: 0.96,
      lineJoin: "round",
      lineCap: "round",
      zIndex: 111,
      title: `D${String(day.day).padStart(2, "0")} · ${day.roads}`,
    }));
    routeOverlays.push(new AMap.Polyline({
      path,
      strokeColor: "#b64934",
      strokeWeight: 2,
      strokeOpacity: 0.9,
      strokeStyle: "dashed",
      strokeDasharray: [3, 10],
      lineJoin: "round",
      lineCap: "round",
      zIndex: 112,
      title: `D${String(day.day).padStart(2, "0")} · ${day.title}`,
    }));
  }

  for (const road of aliRoadLabels) {
    const marker = new AMap.Marker({
      position: toAmapPosition(road.lat, road.lng),
      content: createRoadIconElement(road),
      anchor: "center",
      title: `${road.ref}，${road.name}`,
      zIndex: 150,
      extData: { major: majorRoadRefs.has(road.ref) },
    });
    addAmapInfoWindow(AMap, map, marker, createRoadPopup(road));
    roadOverlays.push(marker);
  }

  const placeOverlays: unknown[] = [];
  for (const point of points) {
    const markerContent = document.createElement("span");
    markerContent.className = "ali-amap-place-marker";
    markerContent.title = `${point.name}，${kindLabel[point.kind]}`;

    const dot = document.createElement("i");
    dot.className = `ali-route-marker ali-route-marker--${point.kind}`;
    markerContent.append(dot);
    if (point.kind === "overnight" || point.kind === "airport") {
      const label = document.createElement("b");
      label.className = "ali-amap-place-label";
      label.textContent = point.shortName;
      markerContent.append(label);
    }

    const marker = new AMap.Marker({
      position: toAmapPosition(point.lat, point.lng),
      content: markerContent,
      anchor: "center",
      title: `${point.name}，${kindLabel[point.kind]}`,
      zIndex: 160,
    });
    addAmapInfoWindow(AMap, map, marker, createPopup(point, dayNumbersByPoint.get(point.id) ?? [], "amap"));
    placeOverlays.push(marker);
  }

  const roads = new AMap.OverlayGroup(roadOverlays);
  const routes = new AMap.OverlayGroup(routeOverlays);
  const places = new AMap.OverlayGroup(placeOverlays);
  layerGroups.current = { roads, routes, places };
  map.add(roads);
  map.add(routes);
  map.add(places);
  map.addControl(new AMap.Scale({ position: "LB" }));
  map.addControl(new AMap.ToolBar({ position: "LT", liteStyle: true }));
  map.setFitView(placeOverlays, false, [38, 38, 38, 38], 7);
  try {
    await mapReady;
  } catch (error) {
    stopReadinessCheck();
    layerGroups.current = {};
    map.destroy();
    throw error;
  }

  return () => {
    layerGroups.current = {};
    map.destroy();
  };
}

async function renderOpenStreetMap(element: HTMLElement, points: AliRoutePoint[], days: AliRouteDay[]) {
  const L = await import("leaflet");
  await import("leaflet/dist/leaflet.css");
  const { pointById, dayNumbersByPoint } = getRouteIndexes(points, days);

  const map = L.map(element, {
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
      color: "#fff8e9", weight: 8, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false,
    }).addTo(roadLayer);
    const road = L.polyline(coordinates, {
      color: "#d29a33", weight: 4, opacity: 0.96, lineCap: "round", lineJoin: "round",
    }).addTo(roadLayer);
    road.bindTooltip(`D${String(day.day).padStart(2, "0")} · ${day.roads}`, {
      sticky: true, className: "ali-road-line-label",
    });
    const line = L.polyline(coordinates, {
      color: "#b64934", weight: 2, opacity: 0.9, dashArray: "3 10", lineCap: "round", lineJoin: "round",
    }).addTo(routeLayer);
    line.bindTooltip(`D${String(day.day).padStart(2, "0")} · ${day.title}`, {
      sticky: true, className: "ali-route-line-label",
    });
  }

  for (const road of aliRoadLabels) {
    const icon = L.divIcon({
      className: `ali-road-shield-icon${majorRoadRefs.has(road.ref) ? " ali-road-shield-icon--major" : ""}`,
      html: createRoadIconElement(road).outerHTML,
      iconSize: [118, 30], iconAnchor: [59, 15], popupAnchor: [0, -17],
    });
    L.marker([road.lat, road.lng], {
      icon, keyboard: true, title: `${road.ref}，${road.name}`, alt: road.name, riseOnHover: true,
    }).bindPopup(createRoadPopup(road), { minWidth: 230, maxWidth: 300 }).addTo(roadLayer);
  }

  const markerLayer = L.featureGroup().addTo(map);
  for (const point of points) {
    const icon = L.divIcon({
      className: "ali-route-div-icon",
      html: `<span class="ali-route-marker ali-route-marker--${point.kind}" aria-hidden="true"></span>`,
      iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -13],
    });
    const marker = L.marker([point.lat, point.lng], {
      icon, keyboard: true, title: `${point.name}，${kindLabel[point.kind]}`, alt: point.name, riseOnHover: true,
    }).addTo(markerLayer);
    marker.bindPopup(createPopup(point, dayNumbersByPoint.get(point.id) ?? [], "osm"), {
      minWidth: 240, maxWidth: 320,
    });
    marker.bindTooltip(point.shortName, {
      direction: "top", offset: [0, -10], permanent: point.kind === "overnight" || point.kind === "airport",
      className: "ali-route-place-label",
    });
  }

  const bounds = markerLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 7 });
  L.control.layers({}, {
    "公路走向与编号": roadLayer,
    "逐日行驶路线": routeLayer,
    "城市、景点与补给": markerLayer,
  }, { collapsed: true, position: "topright" }).addTo(map);
  L.control.scale({ imperial: false, metric: true, position: "bottomleft" }).addTo(map);
  requestAnimationFrame(() => map.invalidateSize());
  return () => map.remove();
}

export default function AliRouteMap({ points, days }: Props) {
  const mapElement = useRef<HTMLDivElement>(null);
  const amapLayerGroups = useRef<Partial<Record<LayerKey, AMapOverlayGroup>>>({});
  const [provider, setProvider] = useState<MapProvider>("loading");

  useEffect(() => {
    if (!mapElement.current || points.length === 0) return;
    let cancelled = false;
    let disposeMap: (() => void) | undefined;

    void (async () => {
      const element = mapElement.current;
      if (!element) return;
      try {
        if (!AMAP_JS_KEY || !AMAP_SECURITY_CODE) throw new Error("高德地图配置未提供");
        const AMap = await loadAmapSdk();
        if (cancelled) return;
        disposeMap = await renderAmap(element, AMap, points, days, amapLayerGroups);
        setProvider("amap");
      } catch (error) {
        if (cancelled) return;
        console.info("[AliRouteMap] 高德地图不可用，已切换 OpenStreetMap 备用底图。", error);
        disposeMap?.();
        element.replaceChildren();
        disposeMap = await renderOpenStreetMap(element, points, days);
        if (!cancelled) setProvider("osm");
        else disposeMap();
      }
    })();

    return () => {
      cancelled = true;
      disposeMap?.();
    };
  }, [days, points]);

  function toggleAmapLayer(layer: LayerKey, visible: boolean) {
    const group = amapLayerGroups.current[layer];
    if (!group) return;
    if (visible) group.show();
    else group.hide();
  }

  const providerLabel = provider === "amap"
    ? "高德地图官方底图"
    : provider === "osm"
      ? "OpenStreetMap 备用底图"
      : "地图正在加载";

  return (
    <div className="ali-route-map-shell" data-map-provider={provider}>
      <div
        ref={mapElement}
        className="ali-route-map"
        role="region"
        aria-label="阿里大环线真实底图，包含道路拟合线、公路编号、每日路线、途经城市、景点、补给点与住宿点"
      />
      {provider === "amap" && (
        <fieldset className="ali-amap-layer-control" aria-label="地图图层开关">
          <legend>图层</legend>
          <label><input type="checkbox" defaultChecked onChange={(event) => toggleAmapLayer("roads", event.currentTarget.checked)} />公路走向与编号</label>
          <label><input type="checkbox" defaultChecked onChange={(event) => toggleAmapLayer("routes", event.currentTarget.checked)} />逐日行驶路线</label>
          <label><input type="checkbox" defaultChecked onChange={(event) => toggleAmapLayer("places", event.currentTarget.checked)} />城市、景点与补给</label>
        </fieldset>
      )}
      <p className="ali-route-map-help" aria-live="polite">
        <strong>{providerLabel}</strong> · 拖动查看 · 点击公路牌或地点查看详情 · 已关闭滚轮缩放
      </p>
    </div>
  );
}

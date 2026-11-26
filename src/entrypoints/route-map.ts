import "leaflet/dist/leaflet.css";

import type { AliRoadLabel } from "../data/ali-road-geometry";
import type { AliRouteDay, AliRoutePoint, AliRoutePointKind } from "../data/ali-route";
import { toAmapPosition } from "../utils/amap-coordinate";

interface RouteData {
  points: AliRoutePoint[];
  days: AliRouteDay[];
  roadLabels: AliRoadLabel[];
  routedDayGeometry: Record<number, [number, number][]>;
}

const EMPTY_ROUTE: RouteData = { points: [], days: [], roadLabels: [], routedDayGeometry: {} };

function parseRouteData(raw: string): RouteData {
  try {
    const parsed = JSON.parse(raw) as Partial<RouteData>;
    return {
      points: parsed.points ?? [],
      days: parsed.days ?? [],
      roadLabels: parsed.roadLabels ?? [],
      routedDayGeometry: parsed.routedDayGeometry ?? {},
    };
  } catch (error) {
    console.error("[AliRouteMap] 路线数据解析失败，地图将保持空白", error);
    return { points: [], days: [], roadLabels: [], routedDayGeometry: {} };
  }
}

type MapProvider = "loading" | "amap" | "osm";
/** AMap 的 OverlayGroup 句柄；不再用 React ref，拿一个普通对象当持有者。 */
type LayerGroupHolder = { current: Partial<Record<LayerKey, AMapOverlayGroup>> };
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
  peak: "重点峰体",
  supply: "补给点",
};

function hasPermanentLabel(point: AliRoutePoint) {
  return point.kind === "overnight" || point.kind === "airport" || point.kind === "peak";
}
const majorRoadRefs = new Set(["G6", "G0612", "G109", "G219", "G317", "G318"]);
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
  if (point.kind === "peak") {
    eyebrow.textContent = days.length > 0
      ? `重点峰体 · ${days.map((day) => `D${String(day).padStart(2, "0")}`).join(" / ")}`
      : "重点峰体 · 本版行驶日不进入";
  } else {
    eyebrow.textContent = `${kindLabel[point.kind]} · ${days.map((day) => `D${String(day).padStart(2, "0")}`).join(" / ")}`;
  }

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
  roadLabels: AliRoadLabel[],
  routedDayGeometry: Record<number, [number, number][]>,
  layerGroups: LayerGroupHolder,
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
    const coordinates = routedDayGeometry[day.day] ?? day.pointIds
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

  for (const road of roadLabels) {
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
    markerContent.className = `ali-amap-place-marker${point.kind === "peak" ? " ali-amap-place-marker--peak" : ""}`;
    markerContent.title = `${point.name}，${kindLabel[point.kind]}`;

    const dot = document.createElement("i");
    dot.className = `ali-route-marker ali-route-marker--${point.kind}`;
    markerContent.append(dot);
    if (hasPermanentLabel(point)) {
      const label = document.createElement("b");
      label.className = `ali-amap-place-label${point.kind === "peak" ? " ali-amap-place-label--peak" : ""}`;
      label.textContent = point.shortName;
      markerContent.append(label);
    }

    const marker = new AMap.Marker({
      position: toAmapPosition(point.lat, point.lng),
      content: markerContent,
      anchor: "center",
      title: `${point.name}，${kindLabel[point.kind]}`,
      zIndex: point.kind === "peak" ? 180 : 160,
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

async function renderOpenStreetMap(
  element: HTMLElement,
  points: AliRoutePoint[],
  days: AliRouteDay[],
  roadLabels: AliRoadLabel[],
  routedDayGeometry: Record<number, [number, number][]>,
) {
  const L = await import("leaflet");
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
    const coordinates = routedDayGeometry[day.day] ?? day.pointIds
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

  for (const road of roadLabels) {
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
      className: `ali-route-div-icon${point.kind === "peak" ? " ali-route-div-icon--peak" : ""}`,
      html: `<span class="ali-route-marker ali-route-marker--${point.kind}" aria-hidden="true"></span>`,
      iconSize: point.kind === "peak" ? [26, 26] : [22, 22],
      iconAnchor: point.kind === "peak" ? [13, 13] : [11, 11],
      popupAnchor: [0, -13],
    });
    const marker = L.marker([point.lat, point.lng], {
      icon,
      keyboard: true,
      title: `${point.name}，${kindLabel[point.kind]}`,
      alt: point.name,
      riseOnHover: true,
      zIndexOffset: point.kind === "peak" ? 400 : 0,
    }).addTo(markerLayer);
    marker.bindPopup(createPopup(point, dayNumbersByPoint.get(point.id) ?? [], "osm"), {
      minWidth: 240, maxWidth: 320,
    });
    marker.bindTooltip(point.shortName, {
      direction: "top",
      offset: [0, -10],
      permanent: hasPermanentLabel(point),
      className: point.kind === "peak" ? "ali-route-place-label ali-route-place-label--peak" : "ali-route-place-label",
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

const PROVIDER_TEXT: Record<MapProvider, string> = {
  loading: "地图正在加载",
  amap: "高德地图官方底图",
  osm: "OpenStreetMap 备用底图",
};

/**
 * 把一个已经服务端渲染好的地图外壳接管起来（第 230 轮）。
 *
 * 上一版这里是 React 岛：8 个路书页为了一个「滚到才画」的地图，各自拉 202 KB 的
 * React 运行时。地图的所有绘制本来就是命令式的 AMap / Leaflet 调用，React 只负责
 * 一个 provider 状态和一个图层开关 —— 换成直接改 DOM 就够了。
 *
 * 数据仍然按需取（`/data/ali-route/<slug>.json`），只有外壳滚进可视区才调用本函数。
 */
export function mountRouteMap(shell: HTMLElement): () => void {
  const mapElement = shell.querySelector<HTMLElement>(".ali-route-map");
  const label = shell.querySelector<HTMLElement>("[data-provider-label]");
  const layerControl = shell.querySelector<HTMLDetailsElement>(".ali-amap-layer-control");
  const dataUrl = shell.dataset.dataUrl ?? "";
  if (!mapElement) return () => {};

  const layerGroups: LayerGroupHolder = { current: {} };
  let disposed = false;
  let disposeMap: (() => void) | undefined;
  const controller = new AbortController();

  const setProvider = (provider: MapProvider, errorText?: string) => {
    if (disposed) return;
    shell.dataset.mapProvider = provider;
    if (label) label.textContent = errorText ?? PROVIDER_TEXT[provider];
    if (layerControl) layerControl.hidden = provider !== "amap";
  };

  (async () => {
    let route: RouteData | null = null;
    try {
      const response = await fetch(dataUrl, { signal: controller.signal, credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      route = parseRouteData(await response.text());
    } catch (error) {
      if (disposed || controller.signal.aborted) return;
      console.error("[AliRouteMap] 路线数据加载失败", error);
      setProvider("loading", "路线数据加载失败，刷新页面可重试");
      return;
    }
    if (disposed) return;
    const { points, days, roadLabels, routedDayGeometry } = route;

    try {
      if (!AMAP_JS_KEY || !AMAP_SECURITY_CODE) throw new Error("高德地图配置未提供");
      const AMap = await loadAmapSdk();
      if (disposed) return;
      disposeMap = await renderAmap(mapElement, AMap, points, days, roadLabels, routedDayGeometry, layerGroups);
      setProvider("amap");
    } catch (error) {
      if (disposed) return;
      disposeMap?.();
      disposeMap = undefined;
      mapElement.replaceChildren();
      console.info("[AliRouteMap] 高德地图不可用，已切换 OpenStreetMap 备用底图。", error);
      try {
        disposeMap = await renderOpenStreetMap(mapElement, points, days, roadLabels, routedDayGeometry);
        setProvider("osm");
      } catch (fallbackError) {
        console.error("[AliRouteMap] 备用底图也失败了", fallbackError);
        setProvider("loading", "地图加载失败，请稍后刷新");
      }
    }
  })();

  // 高德地图的图层开关：SSR 时是 <details hidden>，真用上高德才显示。
  const onLayerToggle = (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    const key = input?.dataset.layer as LayerKey | undefined;
    if (!input || !key) return;
    const group = layerGroups.current[key];
    if (!group) return;
    if (input.checked) group.show();
    else group.hide();
  };
  layerControl?.addEventListener("change", onLayerToggle);

  return () => {
    disposed = true;
    controller.abort();
    layerControl?.removeEventListener("change", onLayerToggle);
    layerGroups.current = {};
    disposeMap?.();
    disposeMap = undefined;
  };
}

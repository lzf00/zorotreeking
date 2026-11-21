/**
 * GPX 轨迹的静态预览（第 126 轮）。
 *
 * 为什么需要：`/hike/sample-route/` 在 Lighthouse CI 里 LCP 3.82 s（预算 3.5 s），
 * LCP 元素就是 **Leaflet 的瓦片图**——地图一进视口，组件水合、拉 12 块瓦片，
 * 首屏最大的那块图象就是瓦片。为了一张用户可以点开的地图，让首屏等第三方瓦片不划算，
 * 而且每开一次页面就给 openstreetmap.org 发 12 个请求（隐私上也没必要）。
 *
 * 做法：先用轨迹点画一个**内联 SVG**（不联网、不加载 Leaflet），
 * 用户点了「加载交互地图」再去拉瓦片。这个文件只管把经纬度投影成 SVG 路径（纯函数，好测）。
 */

export type GpxPoint = { lat: number; lng: number; ele?: number };

export type PreviewBox = { width: number; height: number; padding: number };

export type TrackPreview = {
  /** SVG `<path d="…">` */
  path: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** 轨迹外接框（用于画比例尺/调试） */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
};

/**
 * 等距圆柱投影 + 按纬度压缩经度（在几十公里范围内误差可以忽略）。
 * 单点或空数组返回 null —— 没有轨迹可画时调用方应该什么都不画。
 */
export function trackPreview(points: GpxPoint[], box: PreviewBox = { width: 640, height: 360, padding: 24 }): TrackPreview | null {
  const usable = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (usable.length < 2) return null;

  const midLat = usable.reduce((sum, p) => sum + p.lat, 0) / usable.length;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = usable.map((p) => p.lng * kx);
  const ys = usable.map((p) => -p.lat); // SVG 的 y 向下，纬度向上

  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const innerW = Math.max(box.width - box.padding * 2, 1);
  const innerH = Math.max(box.height - box.padding * 2, 1);
  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;
  // 等比缩放：短边居中，避免轨迹被拉扁
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const offsetX = box.padding + (innerW - spanX * scale) / 2;
  const offsetY = box.padding + (innerH - spanY * scale) / 2;
  const project = (x: number, y: number) => ({
    x: round(offsetX + (x - minX) * scale),
    y: round(offsetY + (y - minY) * scale),
  });

  const coords = xs.map((x, i) => project(x, ys[i]));
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x} ${c.y}`).join(" ");
  return {
    path,
    start: coords[0],
    end: coords[coords.length - 1],
    bounds: { minX: round(offsetX), maxX: round(maxX - minX), minY: round(offsetY), maxY: round(maxY - minY) },
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 轨迹总爬升/总里程这类数字不在这里算（在构建脚本里），这里只画线。 */

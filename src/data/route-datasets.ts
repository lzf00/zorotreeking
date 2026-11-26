/**
 * 路书页的地图数据（第 229 轮）。
 *
 * 背景：8 个阿里/川西路书页原来把整份路线几何（points / days / roadLabels /
 * routedDayGeometry）当对象 props 传给地图岛 —— Astro 会把每个数组/对象包成
 * `[类型, 值]` 二元组，单页 props 实测 47–84 KB，**gzip 后仍占整页 20–25 KB**
 * （这些页面 HTML gzip 只有 55–80 KB，等于三分之一是地图数据）。
 *
 * 现在数据改成静态 JSON（`/data/ali-route/<key>.json`），由地图岛在滚到可视区、
 * 真正要画图时再取：
 *   · 不滚到地图的读者完全不付这 20–25 KB
 *   · 数据可被浏览器/nginx 缓存，8 个页面共享同一份几何（键按线路分，几何数据本身同源）
 *   · HTML 里不再有 base64 之外的大块数字噪声，首屏解析也更快
 *
 * key 用页面 slug：地址栏和 JSON 文件名能对上，排查时不用再跳一层映射表。
 */
import { aliRouteDays, aliRoutePoints } from "./ali-route";
import { aliRoadLabels, aliRoutedDayGeometry } from "./ali-road-geometry";
import {
  aliCentralChengduRoadLabels,
  aliCentralChengduRoutedDayGeometry,
  aliCentralLanzhouRoadLabels,
  aliCentralLanzhouRoutedDayGeometry,
} from "./ali-central-road-geometry";
import {
  aliCentralChengduRouteDays,
  aliCentralChengduRoutePoints,
  aliCentralLanzhouRouteDays,
  aliCentralLanzhouRoutePoints,
} from "./ali-central-route";
import {
  aliLhasaReturnRoadLabels,
  aliLhasaReturnRoutedDayGeometry,
} from "./ali-lhasa-return-road-geometry";
import { aliLhasaReturnRouteDays, aliLhasaReturnRoutePoints } from "./ali-lhasa-return-route";
import {
  aliPermitBypassRoadLabels,
  aliPermitBypassRoutedDayGeometry,
} from "./ali-permit-bypass-road-geometry";
import { aliPermitBypassRouteDays, aliPermitBypassRoutePoints } from "./ali-permit-bypass-route";
import { chuanxiLoopRoadLabels, chuanxiLoopRoutedDayGeometry } from "./chuanxi-loop-road-geometry";
import { chuanxiLoopRouteDays, chuanxiLoopRoutePoints } from "./chuanxi-loop-route";
import { lhasaLanzhouRoadLabels, lhasaLanzhouRoutedDayGeometry } from "./lhasa-lanzhou-road-geometry";
import { lhasaLanzhouRouteDays, lhasaLanzhouRoutePoints } from "./lhasa-lanzhou-route";
import {
  nagquG317RoadLabels,
  nagquG317RoutedDayGeometry,
} from "./nagqu-g317-chengdu-road-geometry";
import { nagquG317DeadlineRouteDays, nagquG317RoutePoints } from "./nagqu-g317-chengdu-route";

import type { AliRouteDay, AliRoutePoint } from "./ali-route";
import type { AliRoadLabel } from "./ali-road-geometry";

export interface RouteDataset {
  points: AliRoutePoint[];
  days: AliRouteDay[];
  roadLabels: AliRoadLabel[];
  routedDayGeometry: Record<number, [number, number][]>;
}

export const routeDatasets: Record<string, RouteDataset> = {
  "ali-grand-loop-2026": {
    points: aliRoutePoints,
    days: aliRouteDays,
    roadLabels: aliRoadLabels,
    routedDayGeometry: aliRoutedDayGeometry,
  },
  "ali-grand-loop-ali-permit-2026": {
    points: aliPermitBypassRoutePoints,
    days: aliPermitBypassRouteDays,
    roadLabels: aliPermitBypassRoadLabels,
    routedDayGeometry: aliPermitBypassRoutedDayGeometry,
  },
  "ali-grand-loop-lhasa-return-2026": {
    points: aliLhasaReturnRoutePoints,
    days: aliLhasaReturnRouteDays,
    roadLabels: aliLhasaReturnRoadLabels,
    routedDayGeometry: aliLhasaReturnRoutedDayGeometry,
  },
  "ali-grand-loop-lhasa-lanzhou-2026": {
    points: lhasaLanzhouRoutePoints,
    days: lhasaLanzhouRouteDays,
    roadLabels: lhasaLanzhouRoadLabels,
    routedDayGeometry: lhasaLanzhouRoutedDayGeometry,
  },
  "ali-central-loop-lhasa-lanzhou-2026": {
    points: aliCentralLanzhouRoutePoints,
    days: aliCentralLanzhouRouteDays,
    roadLabels: aliCentralLanzhouRoadLabels,
    routedDayGeometry: aliCentralLanzhouRoutedDayGeometry,
  },
  "ali-central-loop-nagqu-chengdu-2026": {
    points: aliCentralChengduRoutePoints,
    days: aliCentralChengduRouteDays,
    roadLabels: aliCentralChengduRoadLabels,
    routedDayGeometry: aliCentralChengduRoutedDayGeometry,
  },
  "ali-central-loop-nagqu-g317-chengdu-2026": {
    points: nagquG317RoutePoints,
    days: nagquG317DeadlineRouteDays,
    roadLabels: nagquG317RoadLabels,
    routedDayGeometry: nagquG317RoutedDayGeometry,
  },
  "chuanxi-loop-chengdu-2026": {
    points: chuanxiLoopRoutePoints,
    days: chuanxiLoopRouteDays,
    roadLabels: chuanxiLoopRoadLabels,
    routedDayGeometry: chuanxiLoopRoutedDayGeometry,
  },
};

export type RouteDatasetKey = keyof typeof routeDatasets;

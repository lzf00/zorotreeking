/**
 * 路书地图数据（第 229 轮）—— 静态 JSON，构建期生成，运行期只取不查。
 *
 * 为什么单独一个文件而不是塞回 HTML：见 src/data/route-datasets.ts 的注释。
 * 只有把地图滚进可视区的读者才需要这份数据，所以它不该出现在首屏 HTML 里。
 */
import type { APIRoute, GetStaticPaths } from "astro";

import { routeDatasets } from "../../../data/route-datasets";

export const getStaticPaths: GetStaticPaths = () =>
  Object.keys(routeDatasets).map((key) => ({ params: { key } }));

export const GET: APIRoute = ({ params }) => {
  const dataset = routeDatasets[params.key ?? ""];
  if (!dataset) return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(dataset), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};

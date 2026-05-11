import { useMemo } from "react";

type Point = { lat: number; lng: number; ele?: number };

interface Props {
  points: Point[];
  height?: number;
}

// 简易 SVG 海拔曲线，避免引 Recharts；下采样到 ~200 个点
export default function ElevationChart({ points, height = 120 }: Props) {
  const samples = useMemo(() => {
    const withEle = points.filter((p) => p.ele != null);
    if (withEle.length < 2) return [];
    const N = Math.min(200, withEle.length);
    const step = Math.max(1, Math.floor(withEle.length / N));
    return withEle.filter((_, i) => i % step === 0).map((p) => p.ele!);
  }, [points]);

  if (samples.length < 2) {
    return <div className="text-sm text-[var(--text-tertiary)] py-6 text-center">无海拔数据</div>;
  }

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = Math.max(1, max - min);
  const W = 800;
  const H = height;
  const pad = 8;
  const step = (W - pad * 2) / (samples.length - 1);

  const points2d = samples.map((e, i) => [pad + i * step, pad + ((max - e) / range) * (H - pad * 2)] as const);
  const path = points2d.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${(pad + (samples.length - 1) * step).toFixed(1)},${H - pad} L${pad},${H - pad} Z`;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-auto" role="img" aria-label="elevation profile">
        <defs>
          <linearGradient id="ele-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16a34a" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#16a34a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#ele-grad)" stroke="none" />
        <path d={path} fill="none" stroke="#16a34a" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex items-center justify-between text-xs text-[var(--text-tertiary)]">
        <span>低点 {Math.round(min)}m</span>
        <span>高点 {Math.round(max)}m</span>
      </div>
    </div>
  );
}

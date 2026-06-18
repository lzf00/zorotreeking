/**
 * 简单 PCA 把高维 embedding 投影到 2D 用于 /explore 散点图。
 *
 * 实现策略：60 篇 × 2048 维。直接计算协方差矩阵 (2048×2048) 太大，
 * 走 Gram matrix (60×60) 找 top-2 特征向量，然后映射回原空间。
 * 数学等价：X X^T 的特征向量对应 X^T X 的非零特征向量（差一个变换）。
 *
 * 输入: { [key]: number[] }（每个文档一个向量）
 * 输出: { [key]: [x, y] }
 *
 * 60 个向量 × 2048 维，跑一次约 50ms。
 */

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(v: number[]): number {
  return Math.sqrt(dot(v, v));
}

function scale(v: number[], s: number): number[] {
  return v.map((x) => x * s);
}

function sub(a: number[], b: number[]): number[] {
  return a.map((x, i) => x - b[i]);
}

function add(a: number[], b: number[]): number[] {
  return a.map((x, i) => x + b[i]);
}

/**
 * 在 N×N Gram matrix 上做 power iteration 找前 k 个特征向量。
 * gram[i][j] = centered_X[i] . centered_X[j]
 */
function topKEigen(gram: number[][], k: number, iters = 80): { vec: number[]; val: number }[] {
  const n = gram.length;
  const found: { vec: number[]; val: number }[] = [];

  for (let step = 0; step < k; step++) {
    // 随机初始化
    let v = Array.from({ length: n }, () => Math.random() - 0.5);
    // 单位化
    let m = norm(v);
    v = m > 0 ? scale(v, 1 / m) : v;

    for (let iter = 0; iter < iters; iter++) {
      // v_next = gram * v
      const vn = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        let s = 0;
        const row = gram[i];
        for (let j = 0; j < n; j++) s += row[j] * v[j];
        vn[i] = s;
      }
      // 减去已发现的特征向量分量（deflation 让结果与前面正交）
      for (const f of found) {
        const c = dot(vn, f.vec);
        for (let i = 0; i < n; i++) vn[i] -= c * f.vec[i];
      }
      const nm = norm(vn);
      if (nm < 1e-10) break;
      v = scale(vn, 1 / nm);
    }
    // λ ≈ v^T A v
    const Av = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += gram[i][j] * v[j];
      Av[i] = s;
    }
    const lambda = dot(v, Av);
    found.push({ vec: v, val: lambda });
  }
  return found;
}

export interface ExplorePoint {
  key: string;
  x: number;
  y: number;
}

/**
 * 主入口。把 items map 投影到 2D。
 */
export function projectTo2D(items: Record<string, { vec: number[] }>): ExplorePoint[] {
  const keys = Object.keys(items);
  const n = keys.length;
  if (n < 2) return keys.map((k) => ({ key: k, x: 0, y: 0 }));

  const dim = items[keys[0]].vec.length;
  // 中心化
  const mean = new Array(dim).fill(0);
  for (const k of keys) {
    const v = items[k].vec;
    for (let i = 0; i < dim; i++) mean[i] += v[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= n;
  const centered = keys.map((k) => sub(items[k].vec, mean));

  // Gram matrix
  const gram: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n);
    for (let j = 0; j < n; j++) row[j] = dot(centered[i], centered[j]);
    gram.push(row);
  }

  // 前 2 特征向量（每个是 n 维，对应每个文档在该方向上的"分量"）
  const eigs = topKEigen(gram, 2, 80);

  // 文档 i 的 2D 坐标 ≈ [sqrt(λ1) * e1[i], sqrt(λ2) * e2[i]]
  const out: ExplorePoint[] = keys.map((k, i) => ({
    key: k,
    x: Math.sqrt(Math.max(eigs[0].val, 0)) * eigs[0].vec[i],
    y: Math.sqrt(Math.max(eigs[1].val, 0)) * eigs[1].vec[i],
  }));

  // 归一化到 [-1, 1]
  const maxAbs = out.reduce((m, p) => Math.max(m, Math.abs(p.x), Math.abs(p.y)), 0) || 1;
  return out.map((p) => ({ key: p.key, x: p.x / maxAbs, y: p.y / maxAbs }));
}

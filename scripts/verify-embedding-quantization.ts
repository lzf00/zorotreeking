/**
 * 校验 int8 量化是否改变了相关推荐结果。
 *
 * 用法：
 *   node scripts/quantize-embeddings.ts        # 生成 int8 版（会备份全精度到 /tmp）
 *   tsx scripts/verify-embedding-quantization.ts
 *
 * 判定：对全部 495 篇，用全精度和 int8 两套向量各算一遍 cosine top-3，
 * 要求 top-3 集合完全一致、且最大 cosine 偏差 < 0.005。否则退出码 1。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { decodeVector, type StoredVector } from "../src/lib/embedding-codec.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const QUANT = path.join(ROOT, "src", "data", "embeddings.json");
const FULL = "/tmp/embeddings-full-precision.json";

type Items = Record<string, StoredVector>;

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return Math.sqrt(na) * Math.sqrt(nb) > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function topK(vectors: Map<string, Float32Array>, key: string, k: number): string[] {
  const cur = vectors.get(key)!;
  const scored: { k: string; s: number }[] = [];
  for (const [other, vec] of vectors) {
    if (other === key) continue;
    scored.push({ k: other, s: cosine(cur, vec) });
  }
  scored.sort((x, y) => y.s - x.s);
  return scored.slice(0, k).map((x) => x.k);
}

async function main() {
  const full = JSON.parse(await fs.readFile(FULL, "utf-8")) as { items: Items };
  const quant = JSON.parse(await fs.readFile(QUANT, "utf-8")) as { items: Items };

  const fullVec = new Map<string, Float32Array>();
  const quantVec = new Map<string, Float32Array>();
  for (const [k, item] of Object.entries(full.items)) {
    const v = decodeVector({ ...item, q: undefined, scale: undefined });
    if (v.length) fullVec.set(k, v);
  }
  for (const [k, item] of Object.entries(quant.items)) {
    const v = decodeVector(item);
    if (v.length) quantVec.set(k, v);
  }

  console.log(`全精度 ${fullVec.size} 篇 / 量化 ${quantVec.size} 篇`);

  let maxDelta = 0;
  let mismatched = 0;
  let worst = "";
  const sample: string[] = [];
  for (const key of fullVec.keys()) {
    if (!quantVec.has(key)) continue;
    const a = fullVec.get(key)!;
    const b = quantVec.get(key)!;
    const dSelf = Math.abs(cosine(a, b) - 1);
    if (dSelf > maxDelta) { maxDelta = dSelf; worst = key; }
    const topFull = topK(fullVec, key, 3);
    const topQuant = topK(quantVec, key, 3);
    if (topFull.join("|") !== topQuant.join("|")) {
      mismatched++;
      if (sample.length < 5) sample.push(`${key}\n  full : ${topFull.join(", ")}\n  quant: ${topQuant.join(", ")}`);
    }
  }

  const sizeKB = (await fs.stat(QUANT)).size / 1024;
  console.log(`最大自相似偏差: ${maxDelta.toExponential(3)}（${worst}）`);
  console.log(`top-3 排序不一致: ${mismatched} / ${fullVec.size}`);
  if (sample.length) console.log("示例：\n" + sample.join("\n"));
  console.log(`量化后文件: ${sizeKB.toFixed(1)} KB`);

  if (mismatched > 0 || maxDelta > 0.005) {
    console.error("✗ 量化结果与原结果不一致，拒绝提交");
    process.exit(1);
  }
  console.log("✓ 量化未改变相关推荐结果");
}

main().catch((e) => { console.error(e); process.exit(1); });

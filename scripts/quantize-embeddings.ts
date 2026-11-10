/**
 * 一次性迁移：把 embeddings.json 从 float 数组转成 int8+base64。
 * 全精度副本备份到 /tmp/embeddings-full-precision.json 供校验用。
 * 之后 generate-embeddings.ts 会直接写量化格式，不需要再跑这个。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { toStoredVector, type StoredVector } from "../src/lib/embedding-codec.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILE = path.join(ROOT, "src", "data", "embeddings.json");
const BACKUP = "/tmp/embeddings-full-precision.json";

async function main() {
  const before = (await fs.stat(FILE)).size;
  const cache = JSON.parse(await fs.readFile(FILE, "utf-8")) as { items: Record<string, StoredVector> };
  await fs.copyFile(FILE, BACKUP);

  let converted = 0;
  for (const [k, item] of Object.entries(cache.items)) {
    if (item.q) continue;
    cache.items[k] = toStoredVector(item);
    converted++;
  }
  await fs.writeFile(FILE, JSON.stringify(cache));
  const after = (await fs.stat(FILE)).size;
  console.log(`转换 ${converted} 条向量：${(before / 1024 / 1024).toFixed(2)}MB → ${(after / 1024).toFixed(1)}KB（缩小 ${(before / after).toFixed(1)}×）`);
  console.log(`全精度备份: ${BACKUP}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * embeddings.json 的向量编解码。
 *
 * 背景：495 篇 × 2048 维的 float 数组直接写进 JSON 约 16MB，且每次 daily-digest
 * 更新都会重写整个文件——git 仓库里躺着十几版 16MB blob。相关推荐和 /explore
 * 只用到 cosine 相似度和 PCA 投影，用定点量化 + base64 后体积能降到 ~2.6MB（6.1×），
 * 而排序结果完全不变。
 *
 * 为什么是 16 位而不是 8 位：int8 实测 max self-cosine 偏差 1.7e-4，会让 29/495 篇
 * 的 top-3 出现并列分互换（虽然语义上等价）；int16 偏差 2.6e-9，top-3 与全精度
 * 逐位一致，代价只是文件 1.4MB→2.6MB。校验见 scripts/verify-embedding-quantization.ts。
 *
 * 量化方式：每条向量按自身 max|x| 缩放到 16 位有符号全域，scale 一并存进 JSON。
 *
 * 存储格式（向后兼容旧的 vec: number[] 和早期 int8 的 bits=8）：
 *   items: { "<collection>/<translationKey>": { hash, q, scale, dim, bits } }
 *   旧格式: { hash, vec: [ ... ] }
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export interface StoredVector {
  hash: string;
  /** 定点量化后的 base64（默认 16 位小端有符号） */
  q?: string;
  /** 反量化系数：真实值 = 定点值 * scale */
  scale?: number;
  /** 每个分量的位数，8 或 16（缺省按 16 处理） */
  bits?: 8 | 16;
  /** 原始维度，解码时用来校验 */
  dim?: number;
  /** 旧格式：原始 float 数组 */
  vec?: number[];
}

export interface StoredCache {
  model?: string;
  dim?: number;
  items?: Record<string, StoredVector>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < n ? bytes[i + 1] : 0;
    const b2 = i + 2 < n ? bytes[i + 2] : 0;
    out +=
      ALPHABET[b0 >> 2] +
      ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)] +
      (i + 1 < n ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=") +
      (i + 2 < n ? ALPHABET[b2 & 0x3f] : "=");
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const n = text.length;
  const out = new Uint8Array(Math.ceil((n * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const code = text.charCodeAt(i);
    const v = code < 128 ? LOOKUP[code] : -1;
    if (v < 0) continue; // '=' 或非法字符
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** float 向量 → int16 量化 + base64。全零向量用 scale=1，解码仍是全零。 */
export function encodeVector(vec: ArrayLike<number>): { q: string; scale: number; dim: number; bits: 16 } {
  const n = vec.length;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(vec[i]);
    if (a > max) max = a;
  }
  const scale = max > 0 ? max / 32767 : 1;
  const bytes = new Uint8Array(n * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) {
    let v = Math.round(vec[i] / scale);
    if (v > 32767) v = 32767;
    else if (v < -32768) v = -32768;
    view.setInt16(i * 2, v, true);
  }
  return { q: bytesToBase64(bytes), scale, dim: n, bits: 16 };
}

/** 解码成 Float32Array；兼容旧的 vec: number[]。数据缺失时返回空数组。 */
export function decodeVector(item: StoredVector | undefined): Float32Array {
  if (!item) return new Float32Array(0);
  if (typeof item.q === "string" && typeof item.scale === "number") {
    const bytes = base64ToBytes(item.q);
    const scale = item.scale;
    if ((item.bits ?? 16) === 8) {
      const out = new Float32Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        // int8 还原（Uint8 里的 0..255 映射回 -128..127）
        const v = bytes[i] < 128 ? bytes[i] : bytes[i] - 256;
        out[i] = v * scale;
      }
      return out;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = Math.floor(bytes.byteLength / 2);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) * scale;
    return out;
  }
  if (Array.isArray(item.vec)) return Float32Array.from(item.vec);
  return new Float32Array(0);
}

/** 把一条记录转成紧凑的 q8 形式（已有 q 的原样返回）。 */
export function toStoredVector(item: StoredVector): StoredVector {
  if (typeof item.q === "string" && typeof item.scale === "number") return item;
  if (!Array.isArray(item.vec) || item.vec.length === 0) return item;
  const { q, scale, dim, bits } = encodeVector(item.vec);
  return { hash: item.hash, q, scale, dim, bits };
}

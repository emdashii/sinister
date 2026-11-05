/**
 * Write the shipped vector file from the cached full-precision embeddings:
 * Matryoshka-truncated to SHIPPED_DIMS, then binary-quantized (1 bit per value).
 *
 * Format (little-endian): [u32 total synsets][u32 dims][bitmap: 1 bit per synset, set if it has a
 * vector][one row of dims/8 bytes per set bit, in synset order].
 * Includes the "X genus" synsets that Latin names point at, so they can be scored too.
 *
 * Usage: bun scripts/embed-synsets.ts hyper && bun scripts/build-vectors.ts
 */
import { join } from "node:path";
import { FULL_DIMS, SHIPPED_DIMS, binarize, synsetText, truncate } from "../src/engine/semantic";
import { embedder, loadGlosses, loadTaxonomy, vectorsPath } from "./embed-synsets";

const ROOT = join(import.meta.dir, "..");
const tax = await loadTaxonomy();
const meta = (await Bun.file(vectorsPath("hyper").replace(/\.f32$/, ".json")).json()) as { synsets: number[] };
const vecs = new Float32Array(await Bun.file(vectorsPath("hyper")).arrayBuffer());

const rows = new Map<number, Float32Array>();
meta.synsets.forEach((s, r) => rows.set(s, vecs.subarray(r * FULL_DIMS, (r + 1) * FULL_DIMS)));

// Latin names point at WordNet "X genus" synsets that no single word uses; embed those here.
const latin = (await Bun.file(join(ROOT, "data/build/latin.json")).json()) as { categories: string[] };
const missing = latin.categories.map((id) => tax.indexOf(id)!).filter((s) => !rows.has(s));
if (missing.length) {
  const glosses = await loadGlosses(tax.ids.length);
  const extract = await embedder();
  const out = await extract(missing.map((s) => synsetText(tax, glosses[s]!, s)), { pooling: "mean", normalize: true });
  missing.forEach((s, k) => rows.set(s, (out.data as Float32Array).slice(k * FULL_DIMS, (k + 1) * FULL_DIMS)));
}

const synsets = [...rows.keys()].sort((a, b) => a - b);
const bytes = SHIPPED_DIMS / 8;
const total = tax.ids.length;
const mapBytes = Math.ceil(total / 8);
const buf = new ArrayBuffer(8 + mapBytes + synsets.length * bytes);
new Uint32Array(buf, 0, 2).set([total, SHIPPED_DIMS]);
const bitmap = new Uint8Array(buf, 8, mapBytes);
for (const s of synsets) bitmap[s >> 3]! |= 1 << (s & 7);
const bits = new Uint8Array(buf, 8 + mapBytes);
synsets.forEach((s, r) => bits.set(binarize(truncate(rows.get(s)!, SHIPPED_DIMS), SHIPPED_DIMS), r * bytes));
await Bun.write(join(ROOT, "data/build/vectors.bin"), buf);
console.log(`vectors.bin: ${synsets.length} synsets x ${SHIPPED_DIMS} bits = ${(buf.byteLength / 1024).toFixed(0)} KB`);

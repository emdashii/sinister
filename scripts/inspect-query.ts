/**
 * Print what the description filter returns for a query, scored exactly as the app does
 * (shipped vectors, both query phrasings). Usage:
 *   bun scripts/inspect-query.ts "things in a kitchen" [pool: left|all] [top]
 */
import { join } from "node:path";
import { LAYOUTS, computeMasks, filterByKeys, handMask } from "../src/engine/keys";
import { parseWords, type WordsFile } from "../src/engine/lexicon";
import { FULL_DIMS, QUERY_STYLES, queryText } from "../src/engine/semantic";
import { rowScores } from "../src/chain";
import { embedder, loadTaxonomy } from "./embed-synsets";

const [query = "sounds scary", pool = "left", top = "30"] = process.argv.slice(2);
const ROOT = join(import.meta.dir, "..");
const tax = await loadTaxonomy();
const words = parseWords((await Bun.file(join(ROOT, "data/build/words.json")).json()) as WordsFile);
const buf = await Bun.file(join(ROOT, "data/build/vectors.bin")).arrayBuffer();
const [total, dims] = new Uint32Array(buf, 0, 2) as unknown as [number, number];
const mapBytes = Math.ceil(total / 8);
const bitmap = new Uint8Array(buf, 8, mapBytes);
const rowOf = new Int32Array(total).fill(-1);
let r = 0;
for (let s = 0; s < total; s++) if (bitmap[s >> 3]! & (1 << (s & 7))) rowOf[s] = r++;
const vectors = { dims, rowOf, bits: new Uint8Array(buf, 8 + mapBytes, r * (dims / 8)) };

const ex = await embedder();
const q = (await ex(QUERY_STYLES.map((s) => queryText(query, s)), { pooling: "mean", normalize: true })).data as Float32Array;
const rows = QUERY_STYLES.map((_, i) => rowScores(vectors, q.subarray(i * FULL_DIMS, (i + 1) * FULL_DIMS)));
const masks = computeMasks(words.list.map((w) => w.toLowerCase()));
const ids = pool === "all" ? words.list.map((_, i) => i) : [...filterByKeys(masks, handMask(LAYOUTS.qwerty, "left", true))];
const scored = ids
  .map((id) => {
    let best = -100;
    let bs = -1;
    for (const s of tax.wordSynsets[id]!) for (const row of rows) if (rowOf[s]! >= 0 && row[rowOf[s]!]! > best) [best, bs] = [row[rowOf[s]!]!, s];
    return { w: words.list[id]!, best, bs };
  })
  .sort((a, b) => b.best - a.best);
for (const x of scored.slice(0, Number(top))) console.log(x.best.toFixed(1).padStart(5), x.w.padEnd(16), tax.labels[x.bs]);
const n = (t: number) => scored.filter((x) => x.best >= t).length;
console.log(`count >= 40: ${n(40)}, >= 45: ${n(45)}, >= 50: ${n(50)}, >= 55: ${n(55)}`);

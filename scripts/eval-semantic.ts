/**
 * Score the free-text filter against WordNet ground truth.
 *
 * For each category name, embed the name as a query, rank words by their best synset
 * similarity, and count how many of the top 30 are WordNet descendants of that
 * category's synset (precision@30). Runs every storage variant from the spike:
 * Matryoshka dims x {float, binary} x {query prompt on/off} x {text with/without hypernyms}.
 *
 * Usage: bun scripts/eval-semantic.ts [--quick]
 * Needs: data/raw/vectors-hyper.f32 (and -gloss) from scripts/embed-synsets.ts.
 */
import { existsSync } from "node:fs";
import { LAYOUTS, computeMasks, filterByKeys, handMask } from "../src/engine/keys";
import { parseWords, type Taxonomy, type WordsFile } from "../src/engine/lexicon";
import { FULL_DIMS, binarize, dot, queryText, scoreBinary, truncate, type QueryStyle } from "../src/engine/semantic";
import { embedder, loadTaxonomy, vectorsPath } from "./embed-synsets";

export const CATEGORIES = ["reptile", "bird", "tree", "tool", "fabric", "fish", "insect", "vegetable", "weapon", "musical instrument"];

/** The noun synset labelled `name` with the most descendants (the everyday sense). */
export function categorySynset(tax: Taxonomy, name: string): number {
  let best = -1;
  let size = -1;
  tax.labels.forEach((l, i) => {
    if (l !== name || tax.pos(i) !== "n") return;
    const n = tax.descendants(i).size;
    if (n > size) [best, size] = [i, n];
  });
  if (best < 0) throw new Error(`no synset for ${name}`);
  return best;
}

export interface Variant {
  text: "hyper" | "gloss";
  dims: number;
  binary: boolean;
  /** "both" scores each synset by the better of the plain and "a kind of" phrasings. */
  prompt: QueryStyle | "both";
}

function maxOf(a: Float32Array, b: Float32Array): Float32Array {
  return a.map((x, i) => Math.max(x, b[i]!));
}

interface Loaded {
  synsets: number[];
  vecs: Float32Array;
}

const tax = await loadTaxonomy();
const words = parseWords((await Bun.file(new URL("../data/build/words.json", import.meta.url)).json()) as WordsFile);
const masks = computeMasks(words.list.map((w) => w.toLowerCase()));
const pools: Record<string, number[]> = {
  "all words": words.list.map((_, i) => i),
  "QWERTY left": [...filterByKeys(masks, handMask(LAYOUTS.qwerty, "left", true))],
};

const loaded: Record<string, Loaded> = {};
for (const text of ["hyper", "gloss"]) {
  const p = vectorsPath(text);
  if (!existsSync(p)) continue;
  const meta = (await Bun.file(p.replace(/\.f32$/, ".json")).json()) as { synsets: number[] };
  loaded[text] = { synsets: meta.synsets, vecs: new Float32Array(await Bun.file(p).arrayBuffer()) };
}

const extract = await embedder();
async function embed(q: string): Promise<Float32Array> {
  const r = await extract([q], { pooling: "mean", normalize: true });
  return r.data as Float32Array;
}

/** Per-synset scores for one query under one variant, indexed by synset. */
function synsetScores(v: Variant, query: Float32Array): Float32Array {
  const { synsets, vecs } = loaded[v.text]!;
  const out = new Float32Array(tax.ids.length).fill(-2);
  const q = truncate(query, v.dims);
  if (v.binary) {
    const packed = new Uint8Array(synsets.length * (v.dims / 8));
    for (let r = 0; r < synsets.length; r++) packed.set(binarize(vecs.subarray(r * FULL_DIMS, r * FULL_DIMS + v.dims), v.dims), r * (v.dims / 8));
    const rows = Uint32Array.from(synsets, (_, r) => r);
    const s = scoreBinary(q, packed, v.dims, rows);
    synsets.forEach((syn, r) => (out[syn] = s[r]!));
  } else {
    for (let r = 0; r < synsets.length; r++) {
      const d = truncate(vecs.subarray(r * FULL_DIMS, (r + 1) * FULL_DIMS), v.dims);
      out[synsets[r]!] = dot(q, d);
    }
  }
  return out;
}

function wordScore(w: number, s: Float32Array): number {
  let best = -2;
  for (const syn of tax.wordSynsets[w]!) if (s[syn]! > best) best = s[syn]!;
  return best;
}

export interface Result {
  variant: Variant;
  pool: string;
  perCategory: Record<string, { p30: number; attainable: number; bestF1: number; bestT: number }>;
  mean: number;
}

const quick = process.argv.includes("--quick");
const variants: Variant[] = [];
for (const text of Object.keys(loaded) as Variant["text"][])
  for (const prompt of (quick ? ["kind", "both"] : ["plain", "retrieval", "kind", "both"]) as Variant["prompt"][])
    for (const dims of quick ? [384, 256] : [384, 256, 128, 64])
      for (const binary of [false, true]) variants.push({ text, dims, binary, prompt });

const queries: Record<string, Float32Array> = {};
for (const c of CATEGORIES) for (const prompt of ["plain", "retrieval", "kind"] as QueryStyle[]) queries[`${prompt}|${c}`] = await embed(queryText(c, prompt));

const results: Result[] = [];
for (const v of variants) {
  for (const [pool, members] of Object.entries(pools)) {
    const perCategory: Result["perCategory"] = {};
    for (const c of CATEGORIES) {
      const truth = tax.descendants(categorySynset(tax, c));
      const relevant = new Set(tax.wordsIn(members, truth));
      const s = v.prompt === "both" ? maxOf(synsetScores({ ...v, prompt: "plain" }, queries[`plain|${c}`]!), synsetScores({ ...v, prompt: "kind" }, queries[`kind|${c}`]!)) : synsetScores(v, queries[`${v.prompt}|${c}`]!);
      const scored = members.map((w) => [w, wordScore(w, s)] as const).sort((a, b) => b[1] - a[1]);
      const top = scored.slice(0, 30);
      const hits = top.filter(([w]) => relevant.has(w)).length;
      // Best F1 over thresholds, to calibrate the slider's default.
      let tp = 0;
      let bestF1 = 0;
      let bestT = 0;
      scored.forEach(([w, sc], k) => {
        if (relevant.has(w)) tp++;
        const f1 = (2 * tp) / (k + 1 + relevant.size);
        if (f1 > bestF1) [bestF1, bestT] = [f1, sc];
      });
      perCategory[c] = { p30: hits / 30, attainable: Math.min(30, relevant.size) / 30, bestF1, bestT };
    }
    const mean = CATEGORIES.reduce((a, c) => a + perCategory[c]!.p30, 0) / CATEGORIES.length;
    results.push({ variant: v, pool, perCategory, mean });
    console.log(`${v.text.padEnd(5)} ${String(v.dims).padStart(3)}d ${v.binary ? "binary" : "float "} query=${v.prompt.padEnd(9)} | ${pool.padEnd(11)} | mean P@30 ${mean.toFixed(3)}`);
  }
}
await Bun.write(new URL("../docs/adr/eval-results.json", import.meta.url), JSON.stringify(results, null, 1));

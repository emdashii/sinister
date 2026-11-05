/**
 * Embed every synset that some word points at, at full precision, for the spike, the
 * evaluation and the shipped vectors. Slow (minutes), so the result is cached in
 * data/raw/ (gitignored) and reused.
 *
 * Usage: bun scripts/embed-synsets.ts [hyper|gloss]
 *   hyper  gloss + nearest hypernyms (default; what the app ships)
 *   gloss  gloss only (to measure what the hypernym text adds)
 */
import { env, pipeline } from "@huggingface/transformers";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { Taxonomy, GLOSS_SHARD, type SensesFile } from "../src/engine/lexicon";
import { FULL_DIMS, MODEL_DTYPE, MODEL_ID, synsetText } from "../src/engine/semantic";

const ROOT = join(import.meta.dir, "..");
env.cacheDir = join(ROOT, "data/raw/models");

export async function loadTaxonomy(): Promise<Taxonomy> {
  return new Taxonomy((await Bun.file(join(ROOT, "data/build/senses.json")).json()) as SensesFile);
}

export async function loadGlosses(n: number): Promise<string[]> {
  const out: string[] = [];
  for (let s = 0; s * GLOSS_SHARD < n; s++) out.push(...((await Bun.file(join(ROOT, `data/build/glosses/${String(s).padStart(2, "0")}.json`)).json()) as string[]));
  return out;
}

/** Synsets that at least one word points at, ascending. */
export function wordSynsetList(tax: Taxonomy): number[] {
  const set = new Set<number>();
  for (const ss of tax.wordSynsets) for (const s of ss) set.add(s);
  return [...set].sort((a, b) => a - b);
}

export function vectorsPath(variant: string) {
  return join(ROOT, `data/raw/vectors-${variant}.f32`);
}

export async function embedder() {
  return pipeline("feature-extraction", MODEL_ID, { dtype: MODEL_DTYPE });
}

if (import.meta.main) {
  const variant = process.argv[2] ?? "hyper";
  const out = vectorsPath(variant);
  if (existsSync(out)) {
    console.log(`${out} exists; delete it to re-embed`);
    process.exit(0);
  }
  const tax = await loadTaxonomy();
  const glosses = await loadGlosses(tax.ids.length);
  const list = wordSynsetList(tax);
  const texts = list.map((s) => synsetText(tax, glosses[s]!, s, variant === "hyper"));
  console.log(`${list.length} synsets; sample: ${texts[5000]}`);
  const extract = await embedder();
  const vecs = new Float32Array(list.length * FULL_DIMS);
  const BATCH = 64;
  const t0 = performance.now();
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await extract(texts.slice(i, i + BATCH), { pooling: "mean", normalize: true });
    vecs.set(res.data as Float32Array, i * FULL_DIMS);
    if ((i / BATCH) % 100 === 0) {
      const done = i + BATCH;
      const rate = done / ((performance.now() - t0) / 1000);
      console.log(`${done}/${texts.length} (${rate.toFixed(0)} texts/s)`);
    }
  }
  await Bun.write(out, vecs);
  await Bun.write(out.replace(/\.f32$/, ".json"), JSON.stringify({ synsets: list, seconds: (performance.now() - t0) / 1000 }));
  console.log(`wrote ${out} in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}

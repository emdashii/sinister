/**
 * Data loading. Only the word list loads up front; everything else loads the first
 * time a feature needs it, and each file is fetched once.
 */
import wordsUrl from "../data/build/words.json?url";
import sensesUrl from "../data/build/senses.json?url";
import latinUrl from "../data/build/latin.json?url";
import vectorsUrl from "../data/build/vectors.bin?url";
import { computeMasks } from "./engine/keys";
import { GLOSS_SHARD, Taxonomy, parseWords, type SensesFile, type WordsFile } from "./engine/lexicon";

const glossUrls = import.meta.glob("../data/build/glosses/*.json", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const glossShardUrls = Object.keys(glossUrls)
  .sort()
  .map((k) => glossUrls[k]!);

function once<T>(f: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= f().catch((e) => {
    p = null;
    throw e;
  }));
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface WordList {
  list: string[];
  lower: string[];
  masks: Int32Array;
  ranked: number;
}

export const loadWords = once(async (): Promise<WordList> => {
  const w = parseWords(await json<WordsFile>(wordsUrl));
  const lower = w.list.map((x) => x.toLowerCase());
  return { list: w.list, lower, masks: computeMasks(lower), ranked: w.ranked };
});

export const loadTaxonomy = once(async () => new Taxonomy(await json<SensesFile>(sensesUrl)));

const shardCache = new Map<number, Promise<string[]>>();
export async function gloss(synset: number): Promise<string> {
  const shard = Math.floor(synset / GLOSS_SHARD);
  let p = shardCache.get(shard);
  if (!p) {
    p = json<string[]>(glossShardUrls[shard]!);
    shardCache.set(shard, p);
    p.catch(() => shardCache.delete(shard));
  }
  return (await p)[synset % GLOSS_SHARD] ?? "";
}

export interface LatinFile {
  source: string;
  names: string;
  species: number[];
  lineage: number[];
  lineages: string[];
  lineageCat: number[];
  categories: string[];
}

export interface Latin {
  names: string[];
  masks: Int32Array;
  species: number[];
  lineage: number[];
  lineages: string[];
  /** WordNet synset id of each name's "X genus" category. */
  categoryOf(i: number): string;
}

export const loadLatin = once(async (): Promise<Latin> => {
  const f = await json<LatinFile>(latinUrl);
  const names = f.names.split("\n");
  return {
    names,
    masks: computeMasks(names.map((n) => n.toLowerCase())),
    species: f.species,
    lineage: f.lineage,
    lineages: f.lineages,
    categoryOf: (i) => f.categories[f.lineageCat[f.lineage[i]!]!]!,
  };
});

export interface Vectors {
  dims: number;
  /** Synset index -> row, or -1 when the synset has no vector. */
  rowOf: Int32Array;
  bits: Uint8Array;
}

/** See scripts/build-vectors.ts for the format. */
export const loadVectors = once(async (): Promise<Vectors> => {
  const res = await fetch(vectorsUrl);
  if (!res.ok) throw new Error(`vectors: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const [total, dims] = new Uint32Array(buf, 0, 2) as unknown as [number, number];
  const mapBytes = Math.ceil(total / 8);
  const bitmap = new Uint8Array(buf, 8, mapBytes);
  const rowOf = new Int32Array(total).fill(-1);
  let r = 0;
  for (let s = 0; s < total; s++) if (bitmap[s >> 3]! & (1 << (s & 7))) rowOf[s] = r++;
  return { dims, rowOf, bits: new Uint8Array(buf, 8 + mapBytes, r * (dims / 8)) };
});

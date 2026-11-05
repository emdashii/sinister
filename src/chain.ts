/**
 * The filter chain: the key set gives the base candidates, then each filter narrows the
 * previous step's words. Word ids index WordNet words first, then Latin names.
 */
import { filterByKeys } from "./engine/keys";
import type { Taxonomy } from "./engine/lexicon";
import { scoreBinary, truncate } from "./engine/semantic";
import type { Latin, Vectors, WordList } from "./data";
import type { Filter } from "./state";

export interface Universe {
  words: WordList;
  latin: Latin | null;
  tax: Taxonomy | null;
  vectors: Vectors | null;
}

export function universeSize(u: Universe): number {
  return u.words.list.length + (u.latin?.names.length ?? 0);
}

export function display(u: Universe, id: number): string {
  const n = u.words.list.length;
  return id < n ? u.words.list[id]! : u.latin!.names[id - n]!;
}

export function isLatin(u: Universe, id: number): boolean {
  return id >= u.words.list.length;
}

/** Synsets a word id belongs to (a Latin name belongs to its "X genus" synset). */
export function synsetsOf(u: Universe, tax: Taxonomy, id: number): readonly number[] {
  const n = u.words.list.length;
  if (id < n) return tax.wordSynsets[id] ?? [];
  const s = tax.indexOf(u.latin!.categoryOf(id - n));
  return s === undefined ? [] : [s];
}

export function baseCandidates(u: Universe, allowed: number): Uint32Array {
  const words = filterByKeys(u.words.masks, allowed);
  if (!u.latin) return words;
  const latin = filterByKeys(u.latin.masks, allowed);
  const out = new Uint32Array(words.length + latin.length);
  out.set(words);
  const n = u.words.list.length;
  for (let i = 0; i < latin.length; i++) out[words.length + i] = latin[i]! + n;
  return out;
}

export function applyCategory(u: Universe, tax: Taxonomy, ids: Uint32Array, synsetId: string): Uint32Array {
  const s = tax.indexOf(synsetId);
  if (s === undefined) return new Uint32Array(0);
  const set = tax.descendants(s);
  return ids.filter((id) => synsetsOf(u, tax, id).some((x) => set.has(x)));
}

/** Similarity (0-100) of every vector row to a query embedding. */
export function rowScores(vectors: Vectors, query: Float32Array): Float32Array {
  const q = truncate(query, vectors.dims);
  const rows = vectors.bits.length / (vectors.dims / 8);
  const all = new Uint32Array(rows);
  for (let i = 0; i < rows; i++) all[i] = i;
  const s = scoreBinary(q, vectors.bits, vectors.dims, all);
  for (let i = 0; i < s.length; i++) s[i]! *= 100;
  return s;
}

/** A word's similarity: its best-matching sense. */
export function wordScore(u: Universe, tax: Taxonomy, vectors: Vectors, rows: Float32Array, id: number): number {
  let best = -100;
  for (const s of synsetsOf(u, tax, id)) {
    const r = vectors.rowOf[s] ?? -1;
    if (r >= 0 && rows[r]! > best) best = rows[r]!;
  }
  return best;
}

export function applyText(
  u: Universe,
  tax: Taxonomy,
  vectors: Vectors,
  rows: Float32Array,
  ids: Uint32Array,
  threshold: number,
): { ids: Uint32Array; scores: Float32Array; closest: { id: number; score: number } | null } {
  const kept: number[] = [];
  const scores: number[] = [];
  let closest: { id: number; score: number } | null = null;
  for (const id of ids) {
    const sc = wordScore(u, tax, vectors, rows, id);
    if (!closest || sc > closest.score) closest = { id, score: sc };
    if (sc >= threshold) {
      kept.push(id);
      scores.push(sc);
    }
  }
  // Rank by similarity, most similar first; ties keep frequency order.
  const order = kept.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]! || a - b);
  return { ids: Uint32Array.from(order, (i) => kept[i]!), scores: Float32Array.from(order, (i) => scores[i]!), closest };
}

/**
 * For each synset, how many of `ids` have a sense at or below it. Used to show counts
 * while browsing the category tree.
 */
export function subtreeCounts(u: Universe, tax: Taxonomy, ids: Uint32Array): Int32Array {
  const counts = new Int32Array(tax.ids.length);
  const stamp = new Int32Array(tax.ids.length).fill(-1);
  const stack: number[] = [];
  for (let k = 0; k < ids.length; k++) {
    for (const s of synsetsOf(u, tax, ids[k]!)) stack.push(s);
    while (stack.length) {
      const s = stack.pop()!;
      if (stamp[s] === k) continue;
      stamp[s] = k;
      counts[s]!++;
      for (const p of tax.parents[s]!) stack.push(p);
    }
  }
  return counts;
}

export type { Filter };

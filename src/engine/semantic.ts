/**
 * The free-text ("AI") filter's text and vector maths. Shared by the offline vector
 * build, the evaluation, and the browser worker, so all three embed the same text.
 */
import type { Taxonomy } from "./lexicon";

export const MODEL_ID = "mixedbread-ai/mxbai-embed-xsmall-v1";
export const MODEL_DTYPE = "q8";
export const FULL_DIMS = 384;

/** Text embedded for a synset: its words, gloss, and nearest hypernyms. */
export function synsetText(tax: Taxonomy, gloss: string, synset: number, withHypernyms = true): string {
  const words = tax.labels[synset]!;
  let text = `${words}: ${gloss}`;
  if (withHypernyms) {
    const chain = tax.ancestry(synset).slice(0, 3).map((s) => tax.labels[s]);
    if (chain.length) text += ` (a kind of ${chain.join(", ")})`;
  }
  return text;
}

/** How a query is phrased before embedding. "kind" mirrors the "(a kind of ...)" in synset texts. */
export type QueryStyle = "plain" | "retrieval" | "kind";

/**
 * Phrasings the app embeds for each query; a synset scores its best match. See
 * docs/adr/0001-semantic-filter.md for the measurements behind this choice.
 */
export const QUERY_STYLES: readonly QueryStyle[] = ["plain", "kind"];

/** Dimensions and storage the app ships (Matryoshka truncation, then 1 bit per value). */
export const SHIPPED_DIMS = 384;

export function queryText(query: string, style: QueryStyle): string {
  if (style === "retrieval") return `Represent this sentence for searching relevant passages: ${query}`;
  if (style === "kind") return `a kind of ${query}`;
  return query;
}

/** Matryoshka truncation: keep the first `dims` values and re-normalise. */
export function truncate(v: Float32Array, dims: number): Float32Array {
  const out = v.slice(0, dims);
  let n = 0;
  for (const x of out) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i]! /= n;
  return out;
}

/** Pack the signs of a vector into bits (1 = positive), `dims / 8` bytes. */
export function binarize(v: Float32Array, dims: number): Uint8Array {
  const out = new Uint8Array(dims / 8);
  for (let i = 0; i < dims; i++) if (v[i]! > 0) out[i >> 3]! |= 1 << (i & 7);
  return out;
}

/**
 * Asymmetric score of a float query against packed binary documents: the dot product
 * of the query with each document's sign vector, divided by the best possible value.
 * Returns one score per document in [-1, 1].
 */
export function scoreBinary(query: Float32Array, docs: Uint8Array, dims: number, rows: ArrayLike<number>): Float32Array {
  const bytes = dims / 8;
  let total = 0;
  for (let i = 0; i < dims; i++) total += Math.abs(query[i]!);
  // Per byte, precompute the query's contribution for all 256 bit patterns.
  const table = new Float32Array(bytes * 256);
  for (let b = 0; b < bytes; b++) {
    for (let pat = 0; pat < 256; pat++) {
      let s = 0;
      for (let k = 0; k < 8; k++) s += pat & (1 << k) ? query[b * 8 + k]! : -query[b * 8 + k]!;
      table[b * 256 + pat] = s;
    }
  }
  const out = new Float32Array(rows.length);
  for (let r = 0; r < rows.length; r++) {
    const off = rows[r]! * bytes;
    let s = 0;
    for (let b = 0; b < bytes; b++) s += table[b * 256 + docs[off + b]!]!;
    out[r] = s / (total || 1);
  }
  return out;
}

export function dot(a: Float32Array, b: Float32Array, bOffset = 0, dims = a.length): number {
  let s = 0;
  for (let i = 0; i < dims; i++) s += a[i]! * b[bOffset + i]!;
  return s;
}

/** Rank items by score, highest first, returning indices into `scores`. */
export function rankBy(scores: ArrayLike<number>): number[] {
  return Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
}

/**
 * Build the word lexicon from Open English WordNet 2025 Plus and wordfreq.
 *
 * Inputs (download first; see README "Rebuild the data"):
 *   data/raw/oewnplus/*.json        OEWN 2025 Plus, JSON edition
 *   data/raw/large_en.msgpack.gz    wordfreq's large English list
 *
 * Outputs (committed):
 *   data/build/words.json           every single-token word, most frequent first
 *   data/build/senses.json          word -> synsets, synset ids, labels, hypernym parents
 *   data/build/glosses/NN.json      synset definitions, in shards of GLOSS_SHARD
 */
import { decode } from "@msgpack/msgpack";
import { gunzipSync } from "node:zlib";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { inflectionSlots } from "./inflect";
import { GLOSS_SHARD } from "../src/engine/lexicon";

const ROOT = join(import.meta.dir, "..");
const RAW = join(ROOT, "data/raw");
const OUT = join(ROOT, "data/build");

interface RawSynset {
  definition: string[];
  members: string[];
  partOfSpeech: string;
  hypernym?: string[];
  instance_hypernym?: string[];
}
interface RawEntry {
  form?: string[];
  sense: { synset: string }[];
}

// ---- wordfreq ---------------------------------------------------------------
const cb = decode(gunzipSync(await Bun.file(join(RAW, "large_en.msgpack.gz")).arrayBuffer())) as unknown[];
/** wordfreq bin index -> frequency 10^(-bin/100); smaller bin = more frequent. */
const freqBin = new Map<string, number>();
const freqOrder = new Map<string, number>();
(cb.slice(1) as string[][]).forEach((bin, i) => {
  for (const w of bin) {
    if (!freqBin.has(w)) {
      freqBin.set(w, i);
      freqOrder.set(w, freqOrder.size);
    }
  }
});
const zipf = (w: string) => (freqBin.has(w) ? 9 - freqBin.get(w)! / 100 : 0);

// ---- OEWN -------------------------------------------------------------------
const oewnDir = join(RAW, "oewnplus");
const synsets = new Map<string, RawSynset>();
const entries = new Map<string, Record<string, RawEntry>>();
for (const f of readdirSync(oewnDir)) {
  if (!f.endsWith(".json") || f === "frames.json") continue;
  const data = (await Bun.file(join(oewnDir, f)).json()) as Record<string, unknown>;
  if (f.startsWith("entries-")) for (const [k, v] of Object.entries(data)) entries.set(k, v as Record<string, RawEntry>);
  else for (const [k, v] of Object.entries(data)) synsets.set(k, v as RawSynset);
}

const synsetIds = [...synsets.keys()].sort();
const synsetIndex = new Map(synsetIds.map((id, i) => [id, i]));

/** Display form -> synset indices. Keys are lowercase a-z; display keeps capitals for names. */
const wordSynsets = new Map<string, Set<number>>();
const display = new Map<string, string>();
const base = new Map<string, string>();
const isLemma = new Set<string>();

function addWord(word: string, shown: string, synsetIdx: Iterable<number>, lemma?: string) {
  if (lemma && !/[aeiouy]/.test(word) && !VOWELLESS_WORDS.has(word)) return; // "hms"
  let set = wordSynsets.get(word);
  if (!set) wordSynsets.set(word, (set = new Set()));
  for (const s of synsetIdx) set.add(s);
  // A word spelled in lowercase anywhere is shown in lowercase.
  const prev = display.get(word);
  if (!prev || shown === word) display.set(word, shown);
  if (lemma && lemma !== word && !isLemma.has(word) && !base.has(word)) base.set(word, lemma);
}

const LETTERS = /^[a-z]+$/;
const ROMAN = /^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
/** Real words with no a/e/i/o/u/y; every other vowelless lemma is an abbreviation (ft, lcms, Mrs). */
const VOWELLESS_WORDS = new Set(["hmm", "hm", "shh", "sh", "brr", "nth", "psst", "pst", "tsk", "pfft", "cwm", "crwth", "grr", "zzz"]);

/** Abbreviations, symbols and numerals that WordNet lists as lemmas but nobody types as words. */
function notAWord(lemma: string, lower: string, synsetIds: string[]): boolean {
  if (lemma === lemma.toUpperCase()) return true; // acronyms: SACEUR, TV
  if (/^[A-Z]{2}/.test(lemma)) return true; // SMSgt, NWbN
  if (lemma.length <= 2 && lemma !== lower) return true; // element symbols: Eu, Th
  if (!/[aeiouy]/.test(lower) && !VOWELLESS_WORDS.has(lower)) return true;
  // Roman numerals ("ii", "xiv"), but not words that happen to parse as one ("mix").
  if (ROMAN.test(lower) && synsetIds.every((id) => synsets.get(id)?.members.some((m) => /^\d+$/.test(m)))) return true;
  return false;
}

let skipped = 0;
let inflections = 0;
for (const [lemma, byPos] of entries) {
  const lower = lemma.toLowerCase();
  const ids = Object.values(byPos).flatMap((e) => e.sense.map((s) => s.synset));
  // Single tokens of letters only.
  if (!LETTERS.test(lower) || lower.length < 2 || notAWord(lemma, lower, ids)) {
    skipped++;
    continue;
  }
  isLemma.add(lower);
  base.delete(lower);
  for (const [pos, entry] of Object.entries(byPos)) {
    const idx = entry.sense.map((s) => synsetIndex.get(s.synset)!).filter((i) => i !== undefined);
    addWord(lower, lemma, idx);
    // Proper nouns ("Texas") are not inflected.
    const proper = lemma[0] !== lower[0];
    for (const form of entry.form ?? []) {
      const f = form.toLowerCase();
      if (LETTERS.test(f) && f !== lower) {
        addWord(f, f, idx, lower);
        inflections++;
      }
    }
    if (proper) continue;
    for (const slot of inflectionSlots(lower, pos)) {
      const seen = slot.filter((v) => freqBin.has(v) && v !== lower);
      if (seen.length === 0) continue;
      // Keep spelling variants within 10x of the slot's most frequent one, which drops
      // rare misspellings such as "openned" while keeping "benefited"/"benefitted".
      const best = Math.max(...seen.map(zipf));
      for (const v of seen) {
        if (zipf(v) >= best - 1) {
          addWord(v, v, idx, lower);
          inflections++;
        }
      }
    }
  }
}

// ---- order: wordfreq rank first, then unranked by length and spelling --------
const all = [...wordSynsets.keys()];
const ranked = all.filter((w) => freqOrder.has(w)).sort((a, b) => freqOrder.get(a)! - freqOrder.get(b)!);
const unranked = all.filter((w) => !freqOrder.has(w)).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
const order = [...ranked, ...unranked];
const wordIndex = new Map(order.map((w, i) => [w, i]));

// ---- write ------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
const sources = {
  oewn: "Open English WordNet 2025 Plus (CC BY 4.0)",
  wordfreq: "wordfreq large_en, v3.x data (CC BY-SA 4.0)",
};

await Bun.write(
  join(OUT, "words.json"),
  JSON.stringify({ sources, ranked: ranked.length, words: order.map((w) => display.get(w)).join("\n") }),
);

const parents = synsetIds.map((id) => {
  const s = synsets.get(id)!;
  return [...(s.hypernym ?? []), ...(s.instance_hypernym ?? [])].map((p) => synsetIndex.get(p)!).filter((p) => p !== undefined);
});
await Bun.write(
  join(OUT, "senses.json"),
  JSON.stringify({
    ids: synsetIds.join("\n"),
    labels: synsetIds.map((id) => synsets.get(id)!.members[0] ?? id).join("\n"),
    parents,
    wordSynsets: order.map((w) => [...wordSynsets.get(w)!].sort((a, b) => a - b)),
    wordBase: order.map((w) => (base.has(w) ? (wordIndex.get(base.get(w)!) ?? -1) : -1)),
  }),
);

const glossDir = join(OUT, "glosses");
rmSync(glossDir, { recursive: true, force: true });
mkdirSync(glossDir, { recursive: true });
for (let start = 0, shard = 0; start < synsetIds.length; start += GLOSS_SHARD, shard++) {
  const defs = synsetIds.slice(start, start + GLOSS_SHARD).map((id) => synsets.get(id)!.definition[0] ?? "");
  await Bun.write(join(glossDir, `${String(shard).padStart(2, "0")}.json`), JSON.stringify(defs));
}

console.log(
  `synsets ${synsetIds.length}, words ${order.length} (ranked ${ranked.length}, inflections added ${inflections}), skipped lemmas ${skipped}`,
);

/**
 * Spike: precomputed binary vectors vs embedding the post-letter-filter candidates on
 * demand (cached in IndexedDB). Measures download size, first-filter latency, and warm
 * latency for one query over the QWERTY-left candidates.
 */
import { LAYOUTS, handMask } from "../src/engine/keys";
import { FULL_DIMS, QUERY_STYLES, dot, queryText, synsetText } from "../src/engine/semantic";
import { baseCandidates, rowScores, synsetsOf, type Universe } from "../src/chain";
import { gloss, loadTaxonomy, loadVectors, loadWords } from "../src/data";
import { embed } from "../src/embedder";

const out = document.getElementById("out")!;
const log = (s: string) => (out.textContent += s + "\n");
const now = () => performance.now();

function transferred(match: string | RegExp): number {
  return performance
    .getEntriesByType("resource")
    .filter((e) => (typeof match === "string" ? e.name.includes(match) : match.test(e.name)))
    .reduce((a, e) => a + ((e as PerformanceResourceTiming).encodedBodySize || 0), 0);
}

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("spike-vectors", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("v");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGetMany(db: IDBDatabase, keys: string[]): Promise<(Float32Array | undefined)[]> {
  const tx = db.transaction("v", "readonly");
  const st = tx.objectStore("v");
  return Promise.all(keys.map((k) => new Promise<Float32Array | undefined>((res) => {
    const r = st.get(k);
    r.onsuccess = () => res(r.result as Float32Array | undefined);
    r.onerror = () => res(undefined);
  })));
}
async function idbPutMany(db: IDBDatabase, entries: [string, Float32Array][]) {
  const tx = db.transaction("v", "readwrite");
  const st = tx.objectStore("v");
  for (const [k, v] of entries) st.put(v, k);
  await new Promise((res) => (tx.oncomplete = res));
}

const params = new URLSearchParams(location.search);
const query = params.get("q") ?? "sounds scary";
const maxOnDemand = Number(params.get("max") ?? 100000);
const result: Record<string, number | string> = { query };

const words = await loadWords();
const tax = await loadTaxonomy();
const u: Universe = { words, latin: null, tax, vectors: null };
const ids = baseCandidates(u, handMask(LAYOUTS.qwerty, "left", true));
const synsets = [...new Set([...ids].flatMap((id) => [...synsetsOf(u, tax, id)]))];
result.candidates = ids.length;
result.candidateSynsets = synsets.length;
log(`${ids.length} candidates, ${synsets.length} synsets`);

// Model warm-up (shared by both strategies).
let t = now();
await embed(["warm up"]);
result.modelLoadMs = Math.round(now() - t);
log(`model ready in ${result.modelLoadMs} ms`);

// A: precomputed binary vectors.
t = now();
const vectors = await loadVectors();
result.A_vectorLoadMs = Math.round(now() - t);
result.A_vectorBytes = transferred("vectors");
t = now();
const q = await embed(QUERY_STYLES.map((s) => queryText(query, s)));
const tq = now() - t;
const rows = QUERY_STYLES.map((_, i) => rowScores(vectors, q.subarray(i * FULL_DIMS, (i + 1) * FULL_DIMS)));
let kept = 0;
for (const id of ids) {
  let best = -100;
  for (const s of synsetsOf(u, tax, id)) for (const r of rows) best = Math.max(best, r[vectors.rowOf[s]!] ?? -100);
  if (best >= 45) kept++;
}
result.A_queryEmbedMs = Math.round(tq);
result.A_filterMs = Math.round(now() - t);
log(`A: vectors ${result.A_vectorLoadMs} ms; filter ${result.A_filterMs} ms (embed ${result.A_queryEmbedMs})`);

// B: embed candidate texts on demand, cache in IndexedDB.
const db = await idb();
const sample = synsets.slice(0, maxOnDemand);
t = now();
const glosses = await Promise.all(sample.map((s) => gloss(s)));
result.B_glossLoadMs = Math.round(now() - t);
result.B_glossBytes = transferred(/glosses\/|\/assets\/\d\d-/);
const texts = sample.map((s, i) => synsetText(tax, glosses[i]!, s));
t = now();
const cached = await idbGetMany(db, texts);
const missing = texts.filter((_, i) => !cached[i]);
const BATCH = 32;
const fresh: [string, Float32Array][] = [];
for (let i = 0; i < missing.length; i += BATCH) {
  const batch = missing.slice(i, i + BATCH);
  const v = await embed(batch);
  batch.forEach((text, k) => fresh.push([text, v.slice(k * FULL_DIMS, (k + 1) * FULL_DIMS)]));
}
await idbPutMany(db, fresh);
const embedMs = now() - t;
const qv = await embed([query]);
let keptB = 0;
const all = new Map(fresh);
texts.forEach((text, i) => {
  const v = cached[i] ?? all.get(text)!;
  if (dot(qv, v) > 0.45) keptB++;
});
result.B_embedded = missing.length;
result.B_firstFilterMs = Math.round(now() - t);
result.B_textsPerSecond = missing.length ? Math.round(missing.length / (embedMs / 1000)) : 0;
result.B_projectedFullMs = Math.round((synsets.length / (result.B_textsPerSecond as number || 1)) * 1000);
log(`B: embedded ${missing.length} texts in ${Math.round(embedMs)} ms (${result.B_textsPerSecond}/s); projected for all ${synsets.length}: ${result.B_projectedFullMs} ms`);

// B warm: everything cached.
t = now();
const again = await idbGetMany(db, texts);
const qv2 = await embed([query + " "]);
let k2 = 0;
again.forEach((v) => v && dot(qv2, v) > 0.45 && k2++);
result.B_warmFilterMs = Math.round(now() - t);
log(JSON.stringify(result, null, 1));
(window as unknown as { spikeResult: unknown }).spikeResult = result;

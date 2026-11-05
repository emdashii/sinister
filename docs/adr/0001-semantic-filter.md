# Ship precomputed binary vectors for the description filter

The description ("AI") filter ranks candidates by how close the query is to each word's
senses. Each sense is embedded as "words: gloss (a kind of hypernym, hypernym, hypernym)".
We ship one precomputed 384-bit binary vector per WordNet sense. The browser embeds only
the query, with `mixedbread-ai/mxbai-embed-xsmall-v1` (q8) in a Web Worker. We do not
embed candidates on demand, because that takes about a minute for the default hand.

## Spike

Measured on 2026-11-05 for the QWERTY left hand (2,393 words, 3,862 senses) and the query
"sounds scary". Browser figures come from Chromium on the build machine, using
`bun run spike` (`e2e/spike.e2e.ts`). The raw numbers are in `spike-results.json`.

| | Precomputed vectors (shipped) | On-demand, cached in IndexedDB |
|---|---|---|
| Download when the filter is first used | Model 24.4 MB + runtime 2.7 MB + tokenizer 0.2 MB, plus vectors 4.2 MB | Model, runtime and tokenizer as for precomputed, plus every gloss shard (2.0 MB brotli) |
| First filter after the model loads | 36 ms (10 ms query embed, 26 ms scoring) | 53 s projected (73 texts/s × 3,862 texts) |
| Later filters | 36 ms | 14 ms once cached |
| Mid-range phone estimate (×4 to ×5) | about 0.2 s | about 4 minutes |

CDP CPU throttling does not reach the worker, so the phone row scales the measured
times. The JavaScript and data loaded before the model are about 0.5 MB (brotli), within
the 1 MB budget. The model loads only when the first description filter runs.

## Precision

`bun run eval` embeds 10 category names: reptile, bird, tree, tool, fabric, fish, insect,
vegetable, weapon and musical instrument. It ranks words by their best sense and scores
precision@30 against the WordNet descendants of each category's synset. "All words" ranks
all 109,519 words. "QWERTY left" ranks only the 2,393 left-hand words. That pool has
fewer than 30 relevant words for most categories, so its best possible mean is 0.443.

| Text | Dims | Storage | Query phrasing | All words | QWERTY left |
|---|---|---|---|---|---|
| gloss + hypernyms | 384 | binary | "a kind of X" | **0.737** | 0.357 |
| gloss + hypernyms | 384 | float | "a kind of X" | 0.687 | 0.380 |
| gloss + hypernyms | 256 | float | "a kind of X" | 0.727 | 0.353 |
| gloss + hypernyms | 384 | binary | best of plain and "a kind of X" (shipped) | 0.710 | 0.357 |
| gloss + hypernyms | 384 | binary | plain | 0.647 | 0.337 |
| gloss + hypernyms | 256 | binary | plain | 0.683 | 0.327 |
| gloss + hypernyms | 128 | binary | plain | 0.527 | 0.257 |
| gloss + hypernyms | 64 | binary | plain | 0.360 | 0.177 |
| gloss + hypernyms | 384 | binary | retrieval prompt | 0.253 | 0.193 |
| gloss only | 384 | binary | plain | 0.503 | 0.317 |

The tuning findings were:

- Hypernym text adds about 0.15 to precision.
- Binary quantization costs nothing measurable here.
- Matryoshka truncation below 256 dimensions costs a lot.
- The model's retrieval prompt hurts short queries.
- "A kind of X" helps category names but reads oddly for descriptions such as "sounds
  scary". The app embeds both phrasings and keeps each sense's better score.

The ground truth is circular in one respect: a sense's text names its hypernyms, which
are what the category tree checks. The category filter remains the exact,
deterministic option.

## Considered options

- **256-bit vectors (2.8 MB)** were within noise of 384 bits on plain queries but worse
  with "a kind of X". At 4.2 MB, the full 384 bits are still smaller than the model.
- **On demand** would have shipped no vectors, but the first filter would take minutes
  on a phone. It is also slow again after every key-set change.

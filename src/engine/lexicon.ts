/**
 * The lexicon's in-memory shape and the WordNet taxonomy queries. Pure: no fetching.
 */

/** Synsets per gloss shard file. */
export const GLOSS_SHARD = 2048;

export interface WordsFile {
  sources: Record<string, string>;
  ranked: number;
  words: string;
}

export interface SensesFile {
  ids: string;
  labels: string;
  parents: number[][];
  wordSynsets: number[][];
  wordBase: number[];
}

export interface Words {
  /** Display forms, most frequent first. */
  list: string[];
  /** How many leading words have a wordfreq rank. */
  ranked: number;
}

export function parseWords(file: WordsFile): Words {
  return { list: file.words.split("\n"), ranked: file.ranked };
}

export class Taxonomy {
  readonly ids: string[];
  readonly labels: string[];
  readonly parents: number[][];
  readonly children: number[][];
  readonly wordSynsets: number[][];
  readonly wordBase: number[];
  private readonly idIndex: Map<string, number>;

  constructor(file: SensesFile) {
    this.ids = file.ids.split("\n");
    this.labels = file.labels.split("\n");
    this.parents = file.parents;
    this.wordSynsets = file.wordSynsets;
    this.wordBase = file.wordBase;
    this.idIndex = new Map(this.ids.map((id, i) => [id, i]));
    this.children = this.ids.map(() => []);
    this.parents.forEach((ps, i) => ps.forEach((p) => this.children[p]!.push(i)));
  }

  indexOf(id: string): number | undefined {
    return this.idIndex.get(id);
  }

  pos(synset: number): string {
    return this.ids[synset]!.slice(-1);
  }

  /** The synset and every synset below it (hyponyms and instances, transitively). */
  descendants(synset: number): Set<number> {
    const out = new Set<number>([synset]);
    const stack = [synset];
    while (stack.length) {
      for (const c of this.children[stack.pop()!]!) {
        if (!out.has(c)) {
          out.add(c);
          stack.push(c);
        }
      }
    }
    return out;
  }

  /** First hypernym path to a root, nearest first (excluding the synset itself). */
  ancestry(synset: number): number[] {
    const out: number[] = [];
    const seen = new Set([synset]);
    let s = synset;
    while (this.parents[s]!.length) {
      s = this.parents[s]![0]!;
      if (seen.has(s)) break;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  /** Roots of the hypernym forest (synsets with children but no parents). */
  roots(): number[] {
    const out: number[] = [];
    this.parents.forEach((ps, i) => {
      if (ps.length === 0 && this.children[i]!.length > 0) out.push(i);
    });
    return out;
  }

  /** Words (indices into `candidates`' values) with a sense in `set`. */
  wordsIn(candidates: ArrayLike<number>, set: Set<number>): number[] {
    const out: number[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const w = candidates[i]!;
      const ss = this.wordSynsets[w];
      if (ss && ss.some((s) => set.has(s))) out.push(w);
    }
    return out;
  }
}

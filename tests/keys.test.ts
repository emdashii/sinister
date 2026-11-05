import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  LAYOUTS,
  LAYOUT_IDS,
  computeMasks,
  filterByKeys,
  handMask,
  lettersOf,
  maskOf,
  mirrorMask,
  type Hand,
} from "../src/engine/keys";
import { parseWords, type WordsFile } from "../src/engine/lexicon";

const words = parseWords((await Bun.file(new URL("../data/build/words.json", import.meta.url)).json()) as WordsFile);
const lower = words.list.map((w) => w.toLowerCase());
const masks = computeMasks(lower);
const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

function typableWords(allowed: number): string[] {
  return [...filterByKeys(masks, allowed)].map((i) => lower[i]!);
}

/** Independent check: compares characters, not bit masks. */
function onlyUses(word: string, letters: string): boolean {
  return [...word].every((ch) => letters.includes(ch));
}

describe("standard hands", () => {
  test("QWERTY left is qwert asdfg zxcvb", () => {
    expect(lettersOf(handMask(LAYOUTS.qwerty, "left", true))).toBe([..."qwertasdfgzxcvb"].sort().join(""));
    expect(lettersOf(handMask(LAYOUTS.qwerty, "left", false))).toBe([..."qwerasdfzxcv"].sort().join(""));
    expect(lettersOf(handMask(LAYOUTS.qwerty, "right", true))).toBe([..."yuiophjklnm"].sort().join(""));
  });

  test("each layout splits all 26 letters between the hands", () => {
    for (const id of LAYOUT_IDS) {
      const l = handMask(LAYOUTS[id], "left", true);
      const r = handMask(LAYOUTS[id], "right", true);
      expect(l & r).toBe(0);
      expect(lettersOf(l | r)).toBe(ALPHABET.join(""));
    }
  });

  test("mirroring a hand lands on the other hand (keys that mirror onto punctuation drop)", () => {
    for (const id of LAYOUT_IDS) {
      for (const middle of [true, false]) {
        const layout = LAYOUTS[id];
        const left = handMask(layout, "left", middle);
        const right = handMask(layout, "right", middle);
        expect(mirrorMask(layout, left) & ~right).toBe(0);
        expect(mirrorMask(layout, right) & ~left).toBe(0);
      }
    }
    expect(mirrorMask(LAYOUTS.qwerty, handMask(LAYOUTS.qwerty, "left", true))).toBe(handMask(LAYOUTS.qwerty, "right", true));
  });
});

describe("known records", () => {
  test("QWERTY left includes stewardesses and aftereffects", () => {
    const left = new Set(typableWords(handMask(LAYOUTS.qwerty, "left", true)));
    expect(left.has("stewardesses")).toBe(true);
    expect(left.has("aftereffects")).toBe(true);
  });

  test("QWERTY right includes lollipop and monopoly", () => {
    const right = new Set(typableWords(handMask(LAYOUTS.qwerty, "right", true)));
    expect(right.has("lollipop")).toBe(true);
    expect(right.has("monopoly")).toBe(true);
  });

  test("common words come first", () => {
    expect(typableWords(handMask(LAYOUTS.qwerty, "left", true)).slice(0, 3)).toEqual(["was", "be", "as"]);
  });
});

describe("property: every output word uses only allowed keys, and none is missed", () => {
  const exact = (allowed: number) => {
    const letters = lettersOf(allowed);
    const out = filterByKeys(masks, allowed);
    const inOut = new Uint8Array(lower.length);
    for (const i of out) {
      inOut[i] = 1;
      if (!onlyUses(lower[i]!, letters)) return false;
    }
    // Exact: every word left out has a letter outside the set.
    for (let i = 0; i < lower.length; i++) if (!inOut[i] && onlyUses(lower[i]!, letters)) return false;
    return true;
  };

  test("all layouts, hands and middle-column settings", () => {
    for (const id of LAYOUT_IDS)
      for (const hand of ["left", "right"] as Hand[])
        for (const middle of [true, false]) expect(exact(handMask(LAYOUTS[id], hand, middle))).toBe(true);
  });

  test("random custom key sets", () => {
    fc.assert(
      fc.property(fc.subarray(ALPHABET), (keys) => exact(maskOf(keys))),
      { numRuns: 60 },
    );
  });

  test("random custom sets mirrored to the other hand", () => {
    fc.assert(
      fc.property(fc.constantFrom(...LAYOUT_IDS), fc.subarray(ALPHABET), (id, keys) =>
        exact(mirrorMask(LAYOUTS[id], maskOf(keys))),
      ),
      { numRuns: 30 },
    );
  });
});

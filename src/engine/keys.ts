/**
 * Keyboard layouts, hands, and the exact one-hand letter filter.
 *
 * Every layout is a 3 x 10 grid of the main typing keys. Columns 0-4 belong to the
 * left hand and 5-9 to the right (the standard touch-typing split). Columns 4 and 5
 * are the index-finger reach ("middle") columns: T G B and Y H N on QWERTY.
 */

export type LayoutId = "qwerty" | "dvorak" | "colemak";
export type Hand = "left" | "right";

export interface Layout {
  id: LayoutId;
  name: string;
  /** Three rows of exactly ten keys, top to bottom. */
  rows: readonly [string, string, string];
}

export const LAYOUTS: Record<LayoutId, Layout> = {
  qwerty: { id: "qwerty", name: "QWERTY", rows: ["qwertyuiop", "asdfghjkl;", "zxcvbnm,./"] },
  dvorak: { id: "dvorak", name: "Dvorak", rows: ["',.pyfgcrl", "aoeuidhtns", ";qjkxbmwvz"] },
  colemak: { id: "colemak", name: "Colemak", rows: ["qwfpgjluy;", "arstdhneio", "zxcvbkm,./"] },
};

export const LAYOUT_IDS = Object.keys(LAYOUTS) as LayoutId[];
export const MIDDLE_COLUMNS = { left: 4, right: 5 } as const;

const A = "a".charCodeAt(0);

export function isLetter(ch: string): boolean {
  return ch.length === 1 && ch >= "a" && ch <= "z";
}

/** 26-bit mask of the letters in `letters` (non-letters are ignored). */
export function maskOf(letters: Iterable<string>): number {
  let m = 0;
  for (const ch of letters) if (isLetter(ch)) m |= 1 << (ch.charCodeAt(0) - A);
  return m;
}

export function lettersOf(mask: number): string {
  let s = "";
  for (let i = 0; i < 26; i++) if (mask & (1 << i)) s += String.fromCharCode(A + i);
  return s;
}

export function columnOf(layout: Layout, letter: string): number {
  for (const row of layout.rows) {
    const c = row.indexOf(letter);
    if (c >= 0) return c;
  }
  return -1;
}

/** The letters a hand covers on a layout. With `middle` off, the reach column is excluded. */
export function handMask(layout: Layout, hand: Hand, middle: boolean): number {
  let m = 0;
  for (const row of layout.rows) {
    for (let c = 0; c < 10; c++) {
      const isHand = hand === "left" ? c < 5 : c >= 5;
      if (!isHand) continue;
      if (!middle && c === MIDDLE_COLUMNS[hand]) continue;
      const ch = row[c]!;
      if (isLetter(ch)) m |= 1 << (ch.charCodeAt(0) - A);
    }
  }
  return m;
}

/** Mirror a key set across the keyboard's centre (column c becomes 9 - c). */
export function mirrorMask(layout: Layout, mask: number): number {
  let m = 0;
  for (const row of layout.rows) {
    for (let c = 0; c < 10; c++) {
      const ch = row[c]!;
      const to = row[9 - c]!;
      if (isLetter(ch) && isLetter(to) && mask & (1 << (ch.charCodeAt(0) - A))) m |= 1 << (to.charCodeAt(0) - A);
    }
  }
  return m;
}

/** Mask of the letters in a word, or -1 if it has anything other than a-z. */
export function wordMask(word: string): number {
  let m = 0;
  for (let i = 0; i < word.length; i++) {
    const k = word.charCodeAt(i) - A;
    if (k < 0 || k > 25) return -1;
    m |= 1 << k;
  }
  return m;
}

/** True when every letter of the word is in the allowed set. */
export function typable(wordMaskValue: number, allowed: number): boolean {
  return wordMaskValue >= 0 && (wordMaskValue & ~allowed) === 0;
}

/** Indices of words whose letters are all allowed, in input (frequency) order. */
export function filterByKeys(masks: Int32Array, allowed: number): Uint32Array {
  const out = new Uint32Array(masks.length);
  let n = 0;
  const forbidden = ~allowed;
  for (let i = 0; i < masks.length; i++) {
    const m = masks[i]!;
    if (m >= 0 && (m & forbidden) === 0) out[n++] = i;
  }
  return out.slice(0, n);
}

export function computeMasks(words: readonly string[]): Int32Array {
  const masks = new Int32Array(words.length);
  for (let i = 0; i < words.length; i++) masks[i] = wordMask(words[i]!);
  return masks;
}

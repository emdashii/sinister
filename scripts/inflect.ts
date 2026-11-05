/**
 * Regular English inflection candidates. These are guesses: the lexicon build keeps a
 * candidate only when wordfreq has seen it, so "stewardess" yields "stewardesses" but
 * never "stewardesss".
 */

const VOWEL = /[aeiou]/;

function endsCVC(w: string): boolean {
  // Consonant-vowel-consonant ending, excluding w/x/y finals: stop -> stopping.
  if (w.length < 3) return false;
  const [a, b, c] = [w.at(-3)!, w.at(-2)!, w.at(-1)!];
  return !VOWEL.test(a) && VOWEL.test(b) && !VOWEL.test(c) && !"wxy".includes(c);
}

export function plurals(w: string): string[] {
  if (/(s|x|z|ch|sh)$/.test(w)) return [w + "es"];
  if (/[^aeiou]y$/.test(w)) return [w.slice(0, -1) + "ies"];
  if (/fe$/.test(w)) return [w + "s", w.slice(0, -2) + "ves"];
  if (/[^f]f$/.test(w)) return [w + "s", w.slice(0, -1) + "ves"];
  if (/o$/.test(w)) return [w + "s", w + "es"];
  return [w + "s"];
}

export function thirdPerson(w: string): string[] {
  if (/(s|x|z|ch|sh|o)$/.test(w)) return [w + "es"];
  if (/[^aeiou]y$/.test(w)) return [w.slice(0, -1) + "ies"];
  return [w + "s"];
}

export function pastTense(w: string): string[] {
  if (/e$/.test(w)) return [w + "d"];
  if (/[^aeiou]y$/.test(w)) return [w.slice(0, -1) + "ied"];
  const out = [w + "ed"];
  if (endsCVC(w)) out.push(w + w.at(-1) + "ed");
  return out;
}

export function presentParticiple(w: string): string[] {
  if (/ie$/.test(w)) return [w.slice(0, -2) + "ying"];
  if (/[^eoy]e$/.test(w)) return [w.slice(0, -1) + "ing", w + "ing"];
  const out = [w + "ing"];
  if (endsCVC(w)) out.push(w + w.at(-1) + "ing");
  return out;
}

export function comparatives(w: string): string[][] {
  if (/e$/.test(w)) return [[w + "r"], [w + "st"]];
  if (/[^aeiou]y$/.test(w)) return [[w.slice(0, -1) + "ier"], [w.slice(0, -1) + "iest"]];
  const er = [w + "er"];
  const est = [w + "est"];
  if (endsCVC(w)) {
    er.push(w + w.at(-1) + "er");
    est.push(w + w.at(-1) + "est");
  }
  return [er, est];
}

/**
 * Inflection slots for a lemma and part of speech. Each slot is a list of spelling
 * variants; the build keeps the attested ones.
 */
export function inflectionSlots(lemma: string, pos: string): string[][] {
  switch (pos) {
    case "n":
      return [plurals(lemma)];
    case "v":
      return [thirdPerson(lemma), pastTense(lemma), presentParticiple(lemma)];
    case "a":
    case "s":
      return comparatives(lemma);
    default:
      return [];
  }
}

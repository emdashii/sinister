import "./style.css";
import { LAYOUTS, LAYOUT_IDS, MIDDLE_COLUMNS, isLetter, lettersOf, maskOf, mirrorMask, type Hand } from "./engine/keys";
import type { Taxonomy } from "./engine/lexicon";
import { QUERY_STYLES, queryText, FULL_DIMS } from "./engine/semantic";
import {
  applyCategory,
  applyText,
  baseCandidates,
  display,
  isLatin,
  rowScores,
  subtreeCounts,
  synsetsOf,
  type Universe,
} from "./chain";
import { gloss, loadLatin, loadTaxonomy, loadVectors, loadWords, type Vectors } from "./data";
import { embed, onModelProgress, modelReady } from "./embedder";
import { IDENTITY } from "./identity";
import { DEFAULT_THRESHOLD, allowedMask, decodeState, encodeState, type Filter, type State } from "./state";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = new Intl.NumberFormat("en");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const PAGE = 240;

let state: State = decodeState(location.search);
let universe: Universe | null = null;
let shown = PAGE;
let finalIds: Uint32Array = new Uint32Array(0);
let finalScores: Float32Array | null = null;

// ---------------------------------------------------------------------------
// State changes

function commit(next: State, mode: "push" | "replace" = "replace") {
  state = next;
  const url = `${location.pathname}${encodeState(state)}`;
  if (mode === "push") history.pushState(null, "", url);
  else history.replaceState(null, "", url);
  renderControls();
  void recompute();
}

addEventListener("popstate", () => {
  const prevHand = state.hand;
  const next = decodeState(location.search);
  const apply = () => {
    state = next;
    renderIdentity();
    renderControls();
  };
  if (next.hand !== prevHand) swapHands(apply);
  else apply();
  void recompute();
});

function swapHands(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || reducedMotion.matches) update();
  else doc.startViewTransition(update);
}

function setHand(hand: Hand) {
  if (hand === state.hand) return;
  const layout = LAYOUTS[state.layout];
  // A custom key set follows the hand: mirror it across the keyboard.
  const keys = state.keys === null ? null : lettersOf(mirrorMask(layout, maskOf(state.keys)));
  swapHands(() => {
    commit({ ...state, hand, keys }, "push");
    renderIdentity();
  });
}

// ---------------------------------------------------------------------------
// Identity: name, title, icon, accent, copy

function renderIdentity() {
  const id = IDENTITY[state.hand];
  document.documentElement.dataset.hand = state.hand;
  document.title = id.title;
  $("wordmark").textContent = id.name;
  $("tagline").textContent = id.tagline;
  $("etymology").innerHTML = id.etymology;
  $<HTMLLinkElement>("favicon").href = id.icon;
  $<HTMLAnchorElement>("about-link").href = state.hand === "right" ? "/about.html?hand=right" : "/about.html";
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", accent || "#a3122f");
  for (const b of document.querySelectorAll<HTMLButtonElement>(".hand-switch button"))
    b.setAttribute("aria-checked", String(b.dataset.hand === state.hand));
}

// The etymology note: hover or keyboard focus shows it (CSS); a tap toggles it.
const wordmark = $<HTMLButtonElement>("wordmark");
const etymology = $("etymology");
wordmark.addEventListener("click", () => {
  const open = !etymology.classList.contains("open");
  etymology.classList.toggle("open", open);
  wordmark.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (e) => {
  if (e.target !== wordmark && etymology.classList.contains("open")) {
    etymology.classList.remove("open");
    wordmark.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && etymology.classList.contains("open")) {
    etymology.classList.remove("open");
    wordmark.setAttribute("aria-expanded", "false");
  }
});
for (const b of document.querySelectorAll<HTMLButtonElement>(".hand-switch button"))
  b.addEventListener("click", () => setHand(b.dataset.hand as Hand));

// ---------------------------------------------------------------------------
// Keys panel

function renderControls() {
  const layout = LAYOUTS[state.layout];
  const allowed = allowedMask(state);

  const layouts = $("layouts");
  if (!layouts.childElementCount) {
    for (const id of LAYOUT_IDS) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.layout = id;
      b.textContent = LAYOUTS[id].name;
      b.addEventListener("click", () => commit({ ...state, layout: id, keys: null }, "push"));
      layouts.append(b);
    }
  }
  for (const b of layouts.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-checked", String(b.dataset.layout === state.layout));

  const kb = $("keyboard");
  kb.replaceChildren(
    ...layout.rows.map((row) => {
      const r = document.createElement("div");
      r.className = "row";
      for (let c = 0; c < 10; c++) {
        const ch = row[c]!;
        const k = document.createElement("button");
        k.type = "button";
        k.className = "key";
        k.textContent = ch;
        if (!isLetter(ch)) {
          k.disabled = true;
          k.setAttribute("aria-hidden", "true");
          k.tabIndex = -1;
        } else {
          const on = (allowed & (1 << (ch.charCodeAt(0) - 97))) !== 0;
          k.classList.toggle("on", on);
          k.setAttribute("aria-pressed", String(on));
          k.setAttribute("aria-label", ch.toUpperCase());
          k.addEventListener("click", () => {
            const next = allowed ^ (1 << (ch.charCodeAt(0) - 97));
            commit({ ...state, keys: lettersOf(next) });
          });
        }
        if (c === MIDDLE_COLUMNS[state.hand]) k.classList.add("reach");
        r.append(k);
      }
      return r;
    }),
  );

  const reachLetters = layout.rows.map((row) => row[MIDDLE_COLUMNS[state.hand]]!).filter(isLetter).join(" ").toUpperCase();
  $("reach-label").textContent = `Count the reach column (${reachLetters})`;
  const reach = $<HTMLInputElement>("reach");
  reach.checked = state.reach;
  reach.disabled = state.keys !== null;

  const note = $("keys-note");
  const n = lettersOf(allowed).length;
  if (state.keys === null) {
    note.textContent = `${n} letters under your ${state.hand} hand. Tap a key to choose your own.`;
  } else {
    note.textContent = `Your own ${n} ${n === 1 ? "key" : "keys"}. `;
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = `Use the standard ${state.hand} hand`;
    back.addEventListener("click", () => commit({ ...state, keys: null }));
    note.append(back);
  }
  $<HTMLInputElement>("latin").checked = state.latin;
}

$<HTMLInputElement>("reach").addEventListener("change", (e) => commit({ ...state, reach: (e.target as HTMLInputElement).checked }));
$<HTMLInputElement>("latin").addEventListener("change", (e) => commit({ ...state, latin: (e.target as HTMLInputElement).checked }));

// ---------------------------------------------------------------------------
// The chain

interface Step {
  filter: Filter | null;
  label: string;
  count: number | null;
  note?: string;
  error?: boolean;
}

const textScores = new Map<string, Promise<Float32Array>>();
/** Row scores for a query: the better of its plain and "a kind of" phrasings. */
function scoresFor(query: string, vectors: Vectors): Promise<Float32Array> {
  const key = query.trim().toLowerCase();
  let p = textScores.get(key);
  if (!p) {
    p = embed(QUERY_STYLES.map((s) => queryText(key, s))).then((data) => {
      let best: Float32Array | null = null;
      for (let i = 0; i < QUERY_STYLES.length; i++) {
        const s = rowScores(vectors, data.subarray(i * FULL_DIMS, (i + 1) * FULL_DIMS));
        best = best ? best.map((x, j) => Math.max(x, s[j]!)) : s;
      }
      return best!;
    });
    textScores.set(key, p);
    p.catch(() => textScores.delete(key));
  }
  return p;
}

let generation = 0;
let modelProgress = "";

async function recompute() {
  const gen = ++generation;
  const s = state;
  const status = $("status");
  try {
    const words = await loadWords();
    let latin = null;
    if (s.latin) {
      if (!universe?.latin) status.textContent = "Loading Latin names…";
      latin = await loadLatin();
    }
    if (gen !== generation) return;
    universe = { words, latin, tax: universe?.tax ?? null, vectors: universe?.vectors ?? null };
    const u = universe;

    const base = baseCandidates(u, allowedMask(s));
    const layoutName = LAYOUTS[s.layout].name;
    const steps: Step[] = [
      {
        filter: null,
        label: s.keys === null ? `${layoutName} · ${s.hand} hand${s.reach ? "" : ", no reach"}` : `${lettersOf(maskOf(s.keys)).length} chosen keys`,
        count: base.length,
      },
    ];
    let ids = base;
    let scores: Float32Array | null = null;
    let emptyHint = "";
    renderChain(steps.concat(s.filters.map((f) => ({ filter: f, label: filterLabel(f), count: null }))));

    for (const f of s.filters) {
      const step: Step = { filter: f, label: filterLabel(f), count: null };
      steps.push(step);
      if (f.kind === "category") {
        const tax = (u.tax ??= await loadTaxonomy());
        if (gen !== generation) return;
        step.label = filterLabel(f);
        ids = applyCategory(u, tax, ids, f.id);
        scores = null;
        step.count = ids.length;
      } else {
        const [tax, vectors] = await Promise.all([(u.tax ??= await loadTaxonomy()), (u.vectors ??= await loadVectors())]);
        if (gen !== generation) return;
        if (!modelReady()) {
          step.note = modelProgress || "loading model…";
          renderChain(steps.concat(pendingAfter(s, steps.length)));
        }
        const rows = await scoresFor(f.query, vectors);
        if (gen !== generation) return;
        const r = applyText(u, tax, vectors, rows, ids, f.threshold);
        if (r.ids.length === 0 && r.closest && !emptyHint)
          emptyHint = `No word reaches ${f.threshold} for “${f.query}”. The closest is “${display(u, r.closest.id)}” at ${Math.floor(r.closest.score)}; lower the slider to include it.`;
        ids = r.ids;
        scores = r.scores;
        step.count = ids.length;
      }
    }
    if (gen !== generation) return;
    renderChain(steps);
    finalIds = ids;
    finalScores = scores;
    shown = PAGE;
    renderWords();
    status.textContent = ids.length === 0 ? emptyHint || "No words left. Remove a filter or add keys." : `${fmt.format(ids.length)} ${ids.length === 1 ? "word" : "words"}${scores ? ", most similar first" : ", most common first"}`;
  } catch (err) {
    if (gen !== generation) return;
    const offline = !navigator.onLine;
    status.textContent = offline
      ? "You're offline, and this part hasn't been downloaded yet. Reconnect and try again."
      : `Something failed to load: ${err instanceof Error ? err.message : String(err)}`;
    const chips = $("chain").querySelectorAll(".chip.pending");
    chips.forEach((c) => c.classList.add("error"));
  }
}

function pendingAfter(s: State, done: number): Step[] {
  return s.filters.slice(done - 1).map((f) => ({ filter: f, label: filterLabel(f), count: null }));
}

onModelProgress((p) => {
  modelProgress = p === "ready" ? "" : `loading model ${(p.loaded / 1e6).toFixed(0)} of ${(p.total / 1e6).toFixed(0)} MB`;
  for (const c of $("chain").querySelectorAll(".chip.pending .chip-count")) c.textContent = modelProgress || "…";
});

function filterLabel(f: Filter): string {
  if (f.kind === "text") return `“${f.query}”`;
  const tax = universe?.tax;
  const i = tax?.indexOf(f.id);
  return tax && i !== undefined ? tax.labels[i]! : "category";
}

function renderChain(steps: Step[]) {
  const ol = $("chain");
  ol.replaceChildren(
    ...steps.map((step, i) => {
      const li = document.createElement("li");
      const chip = document.createElement("div");
      chip.className = "chip";
      const label = document.createElement("span");
      label.className = "chip-label";
      label.textContent = step.label;
      const count = document.createElement("span");
      count.className = "chip-count";
      count.textContent = step.count === null ? (step.note ?? "…") : fmt.format(step.count);
      if (step.count === null) chip.classList.add("pending");
      chip.append(label, count);
      if (!step.filter) {
        chip.classList.add("base");
      } else {
        const f = step.filter;
        const fi = i - 1;
        if (f.kind === "category") label.title = "Category";
        if (f.kind === "text") {
          chip.classList.add("text");
          const wrap = document.createElement("label");
          wrap.className = "threshold";
          const slider = document.createElement("input");
          slider.type = "range";
          slider.min = "0";
          slider.max = "100";
          slider.value = String(f.threshold);
          slider.setAttribute("aria-label", `Minimum similarity for ${step.label}`);
          const val = document.createElement("span");
          val.textContent = `≥ ${f.threshold}`;
          slider.addEventListener("input", () => {
            val.textContent = `≥ ${slider.value}`;
            const filters = state.filters.slice();
            filters[fi] = { ...f, threshold: Number(slider.value) };
            state = { ...state, filters };
            history.replaceState(null, "", `${location.pathname}${encodeState(state)}`);
            scheduleRecompute();
          });
          wrap.append(slider, val);
          chip.append(wrap);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Remove ${step.label}`);
        remove.addEventListener("click", () => commit({ ...state, filters: state.filters.filter((_, k) => k !== fi) }, "push"));
        chip.append(remove);
      }
      li.append(chip);
      return li;
    }),
  );
}

let pendingFrame = 0;
function scheduleRecompute() {
  cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => void recompute());
}

// ---------------------------------------------------------------------------
// Results

function renderWords() {
  const u = universe;
  if (!u) return;
  const ul = $("words");
  const frag = document.createDocumentFragment();
  const end = Math.min(shown, finalIds.length);
  for (let k = 0; k < end; k++) {
    const id = finalIds[k]!;
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const w = document.createElement("span");
    w.textContent = display(u, id);
    if (isLatin(u, id)) w.className = "latin";
    b.append(w);
    if (finalScores) {
      const sc = document.createElement("span");
      sc.className = "score";
      sc.textContent = finalScores[k]!.toFixed(0);
      b.append(sc);
    }
    b.addEventListener("click", () => void openWord(id));
    li.append(b);
    frag.append(li);
  }
  ul.replaceChildren(frag);
  const more = $<HTMLButtonElement>("more");
  more.hidden = finalIds.length <= shown;
  more.textContent = `Show ${fmt.format(Math.min(PAGE * 4, finalIds.length - shown))} more`;
}

$("more").addEventListener("click", () => {
  shown += PAGE * 4;
  renderWords();
});

const POS: Record<string, string> = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };

async function openWord(id: number) {
  const u = universe!;
  const dialog = $<HTMLDialogElement>("word-dialog");
  const body = $("word-body");
  $("word-title").textContent = display(u, id);
  body.textContent = "Loading…";
  dialog.showModal();
  try {
    if (isLatin(u, id)) {
      const i = id - u.words.list.length;
      const latin = u.latin!;
      body.innerHTML = "";
      const p = document.createElement("p");
      p.textContent = `A genus with ${fmt.format(latin.species[i]!)} accepted ${latin.species[i] === 1 ? "species" : "species"}.`;
      const lin = document.createElement("p");
      lin.className = "muted";
      lin.textContent = latin.lineages[latin.lineage[i]!]!;
      const a = document.createElement("a");
      a.href = `https://www.gbif.org/species/search?q=${encodeURIComponent(latin.names[i]!)}&rank=GENUS`;
      a.textContent = "Look it up on GBIF";
      a.rel = "noopener";
      body.append(p, lin, a);
      return;
    }
    const tax: Taxonomy = (u.tax ??= await loadTaxonomy());
    const frag = document.createDocumentFragment();
    const base = tax.wordBase[id] ?? -1;
    if (base >= 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = `A form of ${u.words.list[base]}.`;
      frag.append(p);
    }
    const synsets = synsetsOf(u, tax, id).slice(0, 10);
    const glosses = await Promise.all(synsets.map((s) => gloss(s)));
    synsets.forEach((s, k) => {
      const div = document.createElement("div");
      div.className = "sense";
      const pos = document.createElement("span");
      pos.className = "pos";
      pos.textContent = POS[tax.pos(s)] ?? "";
      const g = document.createElement("span");
      g.textContent = glosses[k]!;
      div.append(pos, g);
      const path = tax.ancestry(s).slice(0, 4).map((a) => tax.labels[a]);
      if (path.length) {
        const pth = document.createElement("div");
        pth.className = "path";
        pth.textContent = `${tax.labels[s]} › ${path.join(" › ")}`;
        div.append(pth);
      }
      frag.append(div);
    });
    body.replaceChildren(frag);
  } catch {
    body.textContent = navigator.onLine ? "The definition failed to load." : "You're offline, and this definition hasn't been downloaded yet.";
  }
}

// ---------------------------------------------------------------------------
// Category picker

const POPULAR = ["animal", "plant", "food", "person", "artifact", "body part", "feeling", "color", "location", "act", "communication", "substance"];

interface Picker {
  tax: Taxonomy;
  counts: Int32Array;
  path: number[];
}
let picker: Picker | null = null;

function bestSynset(tax: Taxonomy, label: string): number | undefined {
  let best: number | undefined;
  let size = -1;
  tax.labels.forEach((l, i) => {
    if (l === label && tax.pos(i) === "n") {
      const n = tax.children[i]!.length;
      if (n > size) [best, size] = [i, n];
    }
  });
  return best;
}

async function openCategories() {
  const dialog = $<HTMLDialogElement>("category-dialog");
  const list = $("category-list");
  list.innerHTML = '<li class="muted">Loading categories…</li>';
  $<HTMLInputElement>("category-search").value = "";
  dialog.showModal();
  try {
    const u = universe!;
    const tax = (u.tax ??= await loadTaxonomy());
    picker = { tax, counts: subtreeCounts(u, tax, finalIds), path: [] };
    renderPicker();
  } catch {
    list.innerHTML = `<li class="muted">${navigator.onLine ? "Categories failed to load." : "You're offline, and the categories haven't been downloaded yet."}</li>`;
  }
}

function pickerRow(tax: Taxonomy, s: number, count: number, hint: string | null, onClick: () => void): HTMLLIElement {
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.type = "button";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = tax.labels[s]!;
  b.append(label);
  if (hint) {
    const h = document.createElement("span");
    h.className = "hint";
    h.textContent = hint;
    b.append(h);
  }
  const c = document.createElement("span");
  c.className = "count";
  c.textContent = fmt.format(count);
  b.append(c);
  b.addEventListener("click", onClick);
  li.append(b);
  return li;
}

function renderPicker() {
  if (!picker) return;
  const { tax, counts, path } = picker;
  const list = $("category-list");
  const crumbs = $("category-crumbs");
  const apply = $<HTMLButtonElement>("category-apply");
  const query = $<HTMLInputElement>("category-search").value.trim().toLowerCase();

  crumbs.replaceChildren();
  if (query) {
    apply.hidden = true;
    const hits: { s: number; score: number }[] = [];
    tax.labels.forEach((l, s) => {
      if (!counts[s] || !l.toLowerCase().includes(query)) return;
      const low = l.toLowerCase();
      hits.push({ s, score: (low === query ? 2e9 : low.startsWith(query) ? 1e9 : 0) + counts[s]! });
    });
    hits.sort((a, b) => b.score - a.score);
    list.replaceChildren(
      ...hits.slice(0, 60).map(({ s }) => {
        const parent = tax.parents[s]![0];
        return pickerRow(tax, s, counts[s]!, parent !== undefined ? `in ${tax.labels[parent]}` : null, () => {
          $<HTMLInputElement>("category-search").value = "";
          picker!.path = [...tax.ancestry(s).reverse(), s];
          renderPicker();
        });
      }),
    );
    if (!hits.length) list.innerHTML = '<li class="muted">No category with that name has any of these words.</li>';
    return;
  }

  const top = document.createElement("button");
  top.type = "button";
  top.textContent = "All categories";
  top.addEventListener("click", () => {
    picker!.path = [];
    renderPicker();
  });
  crumbs.append(top);
  path.forEach((s, k) => {
    const sep = document.createElement("span");
    sep.textContent = "›";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = tax.labels[s]!;
    b.addEventListener("click", () => {
      picker!.path = path.slice(0, k + 1);
      renderPicker();
    });
    crumbs.append(sep, b);
  });

  const current = path.at(-1);
  let children: number[];
  if (current === undefined) {
    apply.hidden = true;
    const pop = POPULAR.map((l) => bestSynset(tax, l)).filter((s): s is number => s !== undefined);
    const roots = tax.roots().filter((r) => !pop.includes(r));
    children = [...pop, ...roots.sort((a, b) => counts[b]! - counts[a]!)];
  } else {
    apply.hidden = false;
    apply.textContent = `Keep the ${fmt.format(counts[current]!)} words under “${tax.labels[current]}”`;
    children = tax.children[current]!.slice().sort((a, b) => counts[b]! - counts[a]!);
  }
  const rows = children.filter((c) => counts[c]! > 0).slice(0, 200);
  list.replaceChildren(
    ...rows.map((s) =>
      pickerRow(tax, s, counts[s]!, tax.children[s]!.some((c) => counts[c]! > 0) ? "›" : null, () => {
        picker!.path = current === undefined ? [...tax.ancestry(s).reverse(), s] : [...path, s];
        renderPicker();
      }),
    ),
  );
  if (!rows.length) list.innerHTML = '<li class="muted">Nothing narrower here.</li>';
}

$("add-category").addEventListener("click", () => void openCategories());
$("category-search").addEventListener("input", () => renderPicker());
$("category-apply").addEventListener("click", () => {
  const s = picker?.path.at(-1);
  if (s === undefined || !picker) return;
  $<HTMLDialogElement>("category-dialog").close();
  commit({ ...state, filters: [...state.filters, { kind: "category", id: picker.tax.ids[s]! }] }, "push");
});

// ---------------------------------------------------------------------------
// Free-text filter

$("add-text").addEventListener("click", () => {
  $<HTMLInputElement>("text-query").value = "";
  $("text-note").hidden = modelReady();
  $<HTMLDialogElement>("text-dialog").showModal();
});
$("text-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const query = $<HTMLInputElement>("text-query").value.trim();
  if (!query) return;
  $<HTMLDialogElement>("text-dialog").close();
  commit({ ...state, filters: [...state.filters, { kind: "text", query, threshold: DEFAULT_THRESHOLD }] }, "push");
});

// ---------------------------------------------------------------------------

renderIdentity();
renderControls();
void recompute();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}

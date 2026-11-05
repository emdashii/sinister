/**
 * App state and its URL encoding. The URL is the source of truth, so a shared link
 * reproduces the hand, the key set and the whole filter chain.
 *
 *   ?hand=right&layout=dvorak&reach=0&keys=asdf&latin=1&f=c~01729333-n&f=t~42~sounds scary
 */
import { LAYOUTS, handMask, maskOf, type Hand, type LayoutId } from "./engine/keys";

export type Filter =
  | { kind: "category"; id: string }
  | { kind: "text"; query: string; /** Minimum similarity, 0-100. */ threshold: number };

export interface State {
  hand: Hand;
  layout: LayoutId;
  /** Whether the index-finger reach column (T G B / Y H N on QWERTY) counts. */
  reach: boolean;
  /** Custom key set (letters), or null for the standard hand. */
  keys: string | null;
  latin: boolean;
  filters: Filter[];
}

/** Minimum similarity for a new description filter; see docs/adr/0001-semantic-filter.md. */
export const DEFAULT_THRESHOLD = 45;

export const DEFAULT_STATE: State = { hand: "left", layout: "qwerty", reach: true, keys: null, latin: false, filters: [] };

export function allowedMask(s: State): number {
  return s.keys !== null ? maskOf(s.keys) : handMask(LAYOUTS[s.layout], s.hand, s.reach);
}

export function encodeState(s: State): string {
  const p = new URLSearchParams();
  if (s.hand !== "left") p.set("hand", s.hand);
  if (s.layout !== "qwerty") p.set("layout", s.layout);
  if (!s.reach) p.set("reach", "0");
  if (s.keys !== null) p.set("keys", [...new Set(s.keys)].sort().join(""));
  if (s.latin) p.set("latin", "1");
  for (const f of s.filters) p.append("f", f.kind === "category" ? `c~${f.id}` : `t~${f.threshold}~${f.query}`);
  const q = p.toString();
  return q ? `?${q}` : "";
}

export function decodeState(search: string): State {
  const p = new URLSearchParams(search);
  const hand: Hand = p.get("hand") === "right" ? "right" : "left";
  const layoutParam = p.get("layout") ?? "";
  const layout: LayoutId = layoutParam in LAYOUTS ? (layoutParam as LayoutId) : "qwerty";
  const keysParam = p.get("keys");
  const keys = keysParam === null ? null : [...new Set(keysParam.toLowerCase().replace(/[^a-z]/g, ""))].sort().join("");
  const filters: Filter[] = [];
  for (const raw of p.getAll("f")) {
    if (raw.startsWith("c~")) {
      const id = raw.slice(2);
      if (/^\d{8}-[nvasr]$/.test(id)) filters.push({ kind: "category", id });
    } else if (raw.startsWith("t~")) {
      const m = /^t~(\d{1,3})~(.+)$/s.exec(raw);
      if (m) filters.push({ kind: "text", threshold: Math.min(100, Number(m[1])), query: m[2]!.slice(0, 200) });
    }
  }
  return { hand, layout, reach: p.get("reach") !== "0", keys, latin: p.get("latin") === "1", filters };
}

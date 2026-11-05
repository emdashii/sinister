import { expect, test } from "bun:test";
import fc from "fast-check";
import { DEFAULT_STATE, decodeState, encodeState, type State } from "../src/state";

test("the default state is the bare URL", () => {
  expect(encodeState(DEFAULT_STATE)).toBe("");
  expect(decodeState("")).toEqual(DEFAULT_STATE);
});

test("a shared Dexter link opens as Dexter", () => {
  expect(decodeState("?hand=right").hand).toBe("right");
});

test("any state survives a round trip through the URL", () => {
  const filter = fc.oneof(
    fc.record({ kind: fc.constant("category" as const), id: fc.stringMatching(/^\d{8}-[nvasr]$/) }),
    fc.record({
      kind: fc.constant("text" as const),
      query: fc.string({ minLength: 1, maxLength: 60 }),
      threshold: fc.integer({ min: 0, max: 100 }),
    }),
  );
  const state = fc.record({
    hand: fc.constantFrom("left" as const, "right" as const),
    layout: fc.constantFrom("qwerty" as const, "dvorak" as const, "colemak" as const),
    reach: fc.boolean(),
    keys: fc.option(fc.subarray([..."abcdefghijklmnopqrstuvwxyz"]).map((k) => k.join("")), { nil: null }),
    latin: fc.boolean(),
    filters: fc.array(filter, { maxLength: 5 }),
  });
  fc.assert(fc.property(state, (s: State) => expect(decodeState(encodeState(s))).toEqual(s)));
});

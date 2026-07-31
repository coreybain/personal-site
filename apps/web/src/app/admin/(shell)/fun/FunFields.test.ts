import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { funPatch, type FunDraft } from "./FunFields";

function beerDraft(): FunDraft {
  return {
    type: "beer",
    title: "Friday beer",
    photo: null,
    note: "A lager",
    rating: 4,
    locationName: "The Local",
    locationSuburb: "Sydney",
    latitude: null,
    longitude: null,
    steps: null,
    km: null,
    occurredAt: "2026-07-31T08:00:00.000Z",
  };
}

describe("funPatch", () => {
  it("returns an empty patch for an unchanged draft", () => {
    const initial = beerDraft();
    assert.deepEqual(funPatch(initial, { ...initial }), {});
  });

  it("ignores inactive walk metrics on a non-walk draft", () => {
    const initial = beerDraft();
    const draft = { ...initial, steps: 8_000, km: 6.2 };

    assert.deepEqual(funPatch(initial, draft), {});
  });

  it("returns the active field changes that should advance the revision", () => {
    const initial = beerDraft();
    const draft = { ...initial, title: "Saturday beer", rating: null };

    assert.deepEqual(funPatch(initial, draft), {
      title: "Saturday beer",
      rating: null,
    });
  });
});

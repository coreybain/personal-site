import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { curateLabs, PATHWAY_LAB } from "./labsCatalog";

describe("curateLabs", () => {
  it("puts Pathway first and removes Statline", () => {
    const partyBooth = { ...PATHWAY_LAB, slug: "partybooth", title: "PartyBooth" };
    const statline = { ...PATHWAY_LAB, slug: "statline", title: "Statline" };

    assert.deepEqual(curateLabs([partyBooth, statline]).map((lab) => lab.slug), [
      "pathway",
      "partybooth",
    ]);
  });

  it("prefers live Pathway data without duplicating it", () => {
    const livePathway = {
      ...PATHWAY_LAB,
      liveStats: { ...PATHWAY_LAB.liveStats, stars: 12 },
    };

    const curated = curateLabs([livePathway]);

    assert.equal(curated.length, 1);
    assert.equal(curated[0]?.liveStats.stars, 12);
  });
});

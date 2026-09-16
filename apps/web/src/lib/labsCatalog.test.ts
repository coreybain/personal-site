import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { curateLabs } from "./labsCatalog";
import type { Lab } from "./snapshot";

const PATHWAY_LAB: Lab = {
  slug: "pathway", title: "Pathway", summary: "An open source agentic workspace.",
  repoFullName: "SpiritDevs/pathway", language: "TypeScript", links: {},
  liveStats: { stars: 0, forks: 0, commitsYear: 0, lastPushDaysAgo: 0 }, featured: true,
};

describe("curateLabs", () => {
  it("puts Pathway first and removes Statline", () => {
    const partyBooth = { ...PATHWAY_LAB, slug: "partybooth", title: "PartyBooth" };
    const statline = { ...PATHWAY_LAB, slug: "statline", title: "Statline" };

    assert.deepEqual(curateLabs([partyBooth, statline, PATHWAY_LAB]).map((lab) => lab.slug), [
      "pathway",
      "partybooth",
    ]);
  });

  it("does not recreate unpublished Labs through launch fallback content", () => {
    assert.deepEqual(curateLabs([]), []);
    const other = { ...PATHWAY_LAB, slug: "boca", title: "Boca" };
    assert.deepEqual(curateLabs([other]).map((lab) => lab.slug), ["boca"]);
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

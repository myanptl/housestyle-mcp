import { afterEach, describe, expect, it } from "vitest";

import { type FontFamily, clearCache, primeCache } from "../src/fonts/catalog.js";
import {
  SIGNATURE_DEFAULTS,
  suggestFonts,
  suggestPairing,
} from "../src/fonts/pairing.js";

/**
 * A fixture rather than the live catalogue: these assertions are about the
 * selection logic, and a network-dependent test would fail for reasons that
 * have nothing to do with the code under test.
 */
function font(overrides: Partial<FontFamily> & { family: string }): FontFamily {
  return {
    category: "Sans Serif",
    popularity: 130,
    weights: [300, 400, 500, 700],
    hasItalic: true,
    isVariable: true,
    designers: ["Someone"],
    classifications: [],
    subsets: ["menu", "latin", "latin-ext"],
    primaryScript: "",
    ...overrides,
  };
}

const FIXTURE: FontFamily[] = [
  font({ family: "Inter", popularity: 1 }),
  font({ family: "Roboto", popularity: 2 }),
  font({ family: "Chart Topper", popularity: 3 }),
  font({ family: "Sweet Spot Sans", popularity: 130 }),
  font({ family: "Second Sans", popularity: 160 }),
  font({ family: "Long Tail Sans", popularity: 1800 }),
  font({ family: "Sweet Spot Serif", category: "Serif", popularity: 140 }),
  font({ family: "Second Serif", category: "Serif", popularity: 175 }),
  font({ family: "Thin Serif", category: "Serif", popularity: 150, weights: [400], hasItalic: false }),
  font({ family: "Loud Display", category: "Display", popularity: 145 }),
  font({ family: "Code Mono", category: "Monospace", popularity: 150 }),
  font({
    family: "Script Specific Sans",
    popularity: 20,
    primaryScript: "Thai",
    subsets: ["menu", "latin", "thai"],
  }),
  font({
    family: "No Latin Sans",
    popularity: 25,
    subsets: ["menu", "cyrillic"],
  }),
];

afterEach(() => clearCache());

describe("suggestFonts", () => {
  it("excludes the signature defaults by default", async () => {
    primeCache(FIXTURE);
    const picks = await suggestFonts({ mood: "neutral", role: "body" });
    for (const pick of picks) {
      expect(SIGNATURE_DEFAULTS.has(pick.family)).toBe(false);
    }
  });

  it("lets the defaults back in on request", async () => {
    primeCache(FIXTURE);
    const picks = await suggestFonts({
      mood: "neutral",
      role: "body",
      limit: 20,
      excludeDefaults: false,
    });
    expect(picks.map((p) => p.family)).toContain("Inter");
  });

  it("drops script-specific families even when they ship Latin glyphs", async () => {
    // Noto Sans Thai has a latin subset, so subsets alone cannot filter it.
    primeCache(FIXTURE);
    const families = (
      await suggestFonts({ mood: "neutral", role: "body", limit: 20 })
    ).map((p) => p.family);
    expect(families).not.toContain("Script Specific Sans");
    expect(families).not.toContain("No Latin Sans");
  });

  it("prefers the sweet spot over both the chart topper and the long tail", async () => {
    primeCache(FIXTURE);
    const picks = await suggestFonts({
      mood: "neutral",
      role: "body",
      limit: 20,
      excludeDefaults: false,
    });
    const rank = (name: string) => picks.findIndex((p) => p.family === name);
    expect(rank("Sweet Spot Sans")).toBeLessThan(rank("Chart Topper"));
    expect(rank("Sweet Spot Sans")).toBeLessThan(rank("Long Tail Sans"));
  });

  it("does not produce alphabetically clustered results", async () => {
    // Flat scoring bands used to tie hundreds of families, so a stable sort
    // returned the catalogue in alphabetical order.
    primeCache(FIXTURE);
    const picks = await suggestFonts({
      mood: "neutral",
      role: "body",
      limit: 5,
      excludeDefaults: false,
    });
    const names = picks.map((p) => p.family);
    const alphabetical = [...names].sort();
    expect(names).not.toEqual(alphabetical);
  });

  it("penalises a body face with too few weights", async () => {
    primeCache(FIXTURE);
    const picks = await suggestFonts({ mood: "neutral", role: "body", limit: 20 });
    const rank = (n: string) => picks.findIndex((p) => p.family === n);
    expect(rank("Sweet Spot Serif")).toBeLessThan(rank("Thin Serif"));
  });

  it("keeps display faces out of body results", async () => {
    primeCache(FIXTURE);
    const picks = await suggestFonts({ mood: "neutral", role: "body", limit: 20 });
    expect(picks.map((p) => p.family)).not.toContain("Loud Display");
  });

  it("returns only monospace for the mono role", async () => {
    primeCache(FIXTURE);
    const picks = await suggestFonts({ mood: "technical", role: "mono" });
    expect(picks.map((p) => p.family)).toEqual(["Code Mono"]);
  });

  it("builds an import url and a stack with a real fallback", async () => {
    primeCache(FIXTURE);
    const [pick] = await suggestFonts({ mood: "neutral", role: "body", limit: 1 });
    expect(pick.importUrl).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=/);
    expect(pick.importUrl).toContain("display=swap");
    expect(pick.importUrl).not.toContain(" ");
    expect(pick.cssStack).toContain(",");
  });

  it("honours the limit and caps it", async () => {
    primeCache(FIXTURE);
    expect(await suggestFonts({ mood: "neutral", role: "body", limit: 2 })).toHaveLength(2);
    const capped = await suggestFonts({ mood: "neutral", role: "body", limit: 999 });
    expect(capped.length).toBeLessThanOrEqual(20);
  });
});

describe("suggestPairing", () => {
  it("pairs across a category boundary", async () => {
    primeCache(FIXTURE);
    const pairs = await suggestPairing("neutral");
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(pair.display.category).not.toBe(pair.body.category);
    }
  });

  it("never reuses a family across roles or pairs", async () => {
    primeCache(FIXTURE);
    const pairs = await suggestPairing("neutral");
    const seen = pairs.flatMap((p) => [p.display.family, p.body.family]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("produces a pairing for every mood", async () => {
    // Mood filters used to constrain both roles to the same category, which
    // made a cross-category pairing impossible and returned nothing.
    primeCache(FIXTURE);
    for (const mood of [
      "editorial",
      "technical",
      "warm",
      "brutalist",
      "elegant",
      "neutral",
    ] as const) {
      const pairs = await suggestPairing(mood);
      expect(pairs.length, `mood ${mood} produced no pairing`).toBeGreaterThan(0);
    }
  });

  it("explains the pairing rather than just listing it", async () => {
    primeCache(FIXTURE);
    const [pair] = await suggestPairing("neutral");
    expect(pair.rationale).toContain(pair.display.family);
    expect(pair.rationale).toContain(pair.body.family);
  });
});

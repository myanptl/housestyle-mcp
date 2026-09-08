import { describe, expect, it } from "vitest";

import { apcaContrast, contrastRatio, report } from "../src/color/contrast.js";
import { buildPalette } from "../src/color/palette.js";
import {
  isInSrgbGamut,
  oklchToRgb,
  parseColor,
  relativeLuminance,
  rgbToOklch,
  toHex,
} from "../src/color/space.js";

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

describe("parseColor", () => {
  it("parses long hex", () => {
    expect(parseColor("#3b82f6")).toEqual({ r: 59, g: 130, b: 246 });
  });

  it("parses short hex by doubling each nibble", () => {
    expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204 });
  });

  it("parses hex without the leading hash", () => {
    expect(parseColor("3b82f6")).toEqual({ r: 59, g: 130, b: 246 });
  });

  it("parses rgb() and rgba()", () => {
    expect(parseColor("rgb(59, 130, 246)")).toEqual({ r: 59, g: 130, b: 246 });
    expect(parseColor("rgba(59 130 246 / 0.5)")).toEqual({
      r: 59,
      g: 130,
      b: 246,
    });
  });

  it("returns null rather than guessing at unparseable input", () => {
    expect(parseColor("rebeccapurple")).toBeNull();
    expect(parseColor("")).toBeNull();
    expect(parseColor("#gg0000")).toBeNull();
  });

  it("rejects out-of-range rgb channels", () => {
    expect(parseColor("rgb(300, 0, 0)")).toBeNull();
  });
});

describe("relativeLuminance", () => {
  // Anchored to the WCAG 2.x definition, not to this implementation.
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
  });

  it("matches the published coefficient for pure green", () => {
    expect(relativeLuminance({ r: 0, g: 255, b: 0 })).toBeCloseTo(0.7152, 4);
  });
});

describe("contrastRatio", () => {
  it("gives the maximum 21:1 for black on white", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 2);
  });

  it("gives 1:1 for a colour against itself", () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it("is symmetric — order of arguments does not matter", () => {
    const a = { r: 59, g: 130, b: 246 };
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 10);
  });

  it("scores Tailwind blue-500 on white as a known near-miss for AA", () => {
    // #3b82f6 on white is ~3.68:1 — a well-known failure for body text that
    // ships constantly. If this number moves, the luminance maths broke.
    const ratio = contrastRatio({ r: 59, g: 130, b: 246 }, WHITE);
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(3.9);
    expect(report({ r: 59, g: 130, b: 246 }, WHITE).normalText).toBe("fail");
  });
});

describe("apcaContrast", () => {
  it("is signed by polarity", () => {
    // Dark text on light reads positive; the reverse reads negative.
    expect(apcaContrast(BLACK, WHITE)).toBeGreaterThan(100);
    expect(apcaContrast(WHITE, BLACK)).toBeLessThan(-90);
  });

  it("is 0 when there is no luminance difference", () => {
    expect(apcaContrast(WHITE, WHITE)).toBe(0);
  });

  it("disagrees with WCAG on a mid-grey dark theme, which is the point", () => {
    // WCAG clears this pair for large text; APCA rates it too weak for reading.
    const grey = { r: 120, g: 120, b: 120 };
    const dark = { r: 18, g: 18, b: 18 };
    expect(contrastRatio(grey, dark)).toBeGreaterThan(3);
    expect(Math.abs(apcaContrast(grey, dark))).toBeLessThan(60);
  });
});

describe("oklch round trip", () => {
  it("returns the original colour within rounding", () => {
    for (const hex of ["#3b82f6", "#ff0000", "#123456", "#e2e8f0", "#7c3aed"]) {
      const rgb = parseColor(hex)!;
      const back = oklchToRgb(rgbToOklch(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThan(1);
      expect(Math.abs(back.g - rgb.g)).toBeLessThan(1);
      expect(Math.abs(back.b - rgb.b)).toBeLessThan(1);
      expect(toHex(back)).toBe(hex);
    }
  });

  it("puts greys at essentially zero chroma", () => {
    expect(rgbToOklch({ r: 128, g: 128, b: 128 }).c).toBeLessThan(0.001);
  });

  it("flags an unreachable chroma as out of gamut", () => {
    // No sRGB colour has chroma 0.4 at mid lightness.
    expect(isInSrgbGamut({ l: 0.6, c: 0.4, h: 250 })).toBe(false);
    expect(isInSrgbGamut({ l: 0.6, c: 0.05, h: 250 })).toBe(true);
  });
});

describe("buildPalette", () => {
  it("rejects an unparseable seed instead of emitting a grey ramp", () => {
    expect(() => buildPalette("not-a-colour")).toThrow(/Could not parse/);
  });

  it("returns 11 steps in increasing darkness", () => {
    const p = buildPalette("#3b82f6");
    expect(p.swatches).toHaveLength(11);
    for (let i = 1; i < p.swatches.length; i++) {
      // Each step should be darker, so contrast against white rises monotonically.
      expect(p.swatches[i].onWhite).toBeGreaterThan(p.swatches[i - 1].onWhite);
    }
  });

  it("keeps every emitted swatch inside sRGB", () => {
    // A saturated seed is the case that clips; the ramp must not emit a colour
    // the display cannot show.
    const p = buildPalette("#ff0000");
    for (const swatch of p.swatches) {
      const rgb = parseColor(swatch.hex)!;
      expect(rgb.r).toBeGreaterThanOrEqual(0);
      expect(rgb.r).toBeLessThanOrEqual(255);
      expect(swatch.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("preserves the seed hue across the ramp", () => {
    const seedHue = rgbToOklch(parseColor("#3b82f6")!).h;
    const p = buildPalette("#3b82f6");
    for (const swatch of p.swatches.slice(2, 9)) {
      const hue = rgbToOklch(parseColor(swatch.hex)!).h;
      expect(Math.abs(hue - seedHue)).toBeLessThan(3);
    }
  });

  it("names the token in the emitted CSS", () => {
    expect(buildPalette("#3b82f6", "brand").css).toContain("--brand-500:");
  });
});

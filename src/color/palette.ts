/**
 * Palette ramps built in OKLCH.
 *
 * OKLCH is used rather than HSL because HSL lightness is not perceptual: at a
 * fixed HSL lightness, yellow reads far brighter than blue, so an HSL ramp
 * produces steps that look unevenly spaced. In OKLCH equal lightness steps
 * look equally spaced.
 */

import {
  type Oklch,
  type Rgb,
  formatOklch,
  isInSrgbGamut,
  oklchToRgb,
  parseColor,
  rgbToOklch,
  toHex,
} from "./space.js";
import { contrastRatio } from "./contrast.js";

export interface Swatch {
  step: number;
  hex: string;
  oklch: string;
  /** Contrast against white and black, so callers can pick text colour. */
  onWhite: number;
  onBlack: number;
  inGamut: boolean;
}

/** Tailwind-like steps, which most consumers already think in. */
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Target OKLCH lightness per step. Ends are pulled in from pure white/black. */
const TARGET_LIGHTNESS: Record<number, number> = {
  50: 0.975,
  100: 0.94,
  200: 0.88,
  300: 0.81,
  400: 0.72,
  500: 0.63,
  600: 0.55,
  700: 0.47,
  800: 0.39,
  900: 0.31,
  950: 0.22,
};

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * Chroma is tapered toward both ends. Holding the seed's chroma flat makes the
 * light steps look muddy and pushes the dark steps out of the sRGB gamut.
 */
function chromaFor(step: number, seedChroma: number): number {
  const lightness = TARGET_LIGHTNESS[step];
  const distanceFromMid = Math.abs(lightness - 0.63) / 0.63;
  const taper = 1 - Math.pow(distanceFromMid, 1.5) * 0.55;
  return Math.max(seedChroma * taper, 0.004);
}

/**
 * Walks chroma down until the colour fits in sRGB. Without this, saturated
 * seeds silently clip on conversion and the ramp loses its hue at the ends.
 */
function fitToGamut(target: Oklch): { color: Oklch; clipped: boolean } {
  if (isInSrgbGamut(target)) return { color: target, clipped: false };

  let low = 0;
  let high = target.c;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (isInSrgbGamut({ ...target, c: mid })) low = mid;
    else high = mid;
  }
  return { color: { ...target, c: low }, clipped: true };
}

export interface PaletteResult {
  seedHex: string;
  seedOklch: string;
  swatches: Swatch[];
  css: string;
  notes: string[];
}

export function buildPalette(seed: string, name = "accent"): PaletteResult {
  const rgb = parseColor(seed);
  if (!rgb) {
    throw new Error(
      `Could not parse "${seed}" as a colour. Use #rgb, #rrggbb, or rgb(r, g, b).`
    );
  }

  const seedOklch = rgbToOklch(rgb);
  const notes: string[] = [];
  let clippedCount = 0;

  const swatches: Swatch[] = STEPS.map((step) => {
    const target: Oklch = {
      l: TARGET_LIGHTNESS[step],
      c: chromaFor(step, seedOklch.c),
      h: seedOklch.h,
    };
    const { color, clipped } = fitToGamut(target);
    if (clipped) clippedCount++;

    const stepRgb = oklchToRgb(color);
    return {
      step,
      hex: toHex(stepRgb),
      oklch: formatOklch(color),
      onWhite: Math.round(contrastRatio(stepRgb, WHITE) * 100) / 100,
      onBlack: Math.round(contrastRatio(stepRgb, BLACK) * 100) / 100,
      inGamut: !clipped,
    };
  });

  if (clippedCount > 0) {
    notes.push(
      `${clippedCount} step${clippedCount === 1 ? "" : "s"} had chroma reduced to stay inside sRGB. The hue is preserved; saturation at the extremes is not achievable on a standard display.`
    );
  }

  const bodyOnWhite = swatches.find((s) => s.onWhite >= 4.5);
  notes.push(
    bodyOnWhite
      ? `For body text on white, ${name}-${bodyOnWhite.step} is the lightest step that clears WCAG AA (${bodyOnWhite.onWhite}:1).`
      : `No step reaches 4.5:1 on white. This hue needs a darker seed for body text.`
  );

  const css = [
    ":root {",
    ...swatches.map((s) => `  --${name}-${s.step}: ${s.oklch};`),
    "}",
  ].join("\n");

  return {
    seedHex: toHex(rgb),
    seedOklch: formatOklch(seedOklch),
    swatches,
    css,
    notes,
  };
}

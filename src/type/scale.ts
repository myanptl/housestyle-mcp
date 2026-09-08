/**
 * Fluid modular type scales.
 *
 * Emitted as clamp() so the scale interpolates with the viewport instead of
 * stepping at breakpoints. The clamp middle term is computed in rem + vw so it
 * still honours a user's root font size, which a raw vw value would override.
 */

export const RATIOS = {
  "minor-third": 1.2,
  "major-third": 1.25,
  "perfect-fourth": 1.333,
  "augmented-fourth": 1.414,
  "perfect-fifth": 1.5,
  "golden": 1.618,
} as const;

export type RatioName = keyof typeof RATIOS;

export interface ScaleStep {
  name: string;
  minRem: number;
  maxRem: number;
  clamp: string;
}

export interface ScaleOptions {
  /** Body size at the narrow end, in rem. */
  baseRem?: number;
  ratio?: RatioName;
  /** Viewport where the scale stops growing, in px. */
  minViewportPx?: number;
  maxViewportPx?: number;
  /** Steps above body. */
  stepsUp?: number;
  /** Steps below body. */
  stepsDown?: number;
}

const STEP_NAMES_UP = ["md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"];
const STEP_NAMES_DOWN = ["sm", "xs"];

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Solves for the clamp() middle term.
 *
 * Given the size at two viewport widths, the value scales linearly as
 * `slope * 100vw + intercept`, where slope is the change in size per px of
 * viewport. Expressing the intercept in rem keeps the result responsive to the
 * root font size.
 *
 * The two clamp bounds are ordered by magnitude, not by which viewport they
 * came from. Steps below base run the other way — the gentler narrow-end ratio
 * makes small text relatively larger on a phone — and `clamp()` with a lower
 * bound above its upper bound silently returns the lower bound, which would
 * pin those steps to the wrong size.
 */
function fluidValue(
  atMinViewport: number,
  atMaxViewport: number,
  minViewportPx: number,
  maxViewportPx: number
): string {
  if (maxViewportPx <= minViewportPx) {
    return `${round(atMaxViewport)}rem`;
  }
  if (Math.abs(atMaxViewport - atMinViewport) < 1e-6) {
    return `${round(atMaxViewport)}rem`;
  }

  const rootPx = 16;
  const slope =
    (atMaxViewport - atMinViewport) /
    ((maxViewportPx - minViewportPx) / rootPx);
  const intercept = atMinViewport - slope * (minViewportPx / rootPx);

  const vw = round(slope * 100, 4);
  const rem = round(intercept, 4);

  const lower = round(Math.min(atMinViewport, atMaxViewport));
  const upper = round(Math.max(atMinViewport, atMaxViewport));

  // The vw term carries its own sign into the operator, because `A + -Bvw` is
  // not valid CSS. Downward steps genuinely have a negative slope.
  const operator = vw >= 0 ? "+" : "-";
  const middle =
    rem === 0
      ? `${vw}vw`
      : `${rem}rem ${operator} ${round(Math.abs(vw), 4)}vw`;

  return `clamp(${lower}rem, ${middle}, ${upper}rem)`;
}

export function buildScale(options: ScaleOptions = {}): ScaleStep[] {
  const base = options.baseRem ?? 1;
  const ratio = RATIOS[options.ratio ?? "perfect-fourth"];
  const minViewport = options.minViewportPx ?? 360;
  const maxViewport = options.maxViewportPx ?? 1440;
  const up = Math.min(Math.max(options.stepsUp ?? 5, 0), STEP_NAMES_UP.length);
  const down = Math.min(
    Math.max(options.stepsDown ?? 2, 0),
    STEP_NAMES_DOWN.length
  );

  // The narrow end uses a gentler ratio so headlines stay readable on a phone;
  // a single ratio applied at both ends overshoots badly at 360px.
  const minRatio = 1 + (ratio - 1) * 0.6;

  const steps: ScaleStep[] = [];

  for (let i = down; i >= 1; i--) {
    const minRem = base / Math.pow(minRatio, i);
    const maxRem = base / Math.pow(ratio, i);
    steps.push({
      name: STEP_NAMES_DOWN[i - 1],
      minRem: round(minRem),
      maxRem: round(maxRem),
      clamp: fluidValue(minRem, maxRem, minViewport, maxViewport),
    });
  }

  steps.push({
    name: "base",
    minRem: round(base),
    maxRem: round(base),
    clamp: `${round(base)}rem`,
  });

  for (let i = 1; i <= up; i++) {
    const minRem = base * Math.pow(minRatio, i);
    const maxRem = base * Math.pow(ratio, i);
    steps.push({
      name: STEP_NAMES_UP[i - 1],
      minRem: round(minRem),
      maxRem: round(maxRem),
      clamp: fluidValue(minRem, maxRem, minViewport, maxViewport),
    });
  }

  return steps;
}

export function toCssCustomProperties(steps: ScaleStep[]): string {
  const lines = steps.map((step) => `  --text-${step.name}: ${step.clamp};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

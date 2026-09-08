/**
 * Contrast scoring. WCAG 2.2 is the ratio designers are held to legally; APCA
 * is reported alongside it because WCAG 2.x is known to misjudge dark themes,
 * where it passes light-on-dark pairs that are genuinely hard to read.
 */

import { type Rgb, relativeLuminance } from "./space.js";

export type WcagLevel = "AAA" | "AA" | "AA Large" | "fail";

export interface ContrastReport {
  ratio: number;
  normalText: WcagLevel;
  largeText: WcagLevel;
  apcaLc: number;
  apcaVerdict: string;
}

/** WCAG 2.2 contrast ratio, 1–21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function gradeNormal(ratio: number): WcagLevel {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  return "fail";
}

function gradeLarge(ratio: number): WcagLevel {
  if (ratio >= 4.5) return "AAA";
  if (ratio >= 3) return "AA Large";
  return "fail";
}

// APCA W3 0.1.9 constants.
const APCA = {
  exponent: 2.4,
  normBg: 0.56,
  normText: 0.57,
  revBg: 0.65,
  revText: 0.62,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scale: 1.14,
  loClip: 0.1,
  deltaYmin: 0.0005,
} as const;

function apcaLuminance({ r, g, b }: Rgb): number {
  const c = (n: number) => Math.pow(n / 255, APCA.exponent);
  return 0.2126729 * c(r) + 0.7151522 * c(g) + 0.072175 * c(b);
}

function softClamp(y: number): number {
  return y > APCA.blkThrs ? y : y + Math.pow(APCA.blkThrs - y, APCA.blkClmp);
}

/**
 * APCA lightness contrast (Lc), roughly -108..106. Sign carries polarity:
 * positive is dark text on a light background, negative is the reverse.
 */
export function apcaContrast(text: Rgb, background: Rgb): number {
  const yText = softClamp(apcaLuminance(text));
  const yBg = softClamp(apcaLuminance(background));

  if (Math.abs(yBg - yText) < APCA.deltaYmin) return 0;

  let output: number;
  if (yBg > yText) {
    output =
      (Math.pow(yBg, APCA.normBg) - Math.pow(yText, APCA.normText)) *
      APCA.scale;
    output = output < APCA.loClip ? 0 : output - 0.027;
  } else {
    output =
      (Math.pow(yBg, APCA.revBg) - Math.pow(yText, APCA.revText)) * APCA.scale;
    output = output > -APCA.loClip ? 0 : output + 0.027;
  }

  return output * 100;
}

/**
 * APCA is a guideline rather than a pass/fail line, so this reports the
 * smallest use each Lc value realistically supports.
 */
function apcaVerdict(lc: number): string {
  const magnitude = Math.abs(lc);
  if (magnitude >= 90) return "any text, including thin weights";
  if (magnitude >= 75) return "body text at 16px+";
  if (magnitude >= 60) return "body text at 18px+, or 16px semibold";
  if (magnitude >= 45) return "headlines and large text only (24px+)";
  if (magnitude >= 30) return "large display text only — not for reading";
  if (magnitude >= 15) return "non-text elements only (borders, dividers)";
  return "invisible in practice — do not use";
}

export function report(text: Rgb, background: Rgb): ContrastReport {
  const ratio = contrastRatio(text, background);
  const lc = apcaContrast(text, background);
  return {
    ratio,
    normalText: gradeNormal(ratio),
    largeText: gradeLarge(ratio),
    apcaLc: lc,
    apcaVerdict: apcaVerdict(lc),
  };
}

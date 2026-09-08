/**
 * Colour-space conversions, written out rather than pulled from a dependency.
 * The maths is fixed by specification, so a local implementation cannot drift
 * or pull a supply chain behind it.
 *
 * sRGB primaries and the D65 white point throughout.
 */

export interface Rgb {
  /** 0–255 */
  r: number;
  g: number;
  b: number;
}

export interface Oklch {
  /** Perceptual lightness, 0–1 */
  l: number;
  /** Chroma, 0 to ~0.4 in sRGB */
  c: number;
  /** Hue angle in degrees, 0–360 */
  h: number;
}

const HEX_SHORT = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_LONG = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FUNC = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i;

/** Parses #abc, #aabbcc, or rgb()/rgba(). Returns null on anything else. */
export function parseColor(input: string): Rgb | null {
  const value = input.trim();

  const short = HEX_SHORT.exec(value);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }

  const long = HEX_LONG.exec(value);
  if (long) {
    return {
      r: parseInt(long[1], 16),
      g: parseInt(long[2], 16),
      b: parseInt(long[3], 16),
    };
  }

  const func = RGB_FUNC.exec(value);
  if (func) {
    const channels = [func[1], func[2], func[3]].map(Number);
    if (channels.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
      return null;
    }
    return { r: channels[0], g: channels[1], b: channels[2] };
  }

  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (n: number) =>
    Math.round(clamp(n, 0, 255))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Undoes the sRGB transfer function, giving light-linear values in 0–1. */
function toLinear(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function fromLinear(linear: number): number {
  const c =
    linear <= 0.0031308
      ? linear * 12.92
      : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return clamp(c * 255, 0, 255);
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * toLinear(rgb.r) +
    0.7152 * toLinear(rgb.g) +
    0.0722 * toLinear(rgb.b)
  );
}

export function rgbToOklch(rgb: Rgb): Oklch {
  const lr = toLinear(rgb.r);
  const lg = toLinear(rgb.g);
  const lb = toLinear(rgb.b);

  // Linear sRGB -> LMS
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  // LMS -> OKLab
  const okL = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const okA = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const okB = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const chroma = Math.sqrt(okA * okA + okB * okB);
  const hue = (Math.atan2(okB, okA) * 180) / Math.PI;

  return { l: okL, c: chroma, h: hue < 0 ? hue + 360 : hue };
}

export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const hRad = (h * Math.PI) / 180;
  const okA = c * Math.cos(hRad);
  const okB = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * okA + 0.2158037573 * okB;
  const m_ = l - 0.1055613458 * okA - 0.0638541728 * okB;
  const s_ = l - 0.0894841775 * okA - 1.291485548 * okB;

  const lms_l = l_ * l_ * l_;
  const lms_m = m_ * m_ * m_;
  const lms_s = s_ * s_ * s_;

  const lr = 4.0767416621 * lms_l - 3.3077115913 * lms_m + 0.2309699292 * lms_s;
  const lg = -1.2684380046 * lms_l + 2.6097574011 * lms_m - 0.3413193965 * lms_s;
  const lb = -0.0041960863 * lms_l - 0.7034186147 * lms_m + 1.707614701 * lms_s;

  return { r: fromLinear(lr), g: fromLinear(lg), b: fromLinear(lb) };
}

/**
 * True when the OKLCH triplet survives a round trip through sRGB. Out-of-gamut
 * colours silently clip on conversion, so a generated ramp has to be checked
 * rather than assumed displayable.
 */
export function isInSrgbGamut({ l, c, h }: Oklch): boolean {
  const hRad = (h * Math.PI) / 180;
  const okA = c * Math.cos(hRad);
  const okB = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * okA + 0.2158037573 * okB;
  const m_ = l - 0.1055613458 * okA - 0.0638541728 * okB;
  const s_ = l - 0.0894841775 * okA - 1.291485548 * okB;

  const lms_l = l_ * l_ * l_;
  const lms_m = m_ * m_ * m_;
  const lms_s = s_ * s_ * s_;

  const linear = [
    4.0767416621 * lms_l - 3.3077115913 * lms_m + 0.2309699292 * lms_s,
    -1.2684380046 * lms_l + 2.6097574011 * lms_m - 0.3413193965 * lms_s,
    -0.0041960863 * lms_l - 0.7034186147 * lms_m + 1.707614701 * lms_s,
  ];

  const epsilon = 0.0001;
  return linear.every((v) => v >= -epsilon && v <= 1 + epsilon);
}

export function formatOklch({ l, c, h }: Oklch): string {
  return `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(1)})`;
}

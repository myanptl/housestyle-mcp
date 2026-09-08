/**
 * The tells that make a generated interface read as generated.
 *
 * Every rule here is deterministic and checkable against stylesheet text. The
 * point is not "this CSS is invalid" — a linter already does that — it is
 * "this CSS is the default a model reaches for when nobody made a decision".
 */

export type Severity = "high" | "medium" | "low";

export interface Finding {
  rule: string;
  severity: Severity;
  evidence: string;
  why: string;
  fix: string;
}

export interface Rule {
  id: string;
  severity: Severity;
  why: string;
  fix: string;
  /** Returns the matched evidence strings, deduped by the caller. */
  detect: (css: string) => string[];
}

const uniq = (values: string[]) => [...new Set(values)];

/**
 * Fonts that are not bad, but are what a model picks when it is not choosing.
 * Inter and Roboto in particular are the visual signature of a default.
 */
const OVERUSED_FONTS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Poppins",
  "Montserrat",
  "Lato",
  "Nunito",
  "Raleway",
];

/**
 * Framework-default blues. Tailwind's blue-500/indigo-500 and Bootstrap's
 * primary account for a striking share of generated interfaces.
 */
const DEFAULT_BLUES: Record<string, string> = {
  "#3b82f6": "Tailwind blue-500",
  "#2563eb": "Tailwind blue-600",
  "#6366f1": "Tailwind indigo-500",
  "#4f46e5": "Tailwind indigo-600",
  "#0ea5e9": "Tailwind sky-500",
  "#007bff": "Bootstrap primary",
  "#1877f2": "Facebook blue",
  "#3498db": "Flat UI 'Peter River'",
};

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Declared values only — ignores selectors and custom-property names. */
function declaredValues(css: string, property: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(`${property.source}\\s*:\\s*([^;{}]+)`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) out.push(match[1].trim());
  return out;
}

export const RULES: Rule[] = [
  {
    id: "default-font-stack",
    severity: "high",
    why: "Inter, Roboto and friends are what a generator reaches for when no typographic decision was made. They are competent and completely anonymous, and readers register that anonymity even when they cannot name it.",
    fix: "Pick a typeface with a point of view and pair it deliberately. Call suggest_fonts for candidates that carry the mood you want without the default signature.",
    detect: (css) => {
      const stacks = declaredValues(css, /font-family/);
      return uniq(
        stacks.flatMap((stack) =>
          OVERUSED_FONTS.filter((font) =>
            new RegExp(`\\b${font}\\b`, "i").test(stack)
          ).map((font) => `font-family: … ${font} …`)
        )
      );
    },
  },
  {
    id: "framework-default-blue",
    severity: "high",
    why: "A framework's stock blue signals that the palette was inherited, not chosen. It is the single fastest way for an interface to look like every other generated interface.",
    fix: "Choose a hue the product actually argues for and build the ramp from it. build_palette generates a perceptually even ramp from any seed.",
    detect: (css) => {
      const found: string[] = [];
      for (const [hex, label] of Object.entries(DEFAULT_BLUES)) {
        if (new RegExp(hex.replace("#", "#?"), "i").test(css)) {
          found.push(`${hex} (${label})`);
        }
      }
      return uniq(found);
    },
  },
  {
    id: "ai-gradient",
    severity: "high",
    why: "The purple-to-pink and blue-to-violet gradient became shorthand for 'an AI made this' during 2024–2025. It reads as decoration applied to fill space rather than to mean anything.",
    fix: "Drop the gradient or replace it with a single surface and real depth — layering, a considered shadow, or a texture that belongs to the product.",
    detect: (css) => {
      const gradients = css.match(/(?:linear|radial|conic)-gradient\([^)]*\)/gi) ?? [];
      const suspect = /(#a855f7|#8b5cf6|#7c3aed|#ec4899|#d946ef|#6366f1|purple|violet|fuchsia|magenta)/i;
      return uniq(
        gradients
          .filter((g) => {
            const hits = g.match(suspect);
            return hits !== null && suspect.test(g);
          })
          .map((g) => (g.length > 80 ? `${g.slice(0, 77)}…` : g))
      );
    },
  },
  {
    id: "uniform-radius",
    severity: "medium",
    why: "One border-radius on every surface flattens the hierarchy. Real design systems vary radius with the size and role of the element — a chip and a modal should not share a corner.",
    fix: "Define at least two or three radius tokens and apply them by element scale.",
    detect: (css) => {
      const values = declaredValues(css, /border-radius/)
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v !== "0" && v !== "0px" && !v.startsWith("var("));
      const distinct = uniq(values);
      if (values.length >= 4 && distinct.length === 1) {
        return [`border-radius: ${distinct[0]} used on ${values.length} rules`];
      }
      return [];
    },
  },
  {
    id: "flat-type-scale",
    severity: "high",
    why: "When the largest heading is barely bigger than body text, nothing leads and the page reads as an undifferentiated wall. Scale contrast is the cheapest hierarchy there is.",
    fix: "Open the ratio up. build_type_scale produces a fluid scale where display sizes genuinely dominate body copy.",
    detect: (css) => {
      const sizes = declaredValues(css, /font-size/)
        .map((v) => /^([\d.]+)rem/.exec(v.trim()))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => parseFloat(m[1]))
        .filter((n) => Number.isFinite(n));
      if (sizes.length < 3) return [];
      const max = Math.max(...sizes);
      const min = Math.min(...sizes);
      if (min > 0 && max / min < 2.2) {
        return [
          `largest ${max}rem vs smallest ${min}rem — only ${(max / min).toFixed(1)}× range`,
        ];
      }
      return [];
    },
  },
  {
    id: "emoji-as-iconography",
    severity: "medium",
    why: "Emoji stand in for an icon set that was never chosen. They render differently on every platform, cannot inherit colour or weight, and read as a placeholder.",
    fix: "Use a real icon set (Lucide, Phosphor) so icons inherit currentColor and stroke weight.",
    detect: (css) => {
      const content = declaredValues(css, /content/);
      const emoji =
        /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F0FF}]/u;
      return uniq(content.filter((v) => emoji.test(v)).map((v) => `content: ${v}`));
    },
  },
  {
    id: "uniform-shadow",
    severity: "low",
    why: "A single shadow reused everywhere gives every element the same elevation, which is the same as having no elevation at all.",
    fix: "Tie shadow depth to how far the surface should sit above the page, and keep the light direction consistent.",
    detect: (css) => {
      const values = declaredValues(css, /box-shadow/)
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v !== "none" && !v.startsWith("var("));
      const distinct = uniq(values);
      if (values.length >= 4 && distinct.length === 1) {
        return [`box-shadow: ${distinct[0]} used on ${values.length} rules`];
      }
      return [];
    },
  },
  {
    id: "everything-centered",
    severity: "medium",
    why: "Centring every block is the default when no layout decision was made. Centred text is also measurably harder to read at paragraph length, because each line starts in a new place.",
    fix: "Centre display type deliberately; set body copy ragged-right against a real measure.",
    detect: (css) => {
      const centered = declaredValues(css, /text-align/).filter(
        (v) => v.trim().toLowerCase() === "center"
      );
      return centered.length >= 4
        ? [`text-align: center on ${centered.length} rules`]
        : [];
    },
  },
  {
    id: "no-measure-limit",
    severity: "medium",
    why: "Body text with no max-width runs the full viewport on a wide screen. Past roughly 75 characters the eye loses the line return and reading speed drops.",
    fix: "Constrain running text to about 60–75 characters (max-width: 65ch) rather than a pixel width.",
    detect: (css) => {
      const hasProse = /\b(p|article|prose|body|\.content)\b/i.test(css);
      const hasCh = /max-width\s*:\s*[\d.]+ch/i.test(css);
      const hasAnyMax = /max-width/i.test(css);
      return hasProse && !hasCh && !hasAnyMax
        ? ["no max-width or ch-based measure found on running text"]
        : [];
    },
  },
  {
    id: "pure-black-on-white",
    severity: "low",
    why: "#000 on #fff is the highest possible contrast and reads as harsh on a lit screen; the halation makes long passages tiring. Almost no considered design uses it.",
    fix: "Pull both ends in — a near-black around oklch(18% …) on an off-white around oklch(98% …).",
    detect: (css) => {
      const hasBlack = /(^|[^0-9a-f])#(000|000000)\b/i.test(css);
      const hasWhite = /(^|[^0-9a-f])#(fff|ffffff)\b/i.test(css);
      return hasBlack && hasWhite ? ["#000 and #fff both present"] : [];
    },
  },
];

export function runRules(rawCss: string): Finding[] {
  const css = stripComments(rawCss);
  const findings: Finding[] = [];

  for (const rule of RULES) {
    const evidence = uniq(rule.detect(css));
    for (const item of evidence) {
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        evidence: item,
        why: rule.why,
        fix: rule.fix,
      });
    }
  }

  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Font selection that deliberately steers away from the defaults.
 *
 * The ranking is not "most popular". Popularity is what produces the anonymous
 * look in the first place, so the very top of the charts is penalised while
 * still requiring enough adoption that the family is safe to ship.
 */

import { type FontFamily, loadCatalog } from "./catalog.js";

/** Families whose presence is itself the tell. */
export const SIGNATURE_DEFAULTS = new Set([
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Nunito",
  "Nunito Sans",
  "Raleway",
  "Source Sans Pro",
  "Ubuntu",
  "Work Sans",
  "Noto Sans",
  "PT Sans",
  "Mulish",
  "Rubik",
  "Karla",
]);

export type Mood =
  | "editorial"
  | "technical"
  | "warm"
  | "brutalist"
  | "elegant"
  | "neutral";

/**
 * Moods map onto Google's own classification tags plus category, so the filter
 * follows the catalogue's vocabulary rather than a hand-written allowlist that
 * would rot as families are added.
 */
const MOOD_FILTERS: Record<
  Mood,
  { categories: string[]; classifications?: string[]; preferSerif?: boolean }
> = {
  editorial: {
    categories: ["Serif", "Display"],
    classifications: ["Transitional", "Old Style", "Didone", "Scotch"],
    preferSerif: true,
  },
  technical: { categories: ["Monospace", "Sans Serif"] },
  warm: {
    categories: ["Serif", "Sans Serif", "Handwriting"],
    classifications: ["Humanist", "Slab", "Old Style"],
  },
  brutalist: {
    categories: ["Display", "Sans Serif", "Monospace"],
    classifications: ["Grotesque", "Industrial"],
  },
  elegant: {
    categories: ["Serif", "Display"],
    classifications: ["Didone", "Transitional"],
    preferSerif: true,
  },
  neutral: { categories: ["Sans Serif", "Serif"] },
};

export interface FontPick {
  family: string;
  category: string;
  weights: number[];
  isVariable: boolean;
  popularityRank: number;
  designers: string[];
  importUrl: string;
  cssStack: string;
}

function fallbackFor(category: string): string {
  switch (category) {
    case "Serif":
      return "Georgia, 'Times New Roman', serif";
    case "Monospace":
      return "ui-monospace, 'SF Mono', Menlo, monospace";
    case "Display":
    case "Handwriting":
      return "Georgia, serif";
    default:
      return "system-ui, -apple-system, sans-serif";
  }
}

function toPick(font: FontFamily): FontPick {
  const weightList = font.weights.length > 0 ? font.weights : [400];
  const spec = font.isVariable
    ? `${font.family.replace(/ /g, "+")}:wght@${weightList[0]}..${weightList[weightList.length - 1]}`
    : `${font.family.replace(/ /g, "+")}:wght@${weightList.join(";")}`;

  return {
    family: font.family,
    category: font.category,
    weights: weightList,
    isVariable: font.isVariable,
    popularityRank: font.popularity,
    designers: font.designers,
    importUrl: `https://fonts.googleapis.com/css2?family=${spec}&display=swap`,
    cssStack: `'${font.family}', ${fallbackFor(font.category)}`,
  };
}

export interface SuggestOptions {
  mood: Mood;
  role: "display" | "body" | "mono";
  limit?: number;
  /** Set false to allow Inter and friends back into the results. */
  excludeDefaults?: boolean;
  /**
   * Overrides the mood's category filter. Pairing uses this to ask for a body
   * face that complements the display face, rather than one that re-matches
   * the mood and therefore lands in the same category.
   */
  categories?: string[];
}

/**
 * The rank this ranking aims at: adopted enough to be safe, not so adopted
 * that using it is itself the default.
 */
const IDEAL_RANK = 130;

/**
 * Scores a family for the requested role. Lower is better.
 *
 * The popularity term is deliberately non-monotonic — the top of the charts is
 * what produces the anonymous look, and the long tail is untested. It is scored
 * on a log scale rather than in bands, because bands put hundreds of families
 * on an identical score and a stable sort then falls back to the catalogue's
 * alphabetical order, which surfaced only families beginning with "A".
 */
function score(font: FontFamily, options: SuggestOptions): number {
  const rank = Math.max(font.popularity, 1);

  // Distance from the ideal in log space, so rank 20 and rank 800 are both
  // penalised without the penalty exploding across ~2,000 families.
  let penalty = Math.abs(Math.log(rank) - Math.log(IDEAL_RANK)) * 12;

  // Being in the very top is a stronger signal of "default" than the symmetric
  // distance alone implies.
  if (rank <= 25) penalty += (26 - rank) * 1.5;

  // Body text needs a usable range of weights; display can carry a single cut.
  if (options.role === "body") {
    if (font.weights.length < 3) penalty += 25;
    if (!font.hasItalic) penalty += 15;
    if (font.weights.length >= 5) penalty -= 5;
  }

  if (font.isVariable) penalty -= 8;

  // A family nobody has vetted is a real risk to ship.
  if (font.designers.length === 0) penalty += 4;

  return penalty;
}

export async function suggestFonts(
  options: SuggestOptions
): Promise<FontPick[]> {
  const catalog = await loadCatalog();
  const limit = Math.min(Math.max(options.limit ?? 6, 1), 20);
  const excludeDefaults = options.excludeDefaults ?? true;
  const filter = MOOD_FILTERS[options.mood];

  const candidates = catalog.filter((font) => {
    if (excludeDefaults && SIGNATURE_DEFAULTS.has(font.family)) return false;
    if (font.weights.length === 0) return false;

    // Script-specific families rank well on adoption because of their reach,
    // but are the wrong answer for a Latin interface. A "latin" subset does not
    // separate them — Noto Sans Thai ships Latin glyphs too — so this keys on
    // primaryScript, which the catalogue leaves empty for Latin-first families.
    if (font.primaryScript !== "") return false;
    if (!font.subsets.includes("latin")) return false;

    if (options.role === "mono") return font.category === "Monospace";
    if (font.category === "Monospace") return false;
    if (options.role === "body" && font.category === "Display") return false;

    const allowedCategories = options.categories ?? filter.categories;
    if (!allowedCategories.includes(font.category)) return false;

    if (
      !options.categories &&
      filter.classifications &&
      filter.classifications.length > 0
    ) {
      const tagged = font.classifications.some((c) =>
        filter.classifications!.some((want) =>
          c.toLowerCase().includes(want.toLowerCase())
        )
      );
      // Classification data is sparse, so treat it as a bonus rather than a gate.
      if (!tagged && font.classifications.length > 0) return false;
    }

    return true;
  });

  return candidates
    .sort((a, b) => score(a, options) - score(b, options))
    .slice(0, limit)
    .map(toPick);
}

export interface Pairing {
  display: FontPick;
  body: FontPick;
  rationale: string;
}

/**
 * The category a body face should come from to contrast with a given display
 * face. Contrast between the two roles is what makes a pairing read as
 * intentional; two similar sans faces read as an accident.
 */
const COMPLEMENT: Record<string, string[]> = {
  Serif: ["Sans Serif"],
  "Sans Serif": ["Serif"],
  Display: ["Sans Serif", "Serif"],
  Monospace: ["Sans Serif"],
  Handwriting: ["Sans Serif", "Serif"],
};

export async function suggestPairing(mood: Mood): Promise<Pairing[]> {
  const displays = await suggestFonts({ mood, role: "display", limit: 6 });

  const pairs: Pairing[] = [];
  // One set for both roles: a family that headlines one pairing and sets body
  // copy in the next makes the list look accidental rather than considered.
  const used = new Set<string>();

  for (const display of displays) {
    if (used.has(display.family)) continue;

    const complementCategories = COMPLEMENT[display.category] ?? ["Sans Serif"];
    const bodies = await suggestFonts({
      mood,
      role: "body",
      limit: 8,
      categories: complementCategories,
    });

    const body = bodies.find(
      (candidate) =>
        candidate.family !== display.family && !used.has(candidate.family)
    );
    if (!body) continue;

    used.add(display.family);
    used.add(body.family);
    pairs.push({
      display,
      body,
      rationale: `${display.family} (${display.category.toLowerCase()}) carries the headline while ${body.family} (${body.category.toLowerCase()}) stays quiet at paragraph size. The change of category is what makes the pairing read as deliberate rather than accidental.`,
    });
    if (pairs.length === 4) break;
  }

  return pairs;
}

/**
 * Google Fonts catalogue, read from the public metadata endpoint the fonts.google.com
 * site itself uses. No API key, and no key ever needs to be configured.
 *
 * The response is a JSON document prefixed with an anti-JSON-hijacking guard,
 * so the leading junk is trimmed before parsing.
 */

const METADATA_URL = "https://fonts.google.com/metadata/fonts";
const FETCH_TIMEOUT_MS = 8000;
/** The catalogue changes on the order of weeks; an hour is plenty. */
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface FontFamily {
  family: string;
  category: string;
  /** Lower is more popular; 1 is the most-used family on Google Fonts. */
  popularity: number;
  weights: number[];
  hasItalic: boolean;
  isVariable: boolean;
  designers: string[];
  classifications: string[];
  subsets: string[];
  /** Empty for Latin-first families; "Thai", "Arab", "Deva", ... otherwise. */
  primaryScript: string;
}

interface CacheEntry {
  families: FontFamily[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

interface RawFont {
  family: string;
  category?: string;
  popularity?: number;
  subsets?: string[];
  primaryScript?: string;
  fonts?: Record<string, unknown>;
  axes?: Array<{ tag: string }>;
  designers?: string[];
  classifications?: string[];
}

function normalise(raw: RawFont): FontFamily {
  const styleKeys = Object.keys(raw.fonts ?? {});
  const weights = [
    ...new Set(
      styleKeys
        .map((key) => parseInt(key.replace(/i$/, ""), 10))
        .filter((n) => Number.isFinite(n))
    ),
  ].sort((a, b) => a - b);

  return {
    family: raw.family,
    category: raw.category ?? "Unknown",
    popularity: raw.popularity ?? Number.MAX_SAFE_INTEGER,
    weights,
    hasItalic: styleKeys.some((key) => key.endsWith("i")),
    isVariable: (raw.axes ?? []).some((axis) => axis.tag === "wght"),
    designers: raw.designers ?? [],
    classifications: raw.classifications ?? [],
    subsets: raw.subsets ?? [],
    primaryScript: raw.primaryScript ?? "",
  };
}

export async function loadCatalog(): Promise<FontFamily[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.families;
  }

  const response = await fetch(METADATA_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Google Fonts metadata request failed with status ${response.status}`
    );
  }

  const text = await response.text();
  const start = text.indexOf("{");
  if (start === -1) throw new Error("Google Fonts metadata was not JSON");

  const parsed = JSON.parse(text.slice(start)) as {
    familyMetadataList?: RawFont[];
  };
  const list = parsed.familyMetadataList ?? [];
  if (list.length === 0) throw new Error("Google Fonts metadata was empty");

  const families = list.map(normalise);
  cache = { families, fetchedAt: Date.now() };
  return families;
}

/** Exposed so tests can run against a fixture without touching the network. */
export function primeCache(families: FontFamily[]): void {
  cache = { families, fetchedAt: Date.now() };
}

export function clearCache(): void {
  cache = null;
}

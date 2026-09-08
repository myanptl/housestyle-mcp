#!/usr/bin/env node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { runRules } from "./audit/rules.js";
import { report as contrastReport } from "./color/contrast.js";
import { buildPalette } from "./color/palette.js";
import { parseColor } from "./color/space.js";
import { type Mood, suggestFonts, suggestPairing } from "./fonts/pairing.js";
import { RATIOS, type RatioName, buildScale, toCssCustomProperties } from "./type/scale.js";

const { version: PKG_VERSION } = createRequire(import.meta.url)(
  "../package.json"
) as { version: string };
export const SERVER_VERSION = PKG_VERSION;

const MOODS: Mood[] = [
  "editorial",
  "technical",
  "warm",
  "brutalist",
  "elegant",
  "neutral",
];

const server = new Server(
  { name: "housestyle-mcp", version: PKG_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "audit_css",
      description:
        "Audit CSS for the tells that make an interface look machine-generated: framework-default blues, Inter/Roboto stacks, purple-pink gradients, flat type scales, uniform radius and shadow, centred everything. Returns findings with the reasoning and a concrete fix. Run this before calling any UI finished.",
      inputSchema: {
        type: "object",
        properties: {
          css: {
            type: "string",
            description:
              "Stylesheet text, a design-token block, or a Tailwind config. Paste the real thing rather than a summary.",
          },
        },
        required: ["css"],
      },
    },
    {
      name: "suggest_fonts",
      description:
        "Suggest Google Fonts for a role and mood, drawn from the live catalogue of ~1,950 families. Deliberately skips the overused defaults (Inter, Roboto, Poppins and similar) that make generated UI look generated.",
      inputSchema: {
        type: "object",
        properties: {
          mood: {
            type: "string",
            enum: MOODS,
            description: "Visual direction to aim for. Defaults to neutral.",
          },
          role: {
            type: "string",
            enum: ["display", "body", "mono"],
            description: "Where the face will be used. Defaults to body.",
          },
          limit: {
            type: "number",
            description: "How many to return, 1-20. Defaults to 6.",
          },
          include_defaults: {
            type: "boolean",
            description:
              "Set true to allow Inter and the other signature defaults back into the results. Defaults to false.",
          },
        },
        required: [],
      },
    },
    {
      name: "suggest_pairing",
      description:
        "Suggest display-and-body font pairings for a mood, pairing across a category boundary so the contrast reads as deliberate. Returns ready-to-use @import URLs and CSS stacks.",
      inputSchema: {
        type: "object",
        properties: {
          mood: {
            type: "string",
            enum: MOODS,
            description: "Visual direction to aim for. Defaults to neutral.",
          },
        },
        required: [],
      },
    },
    {
      name: "check_contrast",
      description:
        "Score a foreground/background pair for readability. Reports the WCAG 2.2 ratio with AA/AAA verdicts and the APCA Lc value, which is the better guide for dark themes where WCAG 2.x passes pairs that are hard to read.",
      inputSchema: {
        type: "object",
        properties: {
          foreground: {
            type: "string",
            description: "Text colour as #rgb, #rrggbb, or rgb(r, g, b).",
          },
          background: {
            type: "string",
            description: "Background colour in the same formats.",
          },
        },
        required: ["foreground", "background"],
      },
    },
    {
      name: "build_palette",
      description:
        "Build a perceptually even colour ramp from one seed colour, in OKLCH. Returns 11 steps with contrast against white and black already computed, plus the CSS custom properties. Use this instead of hand-picking hex values, which produces unevenly spaced ramps.",
      inputSchema: {
        type: "object",
        properties: {
          seed: {
            type: "string",
            description: "Seed colour as #rgb, #rrggbb, or rgb(r, g, b).",
          },
          name: {
            type: "string",
            description:
              "Token name for the generated custom properties. Defaults to 'accent'.",
          },
        },
        required: ["seed"],
      },
    },
    {
      name: "build_type_scale",
      description:
        "Build a fluid modular type scale as clamp() values that interpolate with the viewport instead of stepping at breakpoints. The narrow end uses a gentler ratio so headlines stay readable on a phone.",
      inputSchema: {
        type: "object",
        properties: {
          ratio: {
            type: "string",
            enum: Object.keys(RATIOS),
            description: "Scale ratio. Defaults to perfect-fourth.",
          },
          base_rem: {
            type: "number",
            description: "Body size in rem. Defaults to 1.",
          },
          steps_up: {
            type: "number",
            description: "Steps above body, 0-8. Defaults to 5.",
          },
          steps_down: {
            type: "number",
            description: "Steps below body, 0-2. Defaults to 2.",
          },
          min_viewport_px: {
            type: "number",
            description: "Viewport where the scale stops shrinking. Defaults to 360.",
          },
          max_viewport_px: {
            type: "number",
            description: "Viewport where the scale stops growing. Defaults to 1440.",
          },
        },
        required: [],
      },
    },
  ],
}));

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function requireColor(value: string, label: string) {
  const parsed = parseColor(value);
  if (!parsed) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Could not parse ${label} "${value}". Use #rgb, #rrggbb, or rgb(r, g, b).`
    );
  }
  return parsed;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "audit_css": {
        const { css } = args as { css?: string };
        if (typeof css !== "string" || css.trim() === "") {
          throw new McpError(
            ErrorCode.InvalidParams,
            "audit_css needs a non-empty `css` string."
          );
        }

        const findings = runRules(css);
        if (findings.length === 0) {
          return text(
            "## Design audit\n\nNo generic-design tells found.\n\nThat means none of the deterministic checks fired — the palette is not a framework default, the type scale has real range, and the font stack is not a signature default. It does not certify that the design is good, only that it does not carry the usual machine-generated fingerprints."
          );
        }

        const counts = findings.reduce<Record<string, number>>((acc, f) => {
          acc[f.severity] = (acc[f.severity] ?? 0) + 1;
          return acc;
        }, {});

        const summary = ["high", "medium", "low"]
          .filter((s) => counts[s])
          .map((s) => `${counts[s]} ${s}`)
          .join(", ");

        const blocks = findings.map((f, i) => {
          const marker =
            f.severity === "high" ? "!!" : f.severity === "medium" ? "!" : "·";
          return [
            `### ${i + 1}. ${marker} ${f.rule}`,
            ``,
            `**Found:** \`${f.evidence}\``,
            ``,
            `**Why it matters:** ${f.why}`,
            ``,
            `**Fix:** ${f.fix}`,
          ].join("\n");
        });

        return text(
          [`## Design audit — ${summary}`, ``, ...blocks].join("\n")
        );
      }

      case "suggest_fonts": {
        const {
          mood = "neutral",
          role = "body",
          limit,
          include_defaults,
        } = args as {
          mood?: Mood;
          role?: "display" | "body" | "mono";
          limit?: number;
          include_defaults?: boolean;
        };

        const picks = await suggestFonts({
          mood,
          role,
          limit,
          excludeDefaults: !include_defaults,
        });

        if (picks.length === 0) {
          return text(
            `No families matched mood "${mood}" for role "${role}". Try a different mood, or set include_defaults to true.`
          );
        }

        const rows = picks.map((p, i) =>
          [
            `### ${i + 1}. ${p.family}`,
            `- **Category:** ${p.category}${p.isVariable ? " (variable)" : ""}`,
            `- **Weights:** ${p.weights.join(", ")}`,
            `- **Popularity rank:** ${p.popularityRank}`,
            p.designers.length > 0
              ? `- **Designer:** ${p.designers.join(", ")}`
              : null,
            `- **CSS:** \`font-family: ${p.cssStack};\``,
            `- **Import:** \`${p.importUrl}\``,
          ]
            .filter(Boolean)
            .join("\n")
        );

        return text(
          [
            `## ${role} fonts — ${mood}`,
            ``,
            ...rows,
            ``,
            `_Ranked to avoid both the overexposed top of the charts and the untested long tail. Call check_contrast once you have colours, and audit_css when the stylesheet exists._`,
          ].join("\n\n")
        );
      }

      case "suggest_pairing": {
        const { mood = "neutral" } = args as { mood?: Mood };
        const pairs = await suggestPairing(mood);

        if (pairs.length === 0) {
          return text(
            `Could not build a cross-category pairing for mood "${mood}". Try suggest_fonts for each role separately.`
          );
        }

        const blocks = pairs.map((p, i) =>
          [
            `### ${i + 1}. ${p.display.family} + ${p.body.family}`,
            ``,
            p.rationale,
            ``,
            "```css",
            `@import url('${p.display.importUrl}');`,
            `@import url('${p.body.importUrl}');`,
            ``,
            `:root {`,
            `  --font-display: ${p.display.cssStack};`,
            `  --font-body: ${p.body.cssStack};`,
            `}`,
            "```",
          ].join("\n")
        );

        return text([`## Pairings — ${mood}`, ``, ...blocks].join("\n"));
      }

      case "check_contrast": {
        const { foreground, background } = args as {
          foreground: string;
          background: string;
        };
        const fg = requireColor(foreground, "foreground");
        const bg = requireColor(background, "background");
        const r = contrastReport(fg, bg);

        const verdict =
          r.normalText === "fail"
            ? r.largeText === "fail"
              ? "Fails WCAG at every text size."
              : "Fails for body text; passes for large text only."
            : `Passes WCAG ${r.normalText} for body text.`;

        return text(
          [
            `## Contrast — ${foreground} on ${background}`,
            ``,
            `**WCAG 2.2 ratio:** ${r.ratio.toFixed(2)}:1`,
            `- Normal text (< 18.66px): **${r.normalText}**`,
            `- Large text (>= 18.66px bold, or 24px): **${r.largeText}**`,
            ``,
            `**APCA Lc:** ${r.apcaLc.toFixed(1)} — ${r.apcaVerdict}`,
            ``,
            verdict,
            ``,
            `_APCA is reported because WCAG 2.x systematically misjudges dark themes: it will pass light-on-dark pairs that are genuinely hard to read. Where the two disagree on a dark background, trust APCA._`,
          ].join("\n")
        );
      }

      case "build_palette": {
        const { seed, name: tokenName = "accent" } = args as {
          seed: string;
          name?: string;
        };
        if (typeof seed !== "string") {
          throw new McpError(
            ErrorCode.InvalidParams,
            "build_palette needs a `seed` colour."
          );
        }

        const palette = buildPalette(seed, tokenName);
        const rows = palette.swatches.map(
          (s) =>
            `| ${s.step} | \`${s.hex}\` | \`${s.oklch}\` | ${s.onWhite.toFixed(2)}:1 | ${s.onBlack.toFixed(2)}:1 |`
        );

        return text(
          [
            `## Palette from ${palette.seedHex}`,
            ``,
            `Seed in OKLCH: \`${palette.seedOklch}\``,
            ``,
            `| Step | Hex | OKLCH | On white | On black |`,
            `|------|-----|-------|----------|----------|`,
            ...rows,
            ``,
            "```css",
            palette.css,
            "```",
            ``,
            ...palette.notes.map((n) => `- ${n}`),
          ].join("\n")
        );
      }

      case "build_type_scale": {
        const {
          ratio = "perfect-fourth",
          base_rem,
          steps_up,
          steps_down,
          min_viewport_px,
          max_viewport_px,
        } = args as {
          ratio?: RatioName;
          base_rem?: number;
          steps_up?: number;
          steps_down?: number;
          min_viewport_px?: number;
          max_viewport_px?: number;
        };

        if (!(ratio in RATIOS)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Unknown ratio "${ratio}". Use one of: ${Object.keys(RATIOS).join(", ")}.`
          );
        }

        const steps = buildScale({
          ratio,
          baseRem: base_rem,
          stepsUp: steps_up,
          stepsDown: steps_down,
          minViewportPx: min_viewport_px,
          maxViewportPx: max_viewport_px,
        });

        const rows = steps.map(
          (s) =>
            `| \`--text-${s.name}\` | ${s.minRem}rem | ${s.maxRem}rem | \`${s.clamp}\` |`
        );

        return text(
          [
            `## Type scale — ${ratio} (${RATIOS[ratio]})`,
            ``,
            `| Token | Min | Max | Fluid value |`,
            `|-------|-----|-----|-------------|`,
            ...rows,
            ``,
            "```css",
            toCssCustomProperties(steps),
            "```",
            ``,
            `_The narrow end uses a gentler ratio than the wide end, because a single ratio applied at 360px overshoots and headlines wrap badly._`,
          ].join("\n")
        );
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, detail);
  }
});

export async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`housestyle-mcp ${PKG_VERSION} ready\n`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`Fatal: ${error}\n`);
    process.exit(1);
  });
}

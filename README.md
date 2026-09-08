# housestyle-mcp

An MCP server that stops AI-built interfaces from looking AI-built.

Agents are good at producing working UI and bad at producing UI that looks like
somebody decided something. The result has a recognisable fingerprint: Inter on
a Tailwind blue, a purple-to-pink gradient, one border radius everywhere, and a
type scale where the headline is barely larger than the body text.

This server gives an agent the tools to notice that and fix it.

**No API key.** Colour and type maths runs locally; font data comes from Google
Fonts' public metadata endpoint. Nothing to configure, nothing to sign up for.

## Install

```bash
npx housestyle-mcp
```

### Claude Code

```bash
claude mcp add housestyle -- npx -y housestyle-mcp
```

### Claude Desktop / any MCP client

```json
{
  "mcpServers": {
    "housestyle": {
      "command": "npx",
      "args": ["-y", "housestyle-mcp"]
    }
  }
}
```

## Tools

### `audit_css`

Paste a stylesheet, token block, or Tailwind config. Returns the generic-design
tells it found, why each one matters, and what to do instead.

```
## Design audit — 4 high, 3 medium, 1 low

### 1. !! framework-default-blue

**Found:** `#3b82f6 (Tailwind blue-500)`

**Why it matters:** A framework's stock blue signals that the palette was
inherited, not chosen. It is the single fastest way for an interface to look
like every other generated interface.

**Fix:** Choose a hue the product actually argues for and build the ramp from
it. build_palette generates a perceptually even ramp from any seed.
```

Ten rules, all deterministic: default font stacks, framework blues, the AI
gradient, uniform radius, uniform shadow, flat type scale, emoji used as icons,
wholesale centring, missing measure limit, and pure black on pure white.

A clean audit is not a claim that the design is good — only that it does not
carry the usual fingerprints.

### `suggest_fonts` / `suggest_pairing`

Reads the live Google Fonts catalogue (~1,950 families) and ranks for a role and
mood — `editorial`, `technical`, `warm`, `brutalist`, `elegant`, `neutral`.

The ranking is deliberately **not** "most popular". Popularity is what produces
the anonymous look, so the top of the charts is penalised, the long tail is
penalised for being untested, and the middle is preferred. Inter, Roboto,
Poppins and thirteen other signature defaults are excluded unless you ask for
them. Script-specific families are filtered out for Latin interfaces.

`suggest_pairing` pairs across a category boundary, because the change of
category is what makes a pairing read as deliberate. Returns ready-to-paste
`@import` URLs and CSS custom properties.

### `check_contrast`

WCAG 2.2 ratio with AA/AAA verdicts, plus the APCA Lc value.

Both are reported because WCAG 2.x systematically misjudges dark themes — it
will pass light-on-dark pairs that are genuinely hard to read. Where the two
disagree on a dark background, trust APCA.

### `build_palette`

An 11-step ramp from one seed colour, computed in OKLCH.

OKLCH rather than HSL because HSL lightness is not perceptual: at a fixed HSL
lightness, yellow reads far brighter than blue, so an HSL ramp produces steps
that look unevenly spaced. Chroma is tapered toward both ends and every step is
fitted back into the sRGB gamut, so no step silently clips. Contrast against
white and black is computed for each step.

### `build_type_scale`

A fluid modular scale emitted as `clamp()`, so sizes interpolate with the
viewport instead of stepping at breakpoints.

The narrow end uses a gentler ratio than the wide end, because a single ratio
applied at 360px overshoots and headlines wrap badly. Body size stays fixed —
only display sizes scale.

## Design

- **Zero runtime dependencies** beyond the MCP SDK. The colour maths is fixed by
  specification, so it is written out rather than pulled from a package that
  could drift or carry a supply chain.
- **Nothing to break.** The only network call is the Google Fonts metadata
  endpoint, cached for an hour, and every other tool is pure computation.

## Development

```bash
npm install
npm run build
npm test
```

## Licence

MIT

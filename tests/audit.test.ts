import { describe, expect, it } from "vitest";

import { runRules } from "../src/audit/rules.js";

const ruleIds = (css: string) => runRules(css).map((f) => f.rule);

describe("default-font-stack", () => {
  it("flags Inter", () => {
    expect(ruleIds("body { font-family: Inter, sans-serif; }")).toContain(
      "default-font-stack"
    );
  });

  it("does not flag a deliberate choice", () => {
    expect(
      ruleIds("body { font-family: 'Instrument Serif', Georgia, serif; }")
    ).not.toContain("default-font-stack");
  });

  it("does not fire on a word merely containing a font name", () => {
    // "Interstate" contains "Inter" but is a different typeface.
    expect(
      ruleIds("body { font-family: Interstate, sans-serif; }")
    ).not.toContain("default-font-stack");
  });
});

describe("framework-default-blue", () => {
  it("flags Tailwind blue-500", () => {
    expect(ruleIds(".btn { background: #3b82f6; }")).toContain(
      "framework-default-blue"
    );
  });

  it("is case insensitive", () => {
    expect(ruleIds(".btn { background: #3B82F6; }")).toContain(
      "framework-default-blue"
    );
  });

  it("leaves an unrelated blue alone", () => {
    expect(ruleIds(".btn { background: #1b3a5c; }")).not.toContain(
      "framework-default-blue"
    );
  });
});

describe("ai-gradient", () => {
  it("flags the purple-to-pink gradient", () => {
    expect(
      ruleIds(".hero { background: linear-gradient(90deg, #8b5cf6, #ec4899); }")
    ).toContain("ai-gradient");
  });

  it("leaves a restrained single-hue gradient alone", () => {
    expect(
      ruleIds(".hero { background: linear-gradient(180deg, #1b3a5c, #0f2438); }")
    ).not.toContain("ai-gradient");
  });
});

describe("uniform-radius", () => {
  it("flags one radius repeated across many rules", () => {
    const css = [".a", ".b", ".c", ".d"]
      .map((s) => `${s} { border-radius: 8px; }`)
      .join("\n");
    expect(ruleIds(css)).toContain("uniform-radius");
  });

  it("accepts a varied radius system", () => {
    const css = `
      .chip { border-radius: 4px; }
      .card { border-radius: 12px; }
      .modal { border-radius: 20px; }
      .avatar { border-radius: 999px; }`;
    expect(ruleIds(css)).not.toContain("uniform-radius");
  });

  it("ignores token indirection rather than reporting a false positive", () => {
    const css = [".a", ".b", ".c", ".d"]
      .map((s) => `${s} { border-radius: var(--radius); }`)
      .join("\n");
    expect(ruleIds(css)).not.toContain("uniform-radius");
  });
});

describe("flat-type-scale", () => {
  it("flags a scale with almost no range", () => {
    const css = `
      body { font-size: 1rem; }
      h2 { font-size: 1.2rem; }
      h1 { font-size: 1.5rem; }`;
    expect(ruleIds(css)).toContain("flat-type-scale");
  });

  it("accepts a scale with real contrast", () => {
    const css = `
      body { font-size: 1rem; }
      h2 { font-size: 2rem; }
      h1 { font-size: 4rem; }`;
    expect(ruleIds(css)).not.toContain("flat-type-scale");
  });

  it("stays quiet when there are too few sizes to judge", () => {
    expect(ruleIds("body { font-size: 1rem; }")).not.toContain(
      "flat-type-scale"
    );
  });
});

describe("pure-black-on-white", () => {
  it("flags #000 with #fff", () => {
    expect(ruleIds("body { color: #000; background: #fff; }")).toContain(
      "pure-black-on-white"
    );
  });

  it("does not fire on a near-black that merely contains the digits", () => {
    // #10001a must not be read as #000.
    expect(
      ruleIds("body { color: #10001a; background: #fafaf8; }")
    ).not.toContain("pure-black-on-white");
  });
});

describe("everything-centered", () => {
  it("flags centring applied wholesale", () => {
    const css = [".a", ".b", ".c", ".d"]
      .map((s) => `${s} { text-align: center; }`)
      .join("\n");
    expect(ruleIds(css)).toContain("everything-centered");
  });

  it("accepts centring used sparingly", () => {
    expect(ruleIds(".hero { text-align: center; }")).not.toContain(
      "everything-centered"
    );
  });
});

describe("runRules", () => {
  it("ignores anything inside a comment", () => {
    expect(ruleIds("/* font-family: Inter; background: #3b82f6; */")).toEqual(
      []
    );
  });

  it("sorts high severity first", () => {
    const css = `
      body { font-family: Inter; color: #000; background: #fff; }
      .btn { background: #3b82f6; }`;
    const severities = runRules(css).map((f) => f.severity);
    const firstLow = severities.indexOf("low");
    const lastHigh = severities.lastIndexOf("high");
    if (firstLow !== -1 && lastHigh !== -1) {
      expect(lastHigh).toBeLessThan(firstLow);
    }
  });

  it("returns nothing for a deliberately designed stylesheet", () => {
    const css = `
      :root {
        --font-display: 'Instrument Serif', Georgia, serif;
        --ink: oklch(18% 0.01 60);
        --paper: oklch(98% 0.005 90);
        --radius-sm: 3px;
        --radius-lg: 14px;
      }
      body { font-family: var(--font-display); font-size: 1rem; max-width: 68ch; }
      h1 { font-size: 4.2rem; }
      h2 { font-size: 2.1rem; }`;
    expect(runRules(css)).toEqual([]);
  });

  it("gives every finding a why and a fix, not just a label", () => {
    for (const finding of runRules("body { font-family: Inter; }")) {
      expect(finding.why.length).toBeGreaterThan(40);
      expect(finding.fix.length).toBeGreaterThan(20);
      expect(finding.evidence).not.toBe("");
    }
  });
});

import { describe, expect, it } from "vitest";

import { RATIOS, buildScale, toCssCustomProperties } from "../src/type/scale.js";

/**
 * Evaluates a clamp() at a given viewport width, the way a browser would.
 * Deliberately strict: it only accepts syntax a browser would also accept, so
 * a malformed expression fails the test rather than being silently coerced.
 */
function evaluateClamp(expression: string, viewportPx: number): number {
  const plain = /^(-?[\d.]+)rem$/.exec(expression);
  if (plain) return parseFloat(plain[1]);

  const match =
    /^clamp\(\s*(-?[\d.]+)rem,\s*(?:(-?[\d.]+)rem\s*([+-])\s*)?([\d.]+)vw,\s*(-?[\d.]+)rem\s*\)$/.exec(
      expression
    );
  if (!match) throw new Error(`Unparseable or invalid clamp: ${expression}`);

  const lower = parseFloat(match[1]);
  const intercept = match[2] ? parseFloat(match[2]) : 0;
  const vwMagnitude = parseFloat(match[4]);
  const vw = match[2]
    ? match[3] === "-"
      ? -vwMagnitude
      : vwMagnitude
    : vwMagnitude;
  const upper = parseFloat(match[5]);

  if (lower > upper) {
    throw new Error(`clamp lower bound exceeds upper bound: ${expression}`);
  }

  const preferred = intercept + (vw / 100) * (viewportPx / 16);
  return Math.min(Math.max(preferred, lower), upper);
}

describe("buildScale", () => {
  it("puts base in the middle with the requested number of steps either side", () => {
    const steps = buildScale({ stepsUp: 4, stepsDown: 2 });
    expect(steps).toHaveLength(7);
    expect(steps[2].name).toBe("base");
    expect(steps.map((s) => s.name)).toEqual([
      "xs",
      "sm",
      "base",
      "md",
      "lg",
      "xl",
      "2xl",
    ]);
  });

  it("keeps base fixed rather than making body text fluid", () => {
    // Fluid body copy is a common mistake; only display sizes should scale.
    const base = buildScale().find((s) => s.name === "base")!;
    expect(base.clamp).toBe("1rem");
    expect(base.minRem).toBe(1);
    expect(base.maxRem).toBe(1);
  });

  it("increases monotonically", () => {
    const steps = buildScale({ stepsUp: 5, stepsDown: 2 });
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].maxRem).toBeGreaterThan(steps[i - 1].maxRem);
      expect(steps[i].minRem).toBeGreaterThan(steps[i - 1].minRem);
    }
  });

  it("applies the requested ratio at the wide end", () => {
    const steps = buildScale({ ratio: "golden", stepsUp: 1, stepsDown: 0 });
    const base = steps.find((s) => s.name === "base")!;
    const md = steps.find((s) => s.name === "md")!;
    expect(md.maxRem / base.maxRem).toBeCloseTo(RATIOS.golden, 2);
  });

  it("is gentler at the narrow end so headlines survive a phone", () => {
    const steps = buildScale({ ratio: "golden", stepsUp: 3 });
    const top = steps[steps.length - 1];
    expect(top.minRem).toBeLessThan(top.maxRem);
  });

  it("produces clamp values that actually resolve to the stated bounds", () => {
    // The real test of the fluid maths: at the min viewport the clamp must
    // evaluate to minRem, and at the max viewport to maxRem.
    const steps = buildScale({
      stepsUp: 5,
      stepsDown: 2,
      minViewportPx: 360,
      maxViewportPx: 1440,
    });

    for (const step of steps) {
      expect(evaluateClamp(step.clamp, 360)).toBeCloseTo(step.minRem, 2);
      expect(evaluateClamp(step.clamp, 1440)).toBeCloseTo(step.maxRem, 2);
    }
  });

  it("clamps below and above the viewport range instead of running away", () => {
    const step = buildScale({ stepsUp: 3 }).find((s) => s.name === "xl")!;
    expect(evaluateClamp(step.clamp, 200)).toBeCloseTo(step.minRem, 2);
    expect(evaluateClamp(step.clamp, 3000)).toBeCloseTo(step.maxRem, 2);
  });

  it("degenerates safely when the viewport range is inverted", () => {
    const steps = buildScale({ minViewportPx: 1440, maxViewportPx: 360 });
    for (const step of steps) {
      expect(step.clamp).not.toContain("NaN");
      expect(step.clamp).not.toContain("Infinity");
    }
  });

  it("honours bounds on step counts", () => {
    expect(buildScale({ stepsUp: 99, stepsDown: 99 }).length).toBeLessThanOrEqual(
      11
    );
    expect(buildScale({ stepsUp: -5, stepsDown: -5 })).toHaveLength(1);
  });
});

describe("toCssCustomProperties", () => {
  it("emits one custom property per step", () => {
    const css = toCssCustomProperties(buildScale({ stepsUp: 2, stepsDown: 1 }));
    expect(css).toContain("--text-base:");
    expect(css).toContain("--text-md:");
    expect(css).toContain("--text-sm:");
    expect(css.split("\n")).toHaveLength(6);
  });
});

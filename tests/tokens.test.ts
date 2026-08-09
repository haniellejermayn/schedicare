import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cssVars, neutral, tone } from "../design/tokens";

const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");

/** The `:root { ... }` block at the top of globals.css, parsed into a map. */
function parseRootVars(source: string): Record<string, string> {
  const block = source.match(/:root\s*\{([\s\S]*?)\}/);
  if (!block) throw new Error("globals.css has no :root block");
  const out: Record<string, string> = {};
  for (const line of block[1].split(";")) {
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Whitespace-insensitive: a CSS formatter is free to expand `rgba(15,27,45,.06)`
 * into `rgba(15, 27, 45, .06)`, and that is not drift.
 */
const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, "");

describe("design tokens", () => {
  const rootVars = parseRootVars(css);

  it("globals.css mirrors design/tokens.ts exactly", () => {
    // The previous system carried three different values for "amber" across
    // globals.css, tailwind.config.ts and app/doctor/page.tsx. This test is
    // the thing that stops that happening again.
    const drift: string[] = [];
    for (const [name, value] of Object.entries(cssVars)) {
      const actual = rootVars[name];
      if (actual === undefined) {
        drift.push(`${name}: missing from globals.css (expected ${value})`);
      } else if (norm(actual) !== norm(value)) {
        drift.push(`${name}: css has ${actual}, tokens.ts has ${value}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it("does not reintroduce the retired Atlas hue names", () => {
    // The old system named hues after their colour (--teal, --moss, --clay),
    // which is how the same tone ended up with different values in different
    // files. Names are semantic now; reintroducing a colour name is the first
    // step back toward drift.
    for (const legacy of ["--teal", "--moss", "--amber", "--clay", "--navy"]) {
      expect(rootVars[legacy], `${legacy} is retired — use a semantic token`)
        .toBeUndefined();
    }
  });

  it("defines every semantic token the stylesheet needs", () => {
    // Guards the reverse direction: a CSS var used by a component but never
    // declared silently resolves to nothing.
    const declared = new Set(Object.keys(rootVars));
    const used = new Set(
      [...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]),
    );
    const undeclared = [...used].filter(
      (v) => !declared.has(v) && !v.startsWith("--font-"),
    );
    expect(undeclared).toEqual([]);
  });
});

/* ------------------------------------------------------------- contrast */

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return (
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = neutral.surface;
const CANVAS = neutral.canvas;

describe("palette accessibility", () => {
  // The old system used raw hues as text: moss measured 3.94:1 and amber
  // 3.36:1 on white, both under AA, while DESIGN.md claimed otherwise.
  it.each(Object.entries(tone))(
    "%s DEFAULT clears AA as text on white and on canvas",
    (_name, t) => {
      expect(contrast(t.DEFAULT, WHITE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.DEFAULT, CANVAS)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(Object.entries(tone))(
    "%s DEFAULT clears AA with white text on top (solid buttons)",
    (_name, t) => {
      expect(contrast(WHITE, t.DEFAULT)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(Object.entries(tone))(
    "%s rail clears 3:1 graphical contrast on canvas",
    (_name, t) => {
      expect(contrast(t.rail, CANVAS)).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(Object.entries(tone))(
    "%s chip text clears AA on its own soft fill",
    (_name, t) => {
      expect(contrast(t.DEFAULT, t.soft)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([
    ["ink", neutral.ink],
    ["inkSoft", neutral.inkSoft],
    ["muted", neutral.muted],
  ])("neutral %s clears AA on canvas", (_name, value) => {
    expect(contrast(value, CANVAS)).toBeGreaterThanOrEqual(4.5);
  });
});

import { Inter, IBM_Plex_Mono } from "next/font/google";

/**
 * Fonts are self-hosted at build time rather than pulled from the Google Fonts
 * CDN at render time. The previous `@import url(...)` in globals.css meant a
 * flaky network on presentation day would silently fall back to system-ui and
 * reflow every screen mid-demo.
 *
 * Inter carries the UI: it holds up at 12-13px, has real tabular numerals, and
 * projects cleanly. IBM Plex Mono stays for the technical register — timestamps,
 * IDs, tool-call traces, the "Technical detail" toggle.
 */
export const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  // cv11 = single-storey 'a' in numerals context; ss01 tightens punctuation.
  // tnum is applied per-element via the .tnum utility, not globally.
  axes: ["opsz"],
});

export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

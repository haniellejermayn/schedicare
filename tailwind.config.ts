import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F7F8FA",
        line: "#E4E7EC",
        ink: "#101828",
        muted: "#667085",
        accent: { DEFAULT: "#1D4ED8", soft: "#EFF4FF", line: "#C7D7FE" },
        ok: { DEFAULT: "#15803D", soft: "#EFFAF3", line: "#C6EED6" },
        warn: { DEFAULT: "#B45309", soft: "#FFF8EB", line: "#F5E1B8" },
        bad: { DEFAULT: "#B91C1C", soft: "#FEF1F1", line: "#F5C6C6" },
      },
      borderRadius: { card: "12px", ctl: "8px" },
      keyframes: {
        rise: { "0%": { opacity: "0", transform: "translateY(4px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        pop: { "0%": { opacity: "0", transform: "scale(0.98)" }, "100%": { opacity: "1", transform: "scale(1)" } },
      },
      animation: { rise: "rise 160ms ease-out both", pop: "pop 140ms ease-out both" },
    },
  },
  plugins: [],
} satisfies Config;

import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        scd: {
          primary: "#5B2FCE",
          deep: "#3D2A8C",
          lavender: "#EDE8FF",
          bg: "#F4F2FB",
          ink: "#241A4A",
          muted: "#6E6590",
          success: "#18A06A",
          warning: "#B5791F",
          danger: "#C0392B",
          info: "#2F6FCE",
          chip: "#F1EFF8",
          line: "#E4DFF3",
        },
      },
      borderRadius: {
        card: "18px",
        panel: "20px",
        hero: "30px",
        pill: "999px",
      },
      boxShadow: {
        ambient: "0 10px 30px rgba(45,27,90,0.05)",
        floating: "0 24px 60px rgba(45,27,90,0.14)",
        glow: "0 8px 20px rgba(91,47,206,0.3)",
      },
      keyframes: {
        "scd-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scd-pop": {
          "0%": { transform: "scale(0.96)", opacity: "0" },
          "60%": { transform: "scale(1.02)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "scd-blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "scd-in": "scd-in 350ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "scd-pop": "scd-pop 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "scd-blink": "scd-blink 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;

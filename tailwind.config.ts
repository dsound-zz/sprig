import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["var(--font-geist-mono)", "DM Mono", "monospace"],
      },
      colors: {
        canvas: {
          light: "#FAFAF8",
          dark: "#111110",
        },
        ring: {
          light: "#A8A49E",
          dark: "#5A5A56",
          selected: {
            light: "#5C5955",
            dark: "#AAAAA4"
          },
        },
      },
      keyframes: {
        "ghost-pulse": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "0.8" },
        },
      },
      animation: {
        "ghost-pulse": "ghost-pulse 1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;

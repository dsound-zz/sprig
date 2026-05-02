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
          light: "#CCCAC4",
          dark: "#3A3A38",
          selected: "#888880",
        },
      },
    },
  },
  plugins: [],
};
export default config;

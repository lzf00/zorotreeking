import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}"],
  darkMode: "class",
  plugins: [typography],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui", '"PingFang SC"', '"Hiragino Sans GB"', "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", '"SF Mono"', "Menlo", "Consolas", "monospace"],
      },
      colors: {
        section: {
          ai: "#2563eb",
          invest: "#dc2626",
          photo: "#7c3aed",
          hike: "#16a34a",
        },
      },
      maxWidth: {
        prose: "68ch",
      },
    },
  },
};

import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}"],
  darkMode: "class",
  plugins: [typography],
  theme: {
    extend: {
      fontFamily: {
        // 正文（无衬线，带中文回退）
        sans: ['"Inter"', "ui-sans-serif", "system-ui", '"PingFang SC"', '"Hiragino Sans GB"', "sans-serif"],
        // 大标题 / 装饰用衬线（editorial 风）
        serif: ['"Instrument Serif"', "ui-serif", "Georgia", '"Songti SC"', '"STSong"', "serif"],
        // 代码 / 数字
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", '"SF Mono"', "Menlo", "monospace"],
      },
      colors: {
        // 染料色：比原来更沉一档，更"墨色"
        section: {
          ai: "#1d4ed8",      // royal blue
          invest: "#991b1b",  // oxblood
          photo: "#6b21a8",   // violet ink
          hike: "#166534",    // forest
        },
      },
      maxWidth: {
        prose: "68ch",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fade: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        rise: "rise 0.8s cubic-bezier(.22,.61,.36,1) both",
        fade: "fade 1.2s ease-out both",
      },
    },
  },
};

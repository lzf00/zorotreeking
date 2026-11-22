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
        sans: ['"Inter"', '"Inter Fallback"', "ui-sans-serif", "system-ui", '"PingFang SC"', '"Hiragino Sans GB"', "sans-serif"],
        // 大标题 / 装饰用衬线（editorial 风）
        serif: [
          '"Instrument Serif"',
          // Times/Georgia 标定（84.3%）：macOS / 有 Times 的环境命中这条
          '"Instrument Serif Fallback"',
          // 只有 DejaVu Serif 的环境（Linux runner）命中这条：65.1% 是 CI 实测值
          '"DejaVu Serif Fallback"',
          "ui-serif", "Georgia", '"Songti SC"', '"STSong"', "serif",
        ],
        // 代码 / 数字
        mono: [
          '"JetBrains Mono"',
          // 兜底也要挂上：Linux 上没有任何 local() 命中时，行盒会从 1.32em 掉到 1.164em，
          // 字体到货后整张表长高 13%（第 148 轮 /invest/market/ CLS 0.223 的成因）
          '"JetBrains Mono Fallback"',
          "ui-monospace", "SFMono-Regular", '"SF Mono"', "Menlo", "monospace",
        ],
      },
      colors: {
        // 染料色：比原来更沉一档，更"墨色"
        // 深色模式要换成同色系亮一档（见 global.css 的 --section-*-rgb）：
        // 这几个墨色在 #0a0a0a 上只有 2.3–3.0:1，暗色主题下根本读不出来。
        section: {
          ai: "rgb(var(--section-ai-rgb) / <alpha-value>)",
          invest: "rgb(var(--section-invest-rgb) / <alpha-value>)",
          photo: "rgb(var(--section-photo-rgb) / <alpha-value>)",
          hike: "rgb(var(--section-hike-rgb) / <alpha-value>)",
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

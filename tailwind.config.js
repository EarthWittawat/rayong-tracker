/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // claude.ai-inspired warm neutrals
        bg:        "#FAF9F7",
        surface:   "#FFFFFF",
        surface2:  "#F4F2EE",
        border:    "#E7E4DD",
        border2:   "#D9D5CC",
        ink:       "#1F1E1B",
        muted:     "#6B6862",
        muted2:    "#9A968D",
        // accents (kept restrained)
        accent:    "#C96442",   // warm rust — Claude's signature
        accent2:   "#E8A88D",
        good:      "#3F7D58",
        warn:      "#B68A2E",
        crit:      "#B14B3D",
        info:      "#3F6E97",
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Inter', 'sans-serif'],
        serif: ['ui-serif', 'Georgia', 'Cambria', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: "0 1px 0 rgba(31,30,27,0.04), 0 1px 2px rgba(31,30,27,0.04)",
        cardHover: "0 4px 14px -4px rgba(31,30,27,0.08), 0 2px 4px rgba(31,30,27,0.04)",
      },
      borderRadius: {
        xl2: "14px",
      },
    },
  },
  plugins: [],
};

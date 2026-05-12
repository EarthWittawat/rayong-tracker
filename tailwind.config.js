/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg:        "rgb(var(--c-bg)        / <alpha-value>)",
        surface:   "rgb(var(--c-surface)   / <alpha-value>)",
        surface2:  "rgb(var(--c-surface2)  / <alpha-value>)",
        border:    "rgb(var(--c-border)    / <alpha-value>)",
        border2:   "rgb(var(--c-border2)   / <alpha-value>)",
        ink:       "rgb(var(--c-ink)       / <alpha-value>)",
        muted:     "rgb(var(--c-muted)     / <alpha-value>)",
        muted2:    "rgb(var(--c-muted2)    / <alpha-value>)",
        accent:    "rgb(var(--c-accent)    / <alpha-value>)",
        accent2:   "rgb(var(--c-accent2)   / <alpha-value>)",
        good:      "rgb(var(--c-good)      / <alpha-value>)",
        warn:      "rgb(var(--c-warn)      / <alpha-value>)",
        crit:      "rgb(var(--c-crit)      / <alpha-value>)",
        info:      "rgb(var(--c-info)      / <alpha-value>)",
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Inter', 'sans-serif'],
        serif: ['ui-serif', 'Georgia', 'Cambria', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: "0 1px 0 rgb(var(--c-shadow) / 0.04), 0 1px 2px rgb(var(--c-shadow) / 0.04)",
        cardHover: "0 4px 14px -4px rgb(var(--c-shadow) / 0.10), 0 2px 4px rgb(var(--c-shadow) / 0.04)",
      },
      borderRadius: {
        xl2: "14px",
      },
    },
  },
  plugins: [],
};

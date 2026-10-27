import animate from 'tailwindcss-animate'

// Colors come from the CSS variables in src/index.css (HSL triplets), so one edit there
// changes the whole app and `bg-primary/10`-style opacity still works.
const token = (name) => `hsl(var(--${name}) / <alpha-value>)`
// A status color: the strong one (icons, solid backgrounds), a soft background, its border and
// the readable ink for text on the soft background
const tone = (name) => ({
  DEFAULT: token(name),
  soft: token(`${name}-soft`),
  line: token(`${name}-line`),
  ink: token(`${name}-ink`),
})

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: token('primary'), ink: token('primary-ink') },
        secondary: token('secondary'),
        success: tone('success'),
        warning: tone('warning'),
        danger: tone('danger'),
        info: tone('info'),
        neutral: tone('neutral'),
      },
      borderRadius: {
        card: 'var(--radius-card)',
        control: 'var(--radius-control)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
      },
    },
  },
  plugins: [animate],
}

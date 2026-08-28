/**
 * Static Tailwind build config — replaces the cdn.tailwindcss.com Play CDN.
 *
 * `content` scans index.html (the single source-of-truth app file), so every
 * Tailwind class actually used in the app gets included in the static
 * stylesheet. The `colors` block is copied verbatim from the old inline
 * `tailwind.config` that used to live in index.html, so the custom palette is
 * unchanged.
 *
 * `safelist` is a seatbelt: these custom-colour utilities are always emitted
 * even if the scanner ever fails to spot them. (A pre-build audit found NO
 * dynamically-constructed Tailwind classes — e.g. no `bg-${x}-500` — so this
 * is belt-and-braces, not strictly required.)
 */
module.exports = {
  content: ['./index.html'],
  // iOS Phase A's hover gate, which lived ONLY in index.html's inline config
  // (the web app's Play CDN) and never reached this one. Without it the static
  // stylesheet emits every `hover:*` utility ungated, so on iOS — where a tap
  // sets :hover and leaves it set until the next touch lands elsewhere — the
  // last thing tapped stays in its hover colour. On a solid-fill button that
  // reads as the button going pale: `hover:bg-sky-300` is a LIGHTER tint than
  // the `bg-sky-500` beneath it. theme-parity's CONFIG PARITY assertion now
  // covers this block as well as the palette, so the two configs cannot drift
  // on a non-colour key again.
  future: { hoverOnlyWhenSupported: true },
  safelist: [
    'bg-tm-warn', 'bg-tm-pen', 'bg-tm-good', 'bg-tm-kit', 'bg-tm-card-2',
    'text-tm-warn', 'text-tm-pen', 'text-tm-good', 'text-tm-kit',
    'border-tm-warn', 'border-tm-pen', 'border-tm-good', 'border-tm-kit',
  ],
  theme: {
    extend: {
      // Stage-1 theme refactor: every palette colour resolves through a CSS
      // variable defined in index.html's :root (channel triplets, hex noted
      // per line there). The <alpha-value> placeholder keeps every
      // opacity-modified utility compositing exactly as before. This block
      // MUST stay a verbatim copy of the inline tailwind.config in
      // index.html — audit:theme enforces the lockstep. Stock families not
      // listed (red/amber/orange/green error+success states, white/black
      // scrims) are deliberately outside the theme system and stay fixed.
      colors: {
        neutral: {
          100: 'rgb(var(--tm-neutral-100) / <alpha-value>)',
          200: 'rgb(var(--tm-neutral-200) / <alpha-value>)',
          300: 'rgb(var(--tm-neutral-300) / <alpha-value>)',
          400: 'rgb(var(--tm-neutral-400) / <alpha-value>)',
          500: 'rgb(var(--tm-neutral-500) / <alpha-value>)',
          600: 'rgb(var(--tm-neutral-600) / <alpha-value>)',
          700: 'rgb(var(--tm-neutral-700) / <alpha-value>)',
          800: 'rgb(var(--tm-neutral-800) / <alpha-value>)',
          900: 'rgb(var(--tm-neutral-900) / <alpha-value>)',
          950: 'rgb(var(--tm-neutral-950) / <alpha-value>)',
        },
        sky: {
          100: 'rgb(var(--tm-sky-100) / <alpha-value>)',
          200: 'rgb(var(--tm-sky-200) / <alpha-value>)',
          300: 'rgb(var(--tm-sky-300) / <alpha-value>)',
          400: 'rgb(var(--tm-sky-400) / <alpha-value>)',
          500: 'rgb(var(--tm-sky-500) / <alpha-value>)',
          600: 'rgb(var(--tm-sky-600) / <alpha-value>)',
          700: 'rgb(var(--tm-sky-700) / <alpha-value>)',
          800: 'rgb(var(--tm-sky-800) / <alpha-value>)',
          900: 'rgb(var(--tm-sky-900) / <alpha-value>)',
          950: 'rgb(var(--tm-sky-950) / <alpha-value>)',
        },
        fuchsia: {
          400: 'rgb(var(--tm-fuchsia-400) / <alpha-value>)',
        },
        'tm-warn': 'rgb(var(--tm-warn) / <alpha-value>)',    // warm orange — warnings, OT segment
        'tm-pen':  'rgb(var(--tm-pen) / <alpha-value>)',     // hot pink-red — penalties
        'tm-good': 'rgb(var(--tm-good) / <alpha-value>)',    // vibrant green — extras bucket, "ok / sent / paid" states
        'tm-kit':  'rgb(var(--tm-kit) / <alpha-value>)',     // violet — kit money segment in breakdown buckets
        'tm-card-2': 'rgb(var(--tm-card-2) / <alpha-value>)',// one step lighter than card — for chips/pills that need to lift
      },
    },
  },
};

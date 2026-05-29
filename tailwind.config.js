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
  safelist: [
    'bg-tm-warn', 'bg-tm-pen', 'bg-tm-good', 'bg-tm-kit', 'bg-tm-card-2',
    'text-tm-warn', 'text-tm-pen', 'text-tm-good', 'text-tm-kit',
    'border-tm-warn', 'border-tm-pen', 'border-tm-good', 'border-tm-kit',
  ],
  theme: {
    extend: {
      colors: {
        'tm-warn': '#ff8a3d',    // warm orange — warnings, OT segment
        'tm-pen':  '#f43f5e',    // hot pink-red — penalties
        'tm-good': '#4ade80',    // vibrant green — extras bucket, "ok / sent / paid" states
        'tm-kit':  '#a78bfa',    // violet — kit money segment in breakdown buckets
        'tm-card-2': '#1f1f1f',  // one step lighter than card — for chips/pills that need to lift
      },
    },
  },
};

/** @type {import('tailwindcss').Config} */
// Approved identity tokens live in styles.css; body prose and functional UI use separate families.
const v = (name) => `${/^(cta|sage|alert)(-|$)/.test(name) && name !== 'cta-ink' ? 'oklch' : 'rgb'}(var(--c-${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Hover styles only on devices that can hover; touch gets press states instead.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: v('brand'), deep: v('brand-deep') },
        onbrand: v('on-brand'),
        canvas: v('canvas'),
        paper: v('paper'),
        ink: { DEFAULT: v('ink'), muted: v('ink-muted') },
        cta: { DEFAULT: v('cta'), deep: v('cta-deep'), ink: v('cta-ink') },
        sage: v('sage'),
        rule: v('rule'),
        alert: v('alert'),
      },
      fontFamily: {
        display: 'var(--f-display)',
        sans: 'var(--f-ui)',
        reading: 'var(--f-body)',
      },
      borderRadius: { btn: 'var(--r-btn)', card: 'var(--r-card)' },
      fontSize: {
        // Classic scale (Bringhurst): 14 16 18 21 24 30 36 48 60 72
        xs: ['0.75rem', { lineHeight: '1.5' }],
        sm: ['0.875rem', { lineHeight: '1.5' }],
        base: ['1.1875rem', { lineHeight: '1.473684' }],
        lg: ['1.3125rem', { lineHeight: '1.5' }],
        xl: ['1.5rem', { lineHeight: '1.35' }],
        '2xl': ['1.875rem', { lineHeight: '1.2' }],
        '3xl': ['2.25rem', { lineHeight: '1.15' }],
        '4xl': ['3rem', { lineHeight: '1.08' }],
        '5xl': ['3.75rem', { lineHeight: '1.04' }],
        '6xl': ['4.5rem', { lineHeight: '1.0' }],
      },
      maxWidth: { prose: '38rem', page: '72rem' },
    },
  },
  plugins: [],
}

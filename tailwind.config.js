/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ---- Base surface: near-black navy, NOT pure black. Aerospace console convention. ----
        base: {
          900: '#05080F',
          850: '#070C16',
          800: '#0A101C',
          750: '#0D1424',
          700: '#101829',
          600: '#162033',
        },
        surface: {
          DEFAULT: '#0A101C',
          raised: '#0D1424',
          sunken: '#070C16',
          hover: '#121A2B',
        },
        hairline: {
          DEFAULT: '#1B2537',
          strong: '#243146',
        },

        // ---- Telemetry / readouts ----
        ink: {
          DEFAULT: '#E6ECF5',
          muted: '#8C9AB2',
          dim: '#5A6781',
          faint: '#3A4557',
        },

        // ---- State colour language. Used identically in badges, map tint,
        //      timeline dots, sparklines and charts. One source of truth. ----
        nominal: {
          DEFAULT: '#2DD4BF', // cyan-teal : GNSS fused
          soft: '#5EEAD4',
          deep: '#0F766E',
        },
        nominalGreen: {
          DEFAULT: '#34D399',
          soft: '#6EE7B7',
          deep: '#047857',
        },
        degraded: {
          DEFAULT: '#F5A524', // amber : reduced confidence
          soft: '#FBBF4C',
          deep: '#92400E',
        },
        outage: {
          DEFAULT: '#F04E3E', // red : GNSS outage
          soft: '#FB7185',
          deep: '#7F1D1D',
        },
        ai: {
          DEFAULT: '#8B7BF7', // blue-violet : AI correction active
          soft: '#A99BFF',
          deep: '#4338CA',
        },
        recovering: {
          DEFAULT: '#4ADE80', // distinct green, pulsed : re-fusion
          soft: '#86EFAC',
          deep: '#15803D',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // The state indicator must be legible from across a room.
        'state-xl': ['2.75rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        'state-lg': ['2rem', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
        micro: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.08em' }],
      },
      borderRadius: {
        panel: '4px',
      },
      transitionTimingFunction: {
        // Physically-motivated: quick attack, settled settle. No bounce, no overshoot.
        instrument: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { opacity: '0.9', transform: 'scale(1)' },
          '70%': { opacity: '0', transform: 'scale(2.1)' },
          '100%': { opacity: '0', transform: 'scale(2.1)' },
        },
        'breathe': {
          '0%,100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        'trace-dash': {
          from: { strokeDashoffset: '0' },
          to: { strokeDashoffset: '-24' },
        },
        'sweep': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(100%)' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.22,0.61,0.36,1) infinite',
        breathe: 'breathe 2.4s ease-in-out infinite',
        'trace-dash': 'trace-dash 1.2s linear infinite',
        sweep: 'sweep 1.6s cubic-bezier(0.22,0.61,0.36,1) infinite',
        'rise-in': 'rise-in 220ms cubic-bezier(0.22,0.61,0.36,1) both',
      },
    },
  },
  plugins: [],
};

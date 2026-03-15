import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bulk: {
          // Primary accent colors
          green: '#00B482',
          red: '#EF4A3C',
          blue: '#2271B5',
          purple: '#7570B3',
          orange: '#FFB548',
          // Legacy aliases for compatibility
          teal: '#00B482',
          cyan: '#00B482',
          coral: '#EF4A3C',
          magenta: '#EF4A3C',
          yellow: '#FFB548',
        },
        dark: {
          primary: '#151411',    // Main background
          secondary: '#1B1A13',  // Card/section backgrounds
          tertiary: '#252319',   // Hover states
          border: '#554B4C',     // Stroke/borders
        },
        text: {
          primary: '#C7B6BA',    // Main text
          secondary: '#817778',  // Muted text
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        display: ['Orbitron', 'sans-serif'],
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(0, 180, 130, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(117, 112, 179, 0.3)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-20px)' },
        },
      },
    },
  },
  plugins: [],
}
export default config

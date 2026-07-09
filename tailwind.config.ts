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
        // === OFFICIAL BULK COLOR PALETTE ===
        bulk: {
          // Primary accent colors
          green: 'rgb(var(--pos-rgb) / <alpha-value>)',
          red: 'rgb(var(--neg-rgb) / <alpha-value>)',
          orange: '#FFB547',
          accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
          blue: '#2171B5',
          purple: '#7570B3',
          
          // Bids/Asks (same for both themes)
          bids: 'rgb(var(--pos-rgb) / <alpha-value>)',
          asks: 'rgb(var(--neg-rgb) / <alpha-value>)',
          
          // Secondary bids/asks
          'bids-secondary-dark': '#134A55',
          'bids-secondary-light': '#86CEDD',
          'asks-secondary-dark': '#6E1742',
          'asks-secondary-light': '#F16AAB',
          
          // Accent
          'accent-dark': '#FFB547',
          'accent-light': '#5A2C40',
          
          // Muted colors (with transparency)
          'muted-danger': 'rgba(239, 74, 60, 0.2)',
          'muted-warning': 'rgba(255, 181, 71, 0.2)',
          'muted-success': 'rgba(0, 180, 129, 0.2)',
          'muted-success-40': 'rgba(0, 180, 129, 0.4)',
          
          // Volume colors
          'volume-bids': 'rgba(0, 180, 129, 0.2)',
          'volume-asks': 'rgba(239, 74, 60, 0.2)',
        },
        
        // Dark theme colors
        dark: {
          base: '#141310',
          muted: '#1B1A14',
          'muted-80': 'rgba(27, 26, 20, 0.8)',
          'muted-20': 'rgba(27, 26, 20, 0.2)',
          background: '#1B1A14',
          'background-overlay': 'rgba(27, 26, 20, 0.8)',
          secondary: '#544A4C',
          'secondary-muted': '#544A4C',
          'secondary-20': 'rgba(84, 74, 76, 0.2)',
          'secondary-80': 'rgba(84, 74, 76, 0.8)',
          text: '#FFFEEF',
          'text-secondary': '#C6B6BA',
          'text-tertiary': '#807678',
          divider: '#544A4C',
          'button-stroke': 'rgba(198, 182, 186, 0.2)',
          // Legacy aliases
          primary: '#141310',
          tertiary: '#252319',
          border: '#544A4C',
        },
        
        // Light theme colors
        light: {
          base: '#EDECE3',
          muted: '#F9F8ED',
          'muted-80': 'rgba(249, 248, 237, 0.8)',
          'muted-20': 'rgba(249, 248, 237, 0.2)',
          background: '#F9F8ED',
          'background-overlay': 'rgba(249, 248, 237, 0.8)',
          secondary: '#C6B6BA',
          'secondary-muted': '#C6B6BA',
          'secondary-20': 'rgba(198, 182, 186, 0.2)',
          text: '#1B1A14',
          'text-secondary': '#736A6C',
          'text-tertiary': '#9C9092',
          divider: '#EDECE3',
          'button-stroke': 'rgba(115, 106, 108, 0.2)',
          // Legacy aliases
          primary: '#EDECE3',
          tertiary: '#E5E4DB',
          border: '#C6B6BA',
        },
        
        // Theme-aware text colors (used with CSS variables)
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
        },
        
        // Theme-aware background colors
        bg: {
          base: 'var(--bg-base)',
          muted: 'var(--bg-muted)',
          secondary: 'var(--bg-secondary)',
          overlay: 'var(--bg-overlay)',
        },
        
        // Theme-aware border/divider
        border: {
          DEFAULT: 'var(--border-color)',
          secondary: 'var(--border-secondary)',
        },
      },
      fontFamily: {
        sans: ['BULK', 'DIN Alternate', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        // Serif display face for page titles / hero text only — matches
        // BULK mainnet's editorial-serif headings. Body and data never
        // use this; numbers stay on sans/mono for legibility.
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(0, 180, 129, 0.3)' },
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

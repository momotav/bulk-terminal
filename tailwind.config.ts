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
          // Primary colors from BULK explorer
          teal: '#4ecdc4',      // Main teal/cyan color
          coral: '#e8846b',     // Coral/salmon for sell/negative
          // Secondary accent colors
          blue: '#3b82c4',      // Blue accent
          purple: '#8b7fc7',    // Purple accent
          // Semantic colors
          green: '#4ecdc4',     // Buy/positive (same as teal)
          red: '#e8846b',       // Sell/negative (same as coral)
          yellow: '#f5c842',    // Warnings/highlights
          // Legacy aliases for compatibility
          cyan: '#4ecdc4',
          magenta: '#e8846b',
        },
        dark: {
          primary: '#0d1117',   // Darker background like BULK
          secondary: '#161b22', // Card backgrounds
          tertiary: '#21262d',  // Hover states
          border: '#30363d',    // Borders
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
          '0%, 100%': { boxShadow: '0 0 20px rgba(78, 205, 196, 0.5)' },
          '50%': { boxShadow: '0 0 40px rgba(139, 127, 199, 0.5)' },
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

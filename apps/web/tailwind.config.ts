import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Outfit', 'sans-serif'],
        mono: ['Space Grotesk', 'monospace'],
      },
      colors: {
        primary: '#ff4444',
        accent: '#ff9600',
        success: '#00ff88',
        info: '#64b4ff',
        warning: '#ffb800',
        danger: '#ff4444',
        dark: {
          DEFAULT: '#0d0d12',
          deeper: '#08080c',
          card: 'rgba(255, 255, 255, 0.03)',
          sidebar: '#0a0a0f',
        },
      },
      borderRadius: {
        DEFAULT: '12px',
      },
      boxShadow: {
        'glow-red': '0 0 20px rgba(255, 68, 68, 0.2)',
        'glow-green': '0 0 20px rgba(0, 255, 136, 0.2)',
        'glow-orange': '0 0 20px rgba(255, 150, 0, 0.2)',
      },
    },
  },
  plugins: [],
}
export default config

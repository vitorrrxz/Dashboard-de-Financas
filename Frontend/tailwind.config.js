/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0f',
        dashboard: '#12121a',
        primary: '#6366f1',
        secondary: '#a855f7',
        accent: '#14b8a6',
        card: '#1c1c24',
        textMain: '#ffffff',
        textMuted: '#9ca3af',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}

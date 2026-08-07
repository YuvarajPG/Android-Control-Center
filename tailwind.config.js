/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/renderer/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        m3: {
          // Dark Backgrounds & Surface Elevations
          bg: '#0F0E13',
          'surface-0': '#0F0E13',
          'surface-1': '#17171E',
          'surface-2': '#1E1F27',
          'surface-3': '#262732',
          'surface-4': '#2E303D',
          'surface-5': '#373948',
          
          // Primary Palette (Android Blue / Accent)
          primary: '#A8C7FA',
          'on-primary': '#003062',
          'primary-container': '#004A77',
          'on-primary-container': '#C2E7FF',
          
          // Secondary Palette (Cyan / Teal)
          secondary: '#7CD5EC',
          'on-secondary': '#00363F',
          'secondary-container': '#004F58',
          'on-secondary-container': '#A6EEFF',
          
          // Tertiary Palette (Lavender Accent)
          tertiary: '#D0BCFF',
          'on-tertiary': '#381E72',
          'tertiary-container': '#4F378B',
          'on-tertiary-container': '#EADDFF',
          
          // On Surface Content & Borders
          'on-surface': '#E3E2E6',
          'on-surface-variant': '#C4C6D0',
          outline: '#8E9099',
          'outline-variant': '#44474E',
          
          // Status Indicators
          success: '#6DD58C',
          'on-success': '#003919',
          'success-container': '#005327',
          warning: '#FFB951',
          'on-warning': '#452B00',
          'warning-container': '#633F00',
          error: '#F2B8B5',
          'on-error': '#601410',
          'error-container': '#8C1D18',
        },
      },
      fontFamily: {
        sans: ['Roboto', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      borderRadius: {
        'm3-sm': '8px',
        'm3-md': '12px',
        'm3-lg': '16px',
        'm3-xl': '28px',
        'm3-full': '9999px',
      },
      boxShadow: {
        'm3-1': '0px 1px 3px 1px rgba(0, 0, 0, 0.25), 0px 1px 2px 0px rgba(0, 0, 0, 0.3)',
        'm3-2': '0px 2px 6px 2px rgba(0, 0, 0, 0.25), 0px 1px 2px 0px rgba(0, 0, 0, 0.3)',
        'm3-3': '0px 4px 8px 3px rgba(0, 0, 0, 0.25), 0px 1px 3px 0px rgba(0, 0, 0, 0.3)',
      },
    },
  },
  plugins: [],
};

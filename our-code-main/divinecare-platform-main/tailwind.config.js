/** @type {import('tailwindcss').Config} */
/**
 * Oct 22 brand remap — product `blue-*` → purple hex (#5C2D91 primary).
 */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
    './src/providers/**/*.{js,ts,jsx,tsx,mdx}',
    './src/hooks/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        blue: {
          50: '#F5F3FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#7C3AED',
          600: '#5C2D91',
          700: '#4A2475',
          800: '#3B1D5E',
          900: '#141C34',
          950: '#0B1220',
        },
        clinic: {
          primary: '#5C2D91',
          'primary-dark': '#4A2475',
          soft: '#F5F3FF',
          navy: '#141C34',
          bg: '#F8FAFC',
          surface: '#ffffff',
          border: '#E2E8F0',
          text: '#141C34',
          muted: '#64748B',
        },
        altrixs: {
          primary: '#5C2D91',
          'primary-light': '#7C3AED',
          'primary-dark': '#4A2475',
          secondary: '#7C3AED',
          'secondary-light': '#A78BFA',
          accent: '#141C34',
          'accent-light': '#F5F3FF',
          coral: '#ea580c',
          rose: '#e11d48',
          bg: '#F8FAFC',
          surface: '#FFFFFF',
          'surface-alt': '#F5F3FF',
          text: '#141C34',
          'text-secondary': '#64748B',
          'text-light': '#94A3B8',
          border: '#E2E8F0',
        },
      },
      boxShadow: {
        xs: '0 1px 2px rgba(20,28,52,0.05)',
        clinic: '0 1px 2px rgba(20, 28, 52, 0.04), 0 1px 3px rgba(20, 28, 52, 0.03)',
        'clinic-md': '0 4px 16px rgba(20, 28, 52, 0.08)',
      },
      borderRadius: {
        clinic: '12px',
      },
    },
  },
  plugins: [],
};

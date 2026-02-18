/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        pastel: {
          bg: '#C5D1E8',
          'bg-light': '#D4DCF0',
          'bg-dark': '#B8C5E0',
          card: '#E8ECF4',
          'card-hover': '#F0F3F9',
          navy: '#1E2A4A',
          'navy-light': '#2A3B5C',
          accent: '#5B9BD5',
          'accent-light': '#7BB3E0',
          teal: '#6BB5B5',
          muted: '#8A9AB5',
          text: '#3A4A6B',
          'text-light': '#6B7A9A',
        },
      },
      boxShadow: {
        'neumorphic': '8px 8px 20px rgba(163, 177, 198, 0.6), -8px -8px 20px rgba(255, 255, 255, 0.8)',
        'neumorphic-sm': '4px 4px 10px rgba(163, 177, 198, 0.5), -4px -4px 10px rgba(255, 255, 255, 0.7)',
        'neumorphic-inset': 'inset 4px 4px 10px rgba(163, 177, 198, 0.5), inset -4px -4px 10px rgba(255, 255, 255, 0.7)',
        'neumorphic-lg': '12px 12px 30px rgba(163, 177, 198, 0.6), -12px -12px 30px rgba(255, 255, 255, 0.8)',
        'soft': '4px 4px 10px rgba(163, 177, 198, 0.5), -4px -4px 10px rgba(255, 255, 255, 0.7)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};

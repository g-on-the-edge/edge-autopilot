/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/commander/**/*.{js,ts,jsx,tsx,html}',
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          750: 'rgb(41 52 71)',
        },
      },
    },
  },
  plugins: [],
};

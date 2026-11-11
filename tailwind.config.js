/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./views/**/*.ejs', './public/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        cream: '#FFFBF4',
        amber: {
          50: '#FEF6E7',
          100: '#FCE8C3',
          500: '#D97706',
          600: '#B45309',
          700: '#92400E',
        },
        rose: {
          400: '#FB7185',
          500: '#F43F5E',
          600: '#E11D48',
        },
      },
      fontFamily: {
        display: ['Fredoka', 'ui-rounded', 'sans-serif'],
        body: ['Nunito Sans', 'ui-sans-serif', 'sans-serif'],
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './layout/*.liquid',
    './sections/*.liquid',
    './snippets/*.liquid',
    './templates/**/*.liquid',
    './assets/*.js',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

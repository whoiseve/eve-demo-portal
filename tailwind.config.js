/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        uxblack: "#161a1b",
        uxoffwhite: "#e9e5e4",
        uxorange: "#f87500",
        uxred: "#d61106",
        uxgray: "#2a2e30",
      },
    },
  },
  plugins: [],
};

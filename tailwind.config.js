/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#043D8B",
          light: "#8ED8FC"
        }
      }
    }
  },
  plugins: []
}
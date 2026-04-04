/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        dm: {
          bg: "#121317",
          "surface-high": "#212226",
          "surface-higher": "#2f3034",
          text: "#f8f9fc",
          "text-secondary": "#b2bbc5",
          blue: "#3c90ff",
          green: "#0ebc5f",
          red: "#ff4c45",
          outline: "rgba(230,234,240,0.12)",
        },
      },
      fontFamily: {
        sans: ['"Google Sans"', "Segoe UI", "system-ui", "-apple-system", "sans-serif"],
      },
      animation: {
        "title-appear": "title-appear 1.2s ease-out forwards",
        "subtitle-appear": "subtitle-appear 1.2s ease-out 0.3s forwards",
        "button-appear": "button-appear 1s ease-out 0.6s forwards",
        glow: "glow 2s infinite alternate",
        shimmer: "shimmer 1.5s infinite",
        "fade-in-up": "fade-in-up 0.6s ease-out",
        "typing-dot": "typing-dot 1.2s infinite",
        "scan-line": "scan-line 2s linear infinite",
        "pulse-ring": "pulse-ring 1.5s cubic-bezier(0.4,0,0.6,1) infinite",
      },
      keyframes: {
        "title-appear": {
          "0%": { opacity: "0", filter: "blur(8px)", transform: "translateY(20px)" },
          "100%": { opacity: "1", filter: "blur(0px)", transform: "translateY(0)" },
        },
        "subtitle-appear": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "button-appear": {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.95)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        glow: {
          "0%": { textShadow: "0 0 20px rgba(248,249,252,0.1)" },
          "100%": { textShadow: "0 0 80px rgba(248,249,252,0.15)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "typing-dot": {
          "0%, 80%, 100%": { transform: "translateY(0)" },
          "40%": { transform: "translateY(-4px)" },
        },
        "scan-line": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(255,76,69,0.4)" },
          "70%": { boxShadow: "0 0 0 10px rgba(255,76,69,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(255,76,69,0)" },
        },
      },
    },
  },
  plugins: [],
};

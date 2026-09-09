/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Core ThrottleHAWK palette — matte dark base with a neon-teal
        // signal accent, evoking a raptor's-eye telemetry HUD rather
        // than a generic SaaS admin panel.
        hawk: {
          bg: '#0B0E14', // matte dark background
          panel: '#11151D', // slightly raised panel surface
          border: '#1E2530', // hairline panel borders
          muted: '#5A6472', // secondary/quiet text
          text: '#D7DEE8', // primary body text
          teal: '#00E676', // neon accent — allowed / healthy signal
          amber: '#FFB300', // near-limit warning signal
          red: '#FF3B5C', // blocked / 429 signal
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px rgba(0, 230, 118, 0.25)',
      },
    },
  },
  plugins: [],
};

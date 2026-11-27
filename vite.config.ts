import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/FinancesPWA/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "pwa-icon.svg"],
      manifest: {
        id: "/FinancesPWA/",
        name: "SheetFinances",
        short_name: "Finanças",
        description: "Seu espaço financeiro pessoal.",
        theme_color: "#172554",
        background_color: "#f4f6fb",
        display: "standalone",
        scope: "/FinancesPWA/",
        start_url: "/FinancesPWA/",
        icons: [
          {
            src: "pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{css,html,ico,js,svg,woff2}"]
      }
    })
  ],
  server: {
    port: 5173
  }
});

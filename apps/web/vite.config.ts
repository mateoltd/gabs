import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "auto",
      manifest: {
        name: "Common Business Suite",
        short_name: "Common",
        theme_color: "#23231e",
        background_color: "#25251f",
        display: "standalone",
        start_url: "/",
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    strictPort: true,
    proxy: {
      "/api": process.env.API_PROXY ?? "http://localhost:4310",
      "/auth": process.env.API_PROXY ?? "http://localhost:4310",
    },
  },
  build: { sourcemap: false },
});

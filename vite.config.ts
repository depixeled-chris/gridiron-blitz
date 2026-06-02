import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// `base` must match the GitHub Pages path. For a project site that's
// `/<repo>/`; the deploy workflow injects it via VITE_BASE. Defaults to "/"
// for local dev and user/org pages. Vite requires a trailing slash.
const raw = process.env.VITE_BASE ?? "/";
const base = raw.endsWith("/") ? raw : `${raw}/`;

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Gridiron Blitz",
        short_name: "Gridiron",
        description: "A Tecmo Bowl-style arcade football game.",
        theme_color: "#0a0e1a",
        background_color: "#0a0e1a",
        display: "standalone",
        orientation: "landscape",
        categories: ["games", "sports"],
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
  server: { port: 5173, open: true },
});

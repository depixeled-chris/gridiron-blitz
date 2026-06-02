import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` must match the GitHub Pages path. For a project site that's
// `/<repo>/`; the deploy workflow injects it via VITE_BASE. Defaults to "/"
// for local dev and user/org pages. Vite requires a trailing slash.
const raw = process.env.VITE_BASE ?? "/";
const base = raw.endsWith("/") ? raw : `${raw}/`;

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5173, open: true },
});

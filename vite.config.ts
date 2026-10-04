import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    // Listen on every interface (IPv4 and IPv6) so the dev server starts on any machine.
    host: true,
    port: Number(process.env.PORT) || 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  build: {
    // three.js alone is ~690 kB minified and is already split into its own long-lived chunk.
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: the 3D stack changes far less often than app code.
        // Assign each package explicitly: the object form also pulls shared dependencies
        // (React's JSX runtime) into the 3D chunks, which would put them on the first load.
        manualChunks: (id) => {
          // Vite's dynamic-import helper is used by the app too; keep it out of the 3D chunks.
          if (id.includes('vite/preload-helper')) return 'react';
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/three\//.test(id)) return 'three';
          if (/node_modules\/(@react-three|three-stdlib|postprocessing|maath|troika-[^/]+|three-mesh-bvh|camera-controls|meshline|stats-gl|detect-gpu|@monogrid)\//.test(id)) return 'r3f';
          if (/node_modules\/(gsap|@gsap)\//.test(id)) return 'gsap';
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run|zustand|use-sync-external-store|@babel\/runtime)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
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
        manualChunks: {
          three: ["three"],
          r3f: ["@react-three/fiber", "@react-three/drei", "@react-three/postprocessing"],
          gsap: ["gsap", "@gsap/react"],
          react: ["react", "react-dom", "react-router-dom"],
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

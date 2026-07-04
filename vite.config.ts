import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

// base: "./" keeps every asset URL relative, so the built site works at any
// GitHub Pages path (user.github.io/<repo>/) without rebuilding.
export default defineConfig({
  base: "./",
  // @ifc-lite/ids bundles a top-level `await import()` (a Node-only branch of its
  // XML parser). Top-level await needs a modern target; the app already requires
  // WebGPU, so targeting esnext is safe and avoids the es2020 transpile error.
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        // Stable vendor code gets its own chunks so a redeploy of app code
        // doesn't invalidate the React/proj4 bytes in the browser cache.
        manualChunks(id: string) {
          const p = id.replace(/\\/g, "/");
          if (/node_modules\/(react|react-dom|scheduler)\//.test(p)) return "react";
          if (p.includes("node_modules/proj4")) return "proj4";
        },
      },
    },
  },
  plugins: [
    react(),
    // Copies Cesium's static assets (Workers/Assets/Widgets/ThirdParty) into the
    // build and sets window.CESIUM_BASE_URL so the globe view (GlobeViewer) works.
    // rebuildCesium bundles Cesium into the module graph instead of a blocking
    // <script src="cesium/Cesium.js"> tag in index.html — combined with the
    // lazy() GlobeViewer import in App.tsx, the multi-MB Cesium code downloads
    // only when the Glob 3D tab is first opened.
    cesium({ rebuildCesium: true }),
  ],
  worker: { format: "es" },
  // @ifc-lite ships its own wasm + workers via `new URL(..., import.meta.url)`.
  // Excluding the packages from dep-optimization lets Vite resolve those URLs
  // (otherwise the bundled deps lose the worker/wasm asset references).
  optimizeDeps: {
    exclude: ["@ifc-lite/parser", "@ifc-lite/geometry", "@ifc-lite/renderer", "@ifc-lite/wasm"],
    // @ifc-lite/ids gets pre-bundled (not excluded); its top-level await needs a
    // modern esbuild target here too, or the dev dep-optimizer fails like the build did.
    esbuildOptions: { target: "esnext" },
  },
});

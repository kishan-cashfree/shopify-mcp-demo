import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/widget",
    rollupOptions: {
      output: {
        entryFileNames: "widget.js",
        chunkFileNames: "widget-[name].js",
        assetFileNames: "widget.[ext]",
      },
    },
  },
});

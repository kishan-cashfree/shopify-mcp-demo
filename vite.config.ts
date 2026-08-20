import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev server only — none of this reaches the built widget, which is inlined
  // into the MCP resource and never served over HTTP.
  server: {
    // Bound beyond loopback so a tunnel, or a phone on the same wifi, can
    // reach the `?screen=` previewer. Vite 7 defaults to localhost.
    host: true,
    // Vite rejects any request whose Host header it does not recognise — a
    // DNS-rebinding guard. Through a tunnel the Host is the tunnel's domain,
    // so without this the preview answers "Blocked request. This host is not
    // allowed." and nothing else. Scoped to ngrok's domains rather than `true`,
    // which would switch the guard off for every host.
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"],
  },
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

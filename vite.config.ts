import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Pre-bundle everything the lazy sections import. Otherwise Vite discovers
  // xterm the first time Terminal opens, re-optimises, and the open tab's
  // dynamic import fails with a stale module until a manual refresh.
  optimizeDeps: {
    include: [
      "@xterm/xterm",
      "@xterm/addon-fit",
      "@xterm/addon-search",
      "@xterm/addon-web-links",
      "@xterm/addon-webgl",
      "lucide-react",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4310",
      "/ws": {
        target: "ws://127.0.0.1:4310",
        ws: true,
      },
    },
  },
});

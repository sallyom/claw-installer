import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 3001,
    host: "0.0.0.0",
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
